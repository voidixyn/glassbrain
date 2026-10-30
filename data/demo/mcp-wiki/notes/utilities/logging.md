---
type: concept
title: Logging
---
# Logging

`logging/setLevel` was removed; log level is set per request through `_meta`, and servers must not emit `notifications/message` otherwise. The feature is Deprecated: log to stderr (stdio) or use OpenTelemetry. See [[per-request-metadata]], [[deprecated-features]].

## Sources
- [MCP spec: Logging](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/logging)
- [MCP changelog 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/changelog)
