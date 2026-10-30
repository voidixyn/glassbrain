---
type: spec
title: Protocol versioning and negotiation
---
# Protocol versioning and negotiation

Every request states its protocol version; unsupported versions get `UnsupportedProtocolVersionError` listing supported versions, and Streamable HTTP also needs the `MCP-Protocol-Version` header matching `_meta`. Clients can detect legacy servers by trying a modern request first and falling back to `initialize`. See [[per-request-metadata]], [[version-history]], [[error-codes]].

## Sources
- [MCP changelog 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- [MCP spec: Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [MCP spec: Versioning](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)
