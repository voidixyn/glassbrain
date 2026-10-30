# Demo data

One convention; follow it and the demo picks new data up with no code change.

## Layout

```
<project>/<version>/**.json    one folder = one complete graph (sub-folders allowed)
<project>/_profile.json        optional: the project's declarative profile (see below)
<project>/_layout.json         optional: preset positions, `{ <version>: { <node id>: {x, y} } }`
diffable.json                  which versions can be compared with which
```

- **Folder names are the labels** in the UI. A number in front of a version name (`1-skeleton`)
  only sorts; that order is the timeline when browsing.
- **One graph = one folder.** Every `.json` in it goes to `parseSources` together.
- The same layout opens with the CLI: `npx glassbrain view data/demo/boards`.

## diffable.json

An array of groups of versions. Versions in one group can be compared; pick one and the
reference list offers the others in its groups (a version may be in several).

## The datasets

Every dataset but `glassbrain-src` was made by an agent; its `RUN.md` has the prompt, the model and the token count.

| | Made with | |
|---|---|---|
| [`boards/`](boards/RUN.md) | the `docs-to-kg` skill | 4ga Boards' docs and app read separately, merged into 268 user stories with dependencies |
| [`agent-stack/`](agent-stack/RUN.md) | a one-paragraph prompt, web search | the AI agent ecosystem in three layers, from memory and then web-checked |
| [`flask/`](flask/RUN.md) | the `kg-build` skill | Flask's source: every module, class and method, with descriptions and call / import edges |
| [`agent-plan/`](agent-plan/RUN.md) | a one-paragraph prompt | an agent's plan before coding, then its self-review |
| [`how-agents-work/`](how-agents-work/RUN.md) | a one-paragraph prompt | how an LLM agent works, explained from first principles |
| [`citations/`](citations/RUN.md) | a one-paragraph prompt, web search | RAG and agent memory research, 2017–2026 |
| [`graphify-flask/`](graphify-flask/RUN.md) | Graphify, no LLM | Graphify's own `graph.json`, opened as is |
| [`mcp-wiki/`](mcp-wiki/RUN.md) | a one-paragraph prompt, web search | an LLM wiki (markdown + `[[links]]`), opened as is |
| `glassbrain-src/` | `node scripts/gen-demo-data.mjs` | this repository's own `src/` at two revisions, read from the source |

A dataset in another tool's format sets `"demo": { "convert": true }` in its `_profile.json`; the build converts it with
the same adapters as the CLI.

## `_profile.json`

Only declarative fields, handed to `defineProfile` as they are: `layers`, `nodePalette`,
`edgePalette`, `kindLabels` (shared by node and edge kinds), `placeholderFlags`, `detail`, `style`
(see [`schema/profile.schema.json`](../../schema/profile.schema.json)). Plus a `demo` block that
belongs to the demo page: `description` (one line, `{en, zh}`), `source` (one markdown sentence on how
it was made, shown under the versions; relative links are repository paths), `assetBase` (where relative image
URLs in the docs resolve), `order`, `view` (initial look knobs) and `convert` (see above). Parsing always uses the
library's built-in `{nodes, edges}`.
