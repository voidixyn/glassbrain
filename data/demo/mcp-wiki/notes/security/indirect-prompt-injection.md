---
type: issue
title: Indirect prompt injection
---
# Indirect prompt injection

Instructions embedded in tool results or documents the agent reads can hijack behavior. Prompt hardening helps but is not reliable; use least privilege, approvals ([[human-in-the-loop]]) and sanitizing outputs ([[tools]]). See [[tool-poisoning]].

## Sources
- [CSA: MCP Security, Tool Poisoning and the Confused Deputy Problem](https://labs.cloudsecurityalliance.org/research-rb/csa-whitepaper-mcp-security-agentic-attack-surface-20260516/)
- [MCP spec: Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
