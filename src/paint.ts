/* glassbrain · painting: in browse mode, nodes and edges on screen are drawn here, not by cytoscape's renderer.
 *
 * **Division of labor.** cytoscape still owns data, stylesheet, layout and transitions (transitions write positions and inline opacity
 * onto elements frame by frame); this only reads the values it computed, converts them to on-screen size and opacity, and draws them in color batches.
 * The only hooks are two renderer functions: `render` (draw) and `findNearestElements` (mouse hit testing).
 * cytoscape's own WebGL mode plugs in by replacing these same two functions and touches nothing else: events, dragging,
 * viewport, selection, transitions and the text layer all stay as they were.
 *
 * **Why not let cytoscape draw.** It walks every element each frame, and walks every element again on each mouse move to find
 * a hit: on a three-thousand-node graph one mouse move took 150–350 ms, and the picture kept chasing a backlog of events. Batched by color,
 * with hits computed only from point-to-point and point-to-line distances, the same graph takes a few ms per frame.
 *
 * **Four rules** (the numbers are in the constants below, tuned by hand on a test page):
 *
 *   ① The skeleton has weight and follows geometry. Node diameters and containment edge widths are graph units × zoom. When too thin to draw
 *      they stop thinning and fade instead: **ink is conserved**: a line computed at 0.3 px is drawn 1 px at 30% opacity, so the ink on
 *      screen is proportional to its real weight, dense areas are naturally darker, sparse ones lighter, and no element is lost. The skeleton from afar
 *      also has a floor, by weight: the trunk stays a few pixels from afar, the leaf level still recedes to faint lines.
 *   ② Semantic edges are hairlines: a constant 1 px that does not thicken with zoom, only strength (the host's `semanticOpacity`). Their ink
 *      is conserved too, **per screen**: the more and longer the semantic edges drawn on screen, the fainter each; in a sparse graph each is more solid.
 *      So the strength slider sets "the ink of this screen", and changing data or zoom needs no readjusting. Dashes and arrows are drawn only up close:
 *      far away dashed and solid are indistinguishable, yet each small segment costs.
 *   ③ Drawing order is layering: container boxes → haze → edges (by stylesheet z-index) → nodes → the focused hop.
 *   ④ Nodes only care how big they are on screen, one continuous change: very small, a faint haze of the same color under them (clusters have body from afar);
 *      while the haze fades, each node grows a canvas-colored gap ring (separate dots, not stuck into blobs); larger still, solid dots.
 *
 * "Near" and "far" are measured by how big a leaf is drawn right now (`leafPx`), not by absolute zoom: move the node size slider and
 * haze, gaps and detail move with it; the rules need not know the slider exists.
 *
 * Hover is here too: the whole graph times an opacity, the focused hop drawn again on top. One hover changes no
 * element's style.
 */
import { EDGE_W, NODE_BASE, nodeWeight, shareT, type GraphTheme } from './style';

/* ── Rules ─────────────────────────────────────────────────────────────── */

/** Smallest node and thinnest line drawn (screen px). Below that they stop shrinking and fade instead. */
export const MIN_DOT = 2;
export const MIN_LINE = 1;
/** Heavy nodes shrink less from afar: once leaves are drawn smaller than this, nodes get size back by weight (nodeWeight in style.ts, 0–1),
 *  and a fully loaded node stops at its size "when leaves were this big". Fitting a small graph to the window gives leaves about 3 px, so large nodes in small graphs
 *  are only slightly bigger; in large graphs zoomed further out, they carry the hierarchy. */
export const HOLD_LEAF = 4;
/** How close the mouse must be to a node's drawn edge to hit it (screen px). Nodes are tested before edges. */
export const NODE_SLACK = 4;
/** The skeleton's far-away floor: `SKEL_FLOOR × t^SKEL_CURVE` (t = position on the ramp, see shareT in style.ts).
 *  The trunk about 4 px, middle levels about 1 px, the leaf level under half a pixel: still receding to faint lines. */
export const SKEL_FLOOR = 4;
const SKEL_CURVE = 1.2;
/** Semantic edges: the base width (EDGE_W in the stylesheet) is drawn as 1 px, others proportionally: weight and per-kind multipliers (`edgeWidth`)
 *  multiply it; they do not thicken with zoom.
 *  Strength conserves ink per screen: `cover` = total length of semantic edges on screen × width ÷ screen area (overlaps not subtracted). When cover is exactly
 *  SEM_INK you get the given strength; denser fades by √(SEM_INK / cover) (the square root keeps dense graphs looking dense
 *  without smearing into a sheet), sparser gets at most SEM_BOOST times more solid. */
export const SEM_W = 1;
export const SEM_INK = 0.05;
export const SEM_BOOST = 2;
/** Semantic edges of the hovered hop: up to FOCUS_INK of them are solid, beyond that each fades by √(FOCUS_INK / count):
 *  ink is conserved by count, not distance (hover is about seeing them); the square root keeps well-connected ones looking busy without becoming a wall. */
export const FOCUS_INK = 16;
export const focusAlphaOf = (n: number, ink = FOCUS_INK) => Math.min(1, Math.sqrt(ink / Math.max(1, n)));
/** Leaves must be drawn this big before dashes and semantic edge arrows are drawn. */
export const DETAIL_LEAF = 6;
/** Gap ring: grows from GAP[0] px and is full GAP_MAX px at GAP[1] px. The haze fades over the same range. */
export const GAP: readonly [number, number] = [3, 9];
const GAP_MAX = 1.5;
/** Haze: radius = diameter × HAZE_R (graph units), at most HAZE_MAX opacity. */
const HAZE_R = 1.4;
const HAZE_MAX = 0.32;
/** Hover: how dark the rest gets, how long the fade takes. */
export const HOVER_DIM = 0.4;
const HOVER_FADE_MS = 160;
/** Toggling a kind: a whole class fades in or out together, more than the hovered hop, so it gets a bit longer. */
const MUTE_FADE_MS = 240;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const ramp = (v: number, [a, b]: readonly [number, number]) => clamp01((v - a) / (b - a));

