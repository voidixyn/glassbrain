/* glassbrain · model contract (Layer 0)
 *
 * This is the library's only "data contract", and it **contains no domain knowledge**: no "feature points", no "business models",
 * no file formats. A graph is nodes + edges; a node can have a parent (compound nesting), can belong to
 * a layer, can remember which data source it came from.
 *
 * All domain knowledge lives in the profile (see profile.ts): how to parse raw data into slices,
 * which layers exist, how to color, which fields the detail panel shows, how to validate. The core only ever sees the types here.
 *
 * Pure module: no React, no cytoscape, no DOM. Runs on a server, in a worker, in a browser.
 */

/** Graph node. Everything but id/label is optional: the smallest usable graph is an array of `{id,label}`. */
export interface GraphNode {
  id: string;
  label: string;
  /** Semantic / visual category. The core only passes it through (→ cytoscape class); the profile gives it meaning. */
  kind?: string;
  /** Compound parent node id: expresses "nested inside", the only source of structural hierarchy. */
  parent?: string;
  /** **Where it hung in the previous version** (filled by `diffModels`, only `moved` nodes in a union have it).
   *
   *  An edge is defined by its two ends; **change one and it is another edge**. So "moved to another branch" is not a node attribute
   *  but one containment edge gone and another come. In connected mode containment edges are generated from `parent` at render
   *  time; recording only the new parent, the old edge does not exist in the union at all and cannot play its exit. Recorded,
   *  `buildElements` can emit both, each with `gb-added` / `gb-removed`.
   *
   *  `null` means "it was a top level in the previous version" (not the same as `undefined`, "no such information": in connected mode
   *  top levels hang on the virtual root, which is also a real edge). Ordinary parse results never carry this field. */
  prevParent?: string | null;
  /** Layer id. Inferred by profile.layerOf by default. Multi-layer views / 2.5D planes group by it. */
  layer?: string;
  /** The **primary** source: who owns the content (what a future write-back writes to). Stamped automatically by parseSources. */
  origin?: string;
  /** **Every** source that mentions this node. A node is often described by several pieces of data together (a skeleton file
   *  declares it exists, a content file fills it in), and filtering a subgraph by source should show it on any hit; recording only one
   *  would make "select the skeleton file and see nothing" happen. Default = [origin]. */
  origins?: string[];
  /** Boolean marks, each becoming a cytoscape class (e.g. 'unfilled'). */
  flags?: string[];
  /** The raw object, handed to the detail panel as is (and the payload of a future write-back). */
  data?: Record<string, unknown>;
}

/** Graph edge. source/target are **node ids**; the edge's own source is called origin (not source). */
export interface GraphEdge {
  id?: string;
  source: string;
  target: string;
  kind?: string;
  label?: string;
  /** 0–1, meaning decided by the profile (confidence / weight / strength); can drive line style. */
  weight?: number;
  origin?: string;
  /** Boolean marks, each becoming a cytoscape class (same as nodes; diff uses them to mark additions and removals). */
  flags?: string[];
  data?: Record<string, unknown>;
}

/** A fragment parsed from one piece of raw data. One file = one slice. */
export interface GraphSlice {
  origin: string;
  title: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** A profile-defined slice role (e.g. 'manifest', the base skeleton), used in the merge stage. */
  role?: string;
  /** Why parsing failed. When set, nodes/edges should be empty. */
  error?: string;
}

/** The canonical merged model: the one object views, layout and validation all face. */
export interface GraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Data sources that broke during parsing. */
  errors: { origin: string; message: string }[];
  /** id → node (built at construction; do not build your own). */
  index: Map<string, GraphNode>;
  /** Ids defined more than once in the sources (the merge kept the first). Validation reports them. */
  duplicateIds?: string[];
}

export const EMPTY_MODEL: GraphModel = { nodes: [], edges: [], errors: [], index: new Map() };

/** Build a model from bare nodes/edges (builds the index). profile.merge implementations nearly all end with it. */
export function buildModel(
  nodes: GraphNode[],
  edges: GraphEdge[],
  errors: GraphModel['errors'] = [],
): GraphModel {
  const index = new Map<string, GraphNode>();
  for (const n of nodes) if (!index.has(n.id)) index.set(n.id, n);
  return { nodes, edges, errors, index };
}

