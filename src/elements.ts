/* glassbrain · model → cytoscape elements
 *
 * This step makes **structural** decisions only (which nodes are present, how parentage is expressed, how many levels to fold), never
 * **visibility** decisions (that is view.ts's job). This division is why the whole library can
 * "switch around one graph without rebuilding":
 *
 *   model changed                      → element set changes  → rebuild + relayout (rare)
 *   layer / source / search / focus    → only visibility      → display toggles, zero rebuild, zero relayout (frequent)
 *
 * Containment is always drawn as explicit containment edges (no cytoscape compound boxes).
 *
 * This is also where the profile's domain judgments are **burned into data** (`_struct` / `_force`), so downstream divide-and-conquer,
 * layout workers and plane projection are pure geometry and know nothing of the profile.
 */
import { DIFF_FLAG, STEP_FLAG, STEP_KEPT } from './diff';
import { indexModel, type GraphEdge, type GraphModel, type GraphNode } from './model';
import type { GraphProfile } from './profile';

export interface CyElement {
  data: Record<string, unknown>;
  classes?: string;
}

/** Id of the synthetic virtual root. Reserved by the core; profiles must not use it. */
export const VIRTUAL_ROOT = '__gk_root__';

/** cytoscape classes reserved by the core; profile kinds must not reuse these names. */
export const RESERVED_CLASSES = ['container', 'crosslayer', 'contains', 'root', 'gb-node'] as const;

/** kind/flag string → valid cytoscape class name. The palette (paletteStyle in style.ts)
 *  must build selectors with the same rule, or input like "a kind with a space" would compute two different
 *  names in two places, and neither would select the other. */
export const cls = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_');

/**
 * A node's **skin**: what it looks like is decided entirely by this class string (kind / flags / container or not /
 * the profile's own part).
 *
 * It is factored out not to save lines but **to ask about the same node twice**: "what does it look like now" and
 * "what did it look like in the previous version". The transition's look channel relies on those two answers (see planSkins in animate.ts).
 */
export function nodeClasses(
  n: GraphNode, profile: GraphProfile, o: { container: boolean },
): string {
  return [
    'gb-node',
    n.kind ? cls(n.kind) : '',
    ...(n.flags ?? []).map(cls),
    o.container ? 'container' : '',
    profile.nodeClass(n),
  ].filter(Boolean).join(' ');
}

export interface BuildOptions {
  /**
   * This element table draws the **past** version (the left column). It only affects which way containment edges are marked:
   *
   *   default `prevParent` is "who it hung under in the previous version" → the current edge is new, that one is gone
   *   `past`  `prevParent` is "who it hangs under **in the new version**" → the current edge is the one **about to go**,
   *           and the new version's edge should not appear in the old version's graph at all, so it is not emitted
   *
   * In other words: `prevParent` always means "who it hangs under **in the other version**"; this switch says
   * which version this one is.
   */
  past?: boolean;
}

export interface BuiltElements {
  elements: CyElement[];
  /** Fingerprint of the element set: only a change requires rebuilding the cytoscape instance. */
  shape: string;
  /** Present node id → layer id (plane projection and layer toggles need it). */
  layerOf: Map<string, string>;
  /** Present node id → its parent (the parent **in the element table**, not in the model).
   *
   *  They can differ: the virtual root exists only in the element table. Transitions ask
   *  "where does it grow from", about parentage **on screen**, so the answer can only come from here. */
  parentOf: Map<string, string>;
  /** Nodes with children (= ones whose "subgraph" can be expanded). **Must be judged from the model, not asked of cytoscape**:
   *  parentage is explicit edges, not compounds, so `isChildless()` returns true for every node. */
  containers: Set<string>;
}

