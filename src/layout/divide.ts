/* glassbrain · the pure-logic half of divide-and-conquer layout
 *
 * Splits the whole graph into independent components by **structural connectivity** and arranges the laid-out components' bounding boxes on the plane. No
 * cytoscape, no DOM, no profile: it only reads the two marks elements.ts burns into data:
 *
 *   node._struct === false  attached layer nodes (axiom / reference layers): no structural force; after layout placed by
 *                           associated centroid next to the main structure.
 *   edge._force === false   render-only overlay edges (typically cross-module dependency lines): in no layout at all.
 */
import { VIRTUAL_ROOT, type CyElement } from '../elements';

export { VIRTUAL_ROOT };

export interface GraphComponent { key: string; nodes: CyElement[]; edges: CyElement[] }
export interface Partition {
  components: GraphComponent[];
  /** nodeId → component key, used to lift endpoints when the coarse graph aggregates cross edges. */
  compOf: Map<string, string>;
  /** Attached layer node ids (used when the engine places them). */
  attached: Set<string>;
}

const isEdge = (el: CyElement) => !!el.data.source;
const isAttached = (el: CyElement) => el.data._struct === false;

/** Structural connected split. The virtual root joins no component (or the whole graph would stick together into one);
 *  attached nodes with no edges to vote go into a '__attached__' miscellaneous component. */
export function partitionElements(elements: CyElement[]): Partition {
  const nodes = elements.filter((el) => !isEdge(el));
  const edges = elements.filter(isEdge);
  const attached = new Set(nodes.filter(isAttached).map((n) => n.data.id as string));

  // Parent pointers: data.parent in box mode, contains edges in connected mode. The virtual root does not count as a parent.
  const parentOf = new Map<string, string>();
  for (const n of nodes) {
    const p = n.data.parent as string | undefined;
    if (p && p !== VIRTUAL_ROOT) parentOf.set(n.data.id as string, p);
  }
  for (const e of edges) {
    if (e.data.kind === 'contains' && e.data.source !== VIRTUAL_ROOT) {
      parentOf.set(e.data.target as string, e.data.source as string);
    }
  }
  const rootMemo = new Map<string, string>();
  const rootOf = (id: string): string => {
    const hit = rootMemo.get(id);
    if (hit) return hit;
    const p = parentOf.get(id);
    const root = p ? rootOf(p) : id;
    rootMemo.set(id, root);
    return root;
  };

  // Structure nodes belong to their structural root; attached nodes join by majority vote of their associated edges' components.
  const compOf = new Map<string, string>();
  for (const n of nodes) {
    const id = n.data.id as string;
    if (id === VIRTUAL_ROOT || attached.has(id)) continue;
    compOf.set(id, rootOf(id));
  }
  const votes = new Map<string, Map<string, number>>();
  for (const e of edges) {
    const s = e.data.source as string, t = e.data.target as string;
    if (!attached.has(s) && !attached.has(t)) continue;
    for (const [a, other] of [[s, t], [t, s]] as const) {
      if (!attached.has(a)) continue;
      const c = compOf.get(other);
      if (!c) continue;
      const v = votes.get(a) ?? new Map<string, number>();
      v.set(c, (v.get(c) ?? 0) + 1);
      votes.set(a, v);
    }
  }
  for (const id of attached) {
    const v = votes.get(id);
    const best = v && [...v.entries()].sort((a, b) => b[1] - a[1])[0];
    compOf.set(id, best ? best[0] : '__attached__');
  }

  const comps = new Map<string, GraphComponent>();
  const compFor = (key: string) => {
    let c = comps.get(key);
    if (!c) { c = { key, nodes: [], edges: [] }; comps.set(key, c); }
    return c;
  };
  for (const n of nodes) {
    const key = compOf.get(n.data.id as string);
    if (key) compFor(key).nodes.push(n);
  }
  // Only edges inside a component that carry force enter layout.
  for (const e of edges) {
    if (e.data._force === false) continue;
    const cs = compOf.get(e.data.source as string);
    if (cs && cs === compOf.get(e.data.target as string)) compFor(cs).edges.push(e);
  }
  // Single-node components (top-level orphans, modules in a folded view, etc.) merge into one miscellaneous component: one worker job
  // tiled inside, instead of thousands of separate boxes covering the whole graph.
  const out: GraphComponent[] = [];
  const loose: GraphComponent = { key: '__loose__', nodes: [], edges: [] };
  for (const c of comps.values()) {
    if (c.nodes.length === 1) {
      loose.nodes.push(c.nodes[0]);
      compOf.set(c.nodes[0].data.id as string, '__loose__');
    } else out.push(c);
  }
  /* Force-carrying edges between the loose ones come along too. Without them this miscellaneous component could only tile into a grid, and a graph with no
   * containment at all (a citation network, a social graph) **is all loose ones**: the whole graph would be laid out as a checkerboard with no edge
   * having any effect. Loose ones with edges are pulled into shape by them; truly isolated ones are still tiled off to one side. */
  if (loose.nodes.length > 1) {
    for (const e of edges) {
      if (e.data._force === false) continue;
      if (compOf.get(e.data.source as string) === '__loose__' && compOf.get(e.data.target as string) === '__loose__') loose.edges.push(e);
    }
  }
  if (loose.nodes.length) out.push(loose);
  return { components: out, compOf, attached };
}

