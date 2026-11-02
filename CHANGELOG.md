# Changelog

## 0.1.1

- `npx glassbrain` (no arguments) now prints the format and how to build a graph in passes, so
  an agent told only "run `npx glassbrain` first" can write a valid graph without reading the docs.

## 0.1.0

First release.

- `GraphCanvas`: containment-shaped layout, version transitions, side-by-side diff, 2.5D layers,
  search, detail panel, editing as a patch of operations, themes and dark mode, i18n.
- `glassbrain/core`: parse, merge, validate, diff and edit without React.
- `glassbrain/adapters`: Graphify, Understand-Anything, MCP memory, Obsidian / markdown folders.
- CLI `npx glassbrain`: `view`, `diff` (against git refs too), `validate`, `convert`.
- JSON Schemas for graph files and `_profile.json`; agent skills `kg-build`, `kg-view`,
  `kg-diff`, `docs-to-kg`.