/** Node: graph diameter d, zoom z, weight w, current leaf size → [screen diameter, opacity]. */
export const dotOf = (d: number, z: number, w = 0, leafPx = Infinity, hold = HOLD_LEAF): [number, number] => {
  const s = d * z * Math.max(1, (w * hold) / leafPx);
  return s >= MIN_DOT ? [s, 1] : [MIN_DOT, (s / MIN_DOT) ** 2];
};
/** Gap ring width (screen px), depending only on how big the node is drawn. */
export const gapOf = (px: number) => GAP_MAX * ramp(px, GAP);
/** Skeleton line: graph width w, zoom z, ramp position t → [screen width, opacity]. */
export const skeletonLineOf = (w: number, z: number, t: number): [number, number] => {
  const s = Math.max(w * z, SKEL_FLOOR * t ** SKEL_CURVE);
  return s >= MIN_LINE ? [s, 1] : [MIN_LINE, s / MIN_LINE];
};
/** Current semantic edge strength: given strength × how dense this screen is. */
export const semanticAlphaOf = (opacity: number, cover: number) =>
  Math.min(1, opacity * Math.min(SEM_BOOST, Math.sqrt(SEM_INK / Math.max(cover, 1e-9))));
/** How long the part of segment (ax,ay)–(bx,by) inside [0,W]×[0,H] is. */
export const clippedLength = (ax: number, ay: number, bx: number, by: number, W: number, H: number) => {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  for (const [p, q] of [[-dx, ax], [dx, W - ax], [-dy, ay], [dy, H - ay]] as const) {
    if (p === 0) { if (q < 0) return 0; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return 0; if (r > t0) t0 = r; } else { if (r < t0) return 0; if (r < t1) t1 = r; }
  }
  return Math.hypot(dx, dy) * (t1 - t0);
};
/** Current haze strength: hands over with the gap ring in the same range. */
export const hazeOf = (leafPx: number) => HAZE_MAX * (1 - ramp(leafPx, GAP));
/** Edge hit range (screen px from the center line) = (hit width + half line width) × the opacity ink conservation gives it. Continuously:
 *  the clearer it shows, the easier to hit. No threshold and no floor: the mouse lands on whole pixels, a band a fraction of a pixel wide
 *  is almost never landed on when sweeping, and the fainter it is the harder to touch, naturally. */
export const EDGE_REACH = 0.5;
export const reachOf = (vis: number, lineW: number, touch = false, base = EDGE_REACH) =>
  (base * (touch ? 2.4 : 1) + lineW / 2) * vis;
/** A hit band (2 × range) narrower than one pixel does not count: the mouse lands on whole pixels and cannot resolve anything finer;
 *  the threshold is the input device's resolution, not a chosen number. */
export const hittable = (reach: number) => reach * 2 >= 1;
/** Up close or not (dashes, semantic edge arrows). */
export const detailed = (leafPx: number) => leafPx >= DETAIL_LEAF;

/* ── Scene: the values read from cytoscape that drawing needs ────────────────── */

/** Shapes and arrow heads the painter can draw. Hosts drawing marks "like on the graph" (a legend, say) follow these two mappings. */
export type Shape = 'circle' | 'hexagon' | 'diamond' | 'rect';
export type Arrow = 'none' | 'triangle' | 'tee';

interface NodeRec {
  ele: any; id: string; parent: boolean;
  vis: boolean; op: number;
  fill: string; border: string; bw: number;
  d: number; w: number; shape: Shape; t: number; bgOp: number; depth: number;
  events: boolean;
  /* Filled every frame: screen coordinates, drawn size, container boxes' screen boxes. */
  x: number; y: number; s: number; a: number; box?: [number, number, number, number];
}
interface EdgeRec {
  ele: any; id: string; src: NodeRec; tgt: NodeRec;
  vis: boolean; op: number; color: string; w: number;
  dash: 'solid' | 'dashed' | 'dotted'; head: Arrow; tail: Arrow;
  skeleton: boolean; t: number; bend: number; z: number; events: boolean;
}

/** cytoscape `shape` → painter shape. */
export const shapeOf = (name: string): Shape =>
  /hexagon|octagon|pentagon|heptagon/.test(name) ? 'hexagon'
    : /diamond/.test(name) ? 'diamond'
      : /rectangle|square|barrel|tag/.test(name) ? 'rect' : 'circle';
/** cytoscape `*-arrow-shape` → painter arrow head. */
export const arrowOf = (name: string): Arrow => (name === 'none' ? 'none' : name === 'tee' ? 'tee' : 'triangle');

export interface PaintOptions {
  /** Whether the picture belongs here right now (if not, everything is cytoscape as is). Can change any time, asked every frame. */
  active: () => boolean;
  theme: () => GraphTheme;
  /** Semantic edge strength (up close), 0–1. */
  semanticOpacity: () => number;
  /** Node size slider: how big a leaf is drawn right now = NODE_BASE × this × zoom. */
  nodeScale: () => number;
}

