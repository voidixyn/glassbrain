---
type: concept
title: Sampling
---
# Sampling

Sampling let servers ask the client to run an LLM completion (`sampling/createMessage`); 2025-11-25 added tools/toolChoice. It is Deprecated in 2026-07-28: integrate with LLM provider APIs directly instead. Under the new model it would travel as an input request in [[multi-round-trip-requests]]. See [[deprecated-features]], [[deprecated-features]].

## Sources
- [MCP changelog 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- [MCP changelog 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/changelog)
- [MCP spec: Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
