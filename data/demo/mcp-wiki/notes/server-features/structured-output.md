---
type: concept
title: Structured tool output
---
# Structured tool output

Tools may declare `outputSchema`; servers MUST return `structuredContent` conforming to it and should also include serialized JSON in a text block for compatibility. From 2026-07-28 schemas may use any JSON Schema 2020-12 keywords and `structuredContent` may be any JSON value. See [[tools]].

## Sources
- [MCP spec: Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
- [MCP changelog 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
