# citations

The research lineage of retrieval-augmented generation and long-term memory for LLM agents: field ⊃ topic ⊃ paper, institution ⊃ first author, a group of benchmarks; edges `cites`, `extends`, `authored-by`, `evaluates-on`. Two snapshots: what existed by the end of 2022, and everything up to today.

## Prompt

> Trace the research lineage of retrieval-augmented generation and long-term memory for LLM agents, from the first papers to today, as a knowledge graph: the papers, the topics they belong to, the labs and authors, the benchmarks, and which paper builds on, cites or evaluates on which. Use web search to confirm every paper exists (title, year, arXiv or venue link) and what it builds on. Save two snapshots: kg/1-until-2022 (only what existed by the end of 2022) and kg/2-until-2026 (everything).

## How it was run

- **Agent:** Claude Code sub-agent, model **Claude Sonnet 5.5** (`claude-sonnet-5-5`), tools: shell, file read/write, web search and fetch.
- **Harness:** the prompt above, plus where to write the output and to run `glassbrain validate --strict` / `glassbrain diff`
  after each snapshot (never `view`). Nothing else: no skill, no examples, no hand edits.
- **Cost:** 99,173 tokens, 17 tool calls, 5 min wall time (as reported by Claude Code).

Every paper's title, year and first author were checked against the arXiv API (one against the ACL Anthology). The `cites` / `extends` / `evaluates-on` edges and the affiliations come from the model's own knowledge.