export function buildElements(model: GraphModel, profile: GraphProfile, opts: BuildOptions = {}): BuiltElements {
  const past = !!opts.past;
  const idx = indexModel(model);
  const layerSpec = new Map(profile.layers.map((l) => [l.id, l]));
  const isStructural = (n: GraphNode) => layerSpec.get(n.layer ?? '')?.structural !== false;

  // share ∈ [0,1]: the subtree's leaf count as a fraction of the whole graph (√ compressed to separate small branches). One measure
  // drives containment edge darkness and width, layout repulsion and label priority together: bigger branches are darker / thicker / pushed further apart;
  // leaves are always 0.
  const isLeaf = (id: string) => (idx.childrenOf.get(id)?.length ?? 0) === 0;
  const cntMemo = new Map<string, number>();
  const leafCount = (id: string): number => {
    const hit = cntMemo.get(id);
    if (hit != null) return hit;
    const kids = idx.childrenOf.get(id) ?? [];
    const c = kids.length === 0 ? 1 : kids.reduce((s, k) => s + leafCount(k), 0);
    cntMemo.set(id, c);
    return c;
  };
  const totalLeaves = Math.max(1, model.nodes.filter((n) => isLeaf(n.id)).length);
  const shareOf = (id: string) => (isLeaf(id) ? 0 : Math.sqrt(leafCount(id) / totalLeaves));
  // leaves: how many leaves hang below (a leaf itself is 0). Node size and label font size read its log: absolute counts
  // rather than a fraction of the whole graph, so the same module is the same size in large and small graphs.
  const leavesOf = (id: string) => (isLeaf(id) ? 0 : leafCount(id));

  /* ── The virtual root ("Overview"): **it belongs to a version, not to the canvas.** ─────────────────────────
   *
   * A version has an overview only when its structure layer has more than one top level: it gathers several top-level trees into "one tree"
   * to read, and gives the whole dataset a name. Attached layers (axiom / reference layers) are not gathered; they are not a subset of the main tree. Single-root graphs are unchanged.
   *
   * The hard part is transitions: the canvas often draws **the union of two versions**. Judging by the union's top-level count used to mean that when
   * "the old version had two spines and the new one merged them into one tree", the union still had two top levels and synthesized a root neither version needed; layout gave
   * it no coordinates (layout solves the new version itself), the exit list did not have it, and it hung outside the graph with a long line, forever.
   *
   * So each **side** is judged separately: every node in the union carries a mark for "only in old / only in new / in both"
   * (diff's `gb-*` or the transition's `gb-step-*`, both vocabularies are recognized). Whichever side has more than one top level
   * has an overview; the root itself is marked the same way (only on the old side means leaving, only on the new side entering, on both
   * kept) and then handed to the "presence" channel to fade in place or grow like any node, no special case.
   * An ordinary unmarked model is the same on both sides and reduces to "more than one top level means a root". */
  const GONE = new Set<string>([DIFF_FLAG.removed, DIFF_FLAG.merged, STEP_FLAG.removed]);
  const ARRIVED = new Set<string>([DIFF_FLAG.added, STEP_FLAG.added]);
  const sideOf = (n: GraphNode): 'past' | 'now' | 'both' => {
    const f = n.flags ?? [];
    return f.some((x) => GONE.has(x)) ? 'past' : f.some((x) => ARRIVED.has(x)) ? 'now' : 'both';
  };
  /* The root lives on one layer only (the first structure layer) and only gathers that layer's top levels. Other layers do not hang on it: the root is downstairs,
   * and hanging upstairs top levels on it conjures a fan of lines through the floors. In a multi-layer graph each layer is its own forest and takes its own shape. */
  const rootLayer = (profile.layers.find((l) => l.structural !== false) ?? profile.layers[0]).id;
  const rooted = (n: GraphNode) => isStructural(n) && (n.layer ?? profile.layers[0].id) === rootLayer;
  const tops = model.nodes.filter((n) => !n.parent && rooted(n));
  /* Each side's top levels are counted by **that side's own parents**. `parent` in the union belongs to the side this copy draws; the other side's
   * parent is recorded in `prevParent` (only for reparented nodes). Counting only the union's top levels would count "hung under someone else in the previous version,
   * a top level of its own in this one" as top level on both sides: the old side clearly had one tree but would be judged to need an overview. */
  const otherParent = (n: GraphNode) => (n.prevParent !== undefined ? n.prevParent : n.parent);
  const onSide = (n: GraphNode, side: 'past' | 'now') => sideOf(n) !== (side === 'past' ? 'now' : 'past');
  const parentOn = (side: 'past' | 'now') => ((side === 'past') === !past ? otherParent : (n: GraphNode) => n.parent);
  const topOn = (side: 'past' | 'now') =>
    model.nodes.filter((n) => rooted(n) && onSide(n, side) && !parentOn(side)(n)).length;
  /* **No tree means no root**, also judged per side: in a graph with no containment at all (a citation network, a social graph) every
   * node is a top level, and a synthesized root is a big star connecting every node: layout gets dragged into a disc and the graph's own shape
   * is lost. Looking only at the union is misled by the other side: switching from a graph with a tree, the leaving half is still in the union. */
  const treeOn = (side: 'past' | 'now') => model.nodes.some((n) => onSide(n, side) && !!parentOn(side)(n));
  const pastRoot = profile.singleRoot && treeOn('past') && topOn('past') > 1;
  const nowRoot = profile.singleRoot && treeOn('now') && topOn('now') > 1;
  const rootActive = pastRoot || nowRoot;
  /** Whether a top level hangs under the root: only if its side has a root. */
  const underRoot = (n: GraphNode) => {
    const side = sideOf(n);
    return (side !== 'now' && pastRoot) || (side !== 'past' && nowRoot);
  };
  const topSet = new Set(rootActive ? tops.filter(underRoot).map((n) => n.id) : []);
  const stepVocab = model.nodes.some((n) => n.flags?.some((f) => f.startsWith('gb-step-')));
  const rootFlag = pastRoot && !nowRoot ? (stepVocab ? STEP_FLAG.removed : DIFF_FLAG.removed)
    : nowRoot && !pastRoot ? (stepVocab ? STEP_FLAG.added : DIFF_FLAG.added)
      : stepVocab ? STEP_KEPT : '';

  const layerOf = new Map<string, string>();
  const parentOf = new Map<string, string>();
  const nodeIds = new Set<string>();
  const nodes: CyElement[] = [];
  /** [parent, child, mark, carries force]. A non-empty mark = this containment edge is new this time / gone this time.
   *  **A node's own edge always carries force** (it is this version's structure); only "the other version's edge" is synthesized
   *  to play an exit once, and it should not affect any solve. */
  const containPairs: [string, string, string, boolean][] = [];

  if (rootActive) {
    nodeIds.add(VIRTUAL_ROOT);
    layerOf.set(VIRTUAL_ROOT, rootLayer);
    nodes.push({
      data: {
        id: VIRTUAL_ROOT, label: profile.rootLabel, kind: 'root', layer: rootLayer,
        origin: null, share: 1,
        leaves: [...topSet].reduce((s, id) => s + leafCount(id), 0), detail: null, _struct: true,
      },
      classes: ['gb-node root container', rootFlag].filter(Boolean).join(' '),
    });
  }

  for (const n of model.nodes) {
    if (nodeIds.has(n.id)) continue;
    nodeIds.add(n.id);
    const layer = n.layer ?? profile.layers[0].id;
    layerOf.set(n.id, layer);
    const container = (idx.childrenOf.get(n.id)?.length ?? 0) > 0;
    const classes = nodeClasses(n, profile, { container });
    // No compound parents: "containment" is expressed as an explicit edge, so the graph is an ordinary node-link forest.
    const effParent = n.parent ?? (topSet.has(n.id) ? VIRTUAL_ROOT : undefined);
    if (effParent) parentOf.set(n.id, effParent);
    nodes.push({
      data: {
        id: n.id, label: n.label, kind: n.kind ?? '', layer, origin: n.origin ?? null,
        share: shareOf(n.id), leaves: leavesOf(n.id),
        detail: n.data ?? null, _struct: isStructural(n),
      },
      classes,
    });
    /* **Another branch = one containment edge gone + one containment edge come.**
     *
     * This is the **only** case where containment edges get marks, and for a hard reason: containment edges are not data but a projection of `parent`,
     * so they are marked only when they are the sole source. When a node is added / removed, the node's own glow already says everything;
     * coloring the edge too says the same thing twice, and edges are long and large, so saying it twice drowns the node.
     * Only "another branch" is something the node cannot say: present in both versions, both lit as "changed", the only difference is
     * what it hangs under, and only an edge can say that.
     *
     *
     * An edge is defined by its two ends; change one and it is another edge. So both are emitted here, each with its
     * diff mark, and the downstream "presence" channel need not know about "containment edges" at all, treating them like any other edge.
     *
     * Not emitting the old one has a concrete cost: the new one connects "new parent → it", while on frame 0 of the transition it still stands at the
     * old position, so at curtain-up a thick line across the whole graph appears from nowhere (measured median 1257); meanwhile the old one
     * just vanishes. Both ends are abrupt, and **marks alone can never reveal it**: synthesized edges never had marks.
     *
     * `prevParent === null` means "it was a top level in the previous version", hanging on the virtual root, which is also a
     * real edge; only `undefined` means "never changed".
     *
     * The top-level branch asks whether **the other version** has a root: if this copy draws the new version, the other is the old side; if it draws
     * the past (left column), the other is the new side. Whether each side has a root was judged above. */
    const otherRoot = past ? nowRoot : pastRoot;
    const effPrev = n.prevParent === undefined ? undefined
      : n.prevParent ?? (otherRoot ? VIRTUAL_ROOT : undefined);
    const relinked = effPrev !== undefined && effPrev !== effParent;
    const own = relinked ? (past ? DIFF_FLAG.removed : DIFF_FLAG.added) : '';
    if (effParent) containPairs.push([effParent, n.id, own, true]);
    // The other version's edge is synthesized only in the graph of the "now" version (to play its exit once); the old version's graph should not have
    // an edge pointing to the new parent.
    if (relinked && effPrev && !past) containPairs.push([effPrev, n.id, DIFF_FLAG.removed, false]);
  }

  const edges: CyElement[] = [];
  for (const [parent, child, flag, force] of containPairs) {
    if (!nodeIds.has(parent)) continue;
    edges.push({
      data: {
        id: `contains:${parent}->${child}`, source: parent, target: child, kind: 'contains',
        label: '', weight: null, share: shareOf(child),
        _force: force,
      },
      classes: flag ? `contains ${flag}` : 'contains',
    });
  }
  const seen = new Set<string>();
  for (const e of model.edges) {
    const { source, target } = e;
    if (source === target) continue;
    if (!nodeIds.has(source) || !nodeIds.has(target)) continue;
    const id = e.id ?? `${e.kind ?? 'e'}:${source}->${target}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const cross = layerOf.get(source) !== layerOf.get(target);
    edges.push({
      data: {
        id, source, target, kind: e.kind ?? '', label: e.label ?? '', weight: e.weight ?? null,
        origin: e.origin ?? null, share: 0, _force: profile.layoutEdge(e),
      },
      classes: [
        profile.edgeClass(e) || 'plain',
        ...(e.flags ?? []).map(cls),
        cross ? 'crosslayer' : '',
      ].filter(Boolean).join(' '),
    });
  }
  const containers = new Set<string>();
  for (const id of nodeIds) {
    if (id === VIRTUAL_ROOT) { if (rootActive) containers.add(id); continue; }
    if ((idx.childrenOf.get(id)?.length ?? 0) > 0) containers.add(id);
  }
  return {
    elements: [...nodes, ...edges],
    shape: `${profile.id}|${model.nodes.length}|${model.edges.length}`,
    layerOf,
    parentOf,
    containers,
  };
}

/** Pick nodes out of elements (needed in many places downstream; do not each write your own filter). */
export const isNodeEl = (el: CyElement) => !el.data.source;

export function countByKind(model: GraphModel): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of model.nodes) { const k = n.kind ?? ''; out[k] = (out[k] ?? 0) + 1; }
  return out;
}

export type { GraphEdge, GraphNode };
