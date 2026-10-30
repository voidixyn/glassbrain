/* glassbrain · views: "subgraph / layer / perspective" are one and the same thing
 *
 * Everything converges on one predicate: **there is only one graph; the view only decides what is visible**. So switching views rebuilds no instance,
 * relays out no coordinates, does not flicker. Two filter axes stack in order:
 *
 *   1. layers   layers            hard boundary, later expansion never crosses it
 *   2. origins  sources (subgraph) "only this file / this data source"
 *   Finally one ancestor closure: the parent chain of visible nodes must be present, or they would fall outside the graph.
 *
 * **Whatever the view points at that is not in this data counts as not given** (see `planeView` / `originView`). Views often
 * outlive data: after switching data, the previous file names and layer names are still in the view. Without this fallback that would
 * filter the whole graph away: a blank screen.
 *
 * **Search does not filter.** A query only marks hits; visibility is unchanged: the picture dims the rest, hits rank first,
 * Enter flies there. Filtering would tighten and relayout the graph and the shape just recognized would be gone: search is navigation, not a view.
 *
 * With no filter at all (FULL_VIEW) everything is visible directly: the fast path.
 */
import { indexModel, originsOfNode, type GraphModel } from './model';
import { VIRTUAL_ROOT, type CyElement } from './elements';

export interface GraphView {
  /** Visible layer ids; null/omitted = all. In a multi-layer graph (see `planeView`): exactly one layer when not stacked;
   *  when stacked (`planes`) any number of layers, in declaration order; all selected is null. */
  layers?: string[] | null;
  /** Only these sources; null/omitted = all. */
  origins?: string[] | null;
  /** Search query, matching label / id / string values in data; whitespace splits words, `/…/` is a regex (see `parseQuery`). Only marks hits, does not change visibility. */
  query?: string;
  /** Stacked layers (2.5D): the selected layers stack above each other. `false` shows one layer at a time; **omitted means stacked**:
   *  with multi-layer data, the first thing to see is "how many layers, and how they connect". */
  planes?: boolean;
  /** Node / edge kinds hidden in the whole graph (toggled by clicking names in the legend). Only not drawn and not hittable, positions still occupied;
   *  the hovered hop, search hits, and the selected node with its hop still show. Edges on hidden nodes hide with them. */
  hiddenNodeKinds?: string[];
  hiddenEdgeKinds?: string[];
}

export const FULL_VIEW: GraphView = {};

/**
 * **In a multi-layer graph, "which layers" and "how they are arranged" are two things.** Attached layers are placed by associated centroids (right above the
 * nodes they associate with), so flattened one layer covers another; there is no "several layers on one plane":
 *   · not stacked: exactly one layer, flat
 *   · stacked: any layers (at least one), stacked as 2.5D; layer order comes from the data (declaration order / z)
 * There is one set of coordinates, and the two arrangements are the same affine map run halfway (see `t` in planes.ts), so switching recomputes nothing
 * and can animate. The default is stacked with everything selected (`planes` omitted means true); turning stacking off keeps the frontmost selected layer,
 * or the first structure layer if none was ever selected.
 * Single-layer graphs have none of this and return as is.
 */
export function planeView(v: GraphView, layers: { id: string; structural?: boolean }[]): GraphView {
  if (layers.length < 2) return v.planes || v.layers ? { ...v, planes: false, layers: null } : v;
  const stacked = v.planes !== false;
  const picked = layers.map((l) => l.id).filter((id) => v.layers?.includes(id));
  const want = stacked
    ? (picked.length && picked.length < layers.length ? picked : null)
    : [picked[0] ?? (layers.find((l) => l.structural !== false) ?? layers[0]).id];
  const same = v.planes === stacked && (want === null ? v.layers == null
    : !!v.layers && want.length === v.layers.length && want.every((id, i) => id === v.layers![i]));
  return same ? v : { ...v, planes: stacked, layers: want };
}

/** Whether the view filters anything (decides whether to take the "everything visible" fast path). */
export function isFiltering(v: GraphView): boolean {
  return !!((v.origins && v.origins.length) || (v.layers && v.layers.length));
}

/** Whether a "piece cut out" of the graph is being viewed (by source). Only such subviews tighten and relayout; viewing one layer does not count:
 *  a layer is another way of looking at the same coordinates, and tightening would not match when switching back. */
export function isNarrowing(v: GraphView): boolean {
  return !!(v.origins && v.origins.length);
}

/** Keep only sources that really exist in this data; none left means no filter (null). Unchanged returns as is (same reference,
 *  so downstream memos do not rerun for nothing). */
export function originView(v: GraphView, available: Iterable<string>): GraphView {
  if (!v.origins?.length) return v;
  const have = new Set(available);
  const kept = v.origins.filter((o) => have.has(o));
  if (kept.length === v.origins.length) return v;
  return { ...v, origins: kept.length ? kept : null };
}

export interface ResolvedView {
  visible: Set<string>;
  /** Search hits (only searched within the visible range). */
  hits: Set<string>;
}

const textOf = (data: unknown): string => {
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) return data.map(textOf).join(' ');
  if (data && typeof data === 'object') return Object.values(data as Record<string, unknown>).map(textOf).join(' ');
  return '';
};

