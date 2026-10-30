---
type: spec
title: MCP HTTP request headers
---
# MCP HTTP request headers

Streamable HTTP POSTs MUST carry `MCP-Protocol-Version`, `Mcp-Method`, and `Mcp-Name` (for tools/call, resources/read, prompts/get). Servers reject mismatches between header and body with 400 and HeaderMismatch (-32020), preventing routing/execution disagreement. Non-ASCII values use a Base64 sentinel `=?base64?...?=`. See [[x-mcp-header]], [[error-codes]].

## Sources
- [MCP spec: Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [MCP changelog 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
