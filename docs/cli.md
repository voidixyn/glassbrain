# glassbrain CLI

```bash
npx glassbrain <path>                   # open in the browser
npx glassbrain diff <git-ref> <path>    # what changed since that commit
npx glassbrain validate <path>          # schema + structure checks, exit 1 on errors
npx glassbrain convert <path> [out]     # any supported format → glassbrain JSON
```

`<path>` is a file, a folder, or `<git-ref>:<path>` (`HEAD~1:kg`, `main:graph.json`).
`npx glassbrain --help` lists every option; an unknown option is an error.

**Exit codes:** 0 ok · 1 `validate` found errors (or warnings with `--strict`), or `diff --exit-code`
found changes · 2 a usage error or input that cannot be read. Notes about files that were found
but not read (a README next to the versions, a malformed `_profile.json`) go to stderr.

## view

Writes **one self-contained html file** (data inlined, no server, works from `file://`, safe
to send to someone) and opens it. `--out page.html` chooses where; `--no-open` only writes it.
Without `--out` the page goes to the system temp folder, readable only by you.

A folder with two or more sub-folders that each hold JSON (`1-skeleton/`, `2-filled/`, …) and no
JSON of its own opens as **versions** (other files, like a README, are ignored). It opens on the
latest version; ‹ › (or the arrow keys) step through them with the transition, "compare with
previous" shows the two side by side. A `_profile.json` next to them sets colors and names; a
`_layout.json` (`{ "<version>": { "<id>": {x, y} } }`) pins positions.

## diff

```bash
npx glassbrain diff kg                    # working tree vs. HEAD
npx glassbrain diff HEAD~3 kg             # vs. any commit
npx glassbrain diff old.json new.json     # two files or folders
```

Prints added / removed / changed / moved nodes and added / removed edges. In a terminal it
also opens the side-by-side page; when an agent or a pipe calls it, it only prints.
`--json` for programs, `--all` for every line, `--exit-code` to fail CI when anything
changed, `--ignore a,b` for fields that change on every rebuild.

Nodes are matched by `id`, edges by their two ends plus `kind`. A node whose `parent` changed
is reported as **moved**, not as removed + added. Edges pointing at a node that does not exist
are left out of the comparison (`validate` reports them).

`--json` prints `{ before, after, nodes: { added, removed, changed, moved, merged, kept }, edges:
{ added, removed, kept }, changes, edgeChanges }`; `merged` counts old nodes that map onto one new
node (only with a matching `key` in the library; the CLI matches by id, so it is 0).

## validate

Checks every JSON file against [`schema/graph.schema.json`](../schema/graph.schema.json) (and
`_profile.json` against [`schema/profile.schema.json`](../schema/profile.schema.json)), then
the merged graph: dangling edges, duplicate ids and edges, missing parents, parent cycles,
JSON files that are not graphs. Errors exit 1; `--strict` makes warnings exit 1 too.

## Formats

Detected from content, not from file names. `--format <id>` forces one.

| Format | id | Structure (`parent`) comes from | Edges |
|---|---|---|---|
| glassbrain `{nodes, edges}` | `native` | `parent` | as written |
| [Graphify](https://github.com/Graphify-Labs/graphify) `graphify-out/graph.json` | `graphify` | `contains`, `method`, `rationale_for`; then source file → folder | every other `relation`; `confidence_score` → weight |
| [Understand-Anything](https://github.com/Egonex-AI/Understand-Anything) `.ua/knowledge-graph.json` | `understand-anything` | `contains`, `contains_flow`, `flow_step`, `categorized_under`; architecture layers; then folder | every other `type`; `backward` edges are flipped |
| [MCP memory](https://github.com/modelcontextprotocol/servers/tree/main/src/memory) `memory.jsonl` (or `read_graph` JSON) | `memory` | `entityType` groups | relations; observations → detail panel |
| Markdown folder (Obsidian, LLM wiki) | `obsidian` | folders | `[[wikilinks]]` and links to `.md`; frontmatter `title` / `type` / `tags` |

The same converters are a library entry point, for a page of your own:

```ts
import { adapt } from 'glassbrain/adapters';
import { defineProfile, parseSources } from 'glassbrain';

const { sources, profile } = adapt(files);            // files: { path, text }[]
const model = parseSources(sources, defineProfile({ id: 'mine', ...profile }));
```

## Size

Measured with `node scripts/scale.mjs` on an Apple M4 laptop (headless Chrome 155, device pixel
ratio 2, layout on the main thread as in the generated page):

| graph | size | ready | of which layout | pan frame (med / p90) | zoom frame (med / p90) | heap |
|---|---|---|---|---|---|---|
| synthetic 1000 | 1000 nodes, 1400 edges | 1.1 s | 701 ms | 16.7 / 16.7 ms | 16.7 / 16.7 ms | 21 MB |
| synthetic 3000 | 3000 nodes, 4200 edges | 3.1 s | 2.5 s | 16.7 / 16.7 ms | 16.7 / 16.7 ms | 50 MB |
| synthetic 5000 | 5000 nodes, 7000 edges | 4.7 s | 3.7 s | 16.7 / 16.7 ms | 16.7 / 16.7 ms | 79 MB |
| synthetic 10000 | 10000 nodes, 14000 edges | 9.7 s | 7.8 s | 33.3 / 33.4 ms | 16.7 / 33.4 ms | 150 MB |
| [Graphify's own source graph](https://github.com/Graphify-Labs/graphify/releases/tag/v0.9.92) (v0.9.92 release asset) | 3789 nodes, 5213 edges | 7.7 s | 6.6 s | 16.7 / 16.7 ms | 16.7 / 16.7 ms | 66 MB |

*ready* is from opening the page to the first layout (parsing, building, layout); *of which layout*
is the layout alone. A frame of 16.7 ms is 60 fps. The synthetic graphs are three levels of
containment with 1.4 semantic edges per node; a real graph can take longer than a synthetic one
of the same size (Graphify's: 6.6 s at 3.8k nodes). In the generated page the layout runs on the
main thread, so the page is busy until *ready*; inside your own app pass the worker pool
(`glassbrain/layout/worker-pool`) and it stays responsive while laying out.
