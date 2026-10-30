---
type: spec
title: Resource indicators (RFC 8707)
---
# Resource indicators (RFC 8707)

Clients MUST include the `resource` parameter, the canonical URI of the MCP server, in both authorization and token requests, so tokens are audience-bound. Servers must validate audience. 2026-07-28 also requires validating the RFC 9207 `iss` parameter. See [[authorization]], [[confused-deputy]].

## Sources
- [MCP spec: Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [MCP changelog 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
