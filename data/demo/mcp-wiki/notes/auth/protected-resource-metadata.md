---
type: spec
title: Protected Resource Metadata (RFC 9728)
---
# Protected Resource Metadata (RFC 9728)

MCP servers advertise their authorization servers via RFC 9728 metadata; the 401 `WWW-Authenticate` header points to it with `resource_metadata`. Clients then do authorization server metadata discovery with RFC 8414 or OpenID Connect Discovery. See [[authorization]], [[resource-indicators]].

## Sources
- [MCP spec: Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [MCP spec: Authorization server discovery](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery)
