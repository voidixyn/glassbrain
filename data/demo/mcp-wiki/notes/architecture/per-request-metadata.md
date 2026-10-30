---
type: spec
title: Per-request metadata (_meta)
---
# Per-request metadata (_meta)

Under 2026-07-28 each request carries `io.modelcontextprotocol/protocolVersion` and `io.modelcontextprotocol/clientCapabilities` in `_meta`; clients should also send `clientInfo` and servers return `serverInfo` in results. Log level is set via `io.modelcontextprotocol/logLevel` ([[logging]]). OpenTelemetry keys `traceparent`, `tracestate`, `baggage` are documented. Replaces the handshake: [[stateless-protocol]]. Version mismatch: [[protocol-versioning]].

## Sources
- [MCP changelog 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- [MCP spec: Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
