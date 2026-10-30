'use client';
/**
 * glassbrain · diff overlay: each column draws its own half
 *
 * **Drawn under the canvas.** Layer z-index:0; cytoscape's canvases are 1–3 and transparent, so all the light of this layer
 * shows from **behind** the primitives. That is the premise of the whole UI language: diff covers not one pixel of the user's primitives,
 * so "the color channel belongs to the user" needs no exception. The cost is that this layer cannot be clicked (`pointer-events:none`);
 * it should not be anyway: to select, click the node itself.
 *
 * **Two columns, two contents, one table decides** (`MARK`):
 *
 *   left (past)   only in old → dark red glow   in both but different → pale yellow glow
 *   right (now)   only in new → teal green glow   in both but different → pale yellow glow
 *
 * Hue here is **redundant reinforcement**: "which column" already says added and removed, which is why red and green are safe to use; the three
 * inks are also ordered by lightness, so red-green color blind viewers can tell them apart by lightness alone (see `DIFF_INK` in style.ts).
 *
 * **Strength has three levels, not a continuous mapping.** The size of a change (`NodeChange.amount`) drives both the halo's
 * **radius and opacity**: moving only the radius makes the three levels look alike. The lowest level is deliberately faint: a node with
 * only one field changed should not grab attention.
 * Discrete for two very practical reasons: ① shapes of the same color and level join into **one path**, so the layer's DOM count
 * is independent of graph size (a continuous radius would degrade to "one path per node"); ② the eye cannot compare continuous radii
 * anyway, and levels read better. Additions and removals have no "size" (presence is binary) and always take the top level.
 *
 * **No animation.** Permanent blinking costs a full-viewport frame every frame wherever it is drawn, and hides information half the time:
 * blinking is for "spotting a difference", not for "understanding one", and two columns are about the latter.
 */
import { useMemo, type CSSProperties } from 'react';
import type { GraphDelta, NodeChange } from '../diff';
import { useStrings } from './i18n';

/** Node box in graph coordinates. **Must be measured from cytoscape after layout lands**: one measured before layout
 *  has only leaves and lacks compounds' real expanded sizes, and would be visibly off. */
export type NodeBox = { x: number; y: number; w: number; h: number };
/** An edge that should glow: already an svg path, in graph coordinates.
 *  Carries both end ids: the overlay is a separate DOM and has to judge for itself "is this line's owner still present". */
export type GlowEdge = { id: string; kind: 'added' | 'removed'; d: string; source: string; target: string };
/** To hug the primitives the overlay needs their geometry after landing. GraphCanvas measures it once on landing. */
export interface DiffGeometry {
  nodes: Record<string, NodeBox>;
  edges: GlowEdge[];
}

export interface DiffOverlayProps {
  delta: GraphDelta;
  geom: DiffGeometry;
  viewport: { zoom: number; pan: { x: number; y: number } };
  /** Which column it draws for. */
  side: 'past' | 'now';
  /** Only draw these ids (for filters like "changes only"). Omitted = draw all. */
  only?: Set<string> | null;
  /**
   * Currently **visible** nodes (the result of `resolveView`). Nodes filtered out by the view are `display:none` on the canvas,
   * but the overlay is a separate DOM and does not see cytoscape's visibility; without this,
   * filtered nodes leave "a ring of light with no owner" floating in empty space. Omitted = all visible.
   */
  visible?: Set<string> | null;
  /** Mark limit. Beyond it nothing is drawn: thousands of marks carry no information and nobody can count them. */
  max?: number;
}

const DEFAULT_MAX = 600;
/** How far the glow extends beyond the primitive (graph coordinates). */
const PAD = 4;
/** The three node glow passes: [stroke width, opacity]. Wide to narrow, faint to strong, making a fading band of light.
 *  **The innermost pass must be strong enough**: a faint band washes out to grey on white, and the lightness difference between the three inks is the only cue
 *  red-green color blind viewers have; washing it out erases it. */
const GLOW_PASSES: [number, number][] = [[26, 0.05], [15, 0.13], [6, 0.55]];
/**
 * **Edge glow must be much narrower.**
 *
 * The visual weight of light = width × length. A node's perimeter is bounded, an edge's length is not: the same width of 26 on a curve a thousand
 * units long is a band of light across half the graph. One "dependency analysis" step pours in a few hundred long edges and the whole graph is
 * soaked in light, and in a graph soaked in light the light no longer points at anything.
 */
