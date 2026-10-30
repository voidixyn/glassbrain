'use client';
/* glassbrain · a small markdown: the default renderer for long text in the detail panel
 *
 * Descriptions in data are often markdown copied from docs: paragraphs, lists, bold, inline code, links, images. Printed as is
 * as a string of `![…](…)` and `**…**` they look unfinished. This only knows this small set and produces React elements directly:
 * **no innerHTML**, so whatever HTML the data contains is only text, and no separate sanitizing is needed.
 *
 * Links:
 *   http(s): / mailto:   open in a new window
 *   `node:<id>`          a node in the graph: click to fly there (the host's linkify can rewrite references into this)
 *   relative paths       handed to `resolveUrl` to complete; if that fails only the text shows
 *   anything else (javascript: and the like) is not a link
 * Images likewise, only http(s) and relative paths that resolve; if loading fails they collapse, leaving no broken icon.
 *
 * A host with its own markdown component passes `renderText`, and this one is not used.
 */
import type { ReactNode } from 'react';

export interface MarkdownOptions {
  /** Relative URL → full URL. Return null = cannot resolve (link keeps only its text, image is not drawn). */
  resolveUrl?: (url: string) => string | null;
  /** A `node:<id>` link was clicked. */
  onNodeLink?: (id: string) => void;
}

const ABS = /^(https?:|mailto:)/i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function href(url: string, o: MarkdownOptions): { kind: 'ext' | 'node'; url: string } | null {
  const u = url.trim();
  if (u.startsWith('node:')) return { kind: 'node', url: u.slice(5) };
  if (ABS.test(u)) return { kind: 'ext', url: u };
  if (SCHEME.test(u) || u.startsWith('//')) return null;
  const r = o.resolveUrl?.(u);
  return r && ABS.test(r) ? { kind: 'ext', url: r } : null;
}

/** Inline: images, links, inline code, bold, italic. One pass; whichever matches first wins. */
const INLINE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_/g;

function inline(text: string, o: MarkdownOptions, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0, i = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const k = `${key}.${i++}`;
    if (m[2] !== undefined) {
      const h = href(m[2], o);
      if (h?.kind === 'ext') {
        out.push(<img key={k} className="gb-md-img" src={h.url} alt={m[1]} loading="lazy"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />);
      } else if (m[1]) out.push(<span key={k} className="gb-md-alt">{m[1]}</span>);
    } else if (m[4] !== undefined) {
      const h = href(m[4], o);
      const label = inline(m[3], o, k);
      if (h?.kind === 'ext') out.push(<a key={k} href={h.url} target="_blank" rel="noreferrer noopener">{label}</a>);
      else if (h?.kind === 'node' && o.onNodeLink) {
        const id = h.url;
        out.push(<a key={k} href="#" className="gb-md-node" onClick={(e) => { e.preventDefault(); o.onNodeLink!(id); }}>{label}</a>);
      } else out.push(<span key={k}>{label}</span>);
    } else if (m[5] !== undefined) out.push(<code key={k}>{m[5]}</code>);
    else if (m[6] !== undefined || m[7] !== undefined) out.push(<strong key={k}>{inline(m[6] ?? m[7], o, k)}</strong>);
    else out.push(<em key={k}>{inline(m[8] ?? m[9], o, k)}</em>);
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Blocks: headings, lists, code blocks, quotes, paragraphs. Blank lines separate paragraphs. */
export function renderMarkdown(src: string, o: MarkdownOptions = {}): ReactNode {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let n = 0;
  const flushPara = () => {
    if (para.length) blocks.push(<p key={n++}>{inline(para.join(' '), o, `p${n}`)}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, j) => <li key={j}>{inline(it, o, `l${n}.${j}`)}</li>);
    blocks.push(list.ordered ? <ol key={n++}>{items}</ol> : <ul key={n++}>{items}</ul>);
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (t.startsWith('```')) {
      flushPara(); flushList();
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith('```'); i++) body.push(lines[i]);
      blocks.push(<pre key={n++}><code>{body.join('\n')}</code></pre>);
      continue;
    }
    if (!t) { flushPara(); flushList(); continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(t);
    if (h) {
      flushPara(); flushList();
      blocks.push(<div key={n++} className={`gb-md-h gb-md-h${Math.min(h[1].length, 3)}`}>{inline(h[2], o, `h${n}`)}</div>);
      continue;
    }
    const li = /^([-*+]|\d+[.)])\s+(.*)$/.exec(t);
    if (li) {
      flushPara();
      const ordered = /\d/.test(li[1]);
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push(li[2]);
      continue;
    }
    if (t.startsWith('>')) {
      flushPara(); flushList();
      blocks.push(<blockquote key={n++}>{inline(t.replace(/^>\s?/, ''), o, `q${n}`)}</blockquote>);
      continue;
    }
    if (list && /^\s{2,}/.test(line)) { list.items[list.items.length - 1] += ` ${t}`; continue; }
    flushList();
    para.push(t);
  }
  flushPara(); flushList();
  return <div className="gb-md">{blocks}</div>;
}

/** Inline only (for list items and short fields). */
export function renderInline(src: string, o: MarkdownOptions = {}): ReactNode {
  return <>{inline(src, o, 'i')}</>;
}
