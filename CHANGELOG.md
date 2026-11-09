# Changelog

## 0.1.3

- Dark canvases now theme the built-in controls automatically: `DARK_THEME` needs no `--gb-*`
  setup, and a light graph embedded in a dark page keeps light controls.
- The legend expands and collapses with the same 220ms easing as search, and respects reduced
  motion.
- README's "Try it yourself" now leads with three ways in — demo, agent + `npx glassbrain`,
  React — plus the one-line prompt and examples; the demo links to the repo by name.
- `docs/cli.md` says what the layout benchmark does and does not measure.

## 0.1.2

- `npx glassbrain` help: what each pass should contain and what its diff should show, and how to
  give each kind a color in `_profile.json` (with a pointer to the profile schema). No library changes.

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