/** Default merge: same id, first seen wins; all edges kept; errors collected. Used when the profile writes no merge. */
export function mergeSlices(slices: GraphSlice[]): GraphModel {
  const byId = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const errors: GraphModel['errors'] = [];
  const dup = new Set<string>();
  for (const s of slices) {
    if (s.error) { errors.push({ origin: s.origin, message: s.error }); continue; }
    for (const n of s.nodes) {
      const exist = byId.get(n.id);
      // Same id, first seen wins, but sources are merged, or filtering a subgraph by source would miss it. Twice in one file, or
      // defined differently in two, is a duplicate; the same node repeated in several files (a folder every note carries) is merging.
      if (exist) {
        if (exist.origin === n.origin || defOf(exist) !== defOf(n)) dup.add(n.id);
        exist.origins = addOrigin(exist.origins, n.origin);
      }
      else byId.set(n.id, { ...n });
    }
    for (const e of s.edges) edges.push(e);
  }
  const m = buildModel([...byId.values()], edges, errors);
  return dup.size ? { ...m, duplicateIds: [...dup] } : m;
}

/** A node's definition, for telling a repeat from a conflict: everything but where it came from. */
const defOf = ({ origin: _o, origins: _os, ...rest }: GraphNode) => JSON.stringify(rest);

/** Add one to a source list (order kept, deduplicated). Needed all over the merge stage. */
export function addOrigin(list: string[] | undefined, origin: string | undefined): string[] {
  if (!origin) return list ?? [];
  if (!list) return [origin];
  return list.includes(origin) ? list : [...list, origin];
}

/** Which sources mention this node (reads origins, falls back to origin). */
export function originsOfNode(n: GraphNode): string[] {
  return n.origins?.length ? n.origins : n.origin ? [n.origin] : [];
}

/* ─── Structural index: parentage / depth / subtrees ─────────────────────────────────────────── */

export interface GraphIndex {
  parentOf: Map<string, string>;
  childrenOf: Map<string, string[]>;
  depthOf: (id: string) => number;
  ancestorsOf: (id: string) => string[];
  /** Includes itself. */
  subtreeOf: (id: string) => Set<string>;
  /** Undirected adjacency (all edges, cross-layer ones included). Used for search's neighborhood expansion. */
  neighborsOf: Map<string, string[]>;
}

export function indexModel(model: GraphModel): GraphIndex {
  const parentOf = new Map<string, string>();
  const childrenOf = new Map<string, string[]>();
  for (const n of model.nodes) {
    if (!n.parent) continue;
    parentOf.set(n.id, n.parent);
    const arr = childrenOf.get(n.parent);
    arr ? arr.push(n.id) : childrenOf.set(n.parent, [n.id]);
  }
  const neighborsOf = new Map<string, string[]>();
  for (const e of model.edges) {
    for (const [a, b] of [[e.source, e.target], [e.target, e.source]] as const) {
      const arr = neighborsOf.get(a);
      arr ? arr.push(b) : neighborsOf.set(a, [b]);
    }
  }
  const depthMemo = new Map<string, number>();
  const depthOf = (id: string, seen = new Set<string>()): number => {
    const hit = depthMemo.get(id);
    if (hit != null) return hit;
    seen.add(id);
    const p = parentOf.get(id);
    // A parent cycle (validation reports it) must not overflow the stack: the cycle counts as a root.
    const d = p && !seen.has(p) ? depthOf(p, seen) + 1 : 1;
    depthMemo.set(id, d);
    return d;
  };
  const ancestorsOf = (id: string): string[] => {
    const out: string[] = [];
    let p = parentOf.get(id);
    while (p && !out.includes(p)) { out.push(p); p = parentOf.get(p); }
    return out;
  };
  const subtreeOf = (id: string): Set<string> => {
    const out = new Set<string>([id]);
    const stack = [id];
    while (stack.length) {
      for (const c of childrenOf.get(stack.pop()!) ?? []) {
        if (out.has(c)) continue;
        out.add(c); stack.push(c);
      }
    }
    return out;
  };
  return { parentOf, childrenOf, depthOf, ancestorsOf, subtreeOf, neighborsOf };
}

/** The sources that appear in the model (data for the subgraph / view dropdown). */
export function originsOf(model: GraphModel): string[] {
  const seen = new Set<string>();
  for (const n of model.nodes) for (const o of originsOfNode(n)) seen.add(o);
  return [...seen].sort();
}
