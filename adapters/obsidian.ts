/* Obsidian vault / LLM wiki (a folder of markdown referencing each other with [[wikilinks]]) → glassbrain
 *
 * Folders are containment, one note is one node, `[[links]]` and ordinary links to other .md files are edges. The body goes into the detail panel,
 * and wikilinks in the body are rewritten to `node:<id>`, so clicking one in the panel jumps there.
 *
 * Wikilinks resolve as Obsidian does: `[[a/b]]` by path, `[[b]]` by file name (case-insensitive; with duplicate names the shortest path
 * wins, as in Obsidian). `![[…]]` (embeds) and links with no target make no edge.
 * A `type:` in frontmatter becomes the kind, `title:` the name; `tags:` stay in details.
 */
import { autoPalette, clean, folderOf, type Adapter, type InputFile, type PhysicalEdge, type PhysicalNode } from './common';

const isNote = (p: string) => p.toLowerCase().endsWith('.md') && !p.split('/').some((s) => s.startsWith('.'));
const stem = (p: string) => p.replace(/\.md$/i, '');
const baseName = (p: string) => stem(p).split('/').pop()!;

/** Minimal frontmatter: one level of `key: value`, enough for title / type / tags. */
function frontmatter(text: string): { meta: Record<string, string | string[]>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, string | string[]> = {};
  let listKey = '';
  for (const line of m[1].split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) { (meta[listKey] as string[]).push(unquote(item[1])); continue; }
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    listKey = '';
    const v = kv[2].trim();
    if (!v) { meta[kv[1]] = []; listKey = kv[1]; } else if (/^\[.*\]$/.test(v)) meta[kv[1]] = v.slice(1, -1).split(',').map((s) => unquote(s.trim())).filter(Boolean);
    else meta[kv[1]] = unquote(v);
  }
  return { meta, body: text.slice(m[0].length) };
}
const unquote = (s: string) => s.replace(/^["']|["']$/g, '');

export function convertObsidian(files: InputFile[]) {
  const notes = files.filter((f) => isNote(f.path));
  const byPath = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const f of [...notes].sort((a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path))) {
    const id = stem(f.path);
    byPath.set(id.toLowerCase(), id);
    const k = baseName(f.path).toLowerCase();
    if (!byName.has(k)) byName.set(k, id);
  }
  // `[[50% done]]` is a plain name, not a broken escape: fall back to the raw text.
  const decodeSafe = (t: string) => { try { return decodeURIComponent(t); } catch { return t; } };
  const resolve = (target: string, from: string): string | undefined => {
    const t = decodeSafe(target.split('#')[0].split('|')[0]).trim().replace(/\.md$/i, '');
    if (!t) return undefined;
    const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/') + 1) : '';
    return byPath.get(t.toLowerCase()) ?? byPath.get(normalize(dir + t).toLowerCase())
      ?? (t.includes('/') ? undefined : byName.get(t.toLowerCase()));
  };

  const folders = new Map<string, PhysicalNode>();
  return notes.map((f) => {
    const id = stem(f.path);
    const { meta, body } = frontmatter(f.text);
    const edges: PhysicalEdge[] = [];
    const link = (target: string | undefined) => {
      if (target && target !== id && !edges.some((e) => e.target === target)) edges.push({ source: id, target, kind: 'link' });
      return target;
    };
    // Wikilinks in the body → node: links (clickable in the detail panel); ordinary relative .md links are handled the same way.
    const description = body
      .replace(/(!?)\[\[([^\]]+)\]\]/g, (all, bang, inner) => {
        if (bang) return all;
        const [target, alias] = String(inner).split('|');
        const to = link(resolve(target, id));
        const text = (alias ?? target.split('#')[0]).trim();
        return to ? `[${text}](node:${to})` : text;
      })
      .replace(/(?<!!)\[([^\]]*)\]\(([^)\s]+\.md)(#[^)\s]*)?\)/gi, (all, text, href) => {
        if (/^[a-z]+:/i.test(href)) return all;
        const to = link(resolve(href, id));
        return to ? `[${text}](node:${to})` : all;
      })
      .trim();
    const parent = folderOf(f.path, folders);
    const node = clean({
      id, label: typeof meta.title === 'string' ? meta.title : baseName(f.path),
      kind: typeof meta.type === 'string' ? meta.type : 'note',
      parent, description: description || undefined, path: f.path,
      tags: Array.isArray(meta.tags) && meta.tags.length ? meta.tags : typeof meta.tags === 'string' ? [meta.tags] : undefined,
    });
    // Folder nodes go with every note (merging keeps one per id), so even one note alone has a complete branch of sources.
    const chain: PhysicalNode[] = [];
    for (let p = parent; p; p = folders.get(p)?.parent as string | undefined) chain.unshift(folders.get(p)!);
    return { origin: f.path, graph: { name: node.label, nodes: [...chain, node], edges } };
  });
}

const normalize = (p: string) => {
  const out: string[] = [];
  for (const s of p.split('/')) { if (s === '..') out.pop(); else if (s && s !== '.') out.push(s); }
  return out.join('/');
};

export const obsidian: Adapter = {
  id: 'obsidian',
  label: 'Markdown folder (Obsidian / LLM wiki)',
  detect: (files) => files.some((f) => isNote(f.path)),
  convert(files: InputFile[]) {
    const sources = convertObsidian(files);
    const kinds = sources.map((s) => s.graph.nodes.at(-1)!.kind!);
    return {
      sources,
      profile: {
        nodePalette: autoPalette(kinds), edgePalette: { link: '#94a3b8' },
        kindLabels: { folder: 'Folder', note: 'Note', link: 'link' },
        detail: { line: [{ key: 'path', label: 'File' }], list: [{ key: 'tags', label: 'Tags' }] },
        rootLabel: 'Notes',
      },
    };
  },
};
