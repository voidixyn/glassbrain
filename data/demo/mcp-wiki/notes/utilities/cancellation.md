---
type: concept
title: Cancellation
---
# Cancellation

On Streamable HTTP, closing the request's SSE response stream cancels it and the server must stop sending; `notifications/cancelled` is used only on stdio. See [[streamable-http-transport]], [[stdio-transport]], [[progress]].

## Sources
- [MCP spec: Cancellation](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/cancellation)
- [MCP spec: Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
