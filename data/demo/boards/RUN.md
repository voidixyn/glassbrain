# boards

[4ga Boards](https://github.com/RARgames/4gaBoards), an open-source kanban app (MIT, © RARgames; see [LICENSE](LICENSE)),
turned into a graph of what a user can do, by agents following the [`docs-to-kg`](../../../skills/docs-to-kg/SKILL.md)
skill. Four snapshots:

| Snapshot | What happened | Nodes | Edges |
|---|---|---|---|
| `1-enumerated` | two passes that did not see each other: the [docs](https://github.com/RARgames/4gaBoardsDocs) (243 features) and the app's UI code (178) | 423 | 0 |
| `2-merged` | duplicates merged, renamed, grouped into 9 areas: 268 features (126 found by both passes, 93 docs only, 49 app only) | 277 | 0 |
| `3-stories` | each feature written as a user story: role, steps in the app's own words, expected result; 94 stories note where docs and app differ | 277 | 0 |
| `4-linked` | 33 concepts; `requires` (275), `acts-on` (390), `conflicts` (3) | 311 | 668 |

`found_in` on each feature says which pass found it. App-only features are undocumented; docs-only ones may be stale or
not visible in the UI code (the self-hosting pages, for example).

## Prompt

The skill, plus one line per agent naming the step, the inputs and the output folder. Sources: docs at
`4gaBoardsDocs@56c04fa`, app at `4gaBoards@01b7b16` (both 2026-10-24).

## How it was run

- **Agents:** Claude Code sub-agents, model **Claude Sonnet 5.5** (`claude-sonnet-5-5`), tools: shell, file read/write.
  No web access; the app was read as code, not run.
- **Orchestration** (what the skill means by "separate sub-agents"):
  - step 1: two agents in parallel, one told not to read anything but the docs, the other not to read any docs;
  - step 2: one agent;
  - step 3: nine agents in parallel, one per area, each writing `{id: story}` for its area; the nine files were put into
    the snapshot with a ten-line script (no content changed);
  - step 4: one agent.
- **Cost:** 1,324,616 tokens in all (step 1: 207,814 · step 2: 89,482 · step 3: 945,830 · step 4: 81,490), about 14 min
  wall time (as reported by Claude Code).
- **Fixes after the run:** step 1 was written with `"stub": true`, which an earlier wording of the skill asked for;
  rewritten to `"flags": ["stub"]`, the form glassbrain reads (the skill now says so).

Each step's `glassbrain diff` against the previous snapshot shows only that step's job: step 2 adds the 9 areas, removes
the 153 merged duplicates and the two source nodes and moves the rest; step 3 changes 268 nodes and nothing else; step 4
adds the concepts and edges and nothing else.

## Checked

Two blind judges (Claude Sonnet 5.5 and Claude Opus 5.5) compared this inventory with one from an earlier, heavier
multi-stage pipeline of ours on the same product (167 features), both rendered as the same plain list, unlabeled, in
swapped order, with the docs and the source to check against. Both preferred this one "overwhelmingly" (mean scores
8.4 vs 3.0 and 8.4 vs 4.2 on coverage, correctness, actionability, dependencies, organization); of 24 randomly sampled
features each, 23 here checked out fully against the source, 11 there. Their main criticism here: a few `requires`
edges that are arguable (creating a board from a template requires converting one, though built-in templates exist).

## Shorter wordings tried since

Four rewrites of the skill, each about half as long, were run end to end on the same sources the same way, and each
was judged against this run by five blind judges (Claude Sonnet 5.5), one per risk: duplicates, granularity, coverage,
correctness of the stories, dependencies. Every margin was "slightly" except two; no rewrite was ahead on all five, so
this run and this wording stay. What moved the results:

- **Framing changes granularity.** "The test plan a QA lead would write" gave 186 coarser features and dropped install
  and admin; asking for variants as child nodes during enumeration put the same action under several parents.
- **"Be exhaustive, small ones too" is what keeps coverage**, and naming the admin who installs the product is what
  keeps the self-hosting pages in; without it a pass may decide they are not features.
- **Reading `requires` from each story's preconditions** left 5–18 features without one (here: 19), and was the one
  risk the rewrites won.
