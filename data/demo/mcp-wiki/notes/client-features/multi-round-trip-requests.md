---
type: spec
title: Multi Round-Trip Requests (MRTR)
---
# Multi Round-Trip Requests (MRTR)

Replaces server-initiated requests (roots/list, sampling/createMessage, elicitation/create). A server returns an `InputRequiredResult` (`resultType: input_required`) with `inputRequests` and optional `requestState`; the client retries the original request with `inputResponses` and a new JSON-RPC id. Introduced by SEP-2322. See [[elicitation]], [[sampling]], [[tools]], [[streamable-http-transport]].

## Sources
- [MCP spec: Multi Round-Trip Requests](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr)
- [MCP changelog 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- [MCP spec: Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
