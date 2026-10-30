---
type: spec
title: server/discover
---
# server/discover

Servers MUST implement `server/discover` to advertise supported protocol versions, capabilities and identity. Clients may call it first for version selection, or use it as a backward-compatibility probe on [[stdio-transport]]. Part of [[stateless-protocol]]; see [[capabilities]].

## Sources
- [MCP changelog 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
