---
type: concept
title: Stateless MCP
---
# Stateless MCP

2026-07-28 removed the `initialize` / `notifications/initialized` handshake and protocol-level sessions (`Mcp-Session-Id`). List endpoints no longer vary per connection. Servers needing state use explicit handles ([[stateful-tools]]). Motivation discussed in [[issue-session-state-scaling]]. Mechanics: [[per-request-metadata]], [[server-discover]], [[streamable-http-transport]].

## Sources
- [MCP changelog 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- [MCP spec: Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
