---
type: spec
title: Authorization
---
# Authorization

Optional, for HTTP transports, based on OAuth 2.1. The MCP server is a resource server, the client an OAuth client, and a separate authorization server issues tokens. Servers MUST implement [[protected-resource-metadata]]; clients MUST send the resource parameter ([[resource-indicators]]); register via [[client-registration]]; PKCE is used. Tokens go in the Authorization header, never the query string, and servers must accept only tokens issued for them. Insufficient scope: [[step-up-authorization]]. Threats: [[confused-deputy]]. Not for [[stdio-transport]].

## Sources
- [MCP spec: Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [MCP spec: Authorization security considerations](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations)