/* ── Coarse graph: components as super nodes, a second force pass for the top level ──────────────────────────── */

export function buildCoarseElements(
  components: GraphComponent[],
  compOf: Map<string, string>,
  elements: CyElement[],
  bboxOf: (key: string) => { w: number; h: number },
  rootDims?: { w: number; h: number },
): CyElement[] {
  const nodes: CyElement[] = components.map((c) => {
    const b = bboxOf(c.key);
    const rootNode = c.nodes.find((n) => n.data.id === c.key);
    return { data: { id: c.key, share: (rootNode?.data.share as number) ?? 0, _w: b.w, _h: b.h } };
  });
  // In connected mode the virtual root is a real node: it enters the coarse graph and is pulled to the center by containment edges.
  if (rootDims) nodes.push({ data: { id: VIRTUAL_ROOT, share: 1, _w: rootDims.w, _h: rootDims.h } });
  const ids = new Set(nodes.map((n) => n.data.id as string));

  const seen = new Set<string>();
  const edges: CyElement[] = [];
  for (const el of elements) {
    if (!isEdge(el)) continue;
    const a = compOf.get(el.data.source as string) ?? (el.data.source as string);
    const b = compOf.get(el.data.target as string) ?? (el.data.target as string);
    if (a === b || !ids.has(a) || !ids.has(b)) continue;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`; // undirected dedup: layout only cares about proximity
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ data: { id: `coarse:${key}`, source: a, target: b } });
  }
  return [...nodes, ...edges];
}

/* ── Placing attached layers ────────────────────────────────────────────────────────── */

export interface AttachedItem { id: string; w: number; h: number; anchor: { x: number; y: number } | null }

/**
 * Attached layers are not in the tree and carry no force; after layout they are placed separately: right at the associated centroid, overlaps pushed apart. Raised to 2.5D
 * they "hover" right above related nodes, links between layers are nearly vertical, and the correspondence is visible at a glance; flattened, only one layer
 * is present. (There used to be a flat "around the bounding box" placement too; it went away with the merged single-layer view.)
 */
export function placeAttached(
  items: AttachedItem[],
  bbox: { x1: number; y1: number; w: number; h: number },
): Record<string, { x: number; y: number }> {
  const cx = bbox.x1 + bbox.w / 2, cy = bbox.y1 + bbox.h / 2;
  const boxes: Box[] = items.map((it, i) => ({
    key: it.id, w: it.w, h: it.h,
    x: it.anchor?.x ?? cx + ((i % 8) - 4) * (it.w + 16),
    y: it.anchor?.y ?? cy,
  }));
  resolveOverlaps(boxes, { gap: 16, enabled: true });
  return Object.fromEntries(boxes.map((b) => [b.key, { x: b.x, y: b.y }]));
}

/* ── Final overlap removal ────────────────────────────────────────────────────────── */

export interface Box { key: string; w: number; h: number; x: number; y: number }

/** Iteratively push overlapping boxes apart by halves along the axis with less overlap (x/y are centers, modified in place).
 *  **Off** by default at component level: force spacing is usually more natural, and forcing them apart tears clusters;
 *  required for attached 'above' placement (those boxes are piled up by centroid and overlap by nature). */
export function resolveOverlaps(boxes: Box[], o: { gap?: number; enabled?: boolean } = {}): void {
  if (!o.enabled) return;
  const gap = o.gap ?? 0;
  for (let iter = 0; iter < 600; iter++) {
    let moved = false;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const ox = (a.w + b.w) / 2 + gap - Math.abs(dx);
        const oy = (a.h + b.h) / 2 + gap - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        if (ox < oy) { const s = (dx >= 0 ? 1 : -1) * ox / 2; a.x -= s; b.x += s; }
        else { const s = (dy >= 0 ? 1 : -1) * oy / 2; a.y -= s; b.y += s; }
      }
    }
    if (!moved) return;
  }
}
