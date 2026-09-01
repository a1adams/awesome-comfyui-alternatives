# Contributing

Corrections and additions are welcome, including corrections to the entry for the tool that maintains this list.

## The bar for an entry

A tool gets in if someone can use it today for the job this list is about. Popularity, funding and launch announcements are not criteria.

Every entry carries four things:

1. **What it is** — one or two sentences, plain language.
2. **Where it stops** — the honest limit. An entry with no limits line will not be merged.
3. **A link that works** — homepage, and docs or a pricing page where they exist.
4. **A quickstart** — the real install command or connector URL if the tool has a public API, CLI or MCP server. If it has none, link the docs instead. Do not invent one.

## How the data works

`data/tools.json` is the source of truth. `README.md` tables are generated from it.

- Edit `data/tools.json`, never the generated tables in `README.md` directly. Anything between `<!-- DATA-TABLE:START -->` / `<!-- CAPABILITY-SCORES:START -->` markers is overwritten on the next run.
- Regenerate with `node scripts/update.js --offline` (no network, README only).
- `node scripts/update.js` also refreshes live GitHub data — star counts and latest release tags for the tools that publish an official repo. A weekly GitHub Action runs the same command and commits only when something actually changed.
- `node scripts/update.js --check` exits non-zero if the README drifted from `tools.json`.

## What is deliberately not in the data

Prices, credit costs and model counts are not stored as numbers. They change faster than any list gets updated, and a stale number in a comparison table is worse than no number. The table links to each vendor's own pricing page instead.

Star counts and release tags are the exception: they are fetched live from the GitHub API every week, so the number you see is the number that was true at the timestamp shown.

## Capability scores

The score column counts how many of the checks in `data/tools.json` → `capabilityChecks` a tool passes. The checks and the per-tool answers are both in the file. If you think a cell is wrong, open an issue naming the tool, the check, and the evidence.

## Pull requests

Small PRs, one tool per PR. Run `node scripts/update.js --offline` before committing so the tables match the data. No badges, no star-count bragging in prose, no "trusted by" lines.
