/* glassbrain · profile: the one home of domain knowledge
 *
 * The core (model / view / elements / layout / canvas) knows nothing about the domain. All knowledge of "what kind of graph
 * this is" lives in one profile object: how to parse, how many layers, how to color, what the detail panel
 * shows, how to validate.
 *
 * Three levels of use (this is the key to the library being "easy"; not three APIs but three ways to fill one):
 *
 *   1. give nothing: it reads `{nodes:[...], edges:[...]}` directly and shows it.
 *        <GraphCanvas model={parseSources(files)} />
 *
 *   2. give an object: add your own layers / colors / field table; missing fields get defaults.
 *        const p = defineProfile({ id:'flow', layers:[...], style:[...] });
 *
 *   3. give a parser: let the library read your own JSON dialect ("sugar") directly, no conversion first.
 *        const p = defineProfile({ id:'x', parse(origin, text){ ... } });
 *
 * A profile is **data + pure functions**, not a class to inherit from. It can be a constant or a factory
 * (when a closure must carry runtime parameters, e.g. rewriting links in the detail panel).
 */
import {
  buildModel, mergeSlices, type GraphEdge, type GraphModel, type GraphNode, type GraphSlice,
} from './model';

/** Layer declaration. Single-layer graphs need not write it (one 'default' layer by default). */
export interface LayerSpec {
  id: string;
  label: string;
  /** 2.5D plane order: 0 = bottom, larger is higher. Layers with the same value share a plane. */
  z?: number;
  /** This layer's hue (the plate drawn under it in 2.5D, the layer name). Hue only: the plate is this hue at low opacity
   *  over the canvas, its stroke and the name are mixed by `plateColors` from the theme's canvas color, so one color works
   *  under both light and dark themes. */
  color?: string;
  /** false = attached layer: takes no part in the structural layout; after layout it is placed by associated centroids around the main structure
   *  (typically an axiom / reference layer). Default true. */
  structural?: boolean;
}

export interface DetailField { key: string; label: string }

/** Detail panel field table. line = single key-value line; list = array as a list; other fields are shown by the fallback. */
export interface DetailSpec {
  line?: DetailField[];
  list?: DetailField[];
  /** Keys left out of the "other fields" fallback (already rendered elsewhere). */
  skip?: string[];
  /** Rewrite a field's value as markdown (e.g. turning source references into links). */
  linkify?: (field: string, value: string) => string;
  /** flag → one explanatory line at the top of the detail panel (e.g. what unfilled means). */
  flagNotes?: Record<string, string>;
}

export interface GraphIssue {
  kind: string;
  level: 'error' | 'warn';
  /** What this category is called (the issues panel groups by it, e.g. "dangling edge"). Defaults to kind. */
  group?: string;
  message: string;
  nodeId?: string;
  edge?: { source: string; target: string };
}

export interface GraphProfile {
  id: string;
  /** Parse one piece of raw data. Return null = not recognized (silently skipped, not counted as broken). */
  parse(origin: string, text: string): GraphSlice | null;
  /** Slices → model. Default mergeSlices (same id: first seen wins). */
  merge(slices: GraphSlice[]): GraphModel;
  layers: LayerSpec[];
  /** Which layer a node belongs to. Defaults to node.layer, then to the first layer. */
  layerOf(node: GraphNode): string;
  /**
   * Semantic kind → color. **Kinds not listed here are skeleton**: drawn on the `theme.skeleton` ramp
   * computed by share (containers, the virtual root, graphs with structure but no semantics are all like this). So a graph
   * is complete with zero configuration; list only the kinds that "have content and deserve recognition at a glance".
   *
   * Color belongs to "what this kind looks like" (presentation), not to data (data only says "this is this
   * kind"), but it knows the kind's name, so it lives in the profile layer, not in the theme, which is completely
   * independent of content. Hue only: lightness and size are computed from data, not configured here.
   */
  nodePalette: Record<string, string>;
  /** Edge kind → color, as above. */
  edgePalette: Record<string, string>;
  /**
   * kind → size multiplier: for nodes it multiplies the diameter computed from how much hangs off them, for edges the width computed from `weight`;
   * the existing encoding still holds, the whole class just scales. Unlisted kinds = 1. Pure look: layout makes no room for it.
   * Shape, dash and arrow heads are not here: those are semantic encodings of "what this kind of thing is" and belong to `style`.
   */
  nodeSize: Record<string, number>;
  edgeWidth: Record<string, number>;
  /**
   * Nodes with these flags are **placeholders**: declared in the structure, content not filled yet. They are drawn as skeleton, even if
   * their kind is in the palette. A placeholder is not "a light version of some kind" but "not content yet"; once it is filled and
   * the flag drops, the transition shows a reskin from skeleton color → semantic color.
   */
  placeholderFlags: string[];
  /**
   * Escape hatch: only what the palette cannot express (shapes, dashes, font weight…) goes here, appended after the base style
   * and the palette (more specific selectors win: the same kind can override the palette color here,
   * but normally there is no need; leaving color to the two tables above is easier).
   */
  style: unknown[];
  /** Extra node classes (kind and flags are added by the core automatically; only add special ones here). */
  nodeClass(node: GraphNode): string;
  /** Edge class. Defaults to edge.kind. */
  edgeClass(edge: GraphEdge): string;
  /** kind → human-readable name: node and edge kinds share this one table (detail panel titles, legend). */
  kindLabels: Record<string, string>;
  detail: DetailSpec;
  /** Domain validation. The core's generic checks (dangling edges / duplicate ids) always run; add only domain ones here. */
  validate(model: GraphModel): GraphIssue[];
  /** Does this edge carry layout force? **By default none do**: structure comes from containment (the node's `parent`), and semantic edges
   *  are an overlay drawn on top. Letting them carry force, a few hundred cross-branch lines would pull the tree into a ball. Only let a class of edges through here
   *  when it really must help with positions (e.g. an attached layer's "conforms to" edges). Containment does not come here; it is always structure. */
  layoutEdge(edge: GraphEdge): boolean;
  /** With several top levels, whether to synthesize a virtual root box that gathers them. Default true. Not synthesized when the graph has no containment at all (see buildElements). */
  singleRoot: boolean;
  rootLabel: string;
}

