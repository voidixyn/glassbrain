/* glassbrain · readability field: in a large graph "which labels show, and how big" is one continuous function, not three separate mechanisms.
 *
 * Background: with thousands of nodes zoomed to 10%–20% text is completely unreadable. The two ideas listed before
 * (constant screen font size, importance quotas) each hold, but what decides readability is folding them into one
 * score instead of letting each decide separately:
 *
 *   structural importance  reuses `share`, already computed in `elements.ts` (subtree leaves as a fraction, √ compressed).
 *                          Containers / big branches are naturally higher, leaves are always 0, no separate "who matters more" judgment needed.
 *   focus distance         the closer a node is to the viewport center (or the host's focus) in **screen pixels**, the higher; further outside the
 *                          picture it tends to 0. Zoomed out to the whole, only the high-share backbone is readable; zoomed in on
 *                          a small patch, even leaves (share always 0) show when close:
 *                          "zoom out for the trunk, zoom in for the leaves" needs no separate implementation; it follows from adding the two.
 *
 * The sum is only used for **order**: from high score to low, who picks a spot first. Picking is greedy: in order,
 * ask "is this patch of screen still free"; if free take it, if not leave it to the next one. No global average like "viewport area ÷
 * label area" to guess a quota. A global average breaks down **locally**: a graph that is sparse in one half and crowded in the other
 * is the norm (especially containment layouts, where dozens of leaves under one big branch crowd into
 * a small patch); a quota from the global area is too stingy for sparse areas and nowhere near enough for crowded ones, wrong at both ends.
 * Greedy grabbing by position is naturally generous in sparse areas and tight in crowded ones, with no guessing "is it crowded here".
 *
 * **"Free" means two things**: not overlapping text already placed (leaving a `padding`-wide gap), and not covering
 * **named nodes**, the ones already showing a label. Text is drawn above nodes (the canvas puts text on a separate layer), so covering one
 * hides the node; hide a named node and readers cannot tell whose name it is. Small unnamed nodes covered by text
 * do no harm: zoomed far out a cluster has a node every dozen pixels, and "cover no node at all" would leave room for no text,
 * while the whole point of this layer is "however small, give enough information, as much as fits". Conversely, a node already
 * covered by someone else's text no longer shows its own name (a name on an invisible node matches nothing).
 *
 * Label boxes hang below the node first; if there is no room below, try above, right, left in turn. Whichever side it was on last time is tried first, so
 * re-verdicts do not keep moving it and labels do not hop around their nodes.
 *
 * Everything is in screen coordinates (`renderedPosition`), never the nodes' graph coordinates: this layer only decides how labels are drawn
 * and does not touch the baseline "structure comes from containment, not from force".
 *
 * **Who shows is binary; how it shows is continuous.** This only gives verdicts (0/1); the time sliding from the old verdict to the new one
 * belongs to the canvas (GraphCanvas's label channel). This layer has no notion of time; it is a pure function.
 */

export interface LabelInput {
  id: string;
  /** The node's current screen coordinates (cytoscape's renderedPosition). */
  sx: number;
  sy: number;
  /** The node's on-screen radius (half height for box mode containers): labels hang below its bottom edge. */
  r: number;
  /** The structural share computed by `elements.ts`, ∈[0,1], always 0 for leaves. */
  share: number;
  /** Label text. */
  label: string;
  /** This label's font size (screen px); defaults to `opts.fontPx`. */
  fontPx?: number;
  /** Measured text width (screen px). If omitted, estimated from a typical aspect ratio. */
  w?: number;
  /** This is a point. Default yes; a box mode container is an area that should hold text, so it is not an obstacle,
   *  and its label only hangs below its bottom edge (above, left or right would run into other boxes). */
  obstacle?: boolean;
  /** Which side the label hung on last time; try that side first. */
  side?: LabelSide;
  /** Search hit / current selection: always shown, never eliminated. */
  pinned?: boolean;
}