export interface Painter {
  /** Hover an element (null = leave). `instant` skips the fade and clears at once. */
  hover(target: any | null, instant?: boolean): void;
  /** Whether this element is in the currently hovered hop (for the text layer: forced display, no translucency). It reads the hover
   *  target itself, not how far the fade has gone: when hover changes, a re-verdict must get the new hop at once. */
  focused(id: string): boolean;
  /** Which element is hovered right now (one fading out counts as left). */
  hoveredId(): string | null;
  /** Spotlight a set of nodes (search hits): the rest dims, same as hover. Hover sits on top. null/empty = clear. */
  spotlight(ids: Set<string> | null): void;
  /** Hide by kind in the whole graph: not drawn, not hittable, positions still occupied. Brought-out ones still show: the hovered hop (fading
   *  in and out with the hover), the spotlighted set, the selected one with its hop. Edges on hidden nodes hide with them.
   *  The toggle itself fades (MUTE_FADE_MS) rather than cutting. */
  mute(nodeKinds: string[], edgeKinds: string[]): void;
  /** Whether this element is hidden right now (not brought out). For the text layer: hidden ones get no label. */
  hidden(id: string): boolean;
  /** How far hover dims this element right now (the text layer dims along). */
  dimOf(id: string): number;
  /** How big this node is drawn right now (screen radius); null when not drawn here or not a node. For the text layer to avoid nodes. */
  radiusOf(id: string): number | null;
  /** Only asks for one more frame (e.g. semantic edge strength changed). */
  repaint(): void;
  dispose(): void;
}

