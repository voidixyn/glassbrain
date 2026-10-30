/* Graphify's graph.json (`graphify-out/graph.json`) → glassbrain
 *
 * It is NetworkX's node-link format: `{directed, multigraph, nodes, links, hyperedges}`.
 *   nodes: id, label, file_type (code / document / concept / rationale…), source_file,
 *         source_location, community, community_name
 *   edges: source, target, relation (contains / method / calls / imports…),
 *         confidence (EXTRACTED / INFERRED / AMBIGUOUS), confidence_score
 *
 * Containment comes from three places: `contains` (file → symbol), `method` (class → method), `rationale_for` (note → what it
 * explains). The remaining parentless ones hang into their file by source_file, and files into folders; those without even a source_file
 * (concepts) go into a group per file_type. confidence_score becomes the edge weight, so width is confidence.
 */
import {
  clean, folderOf, isObj, tryJson, wouldCycle,
  type Adapter, type InputFile, type PhysicalEdge, type PhysicalNode,
} from './common';

const STRUCT = new Set(['contains', 'method']);
const NOTE = 'rationale_for';

const looksLike = (d: any) => isObj(d) && Array.isArray(d.nodes) && Array.isArray(d.links ?? d.edges)
  && (d.nodes.length === 0 || d.nodes.some((n: any) => isObj(n) && ('file_type' in n || 'source_file' in n)))
  && !('layers' in d && 'project' in d);

const base = (p: string) => p.split('/').pop() ?? p;

export function convertGraphify(d: any, name?: string) {
  const raw: any[] = d.nodes.filter(isObj);
  const links: any[] = (d.links ?? d.edges).filter(isObj);
  const ids = new Set(raw.map((n) => String(n.id)));
  const parentOf = new Map<string, string>();
  const claim = (child: string, parent: string) => {
    if (child === parent || parentOf.has(child) || !ids.has(child) || !ids.has(parent)) return false;
    if (wouldCycle(parentOf, child, parent)) return false;
    parentOf.set(child, parent);
    return true;
  };
  const edges: PhysicalEdge[] = [];
  // Containment first (contains is broader than method: a method is in both a class and a file, the class is more precise, so method goes first).
  for (const rel of ['method', 'contains', NOTE]) {
    for (const l of links) {
      if (l.relation !== rel) continue;
      const s = String(l.source); const t = String(l.target);
      if (rel === NOTE ? claim(s, t) : claim(t, s)) continue;
      // Unrecognized ones (a second parent, a cycle) stay as edges; no information is lost.
      edges.push(clean({ source: s, target: t, kind: rel, weight: score(l) }));
    }
  }
  for (const l of links) {
    if (STRUCT.has(l.relation) || l.relation === NOTE) continue;
    edges.push(clean({
      source: String(l.source), target: String(l.target), kind: String(l.relation ?? 'related'), weight: score(l),
      confidence: l.confidence, source_location: l.source_location,
    }));
  }

  // File nodes: the one whose label is the file name of source_file.
  const fileNode = new Map<string, string>();
  for (const n of raw) {
    const sf = typeof n.source_file === 'string' ? n.source_file : '';
    if (sf && n.label === base(sf) && !fileNode.has(sf)) fileNode.set(sf, String(n.id));
  }
  const extra = new Map<string, PhysicalNode>();
  const nodes: PhysicalNode[] = raw.map((n) => {
    const id = String(n.id);
    const sf = typeof n.source_file === 'string' ? n.source_file : '';
    const isFile = !!sf && fileNode.get(sf) === id;
    let parent = parentOf.get(id);
    if (!parent) {
      if (isFile) parent = folderOf(sf, extra);
      else if (sf && fileNode.has(sf)) parent = fileNode.get(sf);
      else if (sf) {
        // The file itself is not a node (concepts extracted from a README, paragraphs in a document): add a file box and put the concepts in it.
        const f = `file:${sf}`;
        if (!extra.has(f)) extra.set(f, clean({ id: f, label: base(sf), kind: 'file', parent: folderOf(sf, extra), source_file: sf }));
        parent = f;
      }
      else {
        const g = `group:${n.file_type ?? 'other'}`;
        if (!extra.has(g)) extra.set(g, { id: g, label: groupLabel(String(n.file_type ?? 'other')), kind: 'group' });
        parent = g;
      }
    }
    const kind = isFile ? (n.file_type === 'document' ? 'document' : 'file')
      : n.file_type === 'code' ? 'symbol' : String(n.file_type ?? 'symbol');
    return clean({
      id, label: String(n.label ?? id), kind, parent,
      source_file: sf || undefined, source_location: n.source_location, community: n.community_name ?? n.community,
    });
  });
  return { name: name ?? 'Graphify', nodes: [...extra.values(), ...nodes], edges };
}

const score = (l: any): number | undefined =>
  typeof l.confidence_score === 'number' ? l.confidence_score : typeof l.weight === 'number' ? Math.min(1, l.weight) : undefined;
const groupLabel = (t: string) => ({ concept: 'Concepts', rationale: 'Rationale', document: 'Documents' } as Record<string, string>)[t] ?? t;

export const PROFILE = {
  nodePalette: { symbol: '#6366f1', concept: '#e63b7a', rationale: '#f59e0b', document: '#0891b2', paper: '#0891b2', image: '#16a34a' },
  edgePalette: {
    calls: '#6366f1', imports: '#94a3b8', imports_from: '#94a3b8', re_exports: '#94a3b8', references: '#0891b2',
    extends: '#be38f3', inherits: '#be38f3', implements: '#be38f3',
    conceptually_related_to: '#e63b7a', semantically_similar_to: '#e63b7a', shares_data_with: '#f59e0b',
  },
  kindLabels: {
    folder: 'Folder', file: 'File', symbol: 'Symbol', concept: 'Concept', rationale: 'Rationale', document: 'Document', group: 'Group',
    calls: 'calls', imports: 'imports', imports_from: 'imports from', references: 'references',
  },
  detail: { line: [{ key: 'source_file', label: 'File' }, { key: 'source_location', label: 'Line' }, { key: 'community', label: 'Community' }, { key: 'confidence', label: 'Confidence' }] },
  rootLabel: 'Graphify',
  // Fields that change on every rerun without the content changing: community renumbering, line numbers moving with the code.
  diffIgnore: ['community', 'source_location'],
};

export const graphify: Adapter = {
  id: 'graphify',
  label: 'Graphify graph.json',
  detect: (files) => files.some((f) => f.path.endsWith('.json') && looksLike(tryJson(f.text))),
  convert(files: InputFile[]) {
    const sources = files.flatMap((f) => {
      const d = f.path.endsWith('.json') ? tryJson(f.text) : undefined;
      return looksLike(d) ? [{ origin: f.path, graph: convertGraphify(d) }] : [];
    });
    return { sources, profile: PROFILE };
  },
};
