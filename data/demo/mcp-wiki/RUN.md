# mcp-wiki

An LLM wiki on the Model Context Protocol, the way an agent keeps one for itself: a folder of markdown notes with frontmatter and `[[wikilinks]]`. It ships as plain markdown and opens as is (`npx glassbrain mcp-wiki/notes`): folders become structure, wikilinks become edges.

## Prompt

> Research the Model Context Protocol and keep what you learn as an LLM wiki, the way you would maintain one for yourself: one markdown note per concept, YAML frontmatter with `type:` (concept, spec, server, client, tool, issue…) and `title:`, [[wikilinks]] between notes, folders by topic, an index note. Use web search; cite sources at the bottom of each note. 30–60 notes.

## How it was run

- **Agent:** Claude Code sub-agent, model **Claude Sonnet 5.5** (`claude-sonnet-5-5`), tools: shell, file read/write, web search and fetch.
- **Harness:** the prompt above, plus where to write the output and to run `glassbrain validate --strict` / `glassbrain diff`
  after each snapshot (never `view`). Nothing else: no skill, no examples, no hand edits.
- **Cost:** 115,450 tokens, 25 tool calls, 4 min wall time (as reported by Claude Code).

Researched on 2026-10-26.
