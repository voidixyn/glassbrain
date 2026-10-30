---
type: spec
title: Streamable HTTP transport
---
# Streamable HTTP transport

One MCP endpoint accepting POST; each JSON-RPC message is its own POST and the server replies with JSON or a request-scoped SSE stream. Server-to-client needs use [[multi-round-trip-requests]]; long-lived notifications use [[subscriptions-listen]]. Since 2026-07-28: no GET stream, no sessions, no Last-Event-ID resumability (a broken stream loses the request; the client re-issues it). Servers MUST validate Origin ([[dns-rebinding]]). Headers: [[mcp-http-headers]]. Legacy: [[http-sse-legacy-transport]].

## Sources
- [MCP spec: Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [MCP changelog 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
