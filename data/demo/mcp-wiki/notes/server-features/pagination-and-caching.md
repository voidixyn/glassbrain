---
type: concept
title: Pagination and caching
---
# Pagination and caching

List calls support cursor pagination. From 2026-07-28 results of tools/list, prompts/list, resources/list, resources/read and resources/templates/list require `ttlMs` and `cacheScope` (public/private); servers should order tools deterministically to help client and LLM prompt caching. Complements `listChanged` ([[subscriptions-listen]]). See [[tools]], [[resources]], [[prompts]].

## Sources
- [MCP spec: Pagination](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/pagination)
- [MCP spec: Caching](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching)
- [MCP changelog 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
