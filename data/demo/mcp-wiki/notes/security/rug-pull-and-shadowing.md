---
type: issue
title: Rug pulls and shadowing
---
# Rug pulls and shadowing

A server shows a benign tool description at approval time then changes it, or a malicious server registers a same-named tool to impersonate a trusted one. Related to [[issue-tool-name-collisions]] and [[tool-poisoning]]. Hashing and re-approval on change are common defenses per the cited whitepaper; deterministic tool lists ([[pagination-and-caching]]) help detection.

## Sources
- [CSA: MCP Security, Tool Poisoning and the Confused Deputy Problem](https://labs.cloudsecurityalliance.org/research-rb/csa-whitepaper-mcp-security-agentic-attack-surface-20260516/)
- [MCP spec: Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
