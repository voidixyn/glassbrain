---
type: concept
title: Model Context Protocol
---
# Model Context Protocol

MCP is an open protocol that standardizes how LLM applications connect to external data sources and tools. It uses JSON-RPC 2.0 between [[host]], [[client]] and [[server]] roles, and is inspired by the Language Server Protocol ([[mcp]]).

Servers offer [[tools]], [[resources]] and [[prompts]]; clients may offer [[elicitation]] (and, now deprecated, [[sampling]] and [[roots]]). Optional [[extensions-overview]] such as [[tasks-extension]] and [[mcp-apps]] add more. Security is a first-class concern: see [[human-in-the-loop]] and [[security-overview]].

Start at [[index]]. Versions: [[version-history]]. Governance: [[agentic-ai-foundation]].

## Sources
- [MCP Specification overview (2026-07-28)](https://modelcontextprotocol.io/specification/latest)
- [MCP spec: Architecture](https://modelcontextprotocol.io/specification/2026-07-28/architecture)
