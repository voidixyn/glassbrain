---
type: issue
title: DNS rebinding
---
# DNS rebinding

Remote websites can reach local MCP servers via DNS rebinding. Streamable HTTP servers MUST validate Origin (403 if invalid), local servers should bind to 127.0.0.1, and should authenticate. See [[streamable-http-transport]].

## Sources
- [MCP spec: Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