export type LabelSide = 'below' | 'above' | 'right' | 'left';
const SIDES: LabelSide[] = ['below', 'above', 'right', 'left'];

export interface ReadabilityOptions {
  /** Viewport size in pixels (container clientWidth/clientHeight). */
  viewport: { w: number; h: number };
  /** Focus in screen coordinates; defaults to the viewport center. */
  focus?: { x: number; y: number };
  /** Default font size (screen px). */
  fontPx?: number;
  /** Weights of the structure / focus terms, each ∈[0,1]. */
  structWeight?: number;
  focusWeight?: number;
  /** Minimum gap between label boxes (screen px): the "label density" knob. */
  padding?: number;
  /** A bias added to the score, computed outside: incumbent hysteresis and the idle breathing phase drift come in here. */
  bias?: Map<string, number>;
}

export interface LabelPlan {
  /** Got a spot on screen = 1, did not = 0. Nodes are unaffected: they are always there; only text is put away when there is no room. */
  opacity: number;
  fontPx: number;
  /** Text box width (screen px). */
  w: number;
  /** Which side of the node the label hangs on. Without a spot it is "the side to try first next time". */
  side: LabelSide;
}

const DEFAULT_FONT = 13;
const DEFAULT_PAD = 6;
/** Gap between the node's edge and the label box. */
const LABEL_GAP = 3;
/** Minimum distance from a label box to other (named) nodes. Must be smaller than LABEL_GAP; see where planLabels uses it. */
const DOT_CLEARANCE = 2;
/** Label box height = font size × this. */
const LINE = 1.3;

/** Without measuring on a canvas, estimate from a typical aspect ratio; hosts that can measure pass `w`. */
function estimateWidth(label: string, fontPx: number): number {
  return Math.max(fontPx, label.length * fontPx * 0.56);
}

/** Label box geometry, in one place only: the verdict and the canvas drawing both use it, so "what is judged" is "what is drawn". */
export function labelBox(sx: number, sy: number, r: number, fontPx: number, w: number, side: LabelSide = 'below') {
  const h = fontPx * LINE;
  switch (side) {
    case 'above': return { x: sx, y: sy - r - LABEL_GAP - h / 2, w, h };
    case 'right': return { x: sx + r + LABEL_GAP + w / 2, y: sy, w, h };
    case 'left': return { x: sx - r - LABEL_GAP - w / 2, y: sy, w, h };
    default: return { x: sx, y: sy + r + LABEL_GAP + h / 2, w, h };
  }
}

interface Box { x: number; y: number; w: number; h: number }
interface Dot { id: string; x: number; y: number; r: number }

const boxesOverlap = (a: Box, b: Box, pad: number) =>
  Math.abs(a.x - b.x) * 2 < a.w + b.w + pad * 2 && Math.abs(a.y - b.y) * 2 < a.h + b.h + pad * 2;
const boxHitsDot = (b: Box, d: Dot, pad: number) => {
  const dx = Math.max(Math.abs(d.x - b.x) - b.w / 2, 0);
  const dy = Math.max(Math.abs(d.y - b.y) - b.h / 2, 0);
  return dx * dx + dy * dy < (d.r + pad) * (d.r + pad);
};

/** Grid: the cell size is "the largest thing + gap", so any pair that could collide falls in adjacent cells of a 3×3 block. */
class Grid<T extends { x: number; y: number }> {
  private grid = new Map<string, T[]>();
  private cell: number;
  constructor(cell: number) { this.cell = Math.max(1, cell); }
  add(t: T) {
    const k = `${Math.floor(t.x / this.cell)},${Math.floor(t.y / this.cell)}`;
    const arr = this.grid.get(k);
    arr ? arr.push(t) : this.grid.set(k, [t]);
  }
  some(x: number, y: number, hit: (t: T) => boolean): boolean {
    const gx = Math.floor(x / this.cell), gy = Math.floor(y / this.cell);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const t of this.grid.get(`${gx + i},${gy + j}`) ?? []) if (hit(t)) return true;
    }
    return false;
  }
}

