#!/usr/bin/env node
'use strict';

/**
 * scripts/update.js — refresh live data and regenerate the README tables.
 *
 * Zero dependencies. Node 18+ (uses global fetch).
 *
 *   node scripts/update.js            # fetch live data, rewrite data/tools.json + README.md
 *   node scripts/update.js --offline  # regenerate README from data/tools.json only (no network)
 *   node scripts/update.js --check    # exit 1 if the README is out of date with tools.json
 *
 * What is fetched, and only this:
 *   GET https://api.github.com/repos/<owner>/<repo>            -> stargazers_count, pushed_at
 *   GET https://api.github.com/repos/<owner>/<repo>/releases/latest -> tag_name, published_at
 *
 * Nothing else is scraped. Prices, free tiers and model counts are NOT fetched, because a
 * number scraped from a marketing page and then frozen in a table is how these lists go
 * stale and start lying. Those columns link to the vendor's own page instead.
 *
 * The README is regenerated between HTML comment markers, so hand-written prose outside the
 * markers is never touched and the output is deterministic for a given tools.json.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data', 'tools.json');
const README = path.join(ROOT, 'README.md');

const MARKERS = {
  table: 'DATA-TABLE',
  scores: 'CAPABILITY-SCORES',
  checked: 'LAST-CHECKED',
};

// ---------------------------------------------------------------------------
// rendering (shared with the generator — keep this the ONLY implementation)
// ---------------------------------------------------------------------------

const cell = (s) => String(s === null || s === undefined ? '' : s).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim();

const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, '')
    .trim()
    .replace(/\s+/g, '-');

const anchorFor = (t) => `#${slug(`${t.n}. ${t.name}`)}`;

const yesNo = (v) => (v === true ? 'Yes' : v === false ? 'No' : null);

/** "2026-08-31" from an ISO timestamp, or null. */
const day = (s) => (s ? String(s).slice(0, 10) : null);

/**
 * Column definitions. `get` returns a rendered cell or null; a column whose every value is
 * null is dropped, so a list with no verified pricing pages does not ship an empty column.
 */
const COLUMNS = [
  { key: 'tool', header: 'Tool', get: (t) => `**[${cell(t.name)}](${anchorFor(t)})**`, always: true },
  { key: 'connection', header: 'Claude connection', get: (t) => cell(t.claudeConnection) || null },
  { key: 'api', header: 'REST API', get: (t) => yesNo(t.restApi) },
  { key: 'freeTier', header: 'Free tier', get: (t) => (t.freeTier === 'yes' ? 'Yes' : t.freeTier === 'no' ? 'No' : t.pricing ? `[check](${t.pricing})` : null) },
  { key: 'models', header: 'Model support', get: (t) => cell(t.modelSupport) || null },
  { key: 'pricing', header: 'Pricing', get: (t) => (t.pricing ? `[pricing](${t.pricing})` : null) },
  {
    key: 'repo',
    header: 'Open-source SDK / MCP',
    get: (t) => {
      if (!t.repo) return null;
      const live = t.live || {};
      const bits = [];
      if (typeof live.stars === 'number') bits.push(`${live.stars.toLocaleString('en-US')} ★`);
      if (live.latestRelease) bits.push(`${live.latestRelease}`);
      else if (live.lastPush) bits.push(`pushed ${day(live.lastPush)}`);
      const suffix = bits.length ? ` — ${bits.join(', ')}` : '';
      return `[${cell(t.repo)}](https://github.com/${t.repo})${suffix}`;
    },
  },
];

function renderTable(data) {
  const tools = data.tools || [];
  const cols = COLUMNS.filter((c) => c.always || tools.some((t) => c.get(t) !== null && c.get(t) !== ''));
  const lines = [];
  lines.push(`| ${cols.map((c) => c.header).join(' | ')} |`);
  lines.push(`|${cols.map(() => '---').join('|')}|`);
  for (const t of tools) {
    lines.push(`| ${cols.map((c) => c.get(t) || '—').join(' | ')} |`);
  }
  return lines.join('\n');
}

/**
 * Capability score = how many of the list's capability checks a tool passes. The checks and
 * the per-tool answers both live in data/tools.json, so the ranking is reproducible and
 * arguable — open an issue if you disagree with a cell, not with the arithmetic.
 */
