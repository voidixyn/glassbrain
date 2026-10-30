---
type: spec
title: x-mcp-header annotation
---
# x-mcp-header annotation

A tool inputSchema property can carry `x-mcp-header` so the client mirrors its value into an `Mcp-Param-{name}` header, letting load balancers and WAFs route without parsing the body. Only primitive, statically reachable properties; do not mark secrets. See [[mcp-http-headers]], [[tools]].

## Sources
- [MCP spec: Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
- [MCP spec: Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
