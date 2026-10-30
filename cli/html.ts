/* A self-contained html: the viewer bundle + inline data. Double-click to open; send it to someone and it opens too (no server, no network). */
import type { Payload } from './viewer';

/** `</script` and `<!--` end / disturb the script tag early; in the JSON every `<` is escaped as a unicode escape (line separators too: old engines cut strings at them). */
const safeJson = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export function pageHtml(payload: Payload, viewerJs: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="glassbrain">
<title>${esc(payload.title)} · glassbrain</title>
</head>
<body>
<div id="glassbrain"></div>
<script>window.__GLASSBRAIN__ = ${safeJson(payload)};</script>
<script>${viewerJs.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--')}</script>
</body>
</html>
`;
}
