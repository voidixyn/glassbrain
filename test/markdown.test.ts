/* Markdown in the detail panel: only a small subset, rendered straight to React elements — HTML in the data is text, dangerous links are not links. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderMarkdown } from '../dist/internal.js';

const html = (md: string, o = {}) => renderToStaticMarkup(renderMarkdown(md, o) as any);

test('paragraphs, lists, emphasis, code, images, links', () => {
  const out = html('# Title\n\nSome **bold** and `code`.\n\n- one\n- two\n\n![shot](/img/a.png) [site](https://x.dev)',
    { resolveUrl: (u: string) => `https://cdn.dev/${u.replace(/^\//, '')}` });
  assert.match(out, /<strong>bold<\/strong>/);
  assert.match(out, /<code>code<\/code>/);
  assert.match(out, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(out, /<img[^>]+src="https:\/\/cdn\.dev\/img\/a\.png"/);
  assert.match(out, /<a href="https:\/\/x\.dev" target="_blank"/);
});

test('safety: HTML stays as text; javascript: is not a link; relative images that cannot be resolved are not drawn', () => {
  const out = html('<img src=x onerror=alert(1)> [x](javascript:alert(1)) ![y](rel.png)');
  assert.doesNotMatch(out, /<img src="x"/);
  assert.match(out, /&lt;img/);
  assert.doesNotMatch(out, /href="javascript/);
  assert.doesNotMatch(out, /rel\.png/);
});

test('node: links are links only when the host provides onNodeLink', () => {
  assert.doesNotMatch(html('[a](node:p:board)'), /<a /);
  assert.match(html('[a](node:p:board)', { onNodeLink: () => {} }), /<a href="#" class="gb-md-node">a<\/a>/);
});
