# how-agents-work

How an LLM agent works, explained from first principles: six chapters from tokens to planning, 44 claims, each with an accurate statement and a plain-language one; misconceptions point at the claim that corrects them. The claims were listed from two sides that did not see each other (`angle`: `material` = what is true, `audience` = where a newcomer gets stuck).

## Prompt

> Explain how an LLM agent works, from first principles, as a knowledge graph. Start from the basic concepts (tokens, next-token prediction, the context window) and build up to tool use, memory and planning; for each step say why it works that way, and call out what is non-obvious. Before writing, list the claims from two sides without letting one see the other: what is true and important (the material), and where a smart newcomer gets stuck or holds a wrong picture (the audience). Save kg/1-claims (names only), kg/2-explained (each claim with an accurate statement and a plain-language one), kg/3-connected (what each claim depends on, causes or corrects).

## How it was run

- **Agent:** Claude Code sub-agent, model **Claude Sonnet 5.5** (`claude-sonnet-5-5`), tools: shell, file read/write.
- **Harness:** the prompt above, plus where to write the output and to run `glassbrain validate --strict` / `glassbrain diff`
  after each snapshot (never `view`). Nothing else: no skill, no examples, no hand edits (one mechanical fix afterwards: `"stub": true` → `"flags": ["stub"]`).
- **Cost:** 67,915 tokens, 5 tool calls, 2 min wall time (as reported by Claude Code).

The agent ran the two angles as two sub-agents of its own; the token count above is the main agent's.
