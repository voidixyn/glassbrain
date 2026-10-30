# graphify-flask

[Graphify](https://github.com/Graphify-Labs/graphify)'s own output for the [Flask](https://github.com/pallets/flask)
repository (BSD-3-Clause), shipped exactly as Graphify wrote it (`graphify-out/graph.json`) and opened as is: Graphify's
file / symbol containment becomes the structure, its relations become edges.

## How it was made

```bash
git clone --depth 1 https://github.com/pallets/flask      # d086db8, 2026-10-07
cd flask
graphify update .                                          # graphifyy 0.9.96: code-only re-extraction, no LLM
npx glassbrain graphify-out/graph.json
```

No LLM, no tokens: Graphify's code extraction is tree-sitter AST. Result: 2,342 nodes, 3,754 edges, 211 communities over
the whole repository (source, tests, docs examples). Compare with the [`flask`](../flask/RUN.md) dataset, made by an agent
with the `kg-build` skill.
