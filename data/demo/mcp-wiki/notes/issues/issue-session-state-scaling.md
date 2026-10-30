---
type: issue
title: Issue: session state and scaling
---
# Issue: session state and scaling

Protocol-level sessions tied requests to a connection, complicating load balancing and varying list results per connection. 2026-07-28 removed sessions and `Mcp-Session-Id`, pushing state into explicit handles. See [[stateless-protocol]], [[stateful-tools]], [[streamable-http-transport]].

## Sources
- [MCP changelog 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- [MCP spec: Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