function renderScores(data) {
  const checks = data.capabilityChecks || [];
  if (!checks.length) return '';
  const scored = (data.tools || []).map((t) => {
    const caps = t.capabilities || {};
    const hits = checks.filter((c) => caps[c.key] === true).length;
    return { t, hits };
  });
  scored.sort((a, b) => b.hits - a.hits || (a.t.n || 0) - (b.t.n || 0));
  const lines = [];
  lines.push(`| Tool | ${checks.map((c) => c.label).join(' | ')} | Score |`);
  lines.push(`|------|${checks.map(() => '---').join('|')}|-------|`);
  for (const { t, hits } of scored) {
    const caps = t.capabilities || {};
    const row = checks.map((c) => (caps[c.key] === true ? '✅' : caps[c.key] === false ? '❌' : '—'));
    lines.push(`| **[${cell(t.name)}](${anchorFor(t)})** | ${row.join(' | ')} | **${hits}/${checks.length}** |`);
  }
  return lines.join('\n');
}

function replaceBlock(md, marker, body) {
  const start = `<!-- ${marker}:START -->`;
  const end = `<!-- ${marker}:END -->`;
  const re = new RegExp(`${start}[\\s\\S]*?${end}`);
  if (!re.test(md)) return md;
  return md.replace(re, `${start}\n${body}\n${end}`);
}

function renderReadme(md, data) {
  let out = md;
  out = replaceBlock(out, MARKERS.table, renderTable(data));
  const scores = renderScores(data);
  if (scores) out = replaceBlock(out, MARKERS.scores, scores);
  out = replaceBlock(
    out,
    MARKERS.checked,
    `Live repository data last checked **${data.lastChecked || 'never'}** by [\`scripts/update.js\`](scripts/update.js), which runs weekly via GitHub Actions.`
  );
  return out;
}

// ---------------------------------------------------------------------------
// live fetch
// ---------------------------------------------------------------------------

async function gh(pathname) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'awesome-list-refresh',
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com${pathname}`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${pathname} -> ${res.status}`);
  return res.json();
}

async function refresh(data) {
  const today = new Date().toISOString().slice(0, 10);
  for (const t of data.tools || []) {
    if (!t.repo) continue;
    const repo = await gh(`/repos/${t.repo}`);
    if (!repo) {
      console.error(`warn: ${t.repo} not found — leaving previous values in place`);
      continue;
    }
    const rel = await gh(`/repos/${t.repo}/releases/latest`);
    t.live = {
      stars: repo.stargazers_count,
      lastPush: repo.pushed_at,
      latestRelease: rel && rel.tag_name ? rel.tag_name : null,
      latestReleaseDate: rel && rel.published_at ? rel.published_at.slice(0, 10) : null,
      checkedAt: today,
    };
    console.log(`  ${t.repo}: ${repo.stargazers_count} stars, release ${t.live.latestRelease || '(none)'}`);
  }
  data.lastChecked = today;
  return data;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const offline = argv.includes('--offline');
  const check = argv.includes('--check');

  const before = fs.readFileSync(DATA, 'utf8');
  const data = JSON.parse(before);

  if (!offline && !check) {
    console.log('fetching live repository data…');
    await refresh(data);
  }

  const dataOut = JSON.stringify(data, null, 2) + '\n';
  const mdBefore = fs.readFileSync(README, 'utf8');
  const mdOut = renderReadme(mdBefore, data);

  if (check) {
    const stale = mdOut !== mdBefore;
    console.log(stale ? 'README is OUT OF DATE with data/tools.json' : 'README matches data/tools.json');
    process.exit(stale ? 1 : 0);
  }

  const changed = dataOut !== before || mdOut !== mdBefore;
  if (dataOut !== before) fs.writeFileSync(DATA, dataOut);
  if (mdOut !== mdBefore) fs.writeFileSync(README, mdOut);
  console.log(changed ? 'CHANGED' : 'NO CHANGE');
  process.exit(0);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e && e.stack ? e.stack : String(e));
    process.exit(1);
  });
}

module.exports = { renderTable, renderScores, renderReadme, replaceBlock, MARKERS, anchorFor };