export type ProfileInput = { id: string } & Partial<Omit<GraphProfile, 'id'>>;

/** Generic physical parser: reads `{nodes:[...], edges:[...]}`, nothing else. */
export function parsePhysical(origin: string, text: string): GraphSlice | null {
  let raw: any;
  try { raw = JSON.parse(text); } catch (e) {
    return { origin, title: origin, nodes: [], edges: [], error: e instanceof Error ? e.message : String(e) };
  }
  if (!raw || typeof raw !== 'object' || (!('nodes' in raw) && !('edges' in raw))) return null;
  // Entries that are not objects or have no id are skipped (schema validation reports them), never merged into one "undefined" node.
  const ref = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : undefined);
  const nodes: GraphNode[] = (Array.isArray(raw.nodes) ? raw.nodes : []).filter((n: any) => n && typeof n === 'object' && ref(n.id) !== undefined).map((n: any) => ({
    id: String(n.id),
    label: String(n.label ?? n.name ?? n.id),
    kind: typeof n.kind === 'string' ? n.kind : undefined,
    parent: ref(n.parent),
    layer: typeof n.layer === 'string' ? n.layer : undefined,
    // Marks carried by the data itself (e.g. a placeholder "with no content yet"). They are data, not derived: when the profile's
    // `placeholderFlags` recognizes one, it is drawn as skeleton.
    ...(Array.isArray(n.flags) ? { flags: n.flags.filter((f: unknown): f is string => typeof f === 'string') } : {}),
    data: n,
  }));
  const edges: GraphEdge[] = (Array.isArray(raw.edges) ? raw.edges : []).filter((e: any) => e && typeof e === 'object').map((e: any) => ({
    source: String(e.source ?? e.from),
    target: String(e.target ?? e.to),
    kind: typeof e.kind === 'string' ? e.kind : undefined,
    label: typeof e.label === 'string' ? e.label : undefined,
    weight: typeof e.weight === 'number' ? e.weight : undefined,
    // The whole record, like nodes' `data`: fields the library does not know survive a round trip (convert, toPhysical).
    data: e,
  }));
  return { origin, title: String(raw.name ?? raw.title ?? origin), nodes, edges };
}

/**
 * Model → the generic physical format `{nodes, edges}`, read back as is by `parsePhysical`. Only data is kept: derived things
 * (flags, origins, diff marks) are not written; they are recomputed on the next parse. `data` is spread onto the node, as
 * parsePhysical reads it. Used to "take the whole graph away" (export a single file after editing).
 */
export function toPhysical(model: GraphModel): { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] } {
  const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ''));
  return {
    nodes: model.nodes.map((n) => clean({ ...n.data, id: n.id, label: n.label, kind: n.kind, parent: n.parent, layer: n.layer })),
    edges: model.edges.map((e) => clean({ ...e.data, source: e.source, target: e.target, kind: e.kind, label: e.label, weight: e.weight })),
  };
}

const DEFAULT_LAYER: LayerSpec = { id: 'default', label: 'Graph', z: 0, structural: true };

