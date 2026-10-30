/* The smallest offline viewer: a bundle that mounts GraphCanvas over data inlined into the page.
 *
 * Offline contract: the page runs from file://, and the data is inlined as
 *   window.__KG_DATA__ = { "<relPath>": "<json text>", ... }
 * Layout must use inlinePool — browsers refuse `new Worker()` on file://.
 * (`npx glassbrain view` does the same with a version bar on top; this is the version to copy into your own page.)
 */
import { createRoot } from 'react-dom/client';
import { GraphCanvas, parseSources } from 'glassbrain';
import { inlinePool } from 'glassbrain/layout/inline-pool';

declare global {
  interface Window { __KG_DATA__?: Record<string, string>; __KG_TITLE__?: string }
}

const PAGE_CSS = `
  * { box-sizing: border-box; margin: 0; }
  html, body, #kg-root { height: 100%; }
  body { background: #f8fafc; }
`;
document.head.appendChild(Object.assign(document.createElement('style'), { textContent: PAGE_CSS }));

const files = window.__KG_DATA__ ?? {};
const model = parseSources(Object.entries(files).map(([origin, text]) => ({ origin, text })));
const title = window.__KG_TITLE__ ?? 'Graph';

const host = document.getElementById('kg-root') ?? document.body.appendChild(
  Object.assign(document.createElement('div'), { id: 'kg-root' }),
);

createRoot(host).render(
  <GraphCanvas
    model={model}
    pool={inlinePool}
    note={<span>{title} · {model.nodes.length} nodes</span>}
    emptyMessage="No graph json yet"
  />,
);
