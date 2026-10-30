---
type: concept
title: Stateful tools via handles
---
# Stateful tools via handles

With no protocol session ([[stateless-protocol]]), servers keep cross-call state by returning an explicit handle (e.g. a basket id) from a creation tool and accepting it as an argument later. Handles should be authorized per call, opaque, have a stated lifetime, and give clear expiry errors. See [[tools]], [[issue-session-state-scaling]].

## Sources
- [MCP spec: Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