/** Generic validation: the few things true of any graph (dangling edges, duplicate ids, duplicate edges). Domain checks are added separately.
 *
 *  **An edge is defined by its two ends + kind** (compare and edit both use this; `id` is only the name of the primitive on screen).
 *  So two edges with the same ends and kind are one edge written twice: only one is drawn, and deleting removes both. */
export function validateStructure(model: GraphModel): GraphIssue[] {
  const out: GraphIssue[] = [];
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const n of model.nodes) { if (seen.has(n.id)) dup.add(n.id); else seen.add(n.id); }
  for (const id of model.duplicateIds ?? []) dup.add(id);
  for (const id of dup) out.push({ kind: 'duplicate', group: 'Duplicate id', level: 'warn', nodeId: id, message: `Duplicate node id: ${id} (defined more than once; the first one is kept)` });
  const seenEdge = new Set<string>();
  const dupEdge = new Map<string, GraphEdge>();
  for (const e of model.edges) {
    const key = `${e.source}\u0000${e.target}\u0000${e.kind ?? ''}`;
    if (seenEdge.has(key)) dupEdge.set(key, e); else seenEdge.add(key);
  }
  for (const e of dupEdge.values()) {
    out.push({ kind: 'duplicate-edge', group: 'Duplicate edge', level: 'warn', edge: { source: e.source, target: e.target },
      message: `Duplicate edge: ${e.source} → ${e.target}${e.kind ? ` (${e.kind})` : ''} is defined more than once` });
  }
  for (const e of model.edges) {
    const miss = [!seen.has(e.source) && e.source, !seen.has(e.target) && e.target].filter(Boolean).join(' / ');
    if (miss) out.push({ kind: 'dangling', group: 'Dangling edge', level: 'warn', edge: { source: e.source, target: e.target }, message: `Dangling edge: points to missing node ${miss}` });
  }
  return out;
}

/** Complete a (possibly very sparse) input into a full profile. The defaults are the "generic graph" behavior. */
export function defineProfile(input: ProfileInput): GraphProfile {
  const layers = input.layers?.length ? input.layers : [DEFAULT_LAYER];
  const fallbackLayer = layers[0].id;
  return {
    id: input.id,
    parse: input.parse ?? parsePhysical,
    merge: input.merge ?? mergeSlices,
    layers,
    layerOf: input.layerOf ?? ((n) => n.layer ?? fallbackLayer),
    nodePalette: input.nodePalette ?? {},
    edgePalette: input.edgePalette ?? {},
    nodeSize: input.nodeSize ?? {},
    edgeWidth: input.edgeWidth ?? {},
    placeholderFlags: input.placeholderFlags ?? [],
    style: input.style ?? [],
    nodeClass: input.nodeClass ?? (() => ''),
    edgeClass: input.edgeClass ?? ((e) => e.kind ?? ''),
    kindLabels: input.kindLabels ?? {},
    detail: input.detail ?? {},
    validate: input.validate ?? (() => []),
    layoutEdge: input.layoutEdge ?? (() => false),
    singleRoot: input.singleRoot ?? true,
    rootLabel: input.rootLabel ?? 'Overview',
  };
}

/** Zero-configuration profile: reads `{nodes, edges}` directly. */
export const defaultProfile: GraphProfile = defineProfile({ id: 'default' });

/* ─── Entry: raw data → model ───────────────────────────────────────────── */

export interface RawSource { origin: string; text: string }

/**
 * The one entry for parsing + merging. **origin/layer are stamped here, uniformly**, so profile parsers need not
 * remember to fill them in: this is the foundation that "subgraph filtering / write-back location" stands on (filling them yourself always misses some).
 */
export function parseSources(sources: RawSource[], profile: GraphProfile = defaultProfile): GraphModel {
  const slices: GraphSlice[] = [];
  for (const { origin, text } of sources) {
    const s = profile.parse(origin, text);
    if (!s) continue;
    slices.push({
      ...s,
      origin,
      nodes: s.nodes.map((n) => ({
        ...n, origin: n.origin ?? origin, origins: n.origins ?? [origin],
        layer: n.layer ?? profile.layerOf(n),
      })),
      edges: s.edges.map((e) => ({ ...e, origin: e.origin ?? origin })),
    });
  }
  const model = profile.merge(slices);
  // merge may reorder / synthesize nodes (e.g. spine folding), so layers are filled again; rebuilding the index keeps it consistent.
  const nodes = model.nodes.map((n) => (n.layer ? n : { ...n, layer: profile.layerOf(n) }));
  const out = buildModel(nodes, model.edges, model.errors);
  return model.duplicateIds ? { ...out, duplicateIds: model.duplicateIds } : out;
}

/** All validation = generic structural checks + the profile's domain checks. */
export function validateModel(model: GraphModel, profile: GraphProfile): GraphIssue[] {
  return [...validateStructure(model), ...profile.validate(model)];
}
