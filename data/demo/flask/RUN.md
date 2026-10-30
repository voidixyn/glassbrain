# flask

[Flask](https://github.com/pallets/flask)'s source package (`src/flask`, commit d086db8, BSD-3-Clause) mapped by an agent
with the [`kg-build`](../../../skills/kg-build/SKILL.md) skill: folder ⊃ module ⊃ class ⊃ method / attribute, every node
with a description written from reading the code, edges `imports`, `calls`, `references`, `extends`, `decorated_by`, `emits`.
Three snapshots: skeleton → filled → linked.

## Prompt

> Map Flask's source package so a new contributor can find their way around: every module, its public classes, functions
> and methods, and how they call and import each other. Read the code, don't go from memory.

## How it was run

- **Agent:** Claude Code sub-agent, model **Claude Sonnet 5.5** (`claude-sonnet-5-5`), tools: shell, file read/write.
- **Harness:** the prompt above, the `kg-build` skill, and where to write the output. The agent wrote small `ast` helpers of
  its own to list definitions and imports; descriptions and call edges are from its reading.
- **Cost:** 229,695 tokens, 40 tool calls, 10 min wall time (as reported by Claude Code).
- **Result:** 540 nodes, all described; 751 edges. `diff` shows each step did only its job (step 2: 540 changed, nothing
  else; step 3: 751 edges added, nothing else).

- **Fix after the run:** the skill now marks skeleton nodes `"flags": ["stub"]` (drawn grey until filled), which it did not
  when this ran; the flag was added to every node of `1-skeleton` by a one-line script, nothing else changed.

A first run with an earlier wording of the skill came back with 132 nodes and 51 edges (68,423 tokens); the skill now asks
for completeness at the requested depth and for every import and call between mapped nodes in code.

## Same code, Graphify

[`graphify-flask`](../graphify-flask/RUN.md) is Graphify on the whole repository. On the same `src/flask` folder Graphify
(code-only, no LLM) gives 892 nodes and 1,821 edges: 579 code symbols, 257 docstring nodes, 54 concepts; no node carries
a description, and without an LLM its 53 communities are named after a member (`Any`, `.name`).
