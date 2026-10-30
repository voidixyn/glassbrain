---
type: concept
title: Capabilities
---
# Capabilities

Capabilities declare which features a party supports, e.g. servers declare `tools` with optional `listChanged`. From 2026-07-28 the client's capabilities travel on every request in `_meta` ([[per-request-metadata]]) and both capability objects gain an `extensions` field ([[extensions-overview]]). See [[tools]], [[server-discover]].

## Sources
- [MCP spec: Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
- [MCP changelog 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
