---
type: spec
title: JSON-RPC base protocol
---
# JSON-RPC base protocol

MCP messages are JSON-RPC 2.0. The 2026-07-28 base protocol is described as stateless, self-contained requests with per-request capability negotiation ([[per-request-metadata]]). Every result carries a required `resultType` (`complete` or `input_required`, see [[multi-round-trip-requests]]). Error code ranges: [[error-codes]].

## Sources
- [MCP Specification overview (2026-07-28)](https://modelcontextprotocol.io/specification/latest)
- [MCP spec: Base protocol](https://modelcontextprotocol.io/specification/2026-07-28/basic)
- [MCP changelog 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
