---
type: spec
title: subscriptions/listen
---
# subscriptions/listen

Replaces the HTTP GET stream and resources/subscribe: a client opens one long-lived POST response stream and opts in to toolsListChanged, promptsListChanged, resourcesListChanged and resourceSubscriptions. Notifications carry a subscriptionId; request-scoped progress and log notifications stay on their own request stream. Servers should send SSE keep-alive comments. See [[streamable-http-transport]], [[resources]], [[tools]].

## Sources
- [MCP spec: Subscriptions](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/subscriptions)
- [MCP changelog 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
- [MCP spec: Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
