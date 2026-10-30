---
type: spec
title: Step-up authorization and scope challenges
---
# Step-up authorization and scope challenges

On insufficient scope servers answer 403 with `WWW-Authenticate: Bearer error="insufficient_scope" scope=...`; clients re-authorize with the union of old and new scopes, retrying only a few times. Servers should list all needed scopes in one challenge. See [[authorization]].

## Sources
- [MCP spec: Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
