# agent-stack

The AI agent ecosystem in three layers (protocols, building blocks, products), researched by an agent. Two snapshots: what the model knew without searching, then after checking every item on the web. Compare them to see what the research corrected (nodes flagged `corrected`) and added.

## Prompt

> Research the AI agent ecosystem as it stands today and map it as a knowledge graph: the protocols and standards agents speak, the building blocks (frameworks, memory, tool runtimes, evaluation), and the products built on them (coding agents, assistants, browser agents). Use web search and what you already know. First write down what you know without searching (kg/1-from-memory). Then check every item on the web, fix what is wrong or outdated, and add what you missed (kg/2-researched). Each node gets a 1–3 sentence description with source links; edges say what implements, builds on or integrates with what. Three layers: protocols, building blocks, products.

## How it was run

- **Agent:** Claude Code sub-agent, model **Claude Sonnet 5.5** (`claude-sonnet-5-5`), tools: shell, file read/write, web search and fetch.
- **Harness:** the prompt above, plus where to write the output and to run `glassbrain validate --strict` / `glassbrain diff`
  after each snapshot (never `view`). Nothing else: no skill, no examples, no hand edits.
- **Cost:** 125,123 tokens, 39 tool calls, 6 min wall time (as reported by Claude Code).

Researched on 2026-10-26. Web sources vary in quality; where they conflicted the node says so. Not a reference: check the links.
