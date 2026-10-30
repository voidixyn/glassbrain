---
type: concept
title: Resources
---
# Resources

Resources expose context and data (files, records) identified by URI, read via `resources/read` and listed via `resources/list`. Tools can return resource links or embedded resources ([[tools]]). Updates are delivered through [[subscriptions-listen]]; results are cacheable ([[pagination-and-caching]]). Not-found uses -32602 ([[error-codes]]). Annotations (audience, priority, lastModified) are shared with tool content.

## Sources
- [MCP spec: Resources](https://modelcontextprotocol.io/specification/2026-07-28/server/resources)
- [MCP changelog 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
