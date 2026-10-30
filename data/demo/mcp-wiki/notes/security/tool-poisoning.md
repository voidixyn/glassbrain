---
type: issue
title: Tool poisoning
---
# Tool poisoning

Malicious instructions hidden in tool descriptions or metadata steer the model, for example a trivial add tool told to leak SSH keys (shown by Invariant Labs, as reported). A special case of [[indirect-prompt-injection]]. Mitigate by treating [[tools]] as untrusted and pinning tool definitions by hash; see [[rug-pull-and-shadowing]].

## Sources
- [CSA: MCP Security, Tool Poisoning and the Confused Deputy Problem](https://labs.cloudsecurityalliance.org/research-rb/csa-whitepaper-mcp-security-agentic-attack-surface-20260516/)
- [MCP spec: Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