export function installPainter(cy: any, opts: PaintOptions): Painter {
  const r = cy.renderer();
  const baseRender = r.render;
  const baseFind = r.findNearestElements;

  /* Scene records: an element's style is reread only when it fires a 'style' event (transitions, sheet swaps, selection and class changes all fire it);
   * positions are read every frame. */
  let nodes: NodeRec[] = [], parents: NodeRec[] = [], edges: EdgeRec[] = [];
  let byId = new Map<string, NodeRec | EdgeRec>();
  let stale = true;
  const dirty = new Set<any>();
  let needs = true;

  const readNode = (rec: NodeRec) => {
    const e = rec.ele;
    rec.vis = e.visible();
    rec.op = e.effectiveOpacity();
    rec.fill = e.pstyle('background-color').strValue;
    rec.border = e.pstyle('border-color').strValue;
    rec.bw = e.pstyle('border-width').pfValue;
    rec.d = rec.parent ? 0 : e.width();
    rec.shape = rec.parent ? 'rect' : shapeOf(e.pstyle('shape').value);
    rec.bgOp = e.pstyle('background-opacity').value;
    rec.events = e.pstyle('events').value !== 'no';
  };
  const readEdge = (rec: EdgeRec) => {
    const e = rec.ele;
    rec.vis = e.pstyle('display').value !== 'none' && e.pstyle('visibility').value === 'visible';
    rec.op = e.effectiveOpacity() * e.pstyle('line-opacity').value;
    rec.color = e.pstyle('line-color').strValue;
    rec.w = e.pstyle('width').pfValue;
    rec.dash = e.pstyle('line-style').value;
    rec.head = arrowOf(e.pstyle('target-arrow-shape').value);
    rec.tail = arrowOf(e.pstyle('source-arrow-shape').value);
    rec.z = e.pstyle('z-index').value;
    const curve = e.pstyle('curve-style').value;
    rec.bend = curve === 'unbundled-bezier' ? (e.pstyle('control-point-distances').pfValue?.[0] ?? 0) : 0;
    rec.events = e.pstyle('events').value !== 'no';
  };
  const rebuild = () => {
    nodes = []; parents = []; edges = [];
    byId = new Map();
    cy.nodes().forEach((ele: any) => {
      const rec = {
        ele, id: ele.id(), parent: ele.isParent(), t: shareT(ele.data('share') ?? 0), w: nodeWeight(ele.data('leaves') ?? 0),
        depth: ele.ancestors().length, x: 0, y: 0, s: 0, a: 1,
      } as NodeRec;
      readNode(rec);
      (rec.parent ? parents : nodes).push(rec);
      byId.set(rec.id, rec);
    });
    parents.sort((a, b) => a.depth - b.depth);
    cy.edges().forEach((ele: any) => {
      const src = byId.get(ele.source().id()) as NodeRec, tgt = byId.get(ele.target().id()) as NodeRec;
      if (!src || !tgt) return;
      const rec = { ele, id: ele.id(), src, tgt, skeleton: ele.hasClass('contains'), t: shareT(ele.data('share') ?? 0) } as EdgeRec;
      readEdge(rec);
      edges.push(rec);
      byId.set(rec.id, rec);
    });
    edges = byZ(edges);
    stale = false;
    dirty.clear();
    remute();
    repin();
  };
  const refresh = () => {
    if (stale) { rebuild(); return; }
    if (!dirty.size) return;
    let reorder = false;
    for (const ele of dirty) {
      if (ele.removed()) continue;
      const rec = byId.get(ele.id());
      if (!rec) { stale = true; break; }
      if ('src' in rec) { const z = rec.z; readEdge(rec); if (rec.z !== z) reorder = true; } else readNode(rec);
    }
    dirty.clear();
    if (stale) rebuild();
    else if (reorder) edges = byZ(edges);
  };

  /* 'style' fires once per element (sheet swap, class change, selection, inline style, tween). When an inline style is written on a container box
   * it fires only for the box itself, but the box's visibility and opacity pass on to what is inside, so when a box changes its descendants are reread too.
   * 'data' / 'move' affect the few things read only on rebuild (weight, parentage, class); rare, so just rebuild everything. */
  const onStyle = (e: any) => {
    const t = e.target;
    dirty.add(t);
    if (t.isNode() && t.isParent()) t.descendants().forEach((d: any) => dirty.add(d));
    needs = true;
  };
  const onStructure = () => { stale = true; needs = true; };
  const onMove = () => { needs = true; };
  cy.on('style', onStyle);
  cy.on('add remove data move', onStructure);
  cy.on('position viewport', onMove);

  /* ── Hover and spotlight ──────────────────────────────────────────────────────
   * Both go through the same dimming: hover = one element plus its hop; spotlight = a set of nodes (search hits). Hover sits on top of
   * the spotlight: when the mouse leaves, it goes back to the spotlighted set without passing through "everything lit". */
  let focusIds = new Set<string>();     // in focus: the hovered hop, or the spotlighted set
  let lifted = new Set<string>();       // not dimmed: the focused ones + their ancestor boxes in box mode
  /** How dense the semantic edges on screen were last frame (see semanticAlphaOf); the hit range uses it. */
  let semCover = 0;
  let hovered: string | null = null;
  let hoverT = 0, hoverFrom = 0, hoverTo = 0;
  let target: any = null;
  let spot: Set<string> | null = null;

  /* ── Hiding by kind ──────────────────────────────────────────────────────
   * Done only in this drawing layer, display untouched: so "being brought out" is instant (the hovered hop follows the hover fade),
   * and the visible set, framing and layout never know about it: the graph's shape does not jump. */
  let muteKinds = { nodes: new Set<string>(), edges: new Set<string>() };
  let mutedIds = new Set<string>();
  let pinned = new Set<string>();       // the selected one with its hop
  /** A toggle is not a hard cut: fade from the previous set to this one. */
  let mutedFrom = new Set<string>();
  let muteT = 1, muteStart = 0;
  const mutedNow = () => {
    const out = new Set<string>();
    if (!muteKinds.nodes.size && !muteKinds.edges.size) return out;
    for (const n of [...nodes, ...parents]) if (muteKinds.nodes.has(n.ele.data('kind'))) out.add(n.id);
    for (const e of edges) {
      if (muteKinds.edges.has(e.ele.data('kind')) || out.has(e.src.id) || out.has(e.tgt.id)) out.add(e.id);
    }
    return out;
  };
  /** After a rebuild (a new batch of elements): land directly, no animation. */
  const remute = () => { mutedIds = mutedFrom = mutedNow(); muteT = 1; };
  const repin = () => {
    const sel = cy.$(':selected');
    pinned = new Set(sel.nonempty() ? sel.closedNeighborhood().map((x: any) => x.id()) : []);
  };
  /** How much this hidden one shows right now: fully if brought out by selection, following the hover fade if by hover, else 0. */
  const shownIn = (set: Set<string>, id: string) => (!set.has(id) || pinned.has(id) ? 1
    : focusIds.has(id) ? smooth(hoverT) : 0);
  const muteOf = (id: string) => {
    const to = shownIn(mutedIds, id);
    if (muteT >= 1) return to;
    const from = shownIn(mutedFrom, id);
    return from + (to - from) * smooth(muteT);
  };
  const settleFocus = (instant: boolean) => {
    const live = target && !target.removed() ? target
      : spot?.size ? cy.collection([...spot].map((id) => cy.$id(id)).filter((x: any) => x.nonempty())) : null;
    if (live && live.nonempty()) {
      const one = live === target;
      const focus = !one ? live : target.isNode() ? target.closedNeighborhood() : target.union(target.connectedNodes());
      focusIds = new Set(focus.map((x: any) => x.id()));
      lifted = new Set([...focusIds, ...focus.nodes().ancestors().map((x: any) => x.id())]);
      hovered = one ? target.id() : null;
      if (hoverTo !== 1) { hoverFrom = performance.now() - hoverT * HOVER_FADE_MS; hoverTo = 1; }
    } else {
      if (instant) { hoverT = 0; focusIds = new Set(); lifted = new Set(); hovered = null; }
      if (hoverTo !== 0) { hoverFrom = performance.now() - (1 - hoverT) * HOVER_FADE_MS; hoverTo = 0; }
    }
    needs = true;
    r.redraw();
  };
  const hover = (t: any | null, instant = false) => { target = t; settleFocus(instant); };
  const mute = (nodeKinds: string[], edgeKinds: string[]) => {
    const same = (a: Set<string>, b: string[]) => a.size === b.length && b.every((k) => a.has(k));
    if (same(muteKinds.nodes, nodeKinds) && same(muteKinds.edges, edgeKinds)) return;
    muteKinds = { nodes: new Set(nodeKinds), edges: new Set(edgeKinds) };
    if (!stale) {
      const next = mutedNow();
      // Changed its mind halfway through a fade (just off, on again): turn back and continue from how it looks now, without jumping to the end first.
      const back = muteT < 1 && next.size === mutedFrom.size && [...next].every((id) => mutedFrom.has(id));
      const t = back ? 1 - muteT : 0;
      mutedFrom = mutedIds; mutedIds = next; muteT = t;
      muteStart = performance.now() - t * MUTE_FADE_MS;
    }
    needs = true;
    r.redraw();
  };
  const onSelect = () => { repin(); needs = true; r.redraw(); };
  cy.on('select unselect', onSelect);
  const spotlight = (ids: Set<string> | null) => { spot = ids?.size ? ids : null; settleFocus(false); };
  const stepHover = (now: number) => {
    if (hoverT === hoverTo) return false;
    const k = Math.min(1, (now - hoverFrom) / HOVER_FADE_MS);
    hoverT = hoverTo ? k : 1 - k;
    if (k >= 1) {
      hoverT = hoverTo;
      if (!hoverTo) { focusIds = new Set(); lifted = new Set(); hovered = null; }
    }
    return true;
  };
  const stepMute = (now: number) => {
    if (muteT >= 1) return false;
    muteT = Math.min(1, (now - muteStart) / MUTE_FADE_MS);
    if (muteT >= 1) mutedFrom = mutedIds;
    return true;
  };
  const dimNow = () => 1 - (1 - HOVER_DIM) * smooth(hoverT);

  /* ── Drawing ────────────────────────────────────────────────────────────── */
  let wasActive = false;
  let lastSize = '';
  /** Color → small integer; group keys are built from integers (building strings for thousands of elements per frame was the main cost). Separate tables for fill, stroke and line,
   *  **reset every frame**: numbers only mean something within this frame's grouping; a reskin tween produces a batch of new colors every frame, and keeping them
   *  across frames would only pile up until keys collide. */
  const ids = [new Map<string, number>(), new Map<string, number>(), new Map<string, number>()];
  const idOf = (m: Map<string, number>) => (c: string) => m.get(c) ?? m.set(c, m.size).get(c)!;
  const fillId = idOf(ids[0]), borderId = idOf(ids[1]), lineId = idOf(ids[2]);

  const paint = () => {
    const pr = r.getPixelRatio();
    if (r.prevPxRatio !== pr) { r.invalidateContainerClientCoordsCache(); r.matchCanvasSize(r.container); }
    r.prevPxRatio = pr;
    const size = `${r.canvasWidth}x${r.canvasHeight}`;
    const now = performance.now();
    const hovering = stepHover(now), muting = stepMute(now);
    const animating = hovering || muting;
    // While box-selecting, a mouse move makes cytoscape want one frame without firing any event: the box must follow.
    if (r.hoverData?.selecting || r.touchData?.selecting) needs = true;
    if (!needs && !animating && size === lastSize) return;
    needs = false; lastSize = size;
    refresh();
    for (const m of ids) m.clear();

    const ctx: CanvasRenderingContext2D = r.data.contexts[r.NODE];
    // cytoscape has three canvases (selection box / drag / elements). Everything is drawn on the elements one and the other two cleared: on the hand-over
    // frame they may still hold what cytoscape drew.
    for (const c of r.data.contexts as CanvasRenderingContext2D[]) {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, r.canvasWidth, r.canvasHeight);
    }
    ctx.setTransform(pr, 0, 0, pr, 0, 0);
    const W = r.canvasWidth / pr, H = r.canvasHeight / pr;
    const z = cy.zoom(), pan = cy.pan();
    const leafPx = NODE_BASE * opts.nodeScale() * z;
    const dim = dimNow();
    const mulOf = (id: string) => (hoverT > 0 && !lifted.has(id) ? dim : 1) * muteOf(id);
    const PAD = 40;
    const onScreen = (x: number, y: number, rad: number) => x + rad > -PAD && x - rad < W + PAD && y + rad > -PAD && y - rad < H + PAD;

    // Positions: read every frame, converted to screen coordinates.
    const hold = HOLD_LEAF;
    for (const n of nodes) {
      if (!n.vis) continue;
      const p = n.ele.position();
      n.x = p.x * z + pan.x; n.y = p.y * z + pan.y;
      [n.s, n.a] = dotOf(n.d, z, n.w, leafPx, hold);
    }
    for (const n of parents) {
      if (!n.vis) continue;
      const bb = n.ele.boundingBox({ includeLabels: false, includeOverlays: false, includeUnderlays: false });
      n.box = [bb.x1 * z + pan.x, bb.y1 * z + pan.y, bb.w * z, bb.h * z];
      n.x = n.box[0] + n.box[2] / 2; n.y = n.box[1] + n.box[3] / 2; n.s = 0; n.a = 1;
    }

    ctx.lineJoin = 'round';
    drawBoxes(ctx, z, mulOf);
    const haze = hazeOf(leafPx);
    if (haze > 0.005) drawHaze(ctx, z, haze, mulOf, onScreen);
    let ink = 0;
    for (const e of edges) {
      if (e.skeleton || !e.vis || !e.src.vis || !e.tgt.vis) continue;
      ink += clippedLength(e.src.x, e.src.y, e.tgt.x, e.tgt.y, W, H) * (SEM_W * e.w / EDGE_W) * e.op;
    }
    semCover = ink / (W * H);
    drawEdges(ctx, edges, z, leafPx, mulOf, W, H, false);
    drawNodes(ctx, nodes, mulOf, onScreen);
    if (hoverT > 0 && focusIds.size) {
      // The focused hop: drawn again as is, on top of the dimmed rest.
      drawEdges(ctx, edges.filter((e) => focusIds.has(e.id)), z, leafPx, () => 1, W, H, true);
      drawNodes(ctx, nodes.filter((n) => focusIds.has(n.id)), () => 1, onScreen);
      const h = hovered ? byId.get(hovered) : null;
      if (h && !('src' in h) && !h.parent && h.vis) {
        ctx.globalAlpha = 0.5 * smooth(hoverT);
        ctx.strokeStyle = opts.theme().halo; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(h.x, h.y, h.s / 2 + gapOf(h.s) + 3, 0, Math.PI * 2); ctx.stroke();
      }
    }
    drawSelectionBox(ctx, z, pan);
    ctx.globalAlpha = 1;
    // The fade is not done, so another frame is needed. No redraw right here: cytoscape's render loop clears "wants a frame" **after** render
    // returns and would wipe a request made here; with the mouse resting on empty space no other event asks for a frame, and the dimming gets stuck.
    // A microtask runs after this rAF callback finishes, after the clearing.
    if (animating) queueMicrotask(() => r.redraw());
  };

  /** Container boxes (box mode): a thin fill + a skeleton-colored border. The border is skeleton too, so it has the far-away floor. */
  const drawBoxes = (ctx: CanvasRenderingContext2D, z: number, mulOf: (id: string) => number) => {
    for (const n of parents) {
      if (!n.vis || !n.box) continue;
      const m = n.op * mulOf(n.id);
      if (m < 0.01) continue;
      const [x, y, w, h] = n.box;
      const rad = Math.min(10, w / 4, h / 4);
      ctx.beginPath(); ctx.roundRect(x, y, w, h, rad);
      ctx.globalAlpha = n.bgOp * m; ctx.fillStyle = n.fill; ctx.fill();
      const [lw, la] = skeletonLineOf(n.bw, z, n.t);
      ctx.globalAlpha = la * m; ctx.strokeStyle = n.border; ctx.lineWidth = lw; ctx.stroke();
    }
  };

  const drawHaze = (ctx: CanvasRenderingContext2D, z: number, haze: number, mulOf: (id: string) => number,
    onScreen: (x: number, y: number, r: number) => boolean) => {
    const groups = new Map<number, { c: string; a: number; list: NodeRec[] }>();
    for (const n of nodes) {
      if (!n.vis) continue;
      const rad = n.d * HAZE_R * z;
      if (!onScreen(n.x, n.y, rad)) continue;
      const a = q(haze * n.op * mulOf(n.id), 0.02);
      if (a < 0.01) continue;
      const key = fillId(n.fill) * 64 + Math.round(a * 50);   // a ≤ 0.32 → at most 16
      let g = groups.get(key);
      if (!g) groups.set(key, g = { c: n.fill, a, list: [] });
      g.list.push(n);
    }
    for (const g of groups.values()) {
      ctx.globalAlpha = g.a; ctx.fillStyle = g.c; ctx.beginPath();
      for (const n of g.list) { const rad = n.d * HAZE_R * z; ctx.moveTo(n.x + rad, n.y); ctx.arc(n.x, n.y, rad, 0, Math.PI * 2); }
      ctx.fill();
    }
  };

  /** Edges: grouped within one z layer by (color, width, strength, dash), one stroke per group. Layer order is kept. */
  const drawEdges = (ctx: CanvasRenderingContext2D, list: EdgeRec[], z: number, leafPx: number,
    mulOf: (id: string) => number, W: number, H: number, focus: boolean) => {
    const near = detailed(leafPx);
    const semA = semanticAlphaOf(opts.semanticOpacity(), semCover);
    const focusA = focus ? focusAlphaOf(list.reduce((k, e) => k + (e.skeleton ? 0 : 1), 0)) : 0;
    let layer: number | null = null;
    let groups = new Map<number, EdgeGroup>();
    const flush = () => { for (const g of groups.values()) strokeGroup(ctx, g, z, near); groups = new Map(); };
    for (const e of list) {
      if (!e.vis || !e.src.vis || !e.tgt.vis) continue;
      const a = e.src, b = e.tgt;
      if (Math.max(a.x, b.x) < -40 || Math.min(a.x, b.x) > W + 40 || Math.max(a.y, b.y) < -40 || Math.min(a.y, b.y) > H + 40) continue;
      if (e.z !== layer) { flush(); layer = e.z; }
      let w: number, al: number;
      if (e.skeleton) [w, al] = skeletonLineOf(e.w, z, e.t);
      else [w, al] = [SEM_W * e.w / EDGE_W, focus ? focusA : semA];
      al *= e.op * mulOf(e.id);
      if (al < 0.01) continue;
      const wq = q(w, 0.25) || 0.25, aq = q(al, 0.05) || 0.05;
      const dash = e.dash === 'solid' || !near ? 0 : e.dash === 'dashed' ? 1 : 2;
      const key = ((lineId(e.color) * 4096 + Math.round(wq * 4)) * 32 + Math.round(aq * 20)) * 3 + dash;
      let g = groups.get(key);
      if (!g) groups.set(key, g = { c: e.color, w: wq, a: aq, dash, list: [] });
      g.list.push(e);
    }
    flush();
    ctx.setLineDash([]);
  };

  const drawNodes = (ctx: CanvasRenderingContext2D, list: NodeRec[], mulOf: (id: string) => number,
    onScreen: (x: number, y: number, r: number) => boolean) => {
    const groups = new Map<number, NodeGroup>();
    const marked: NodeRec[] = [];
    for (const n of list) {
      if (!n.vis || !onScreen(n.x, n.y, n.s)) continue;
      const a = q(n.a * n.op * mulOf(n.id), 0.05);
      if (a < 0.01) continue;
      const gap = q(gapOf(n.s), 0.25);
      const shapeK = n.shape === 'circle' ? 0 : n.shape === 'hexagon' ? 1 : n.shape === 'diamond' ? 2 : 3;
      const key = (((fillId(n.fill) * 65536 + borderId(n.border)) * 32 + Math.round(a * 20)) * 8 + gap * 4) * 4 + shapeK;
      let g = groups.get(key);
      if (!g) groups.set(key, g = { c: n.fill, border: n.border, a, gap, shape: n.shape, list: [] });
      g.list.push(n);
      // Selected / search hit: the stylesheet gives a wider accent stroke; here it is drawn as a solid ring outside the node.
      if (n.bw > 1.5) marked.push(n);
    }
    for (const g of groups.values()) {
      ctx.globalAlpha = g.a; ctx.beginPath();
      for (const n of g.list) tracePoint(ctx, g.shape, n.x, n.y, n.s / 2);
      // Stroke the gap first (canvas color, a ring outside the node), then fill the node: neighboring nodes keep a gap between them.
      if (g.gap > 0) { ctx.strokeStyle = g.border; ctx.lineWidth = g.gap * 2; ctx.stroke(); }
      ctx.fillStyle = g.c; ctx.fill();
    }
    for (const n of marked) {
      ctx.globalAlpha = n.op * mulOf(n.id);
      ctx.strokeStyle = n.border; ctx.lineWidth = 2;
      ctx.beginPath(); tracePoint(ctx, n.shape, n.x, n.y, n.s / 2 + gapOf(n.s) + 1.5); ctx.stroke();
    }
  };

  const drawSelectionBox = (ctx: CanvasRenderingContext2D, z: number, pan: { x: number; y: number }) => {
    const sel = r.selection;
    if (!sel || sel[4] !== 1 || !(r.hoverData?.selecting || r.touchData?.selecting)) return;
    const t = opts.theme();
    const x = sel[0] * z + pan.x, y = sel[1] * z + pan.y, w = (sel[2] - sel[0]) * z, h = (sel[3] - sel[1]) * z;
    ctx.globalAlpha = 0.15; ctx.fillStyle = t.selected; ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 0.6; ctx.strokeStyle = t.selected; ctx.lineWidth = 1; ctx.strokeRect(x, y, w, h);
  };

  /* ── Hit testing: point-to-point and point-to-line distances, no pass through the render cache ──────────────────── */
  const find = (mx: number, my: number, interactiveOnly: boolean, isTouch: boolean): any[] => {
    refresh();
    const z = cy.zoom(), pan = cy.pan();
    const sx = mx * z + pan.x, sy = my * z + pan.y;
    const slack = isTouch ? 10 : NODE_SLACK;
    const leafPx = NODE_BASE * opts.nodeScale() * z;
    const usable = (x: { id: string; vis: boolean; op: number; events: boolean }) =>
      x.vis && x.op > 0.05 && (!interactiveOnly || x.events) && muteOf(x.id) > 0.5;
    let best: any = null, bestD = Infinity;
    for (const n of nodes) {
      if (!usable(n)) continue;
      const p = n.ele.position();
      const x = p.x * z + pan.x, y = p.y * z + pan.y;
      const rad = dotOf(n.d, z, n.w, leafPx)[0] / 2 + slack;
      const d = Math.hypot(sx - x, sy - y);
      if (d <= rad && d - rad < bestD) { best = n.ele; bestD = d - rad; }
    }
    if (best) return [best];
    // An edge's range follows how solid it is drawn right now (the same number used to draw it): nearly invisible far-away lines need the mouse
    // right on them and do not catch the mouse sweeping everywhere.
    const semReach = reachOf(semanticAlphaOf(1, semCover), SEM_W, isTouch);
    for (const e of edges) {
      if (!usable(e) || !e.src.vis || !e.tgt.vis) continue;
      let reach = semReach * Math.max(1, e.w / EDGE_W);
      if (e.skeleton) { const [lw, la] = skeletonLineOf(e.w, z, e.t); reach = reachOf(la, lw, isTouch); }
      const a = e.src.ele.position(), b = e.tgt.ele.position();
      const d = distToEdge(sx, sy, a.x * z + pan.x, a.y * z + pan.y, b.x * z + pan.x, b.y * z + pan.y, e.bend * z);
      if (hittable(reach) && d <= reach && d - reach < bestD) { best = e.ele; bestD = d - reach; }
    }
    if (best) return [best];
    for (let i = parents.length - 1; i >= 0; i--) {
      const n = parents[i];
      if (!usable(n)) continue;
      const bb = n.ele.boundingBox({ includeLabels: false, includeOverlays: false, includeUnderlays: false });
      if (mx >= bb.x1 && mx <= bb.x2 && my >= bb.y1 && my <= bb.y2) return [n.ele];
    }
    return [];
  };

  /* ── Hooking into the renderer ─────────────────────────────────────────────────────── */
  r.render = function render(this: any, options?: any) {
    const active = opts.active() && !options?.forcedContext;
    if (active !== wasActive) {
      wasActive = active;
      needs = true;
      // Handing back to cytoscape, make it redraw every layer (its cached layers were not drawn meanwhile).
      if (!active) { r.redrawHint('eles', true); r.redrawHint('drag', true); }
    }
    if (!active) return baseRender.call(r, options);
    paint();
    cy.emit('render');
  };
  r.findNearestElements = function findNearestElements(this: any, x: number, y: number, interactiveOnly: boolean, isTouch: boolean) {
    if (!opts.active()) return baseFind.call(r, x, y, interactiveOnly, isTouch);
    return find(x, y, interactiveOnly, isTouch);
  };
  r.redraw();

  return {
    hover,
    spotlight,
    focused: (id) => hoverTo === 1 && focusIds.has(id),
    hoveredId: () => (hoverTo === 1 ? hovered : null),
    dimOf: (id) => (hoverT > 0 && !lifted.has(id) ? dimNow() : 1) * muteOf(id),
    mute,
    // Reads the hover **target**, not how far the fade has gone: when hover changes, the text layer must lay out the brought-out set at once.
    hidden: (id) => mutedIds.has(id) && !pinned.has(id) && !(hoverTo === 1 && focusIds.has(id)),
    radiusOf: (id) => {
      if (!opts.active()) return null;
      refresh();
      const n = byId.get(id);
      if (!n || 'src' in n || n.parent) return null;
      const z = cy.zoom();
      return dotOf(n.d, z, n.w, NODE_BASE * opts.nodeScale() * z)[0] / 2;
    },
    repaint: () => { needs = true; r.redraw(); },
    dispose: () => {
      cy.off('style', onStyle); cy.off('add remove data move', onStructure); cy.off('position viewport', onMove);
      cy.off('select unselect', onSelect);
      if (!cy.destroyed()) { r.render = baseRender; r.findNearestElements = baseFind; }
    },
  };
}

