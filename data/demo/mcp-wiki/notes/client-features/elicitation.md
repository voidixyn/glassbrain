---
type: concept
title: Elicitation
---
# Elicitation

Servers request extra information from users through the client. 2025-11-25 added URL mode and richer enums; 2026-07-28 removed the completion notification and `elicitationId`, because the client learns the outcome by retrying the request ([[multi-round-trip-requests]]). Servers needing correlation put their own id in `requestState`. See [[client]], [[human-in-the-loop]].

## Sources
- [MCP changelog 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- [MCP changelog 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/changelog)
- [MCP spec: Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
