---
type: spec
title: stdio transport
---
# stdio transport

Local transport where the client launches the server as a subprocess. Authorization per the HTTP spec should not be used with stdio; credentials come from the environment ([[authorization]]). Cancellation uses `notifications/cancelled` ([[cancellation]]); logs go to stderr ([[logging]]). See [[streamable-http-transport]].

## Sources
- [MCP spec: stdio transport](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio)
- [MCP spec: Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [MCP changelog 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