/* ── Drawing helpers ───────────────────────────────────────────────────────── */

interface EdgeGroup { c: string; w: number; a: number; dash: number; list: EdgeRec[] }
interface NodeGroup { c: string; border: string; a: number; gap: number; shape: Shape; list: NodeRec[] }

const q = (v: number, step: number) => Math.round(v / step) * step;
/** Drawing order: lower z-index first; within one layer, element table order. */
const byZ = (list: EdgeRec[]) =>
  list.map((e, i) => [e, i] as const).sort((a, b) => a[0].z - b[0].z || a[1] - b[1]).map(([e]) => e);
const smooth = (x: number) => x * x * (3 - 2 * x);

/** Semantic edges bend to one side (`control-point-distances`, graph units): the control point is on the normal at the midpoint. */
const controlOf = (ax: number, ay: number, bx: number, by: number, bend: number): [number, number] => {
  const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
  return [(ax + bx) / 2 - (dy / L) * bend, (ay + by) / 2 + (dx / L) * bend];
};

function strokeGroup(ctx: CanvasRenderingContext2D, g: EdgeGroup, z: number, near: boolean) {
  ctx.globalAlpha = Math.min(1, g.a); ctx.strokeStyle = g.c; ctx.lineWidth = g.w; ctx.lineCap = 'round';
  ctx.setLineDash(g.dash === 1 ? [4, 3] : g.dash === 2 ? [1, 3] : []);
  ctx.beginPath();
  const heads: [EdgeRec, number, number, number, number, boolean][] = [];
  for (const e of g.list) {
    const ax = e.src.x, ay = e.src.y, bx = e.tgt.x, by = e.tgt.y;
    ctx.moveTo(ax, ay);
    let hx = bx - ax, hy = by - ay, tx = ax - bx, ty = ay - by;
    if (e.bend) {
      const [cx, cy] = controlOf(ax, ay, bx, by, e.bend * z);
      ctx.quadraticCurveTo(cx, cy, bx, by);
      hx = bx - cx; hy = by - cy; tx = ax - cx; ty = ay - cy;
    } else ctx.lineTo(bx, by);
    // Arrows: skeleton lines only when thick enough to show direction; semantic edges only up close and long enough on screen.
    const show = e.skeleton ? g.w >= 1.5 : near && Math.hypot(bx - ax, by - ay) > 40;
    if (!show) continue;
    if (e.head !== 'none') heads.push([e, bx, by, hx, hy, true]);
    if (e.tail !== 'none') heads.push([e, ax, ay, tx, ty, false]);
  }
  ctx.stroke();
  if (!heads.length) return;
  ctx.setLineDash([]); ctx.fillStyle = g.c; ctx.beginPath();
  const tees: [number, number, number, number, number][] = [];
  for (const [e, px, py, ux0, uy0, atHead] of heads) {
    const L = Math.hypot(ux0, uy0) || 1, ux = ux0 / L, uy = uy0 / L;
    const n = atHead ? e.tgt : e.src;
    const rad = n.parent ? 0 : n.s / 2 + gapOf(n.s);
    const tipX = px - ux * rad, tipY = py - uy * rad;
    const len = e.skeleton ? g.w * 2.6 : 3 + g.w * 2.5, half = len * 0.55;
    if ((atHead ? e.head : e.tail) === 'tee') { tees.push([tipX, tipY, ux, uy, half]); continue; }
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - ux * len - uy * half, tipY - uy * len + ux * half);
    ctx.lineTo(tipX - ux * len + uy * half, tipY - uy * len - ux * half);
    ctx.closePath();
  }
  ctx.fill();
  if (tees.length) {
    ctx.beginPath();
    for (const [x, y, ux, uy, half] of tees) {
      const cx = x - ux * 2, cy = y - uy * 2;
      ctx.moveTo(cx - uy * half, cy + ux * half); ctx.lineTo(cx + uy * half, cy - ux * half);
    }
    ctx.lineWidth = Math.max(1.5, g.w); ctx.stroke();
  }
}

