---
type: concept
title: Tools
---
# Tools

Tools are functions the model can invoke; they are model-controlled, with a human in the loop recommended ([[human-in-the-loop]]). Servers declare the `tools` capability, answer `tools/list` (paginated, cacheable: [[pagination-and-caching]]) and `tools/call`. A tool has name ([[tool-names]]), title, description, icons, `inputSchema`, optional `outputSchema` ([[structured-output]]) and annotations ([[tools]]). Results can hold text, image, audio, resource links and embedded [[resources]]. Errors: [[tool-errors]]. Tool descriptions are an attack surface: [[tool-poisoning]].

## Sources
- [MCP spec: Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