const GLOW_EDGE_PASSES: [number, number][] = [[9, 0.07], [5, 0.18], [2.5, 0.62]];
/** Three strength levels: [radius factor, opacity factor]. **Radius and opacity move together**: shrinking only the radius makes the three levels look alike,
 *  because a thin strong ring and a thick strong ring share the same "strong".
 *
 *  The lowest level is **deliberately faint**: a node with only `dependencies` changed should not grab attention.
 *  But not zero: strength is for **ranking**, not for hiding; up close it must still be visible. */
const LEVEL: [number, number][] = [[0.3, 0.28], [0.75, 0.68], [1.3, 1.15]];
/** Those without `amount` (additions / removals, and ones upstream did not provide) all take the top level. */
const TOP = LEVEL.length - 1;

const levelOf = (amount?: number) =>
  (amount === undefined ? TOP : Math.max(0, Math.min(TOP, Math.floor(amount * LEVEL.length))));

const r1 = (v: number) => Math.round(v * 10) / 10;

/** A rounded rectangle path. **A string rather than a `<rect>`**: only then can hundreds of boxes merge into one path. */
function roundRect(x: number, y: number, w: number, h: number, r: number): string {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  const [X, Y, W, H, K] = [r1(x), r1(y), r1(w), r1(h), r1(k)];
  return `M${X + K},${Y}h${r1(W - 2 * K)}a${K},${K} 0 0 1 ${K},${K}`
    + `v${r1(H - 2 * K)}a${K},${K} 0 0 1 ${-K},${K}`
    + `h${r1(-(W - 2 * K))}a${K},${K} 0 0 1 ${-K},${-K}`
    + `v${r1(-(H - 2 * K))}a${K},${K} 0 0 1 ${K},${-K}z`;
}

/** A rounded rectangle hugging a node's box. */
function around(b: NodeBox, pad: number): string {
  return roundRect(b.x - b.w / 2 - pad, b.y - b.h / 2 - pad, b.w + pad * 2, b.h + pad * 2, 6 + pad);
}

/** Reconstruct the curve cytoscape draws: control points joined at their midpoints into quadratic Béziers,
 *  consistent with its own multi-control-point drawing. */
export function edgePath(s: { x: number; y: number }, cps: { x: number; y: number }[], t: { x: number; y: number }): string {
  if (!cps.length) return `M${s.x},${s.y}L${t.x},${t.y}`;
  if (cps.length === 1) return `M${s.x},${s.y}Q${cps[0].x},${cps[0].y} ${t.x},${t.y}`;
  let d = `M${s.x},${s.y}`;
  for (let i = 0; i < cps.length - 1; i++) {
    const c = cps[i], n = cps[i + 1];
    d += `Q${c.x},${c.y} ${(c.x + n.x) / 2},${(c.y + n.y) / 2}`;
  }
  const last = cps[cps.length - 1];
  return `${d}Q${last.x},${last.y} ${t.x},${t.y}`;
}

type Ink = 'new' | 'del' | 'mod';
/** Drawing order: red at the bottom, green at the top. (Each column has only two inks, so overlap never happens; fixing it only
 *  keeps DOM order independent of the data.) */
const INKS: Ink[] = ['del', 'mod', 'new'];

/** Which ink for which column and which change category. **This table is the UI language itself**; do not decide it again elsewhere. */
const MARK: Record<'past' | 'now', Record<NodeChange['kind'], Ink | null>> = {
  past: { added: null, changed: 'mod', moved: 'mod', removed: 'del', merged: 'del' },
  now: { added: 'new', changed: 'mod', moved: 'mod', removed: null, merged: null },
};

/** One path accumulated per ink × level. */
type Buckets = Record<Ink, string[]>;
const emptyBuckets = (): Buckets => ({ new: [], del: [], mod: [] });

