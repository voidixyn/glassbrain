/* Understand-Anything's `.ua/knowledge-graph.json` (in `.understand-anything/` for old projects) → glassbrain
 *
 *   {version, kind?, project, nodes, edges, layers, tour}
 *   nodes: id, type (file / function / class / document / config / domain / article / …), name,
 *         filePath, lineRange, summary, tags, complexity
 *   edges: source, target, type (contains / imports / calls / …), direction, weight, description
 *   layers: architecture layers, each a group of nodeIds (measured: only file-level nodes, not overlapping)
 *
 * Containment: `contains`, `contains_flow`, `flow_step`, `categorized_under` become parent; file-level nodes hang into
 * their architecture layer (the layer itself becomes a box); remaining parentless ones hang into folders by filePath. Edges with direction=backward
 * are flipped, and summary becomes the body text in details.
 */
import {
  clean, folderOf, isObj, tryJson, wouldCycle,
  type Adapter, type InputFile, type PhysicalEdge, type PhysicalNode,
} from './common';

/** These edge types say "who is inside whom". categorized_under points the other way: article → the topic it belongs to. */
const DOWN = new Set(['contains', 'contains_flow', 'flow_step']);
const UP = new Set(['categorized_under']);

const looksLike = (d: any) => isObj(d) && Array.isArray(d.nodes) && Array.isArray(d.edges)
  && (Array.isArray(d.layers) || isObj(d.project))
  && d.nodes.every((n: any) => isObj(n) && 'type' in n && 'name' in n);

export function convertUnderstand(d: any) {
  const raw: any[] = d.nodes.filter(isObj);
  const ids = new Set(raw.map((n) => String(n.id)));
  const parentOf = new Map<string, string>();
  const claim = (child: string, parent: string) => {
    if (child === parent || parentOf.has(child) || !ids.has(child) || !ids.has(parent)) return false;
    if (wouldCycle(parentOf, child, parent)) return false;
    parentOf.set(child, parent);
    return true;
  };
  const edges: PhysicalEdge[] = [];
  for (const e of d.edges.filter(isObj)) {
    let s = String(e.source); let t = String(e.target);
    if (e.direction === 'backward') [s, t] = [t, s];
    const type = String(e.type ?? 'related');
    if (DOWN.has(type) && claim(t, s)) continue;
    if (UP.has(type) && claim(s, t)) continue;
    edges.push(clean({
      source: s, target: t, kind: type, weight: typeof e.weight === 'number' ? e.weight : undefined,
      description: e.description, ...(e.direction === 'bidirectional' ? { bidirectional: true } : {}),
    }));
  }
  const extra = new Map<string, PhysicalNode>();
  const layerOf = new Map<string, string>();
  for (const l of (d.layers ?? []).filter(isObj)) {
    const id = `ua-layer:${l.id}`;
    extra.set(id, clean({ id, label: String(l.name ?? l.id), kind: 'layer', description: l.description }));
    for (const n of l.nodeIds ?? []) if (!layerOf.has(String(n))) layerOf.set(String(n), id);
  }
  const nodes: PhysicalNode[] = raw.map((n) => {
    const id = String(n.id);
    const file = typeof n.filePath === 'string' ? n.filePath : '';
    const parent = parentOf.get(id) ?? layerOf.get(id) ?? (file ? folderOf(file, extra) : undefined);
    const lines = Array.isArray(n.lineRange) ? `${n.lineRange[0]}–${n.lineRange[1]}` : undefined;
    return clean({
      id, label: String(n.name ?? id), kind: String(n.type ?? 'node'), parent,
      description: n.summary, filePath: file || undefined, lines, complexity: n.complexity,
      tags: Array.isArray(n.tags) && n.tags.length ? n.tags : undefined, languageNotes: n.languageNotes,
    });
  });
  return { name: String(d.project?.name ?? 'Understand-Anything'), nodes: [...extra.values(), ...nodes], edges };
}

export const PROFILE = {
  nodePalette: {
    function: '#6366f1', class: '#be38f3', concept: '#e63b7a', document: '#0891b2', config: '#64748b',
    service: '#ff6a00', table: '#16a34a', endpoint: '#f59e0b', schema: '#16a34a', pipeline: '#ff6a00', resource: '#64748b',
    domain: '#e63b7a', flow: '#6366f1', step: '#f59e0b',
    article: '#0891b2', entity: '#6366f1', topic: '#e63b7a', claim: '#f59e0b', source: '#64748b',
    screen: '#0891b2', component: '#6366f1', token: '#f59e0b',
  },
  edgePalette: {
    imports: '#94a3b8', exports: '#94a3b8', calls: '#6366f1', depends_on: '#f59e0b', tested_by: '#16a34a',
    inherits: '#be38f3', implements: '#be38f3', related: '#e63b7a', similar_to: '#e63b7a', documents: '#0891b2',
    reads_from: '#0891b2', writes_to: '#ff6a00', cites: '#0891b2', contradicts: '#ef4444', builds_on: '#16a34a',
  },
  kindLabels: { layer: 'Layer', folder: 'Folder', file: 'File', function: 'Function', class: 'Class', document: 'Document', config: 'Config' },
  detail: {
    line: [{ key: 'filePath', label: 'File' }, { key: 'lines', label: 'Lines' }, { key: 'complexity', label: 'Complexity' }],
    list: [{ key: 'tags', label: 'Tags' }],
  },
  rootLabel: 'Understand-Anything',
};

export const understand: Adapter = {
  id: 'understand-anything',
  label: 'Understand-Anything knowledge-graph.json',
  detect: (files) => files.some((f) => f.path.endsWith('.json') && looksLike(tryJson(f.text))),
  convert(files: InputFile[]) {
    const sources = files.flatMap((f) => {
      const d = f.path.endsWith('.json') ? tryJson(f.text) : undefined;
      return looksLike(d) ? [{ origin: f.path, graph: convertUnderstand(d) }] : [];
    });
    return { sources, profile: PROFILE };
  },
};