function tracePoint(ctx: CanvasRenderingContext2D, shape: Shape, x: number, y: number, rad: number) {
  if (shape === 'circle') { ctx.moveTo(x + rad, y); ctx.arc(x, y, rad, 0, Math.PI * 2); return; }
  if (shape === 'rect') { ctx.rect(x - rad, y - rad, rad * 2, rad * 2); return; }
  const n = shape === 'hexagon' ? 6 : 4;
  const off = shape === 'diamond' ? -Math.PI / 2 : 0;
  for (let i = 0; i < n; i++) {
    const t = off + (i * 2 * Math.PI) / n;
    const px = x + rad * Math.cos(t), py = y + rad * Math.sin(t);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/** Distance on screen from a point to an edge: a straight one is point-to-segment; a curved one is approximated by an 8-segment polyline. */
function distToEdge(px: number, py: number, ax: number, ay: number, bx: number, by: number, bend: number): number {
  if (!bend) return distToSeg(px, py, ax, ay, bx, by);
  const [cx, cy] = controlOf(ax, ay, bx, by, bend);
  let best = Infinity, lx = ax, ly = ay;
  for (let i = 1; i <= 8; i++) {
    const t = i / 8, u = 1 - t;
    const x = u * u * ax + 2 * u * t * cx + t * t * bx, y = u * u * ay + 2 * u * t * cy + t * t * by;
    best = Math.min(best, distToSeg(px, py, lx, ly, x, y));
    lx = x; ly = y;
  }
  return best;
}
function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