export default function DiffOverlay(p: DiffOverlayProps) {
  const { delta, geom, viewport, side, only, visible, max = DEFAULT_MAX } = p;
  const str = useStrings();

  const { nodeGlow, edgeGlow, wireD, truncated } = useMemo(() => {
    const shown = (id: string) => (!only || only.has(id)) && (!visible || visible.has(id));
    const table = MARK[side];
    /* **The quota only counts what this column can draw.** Both columns share one change list but each draws half: the left does not
     * draw "only in new", the right does not draw "only in old". Cutting before filtering, the quota would be eaten by things this column never
     * draws: one "dependency analysis" step adds a few hundred and the left column's yellow glows get squeezed out, while "N more not
     * marked" reports some other number. */
    // Structural changes (merged / moved) come first: with a limited quota, the most informative ones go first.
    const rank: Record<NodeChange['kind'], number> = { merged: 0, moved: 1, removed: 2, added: 3, changed: 4 };
    const list = [...delta.changes]
      .filter((c) => table[c.kind] && shown(c.id))
      .sort((a, b) => rank[a.kind] - rank[b.kind]);
    const truncated = Math.max(0, list.length - max);

    const nodeGlow = LEVEL.map(emptyBuckets);
    const edgeGlow = emptyBuckets();
    const wire: string[] = [];
    for (const c of list.slice(0, max)) {
      const box = geom.nodes[c.id];
      if (!box) continue;
      const ink = table[c.kind]!;
      const lv = levelOf(c.amount);
      nodeGlow[lv][ink].push(around(box, PAD * LEVEL[lv][0]));
      /* Counterpart lines are drawn only for relations **no edge can express**:
       *  · merged: the old merged into the new, and the union never has such an edge;
       *  (moved is not drawn: each column has a marked containment edge saying it, and drawing more says the same thing twice.)
       * The right column draws none: both categories start from nodes only in the old version, which the right column does not have. */
      if (side === 'now' || !c.pairId || !shown(c.pairId)) continue;
      if (c.kind !== 'merged') continue;
      const to = geom.nodes[c.pairId];
      if (to) wire.push(`M${r1(box.x)},${r1(box.y)}L${r1(to.x)},${r1(to.y)}`);
    }
    /* Edges glow too: for a whole cluster of added nodes, the edges connecting them are of course added; if only nodes glow and edges stay
     * untouched it looks disjointed. The left column only takes removed edges, the right only new ones. Edges have no "size", no levels. */
    const wantEdge = side === 'past' ? 'removed' : 'added';
    const edgeInk: Ink = side === 'past' ? 'del' : 'new';
    for (const e of geom.edges) {
      if (e.kind !== wantEdge || !shown(e.source) || !shown(e.target)) continue;
      if (edgeGlow[edgeInk].length >= max * 2) break;
      edgeGlow[edgeInk].push(e.d);
    }
    const join = (m: Buckets) => ({ new: m.new.join(''), del: m.del.join(''), mod: m.mod.join('') });
    return {
      nodeGlow: nodeGlow.map(join),
      edgeGlow: join(edgeGlow),
      wireD: wire.join(''),
      truncated,
    };
  }, [delta, geom, only, visible, side, max]);

  const anyGlow = INKS.some((k) => edgeGlow[k] || nodeGlow.some((lv) => lv[k]));
  if (!anyGlow && !wireD) return null;
  const t = `translate(${viewport.pan.x},${viewport.pan.y}) scale(${viewport.zoom})`;
  // Line width compensates for zoom inversely, so it does not blur into a blob when zoomed out.
  const inv = 1 / Math.max(viewport.zoom, 0.02);
  const dash: CSSProperties = { strokeDasharray: `${5 * inv} ${4 * inv}` };

  return (
    <>
      <svg className="gb-diff-under" aria-hidden>
        <g transform={t}>
          {INKS.map((ink) => (
            <g key={ink} className={`gb-glow gb-glow-${ink}`}>
              {edgeGlow[ink] && GLOW_EDGE_PASSES.map(([w, o]) => (
                <path key={`e${w}`} d={edgeGlow[ink]} strokeWidth={w * inv} strokeOpacity={o} />
              ))}
              {nodeGlow.map((lv, i) => lv[ink] && GLOW_PASSES.map(([w, o]) => (
                <path key={`n${i}-${w}`} d={lv[ink]}
                  strokeWidth={w * LEVEL[i][0] * inv} strokeOpacity={Math.min(1, o * LEVEL[i][1])} />
              )))}
            </g>
          ))}
          {wireD && <path className="gb-pastwire" d={wireD} strokeWidth={2 * inv} style={dash} />}
        </g>
      </svg>
      {truncated > 0 && <div className="gb-diff-trunc">{str.diffTruncated(truncated)}</div>}
    </>
  );
}
