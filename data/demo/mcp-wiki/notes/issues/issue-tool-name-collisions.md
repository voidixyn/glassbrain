---
type: issue
title: Issue: tool name collisions
---
# Issue: tool name collisions

Gateways aggregating several servers may see duplicate names like `search`; the spec advises prefixing with a server identifier and not relying on serverInfo.name. Also exploited for shadowing. See [[tool-names]], [[rug-pull-and-shadowing]].

## Sources
- [MCP spec: Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
- [CSA: MCP Security, Tool Poisoning and the Confused Deputy Problem](https://labs.cloudsecurityalliance.org/research-rb/csa-whitepaper-mcp-security-agentic-attack-surface-20260516/)