export function resolveView(model: GraphModel, elements: CyElement[], view: GraphView): ResolvedView {
  const present = new Set<string>();
  for (const el of elements) if (!el.data.source) present.add(el.data.id as string);

  const hitsIn = (scope: Set<string>) => new Set(searchNodes(model, view.query ?? '', scope));
  if (!isFiltering(view)) {
    return { visible: present, hits: hitsIn(present) };
  }

  const idx = indexModel(model);
  const layers = view.layers?.length ? new Set(view.layers) : null;
  const origins = view.origins?.length ? new Set(view.origins) : null;

  // 1+2 hard filters. The virtual root always stays (it is rendering scaffolding, not data).
  const base = new Set<string>();
  for (const n of model.nodes) {
    if (!present.has(n.id)) continue;
    if (layers && !layers.has(n.layer ?? '')) continue;
    if (origins && !originsOfNode(n).some((o) => origins.has(o))) continue;
    base.add(n.id);
  }

  // 3 ancestor closure. **It must close over the element-level parent chain** (including the synthesized virtual root), not just the model's
  // parent: in cytoscape a parent with display:none hides its whole subtree, and missing the root blanks the whole
  // graph.
  const visible = new Set(base);
  for (const id of base) for (const a of idx.ancestorsOf(id)) if (present.has(a)) visible.add(a);
  if (present.has(VIRTUAL_ROOT)) {
    // In box mode the root is a real compound parent and must stay; in connected mode it is just an ordinary node, and
    // when only one tree remains in a subview keeping it is noise, "an empty box + one very long line", so drop it.
    let isCompoundRoot = false;
    let topVisible = 0;
    for (const el of elements) {
      if (el.data.source) {
        if (el.data.kind === 'contains' && el.data.source === VIRTUAL_ROOT && visible.has(el.data.target as string)) topVisible++;
      } else if (el.data.parent === VIRTUAL_ROOT) {
        isCompoundRoot = true;
        if (visible.has(el.data.id as string)) topVisible++;
      }
    }
    if (isCompoundRoot || topVisible > 1) visible.add(VIRTUAL_ROOT);
  }

  return { visible, hits: hitsIn(base) };
}

/**
 * How a query is read. Wrapped in `/…/` it is a regex (if broken, it is treated as plain text); otherwise it splits on whitespace into words, and the whole string counts as one too.
 * Always case-insensitive. Search and "bold the matched part" in the dropdown share this, so the two never disagree.
 */
export function parseQuery(query: string): { re: RegExp | null; phrase: string; words: string[] } {
  const raw = query.trim();
  const m = /^\/(.+)\/$/.exec(raw);
  if (m) {
    try { return { re: new RegExp(m[1], 'i'), phrase: '', words: [] }; } catch { /* broken, fall through to text */ }
  }
  const phrase = raw.toLowerCase();
  return { re: null, phrase, words: phrase ? [...new Set(phrase.split(/\s+/))] : [] };
}

/** For "mark the matched parts": global, case-insensitive; the whole string first, longer words first. Returns null when there is nothing to mark. */
export function queryMarker(query: string): RegExp | null {
  const { re, phrase, words } = parseQuery(query);
  if (re) return new RegExp(re.source, 'gi');
  if (!phrase) return null;
  const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const alts = [phrase, ...words.filter((w) => w !== phrase)].sort((a, b) => b.length - a.length);
  return new RegExp(alts.map(esc).join('|'), 'gi');
}

/**
 * Search: look within `scope`, **ranked by similarity**.
 *
 * Tiers for the whole string from strict to loose: name equal, name starts with, name contains, id contains, content contains. With several words one more
 * tier is added, "word hits" (words may land in name / id / content each), but **only the batch with the most words hit is kept**: if some
 * hit all, only those (= AND); only if none hit all does it fall back to those that hit most (synonyms like "add insert" naturally
 * become OR). Highlighting follows the results, so one common word does not light up half the graph.
 *
 * Within a tier shorter comes first (shorter is closer to "that is it"), then by id, so results are stable. An empty query returns nothing.
 */
export function searchNodes(model: GraphModel, query: string, scope?: Iterable<string> | null): string[] {
  const { re, phrase: q, words } = parseQuery(query);
  if (!re && !q) return [];
  const ids = scope ? scope : model.nodes.map((n) => n.id);
  const ranked: [number, number, number, string][] = [];
  let best = 0;
  for (const id of ids) {
    if (id === VIRTUAL_ROOT) continue;
    const n = model.index.get(id);
    if (!n) continue;
    let tier = -1;
    let k = 1;
    if (re) {
      const m = re.exec(n.label);
      tier = m ? (m.index > 0 ? 2 : m[0].length === n.label.length ? 0 : 1)
        : re.test(n.id) ? 3 : re.test(textOf(n.data)) ? 4 : -1;
    } else {
      const label = n.label.toLowerCase();
      tier = label === q ? 0 : label.startsWith(q) ? 1 : label.includes(q) ? 2
        : n.id.toLowerCase().includes(q) ? 3 : -1;
      let text: string | null = null;
      const rest = () => (text ??= `${n.id} ${textOf(n.data)}`.toLowerCase());
      if (tier < 0 && rest().includes(q)) tier = 4;
      if (tier >= 0) k = words.length;
      else if (words.length > 1) {
        let inLabel = 0;
        k = 0;
        for (const w of words) {
          if (label.includes(w)) { k++; inLabel++; } else if (rest().includes(w)) k++;
        }
        if (k) tier = inLabel === k ? 5 : 6;
      }
    }
    if (tier < 0) continue;
    if (k > best) best = k;
    ranked.push([k, tier, n.label.length, id]);
  }
  return ranked
    .filter((r) => r[0] === best)
    .sort((a, b) => a[1] - b[1] || a[2] - b[2] || (a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0))
    .map((r) => r[3]);
}