export function planLabels(nodes: LabelInput[], opts: ReadabilityOptions): Map<string, LabelPlan> {
  const { viewport } = opts;
  const focus = opts.focus ?? { x: viewport.w / 2, y: viewport.h / 2 };
  const wStruct = opts.structWeight ?? 1;
  const wFocus = opts.focusWeight ?? 1;
  const pad = opts.padding ?? DEFAULT_PAD;
  const maxDist = Math.hypot(viewport.w, viewport.h) / 2 || 1;

  const cands = nodes.map((n) => {
    const fontPx = n.fontPx ?? opts.fontPx ?? DEFAULT_FONT;
    const w = n.w ?? estimateWidth(n.label, fontPx);
    const dist = Math.hypot(n.sx - focus.x, n.sy - focus.y);
    const proximity = Math.max(0, 1 - dist / maxDist);
    const score = n.pinned ? Infinity
      : wStruct * n.share + wFocus * proximity + (opts.bias?.get(n.id) ?? 0);
    return { n, fontPx, w, score };
  });
  cands.sort((a, b) => b.score - a.score);

  // Only a fixed thin gap from named nodes, not tied to the spacing knob: the knob sets how sparse text is relative to text;
  // and once this gap is wider than the gap between a node and its own label, side-by-side neighbors in a row block each other's labels.
  const dotPad = DOT_CLEARANCE;
  const biggest = Math.max(
    DEFAULT_FONT * 6,
    ...cands.map((c) => Math.max(c.w, c.fontPx * LINE) + c.n.r * 2 + LABEL_GAP * 2),
  );
  const labels = new Grid<Box>(biggest + pad * 2);
  const named = new Grid<Dot>(biggest + pad * 2);
  const onScreen = (b: Box) => b.x + b.w / 2 > 0 && b.x - b.w / 2 < viewport.w
    && b.y + b.h / 2 > 0 && b.y - b.h / 2 < viewport.h;

  // Greedy placement: higher scores pick first. Those that find no spot are not "scored too low" but "this patch is already full":
  // it tightens locally by itself, no global quota needed to guess where it is crowded.
  const plan = new Map<string, LabelPlan>();
  for (const { n, fontPx, w } of cands) {
    const isDot = n.obstacle !== false;
    const prefer = isDot ? n.side ?? 'below' : 'below';
    const order = isDot ? [prefer, ...SIDES.filter((s) => s !== prefer)] : ['below' as const];
    const self: Dot = { id: n.id, x: n.sx, y: n.sy, r: n.r };
    let placed: { box: Box; side: LabelSide } | null = null;
    if (n.pinned) {
      placed = { box: labelBox(n.sx, n.sy, n.r, fontPx, w, prefer), side: prefer };
    } else if (!(isDot && labels.some(n.sx, n.sy, (b) => boxHitsDot(b, self, dotPad)))) {
      for (const side of order) {
        const box = labelBox(n.sx, n.sy, n.r, fontPx, w, side);
        if (!onScreen(box)) continue;
        if (labels.some(box.x, box.y, (b) => boxesOverlap(box, b, pad))) continue;
        if (named.some(box.x, box.y, (d) => boxHitsDot(box, d, dotPad))) continue;
        placed = { box, side };
        break;
      }
    }
    if (placed) {
      labels.add(placed.box);
      if (isDot) named.add(self);
    }
    plan.set(n.id, { opacity: placed ? 1 : 0, fontPx, w, side: placed?.side ?? prefer });
  }
  return plan;
}

/** Give each id a stable but random-looking phase ∈[0, 2π). Not truly random: the same id gets the same phase
 *  every call, so breathing rotation "turns slowly" instead of "reshuffling every time". */
export function idPhase(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 6283) / 1000; // an approximation of 0..2π
}
