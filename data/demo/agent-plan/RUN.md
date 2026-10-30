# agent-plan

An agent's plan, before writing any code, for adding real-time collaborative editing to a notes app: requirements, decisions (each with a `because` edge to the requirement it serves), rejected alternatives, risks, tasks and open questions for the user. Three snapshots: outline, plan, and the plan after the agent reviewed itself as a skeptical senior engineer. Compare 2 and 3 to see what the review changed.

## Prompt

> Before writing any code: we want to add real-time collaborative editing to our markdown notes app — several people in one note, live cursors, works offline and syncs later. Stack: React frontend, Node + Postgres backend, about 50k users. Lay out your plan as a knowledge graph I can review, not as a long document. Start from the requirements and explain every decision from them: what you would build, why, what you rejected, what could go wrong, and what you still need from me. Before you write anything, list the points from two angles separately: what the implementation needs, and where a reviewer will push back or get lost. Save kg/1-outline (names only), then kg/2-plan (everything filled in), then review your own plan as a skeptical senior engineer and save kg/3-reviewed with what changed.

## How it was run

- **Agent:** Claude Code sub-agent, model **Claude Sonnet 5.5** (`claude-sonnet-5-5`), tools: shell, file read/write.
- **Harness:** the prompt above, plus where to write the output and to run `glassbrain validate --strict` / `glassbrain diff`
  after each snapshot (never `view`). Nothing else: no skill, no examples, no hand edits (one mechanical fix afterwards: placeholder nodes written as `"stub": true` were rewritten to `"flags": ["stub"]`, the form glassbrain reads).
- **Cost:** 85,187 tokens, 12 tool calls, 4 min wall time (as reported by Claude Code).
