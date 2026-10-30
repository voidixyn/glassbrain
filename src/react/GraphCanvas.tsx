'use client';
/**
 * glassbrain · GraphCanvas — the one graph canvas component
 *
 * One rule holds the whole interaction model together: **there is only one graph; the view only decides what is visible.**
 *
 *   source (subgraph) / focus      → only toggles display: no rebuild, no relayout, no flicker
 *   which layer / stack as 2.5D    → one affine map over the same coordinates, animated
 *   search                         → visibility unchanged; dims the rest and flies there
 *
 * Coordinates are computed outside the canvas by glassbrain/layout and poured in (preset). Two wins:
 * ① 2.5D layering is just one affine map before pouring, no other renderer needed; ② layout can run
 * in a worker, so the page does not freeze while a large graph is laid out.
 *
 * All domain knowledge comes from the profile; this component knows no business concept at all.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { indexModel, originsOf, type GraphModel } from '../model';
import { defaultProfile, validateModel, type GraphIssue, type GraphProfile } from '../profile';
import { buildElements, VIRTUAL_ROOT, type BuiltElements, type CyElement } from '../elements';
import { FULL_VIEW, isFiltering, isNarrowing, originView, planeView, resolveView, searchNodes, type GraphView } from '../view';
import { DIFF_INK, GK_CSS, graphStyle, LABEL_MAX_EM, LIGHT_THEME, mixHex, nodeWeight, plateColors, type GraphTheme } from '../style';
import { installPainter, type Painter } from '../paint';
import { computeLayout, type Plate, type Positions } from '../layout/engine';
import { projectPlanes } from '../layout/planes';
import { inlinePool } from '../layout/inline-pool';
import type { LayoutRunnerPool } from '../layout/run-job';
import { anchorOf, diffSkinStyle, edgeFade, edgeTraffic, FADE_BASE, FADE_NAMES, planSkins,
  planTransition, resolveSpec, sampleSkinStyle, sampleTransition, SKIN_SIZE_PROPS, type EndState, type FadeName,
  type SkinChange, type StyleMap, type StyleTween, type AnimateSpec, type TransitionReport } from '../animate';
import { diffModels, stepUnion, unionSides, STEP_FLAG, type ChangeKind, type GraphDelta } from '../diff';
import { diffPositions, solveDiffLayout, type DiffLayoutSpec, type DiffSolve } from '../layout/diff-layout';
import { relaxNodes, relaxOverlaps } from '../layout/relax';
import { idPhase, labelBox, planLabels, type LabelInput, type LabelSide } from '../layout/readability';
import type { GraphNode } from '../model';
import Toolbar, { ALL_CONTROLS, ZoomDock, type ControlId, type SearchResult } from './Toolbar';
import { easeInOut, lerpRect, toRect, toView, zoomPath, type Viewport } from './camera';
import DetailPanel, { type SelectedNode } from './DetailPanel';
import EditPanel, { type EditTarget, type RenderEditor } from './EditPanel';
import Legend, { applyLook, type GraphLook } from './Legend';
import { StringsContext } from './i18n';
import { checkEdit, type EditOp } from '../edit';
import { EN, type GraphStrings } from '../strings';
import DiffOverlay, { edgePath, type DiffGeometry, type NodeBox } from './DiffOverlay';

/** Above this many nodes a subview is not tightened locally: it is already a "large view", global
 *  coordinates suit it, and another layout run is only waiting for nothing. */
const TIGHTEN_MAX = 400;
/** Roughly how wide one node is: used to estimate the target size when a subgraph is compressed to its proper density. */
const NODE_PITCH = 150;
/** How large a subgraph may be and still keep the global coordinates. In a small view positional
 *  continuity is visible and useful; beyond that it only hurts: a few hundred nodes cut out of three
 *  thousand sit across large hidden gaps, and holding their relative positions gives two blobs and a long
 *  line. Relaying out a large subgraph reads more like "the graph of this module". */
const SEED_MAX = 60;
/** How long raising / flattening layers, or switching between single layers, takes. It is an action (not data changing), so it is shorter than a data switch. */
const PLANE_MS = 720;
/** Search fly-to: the landing size (a leaf drawn at this many times the base size, so its label fits), and the distance-to-duration factor with its bounds. */
const FLY_ZOOM = 1;
const FLY_MS_PER_S = 380;
const FLY_MS = { min: 280, max: 1100 };
/** At most this many entries in the search dropdown. */
const SEARCH_LIST = 8;
/** Framing padding (screen px) and the maximum zoom when framing. */
const FIT_PAD = 56;
const FIT_MAX_ZOOM = 1.5;
const planeKey = (v: GraphView) => `${v.planes ? 1 : 0}|${(v.layers ?? []).join(',')}`;
/** The view axes that decide what is visible. Only a change here reframes: typing a search should not make the camera jump. */
/** Layer plates with each layer's current brightness: unselected layers have no plate, and a plate fades with its layer. */
const litPlates = (plates: Plate[], alphaOf: (layer: string) => number): Plate[] =>
  plates.map((p) => ({ ...p, alpha: alphaOf(p.layer) })).filter((p) => p.alpha > 0.001);
const shownIn = (v: GraphView) => (layer: string) => (!v.layers || v.layers.includes(layer) ? 1 : 0);
const sightKey = (v: GraphView) => `${planeKey(v)}|${(v.origins ?? []).join(',')}`;

/* ── Label channel ──────────────────────────────────────────────────────
 * The verdict (who shows, on which side) comes from layout/readability.ts: share + focus distance → score → greedy
 * placement (no label over a label, no label over a named node). This is its **presentation**: a ledger (how bright and
 * how big each node's label is right now), a fade loop that only runs while something changes, a canvas layer for the
 * text, plus three rules:
 *   · **Text is always above nodes.** cytoscape draws element by element, "node then label", so a later node always
 *     covers an earlier label and no stylesheet order can fix it. So text is not drawn by cytoscape: its labels stay only
 *     for measuring sizes, and on-screen text is drawn on a canvas stacked above it, redrawn whenever cytoscape redraws.
 *   · **Frame 0 is the previous frame.** The ledger survives instance rebuilds and is drawn the moment a new instance
 *     mounts, the same contract as the transition's "presence" and "look" channels.
 *   · **No re-verdict while a transition plays.** For the whole switch (layout wait + tween) visibility is frozen and
 *     labels follow their nodes; after the curtain one re-verdict fades in. Coordinates change every frame, and judging
 *     every frame only makes labels flicker.
 * **Main instance only.** Diff mode (including the left mirror) is untouched: cytoscape still draws labels there. */
/** Label font size (screen px, constant under zoom), picked in this narrow range by how much hangs off the node.
 *  It reads the same number as the node size (`nodeWeight`): how much weight a node carries, node and label say the same. */
const LABEL_FONT = { min: 12, max: 15 };
const labelFontOf = (leaves: number) => LABEL_FONT.min + (LABEL_FONT.max - LABEL_FONT.min) * nodeWeight(leaves);
const labelCss = (px: number, bold = false) => `${bold ? 600 : 400} ${px}px ui-sans-serif, system-ui, sans-serif`;
/** Default minimum gap between labels (screen px); the `labelSpacing` prop overrides it. */
const LABEL_SPACING = 6;
/** The label halo: width (screen px, half outside the glyph) and how strongly the node color tints it: faint enough not
 *  to compete with the text, strong enough to match it to its node at a glance. */
const LABEL_HALO = 4;
const LABEL_TINT = 0.25;
/** Hover: how long to wait after leaving before clearing (no flicker when sweeping between nodes). The fade itself is in paint.ts. */
const HOVER_OUT_MS = 120;
/** Hover: coming from "nothing hovered", rest this long before it counts (no fog when the mouse just crosses the graph).
 *  Moving from one node to another while already hovering does not wait: that is someone looking. 90 ms is below the
 *  "feels instant" threshold and longer than it takes to sweep across a node. */
const HOVER_IN_MS = 90;
/** Default strength of semantic edges. */
const SEMANTIC_OPACITY = 0.8;
/** Selection ring: entrance duration and distance (screen px) as it closes in from outside, gap to the node, ring width. */
const RING_IN_MS = 240;
const RING_IN_FROM = 14;
const RING_GAP = 5;
const RING_WIDTH = 3;
/** Opacity of all text (with its halo): text is an annotation layer on top of the graph and should not bury nodes and edges. */
const LABEL_ALPHA = 0.7;
/** How long one show / hide takes. The verdict is binary; the presentation slides through this time. */
const LABEL_FADE_MS = 280;
/** Incumbent hysteresis: a label already shown gets this many extra points when ranking. Greedy ranking is unstable under
 *  tiny perturbations; without this, panning one pixel can swap the whole set and labels flicker. */
const LABEL_HOLD = 0.1;
/** Extra points for labels one hop from the hovered node: ahead of all others, and those that do not fit still yield.
 *  Structure + focus distance add up to at most 2, placement and breathing keep it under 2.2, so 3 is enough; more makes no difference. */
const HOVER_BOOST = 3;
/** Extra points for labels of nodes that changed in a diff (added, removed, edited, moved): same idea, ahead of unchanged ones. */
const CHANGE_BOOST = 3;
/** Whether to re-verdict every frame while the viewport moves depends on how long the last one took: cheap (small graph)
 *  follows the hand every frame; expensive (thousands of nodes) only lets labels ride along and judges once after the
 *  motion stops for this long. Otherwise every frame lays out text and dragging drops frames. */
const LABEL_REPLAN_BUDGET_MS = 8;
const LABEL_SETTLE_MS = 140;
/** How long without interaction counts as idle, and how long each breath lasts once idle before another batch shows. */
const BREATH_IDLE_MS = 4000;
const BREATH_INTERVAL_MS = 2600;
/** Amplitude of the breathing phase drift. Two labels in opposite phase differ by 2× amplitude, just past the hysteresis,
 *  so each beat only the few whose phase sits at the extremes swap. Hysteresis and breathing are two sides of one inequality. */
const BREATH_AMPLITUDE = 0.08;
const smoothstep = (x: number) => x * x * (3 - 2 * x);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * Label sprites. The font size is a screen constant, so a label (with its halo) is rasterized once and blitted every frame
 * after. Stroking a few hundred labels twice per frame is the most expensive thing in this layer (stroked text skips the glyph cache).
 * The halo: no solid backing box (that would punch a background into the graph), just a stroke along the glyphs: first in the
 * canvas color so text reads even over an edge, then a thin tint of the node's own color on the same stroke so you can tell which node it belongs to.
 * The key includes color and theme, so a reskin or theme switch is a different sprite. Kept LRU; the oldest goes when full.
 */
type Sprite = HTMLCanvasElement & { cssW: number; cssH: number };
const SPRITE_MAX = 1500;
const sprites = new Map<string, Sprite>();
/** The halo tint is quantized to 32 levels: it only tints at 25%, so a small difference is invisible; during a reskin tween
 *  node colors change every frame, and without quantizing every label would need a new sprite every frame. */
const tintOf = ([r, g, b]: number[]) => `rgb(${[r, g, b].map((v) => Math.round(v / 8) * 8).join(',')})`;
let spriteRuler: CanvasRenderingContext2D | null = null;
/** Change marks on text in a diff, following the old track-changes convention: removed (left only) is struck through, added
 *  is underlined. The line takes that change's color (same as the legend and halos). Edited and moved are not marked:
 *  the halo already says it and more marks would be noise. Canvas text has no text-decoration, so the line is drawn into the sprite once. */
type LabelMark = 'strike' | 'underline';
const markOf = (kind: ChangeKind | undefined): LabelMark | null =>
  kind === 'removed' || kind === 'merged' ? 'strike' : kind === 'added' ? 'underline' : null;
/** The line's ink: the change color moved 30% toward the text color. Green and dark red still read on light and dark, hue unchanged. */
const lineInk = (mark: LabelMark, th: GraphTheme) =>
  mixHex(mark === 'strike' ? DIFF_INK.removed : DIFF_INK.added, th.nodeText, 0.3);

function labelSprite(text: string, px: number, bold: boolean, tint: string, th: GraphTheme, dpr: number,
  mark: LabelMark | null = null): Sprite {
  const key = `${dpr}|${px}|${bold ? 1 : 0}|${tint}|${th.canvas}|${th.nodeText}|${mark ?? ''}|${text}`;
  let sp = sprites.get(key);
  if (sp) { sprites.delete(key); sprites.set(key, sp); return sp; }
  if (sprites.size >= SPRITE_MAX) sprites.delete(sprites.keys().next().value!);
  const font = labelCss(px, bold);
  spriteRuler ??= document.createElement('canvas').getContext('2d');
  let w = text.length * px * 0.56;
  if (spriteRuler) { spriteRuler.font = font; w = spriteRuler.measureText(text).width; }
  const cssW = Math.ceil(w + LABEL_HALO * 2 + 4), cssH = Math.ceil(px * 1.5 + LABEL_HALO);
  sp = Object.assign(document.createElement('canvas'), { cssW, cssH }) as Sprite;
  sp.width = Math.ceil(cssW * dpr); sp.height = Math.ceil(cssH * dpr);
  const c = sp.getContext('2d');
  if (c) {
    c.scale(dpr, dpr);
    c.font = font; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
    c.lineWidth = LABEL_HALO;
    c.strokeStyle = th.canvas; c.strokeText(text, cssW / 2, cssH / 2);
    c.globalAlpha = LABEL_TINT; c.strokeStyle = tint; c.strokeText(text, cssW / 2, cssH / 2);
    c.globalAlpha = 1; c.fillStyle = th.nodeText; c.fillText(text, cssW / 2, cssH / 2);
    if (mark) {
      const y = cssH / 2 + (mark === 'strike' ? 0.5 : px * 0.62);
      c.strokeStyle = lineInk(mark, th); c.lineWidth = Math.max(1.5, px / 9); c.lineCap = 'round';
      c.beginPath(); c.moveTo((cssW - w) / 2, y); c.lineTo((cssW + w) / 2, y); c.stroke();
    }
  }
  sprites.set(key, sp);
  return sp;
}

/** What a label looks like right now: o = on-screen opacity (mid-fade), t = verdict (0/1), f = font size, w = text width (screen px),
 *  side = which side of the node, next = the side to move to (fade out in place first, then light up there). */
interface LabelState { o: number; t: number; f: number; w: number; side: LabelSide; next?: LabelSide }

/** In a profile only the palette (including placeholder flags) is pure "look": recoloring never changes geometry, so only
 *  the stylesheet is swapped, no rebuild, no relayout. Any other field (parsing, layering, class rules, the style escape
 *  hatch…) changing means a different graph. Returns the profile "without look": when nothing but the palette changed, it is the previous one, same reference. */
/**
 * Hide semantic edges by kind (for the paths without a painter): those kinds, and edges with a hidden endpoint. **Only touches
 * what changed:** what was hidden last time and should not be now comes back (writing `element` explicitly, not relying on
 * fallback; see the mirror comment), newly hidden ones go, and nothing else is touched, so display values written by other channels (transition, exit) survive. Returns what it hid.
 */
function hideEdgesByKind(cy: any, hn: Set<string>, he: Set<string>, prev: Set<string>): Set<string> {
  const off = new Set<string>();
  if (hn.size || he.size) {
    cy.edges().forEach((e: any) => {
      if (e.hasClass('contains')) return;
      if (he.has(e.data('kind')) || hn.has(e.source().data('kind')) || hn.has(e.target().data('kind'))) off.add(e.id());
    });
  }
  for (const id of prev) if (!off.has(id)) cy.$id(id).style('display', 'element');
  for (const id of off) cy.$id(id).style('display', 'none');
  return off;
}

const LOOK_ONLY = new Set(['nodePalette', 'edgePalette', 'nodeSize', 'edgeWidth', 'placeholderFlags']);
function useShapeOf(p: GraphProfile): GraphProfile {
  const ref = useRef(p);
  const prev = ref.current as unknown as Record<string, unknown>;
  const next = p as unknown as Record<string, unknown>;
  if (prev !== next) {
    for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) {
      if (!LOOK_ONLY.has(k) && prev[k] !== next[k]) { ref.current = p; break; }
    }
  }
  return ref.current;
}

/** Where a layout came from (as `onLayout` reports it):
 *  `preset` the host's `layout` covered everything · `cache` nothing was computed, an existing result was reused (local cache, or the one already on screen) ·
 *  `fresh` a full recompute ·
 *  `continue` continued (full recompute starting from existing coordinates) · `relayout` the user pressed "Relayout" in the canvas menu. */
export interface LayoutInfo { source: 'preset' | 'cache' | 'fresh' | 'continue' | 'relayout'; ms: number }

/** Two coordinate sets with the same content (same ids, same x/y). `layout` is often a new object every render (the host
 *  reads the file again, or stores what `onLayout` reported). Comparing by reference would relayout every time: with
 *  unchanged coordinates the transition ends at once, `onLayout` reports again, the host stores again, forever. So compare by content. */
function samePositions(a: Positions | null | undefined, b: Positions | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    const p = a[k], q = b[k];
    if (!q || p.x !== q.x || p.y !== q.y) return false;
  }
  return true;
}

/** Layout elements that need coordinates: every node except the synthetic virtual root (containment is drawn as edges, a parent is a point with coordinates too). */
function placedIdsOf(elements: CyElement[]): string[] {
  const out: string[] = [];
  for (const el of elements) {
    const id = el.data.id as string;
    if (!el.data.source && id !== VIRTUAL_ROOT) out.push(id);
  }
  return out;
}

export interface GraphCanvasProps {
  model: GraphModel;
  /** Default = the generic profile (reads {nodes,edges}, one layer, neutral colors). */
  profile?: GraphProfile;
  /** Controlled view. If omitted the component owns it (defaultView is the initial value). */
  view?: GraphView;
  onViewChange?: (v: GraphView) => void;
  defaultView?: Partial<GraphView>;
  /**
   * How labels in a large graph are read: constant screen font size + greedy placement by share / focus distance + fades,
   * plus slow idle rotation that reveals labels near the cut-off. On by default. Browse mode only: diff mode (including
   * the left mirror) is unaffected, see layout/readability.ts. The node and edge painter (paint.ts) shares this switch: off
   * means cytoscape draws the whole graph itself (labels too), hover dimming goes away, and large graphs get slow.
   */
  readable?: boolean;
  /** Scales all node sizes, multiplied with the `share` curve. Default 1. Pure look: swaps the stylesheet, no rebuild,
   *  no relayout (layout ignores it). Browse mode only: in diff mode both columns are always 1 so they line up. */
  nodeScale?: number;
  /** Strength of semantic edges (everything but containment), 0–1, default 0.8. In browse mode they are hairlines that do
   *  not thicken with zoom (1px by default; `profile.edgeWidth` can multiply it). This is the value at "normal density per
   *  screen": the more edges on screen the fainter each, the fewer the more solid (see SEM_INK in paint.ts). Pure look: no stylesheet swap, no relayout, one redraw. */
  semanticOpacity?: number;
  /** Temporarily spotlight some classes (say the mouse is over the host's legend): those light up, the rest dim, the same
   *  mechanism as search hits; hidden classes are brought out too. Edge classes bring their endpoints. null = clear, back to search hits. Browse mode only. */
  emphasis?: { nodeKinds?: string[]; edgeKinds?: string[] } | null;
  /** Minimum gap between labels (screen px), default 6. Smaller is denser and shows more labels; larger is sparser.
   *  "No label over a label" and "no label over a named node" are unaffected. Readability field (browse mode) only. */
  labelSpacing?: number;
  /** Layout execution path. **Main thread by default**: it runs anywhere (including offline file:// pages,
   *  where browsers disable Worker outright). Hosts with their own bundler pass workerPool for parallel cores:
   *    import { workerPool } from 'glassbrain/layout/worker-pool';
   *  The library does not guess the host's bundler, so the default is the one that always works. */
  pool?: LayoutRunnerPool;
  /** Primitive theme (skeleton color, canvas background…). Pure look: swapping it swaps the stylesheet, no rebuild, no relayout. */
  theme?: GraphTheme;
  className?: string;
  style?: CSSProperties;
  /** Turn off sections the host already has an equivalent for, to avoid two sources of truth. All on by default. */
  controls?: Partial<Record<ControlId, boolean>>;
  /** Compact mode: no toolbar, just one stats line. For small embeds. */
  compact?: boolean;
  detailPanel?: boolean;
  /** Rich text renderer injection (the host's markdown component). */
  renderText?: (text: string) => ReactNode;
  onSelect?: (node: SelectedNode | null) => void;
  /** Receives the cytoscape instance (for debugging / custom interaction). Called again when the instance is rebuilt. */
  onReady?: (cy: any) => void;
  /** Validation results go out; turn showIssues off when the host shows them itself. */
  onIssues?: (issues: GraphIssue[]) => void;
  showIssues?: boolean;
  /**
   * Whether data changes animate. **On by default**, nothing to pass: the component remembers the previous frame's
   * coordinates and walks from there when new data arrives. Pass false to turn it off, or an object for duration / easing / size cap.
   *
   * Only holds for nodes with **the same id**. Where ids change (dedupe merges) you need `idMapping`, otherwise
   * old ones can only fade out and new ones fade in, with no visible "merging".
   */
  animate?: boolean | AnimateSpec;
  /**
   * **Matching rule**: decides which things in the old and new versions are the same. By default ids are compared verbatim.
   * Required when the two versions live in different namespaces (source-prefixed before a merge, renumbered after),
   * otherwise you get "everything added, everything removed". The `key` passed to `diffModels` is the same thing: matching
   * has one implementation shared by animation and diff, so "animation says same, diff says one add one remove" cannot happen.
   */
  matchKey?: (node: GraphNode) => string;
  /**
   * **Preset layout**: this version's `{ nodeId: {x, y} }`, usually what you stored from `onLayout`. With several versions of
   * data, the host stores one per version and passes the current one. One id table cannot cover all versions: continue is a
   * full recompute, surviving nodes shift a little each version, and drawing version one with the last version's coordinates makes shared nodes look welded in place.
   *
   * Each time a layout is needed, sources are tried in this order, stopping at the first hit:
   *   ① the preset covers **every** node of this version → used as is, nothing solved.
   *   ② the local cache (localStorage, addressed by structure) has this structure → use it. Survives reloads; `clearLayoutCache()` clears it.
   *   ③ solve now, per `layoutMode`.
   * The preset is never rewritten: when the user presses "Relayout", the new result goes to the local cache and to `onLayout`; storing it is up to you.
   */
  layout?: Positions | null;
  /**
   * How ③ solves:
   *   `'fresh'` (default)  **full recompute**, structure only.
   *   `'continue'`         **continue**: also a full recompute, but starting from existing coordinates (this frame on screen, gaps filled from the preset)
   *                        instead of a random start, so the result hugs the previous version and surviving nodes move only a little between steps.
   * Only decides the first time: the result goes into the cache (each mode separately), so the same structure hits the cache next time and never drifts.
   */
  layoutMode?: 'fresh' | 'continue';
  /** Called once per layout produced (including "Relayout" in the canvas menu): flat coordinates, and where they came from.
   *  To persist, store them and pass them back as `layout` next time. Not called in diff mode. */
  onLayout?: (positions: Positions, info: LayoutInfo) => void;
  /** Called once after each transition with its account. When you cannot see the animation, this is the only thing to check against. */
  onTransition?: (report: TransitionReport & { layoutMs: number; animated: boolean }) => void;
  /**
   * **A transition is an uninterruptible scene.** New data arriving midway does not cut in; it is **queued**:
   * the next scene plays after this one, and only the latest data is kept (the versions in between were never drawn,
   * skipping them loses nothing; exactly the semantics a throttle should have).
   *
   * This callback is that gate's switch; hosts use it to grey out "switch data" controls: **without feedback, a
   * click that does nothing is worse than a blocked one.**
   *
   * The window matches the scene exactly: from accepting a switch (layout starts) to the curtain, **including the
   * layout wait**: the screen holds the previous frame then, and that belongs to this switch.
   */
  onBusy?: (busy: boolean) => void;
  /**
   * Diff result (what `diffModels()` returns). Passing it enters diff mode: primitive colors give way to change
   * marks, and changed nodes get a breathing halo. **model must still be delta.model** (the union graph).
   */
  diff?: GraphDelta | null;
  /** Only mark changes on these ids; pair with `changedSubset()` for "changes only". */
  diffOnly?: Set<string> | null;
  /**
   * **Two columns is the diff; there is no other arrangement.** Left = before, right = now, sharing one set of coordinates and one viewport:
   * any node present in both versions is the same screen pixel in both columns (measured max coordinate difference: 0), so a glance
   * matches them up. The left instance is a **dumb mirror**: no layout, no view algebra, no transitions.
   *
   * There used to be a single-column arrangement that overlaid both versions on one graph; it is gone, along with its ghosting
   * vocabulary. One logic beats two, and in a single column "only in old" and "only in new" fight for space, which is exactly
   * the hardest part of a diff to read.
   */
  /**
   * Fusion: one shared frozen skeleton + taking turns pushing each side's own parts apart. See layout/diff-layout.ts.
   * Default `{ rounds: 1 }`, i.e. "the new version does not move at all, the old one adapts": that is the only path that keeps
   * "press compare and no surviving node moves".
   */
  diffLayout?: DiffLayoutSpec;
  /** Called once when the fusion solve finishes (which steps ran, how long). When you cannot see the layout, this is the only thing to check against. */
  onDiffLayout?: (r: { steps: { side: 'before' | 'after'; iterations: number }[]; layoutMs: number }) => void;
  /** Top-left caption (title / stats). */
  note?: ReactNode;
  emptyMessage?: ReactNode;
  /** UI strings. The library ships English only; other languages come from the host (partial is fine). `examples/strings-zh.ts` is a ready Chinese sample. */
  strings?: Partial<GraphStrings>;
  /**
   * **Pass it and the graph is editable**: "More ⋯" gets add node / add edge, and the detail panel gets "Edit".
   * The library never changes the model or touches files: each edit is just an `EditOp` handed out; the host applies it
   * with `applyEdit` to its own model and passes it back, and the transition shows the change. Not editable in compare mode. See edit.ts.
   */
  onEdit?: (op: EditOp) => void;
  /** Replace the free-form part of the edit panel (label / kind / data, JSON) with the host's own editor. */
  renderEditor?: RenderEditor;
  /**
   * How markdown in details (rendered by default) resolves relative URLs: images, links. Return null = cannot resolve
   * (link keeps only its text, image is not drawn). E.g. data extracted from a repository's docs resolves to that repository's raw file URLs.
   */
  resolveUrl?: (url: string, node: GraphNode) => string | null;
  /** The legend at bottom left (kinds and counts; click to hide, recolor, resize). On by default. */
  legend?: boolean;
  /**
   * Look overrides: colors / sizes / skeleton color the viewer changed in the legend, layered over profile and theme. Controlled or
   * self-owned, like `view`; to remember it (across sessions, per dataset) take `onLookChange` and store it. See `GraphLook`.
   */
  look?: GraphLook;
  defaultLook?: GraphLook;
  onLookChange?: (look: GraphLook) => void;
}

let cssInjected = false;
function injectCss() {
  if (cssInjected || typeof document === 'undefined') return;
  cssInjected = true;
  const el = document.createElement('style');
  el.id = 'glassbrain-css';
  el.textContent = GK_CSS;
  document.head.appendChild(el);
}

/** A group of elements with "the same skin and the same difference", plus the style tween they run this time. */
interface SkinGroup {
  eles: any;
  tween: StyleTween[];
  /** The ones with no in-between (`dashed`→`solid`): the old value goes on at the start and comes off at the end. */
  steps: StyleMap;
  /** Every property this group overrides, space separated (the format cytoscape's removeStyle accepts). */
  props: string;
  stepProps: string;
}

/**
 * Reskin list → groups of style tweens. **Read in two passes, because reading full styles is not cheap**: one element's full
 * computed style has over five hundred properties, ~0.1 ms per read, and reading 167 elements twice is tens of milliseconds.
 *
 *   ① pick one representative per "old skin → new skin" pair and read it fully twice to find **which properties actually differ**;
 *   ② read only those properties for every element in the group, and merge into one group only where values are identical.
 *
 * Step ② cannot be skipped: profile colors may well come from `mapData`, so two nodes with the same pair of skins
 * can have different colors, and without this step the whole group would be painted the representative's color.
 *
 * "What the old skin looks like" is read by **briefly putting the old classes back on, asking, and restoring synchronously**: no
 * frame boundary is crossed, so this in-between state never appears on screen. Restoring uses the element's **original class list**,
 * not a rebuilt one: the union and the new model can disagree by one on "is this a container" (its only child left), and a rebuilt
 * list would lose `container`.
 */
function planSkinTweens(cy: any, skins: SkinChange[]): SkinGroup[] {
  if (!skins.length) return [];
  const byPair = new Map<string, any[]>();
  const pastOf = new Map<string, string>();
  for (const sk of skins) {
    const el = cy.$id(sk.id);
    if (el.empty()) continue;
    pastOf.set(sk.id, sk.past);
    const k = `${sk.past}\n${sk.now}`;
    const arr = byPair.get(k);
    arr ? arr.push(el) : byPair.set(k, [el]);
  }
  const out: SkinGroup[] = [];
  for (const els of byPair.values()) {
    const orig: string[][] = els.map((el: any) => el.classes());
    const wearPast = () => cy.batch(() => els.forEach((el: any, i: number) => {
      // gb-* are the diff channel; reskinning leaves them alone (gb-node is part of the skin, the exception).
      const flags = orig[i].filter((c) => c.startsWith('gb-') && c !== 'gb-node');
      el.classes([...pastOf.get(el.id())!.split(' '), ...flags]);
    }));
    const restore = () => cy.batch(() => els.forEach((el: any, i: number) => el.classes(orig[i])));

    const nowFull: StyleMap = els[0].style();
    wearPast();
    const pastFull: StyleMap = els[0].style();
    const probe = diffSkinStyle(pastFull, nowFull);
    const cand = [...probe.tween.map((t) => t.prop), ...Object.keys(probe.steps)];
    if (!cand.length) { restore(); continue; }

    const read = (el: any): StyleMap => {
      const m: StyleMap = {};
      for (const prop of cand) m[prop] = el.style(prop);
      return m;
    };
    const past = els.map(read);          // still wearing the old skin
    restore();
    const now = els.map(read);

    const sub = new Map<string, number[]>();
    els.forEach((_: any, i: number) => {
      const k = JSON.stringify([past[i], now[i]]);
      const arr = sub.get(k);
      arr ? arr.push(i) : sub.set(k, [i]);
    });
    for (const idxs of sub.values()) {
      const { tween, steps } = diffSkinStyle(past[idxs[0]], now[idxs[0]]);
      const props = [...tween.map((t) => t.prop), ...Object.keys(steps)];
      if (!props.length) continue;
      out.push({
        eles: cy.collection(idxs.map((i) => els[i])),
        tween, steps,
        props: props.join(' '),
        stepProps: Object.keys(steps).join(' '),
      });
    }
  }
  return out;
}

/**
 * Which **set** of marks this transition should read.
 *
 * In browse mode the union comes from `diffModels`, marked `gb-added` / `gb-removed` / `gb-merged`;
 * in diff mode it comes from `stepUnion`, marked `gb-step-*`. Both must be read right, because in diff mode
 * `gb-removed` means **"this is a change"** (a ghost meant to be seen), not "this leaves now".
 * Read the wrong set and a whole field of ghosts fades out the moment the scene starts.
 */
interface Marks { gone: string[]; arrived: string }
const DIFF_MARKS: Marks = { gone: ['gb-removed', 'gb-merged'], arrived: 'gb-added' };
const STEP_MARKS: Marks = { gone: [STEP_FLAG.removed], arrived: STEP_FLAG.added };
/** Does this switch change anything on stage: a node in or out or changed, or an edge in or out. */
const stirs = (d: GraphDelta) => {
  if (d.changes.length) return true;
  const e = edgeTraffic(d);
  return e.in + e.out > 0;
};
const goneSel = (m: Marks) => m.gone.map((c) => '.' + c).join(', ');

/**
 * **Who enters and who leaves** on screen: one source only, the marks on the elements.
 *
 * The data change (delta) is only part of it: synthetic things in the element table (the virtual root) are not in the data but
 * still enter and leave. The "presence" channel and the curtain used to read marks while transition planning, framing and
 * pre-layout coordinate filling read the delta, so one node was fading out while being planned as "staying" and framed in
 * (after a version switch the picture leaned to one side, leaving a gap meant for it). Now every "who enters, who leaves" question asks here.
 */
function presenceOf(inst: any, marks: Marks): Map<string, 'gone' | 'new'> {
  const out = new Map<string, 'gone' | 'new'>();
  if (!inst || inst.destroyed()) return out;
  inst.nodes(goneSel(marks)).forEach((n: any) => out.set(n.id(), 'gone'));
  inst.nodes('.' + marks.arrived).forEach((n: any) => { if (!out.has(n.id())) out.set(n.id(), 'new'); });
  return out;
}
/** Elements leaving (nodes and edges): exactly the batch tucked away after the scene. */
const goneIn = (inst: any, marks: Marks): Set<string> => {
  const out = new Set<string>();
  if (inst && !inst.destroyed()) inst.elements(goneSel(marks)).forEach((el: any) => out.add(el.id()));
  return out;
};

/**
 * The four groups of the "presence" channel. **Only the situation at both ends and the marks matter, not a single coordinate**, so the
 * moment the union mounts the groups can be formed and their base points written, without waiting for layout.
 *
 * Which group is decided by one pure function, `edgeFade` (see animate.ts: one axiom + "an edge has no position of
 * its own"). This only does the rough work: read classes to see the situation, collect each group.
 *
 * **No more special case for containment edges.** Synthetic containment edges used to never carry marks, so they had to be
 * guessed from connectivity; now a reparent makes `buildElements` honestly emit two (the old with gb-removed, the new with
 * gb-added), exactly like every other edge.
 */
function presenceGroups(cy: any, live: boolean, marks: Marks): Record<FadeName, any> {
  /* **No additions or removals this time means no "presence" to play.** The gb-* marks on the union are left over from the
   * **previous** switch (renderModel stays that union until the next switch); grouping by them would fade the previous batch
   * of new elements in again. That is exactly where the full-screen flash on "Recompute" came from. */
  const bucket: Record<FadeName, any[]> = { cut: [], out: [], in: [], graft: [] };
  if (live) {
    const stateOf = (n: any): EndState => (marks.gone.some((c) => n.hasClass(c))
      ? 'gone' : n.hasClass(marks.arrived) ? 'new' : 'stay');
    cy.nodes().forEach((n: any) => {
      const s = stateOf(n);
      if (s === 'gone') bucket.out.push(n);
      else if (s === 'new') bucket.in.push(n);
    });
    cy.edges().forEach((e: any) => {
      const flag = e.hasClass(marks.arrived) ? 'added' as const
        : marks.gone.some((c) => e.hasClass(c)) ? 'removed' as const : null;
      const k = edgeFade(stateOf(e.source()), stateOf(e.target()), flag);
      if (k) bucket[k].push(e);
    });
  }
  return {
    cut: cy.collection(bucket.cut), out: cy.collection(bucket.out),
    in: cy.collection(bucket.in), graft: cy.collection(bucket.graft),
  };
}

/**
 * The union may contain nodes **that neither single-version solve gave coordinates to**. The only real source is the **synthetic
 * virtual root**: each version has a single top level, together they have >1, so the root exists only in the union. In connected
 * mode it is a real node; without coordinates it sits at (0,0), showing up as a fan of long lines dragged off the graph.
 *
 * It sits down nearby: at its children's centroid, or the overall centroid without children. Same idea as where entering
 * nodes land: **a thing without a position takes the position of its relatives**.
 */
function seatOrphans(pos: Positions, built: BuiltElements): void {
  const missing: string[] = [];
  let sx = 0, sy = 0, n = 0;
  for (const el of built.elements) {
    if (el.data.source) continue;
    const id = el.data.id as string;
    const p = pos[id];
    if (p) { sx += p.x; sy += p.y; n++; } else missing.push(id);
  }
  if (!missing.length || !n) return;
  const mid = { x: sx / n, y: sy / n };
  for (const id of missing) {
    let cx = 0, cy = 0, k = 0;
    for (const [child, parent] of built.parentOf) {
      if (parent !== id) continue;
      const p = pos[child];
      if (p) { cx += p.x; cy += p.y; k++; }
    }
    pos[id] = k ? { x: cx / k, y: cy / k } : mid;
  }
}

/**
 * **Lay the previous frame's coordinates back onto a freshly built instance.**
 *
 * Any change to the element set means a new instance, and in a new instance every node is piled at (0,0). Until the layout
 * finishes the picture would be empty: a flash on every data update, nobody sees "what the previous version looked like", and there is nothing to animate from.
 *
 * Elements the previous version did not have (new this time) **land where they grow from**: the first ancestor up the parent chain
 * that was on screen in the previous frame. That is the same function as the "sprout" leg's base point (`anchorOf`), so "mount
 * frame = sample 0" holds coordinate for coordinate, not approximately. Only when the whole parent chain is new (a whole new
 * tree) does it fall back to the centroid; that branch only fades in, it does not move.
 *
 * **Both instances go through this.** It used to be the main instance only, while the mirror laid out `baseRef` via `syncMirror`,
 * and `baseRef` is the **previous round's** target coordinates. Once matching renamed things (the old side's ids swapped with `resolved`)
 * nothing matched, so the whole left column piled at the origin with edges pulled from the graph to (0,0): the **dangling lines and glows**,
 * and the "left column did not move along", all came from that.
 */
function seatFromLastFrame(cy: any, prev: Positions, parentOf: (id: string) => string | undefined): void {
  const vals = Object.values(prev);
  if (!vals.length) return;
  const mid = {
    x: vals.reduce((s, p) => s + p.x, 0) / vals.length,
    y: vals.reduce((s, p) => s + p.y, 0) / vals.length,
  };
  const seat = (id: string) => {
    const anc = anchorOf(id, (q) => !!prev[q], parentOf);
    return anc ? prev[anc] : mid;
  };
  cy.batch(() => {
    cy.nodes(':childless').forEach((n: any) => n.position(prev[n.id()] ?? seat(n.id())));
  });
}

/**
 * **The right column should show only "now".** The main instance holds the union, so each time its display is rewritten
 * the past half must be hidden again; same path as view filtering (only toggle display), no rebuild, no relayout.
 *
 * **Hide as soon as the union mounts; do not wait for `applyView`.** `applyView` runs after the curtain, so for the whole
 * second of the tween the right column also drew the past version: two versions overlaid, glows smeared together. That is
 * where the "muddle" came from, and it appeared exactly in the second someone is staring at.
 */
function hideGhosts(cy: any): void {
  cy.elements('.gb-removed, .gb-merged').style('display', 'none');
}

/** Empty geometry = the overlay draws nothing. Used mid-tween to take the marks down (see playTransition). */
const EMPTY_GEOM: DiffGeometry = { nodes: {}, edges: [] };

/**
 * Geometry snapshot after landing, for the overlay to hug the primitives. **Measured per column**: the two columns have different
 * visible sets, so compound sizes and edge control points differ too.
 *
 * `hidden` is the half of this column **tucked away after the scene** (`leftRef` / `leftPastRef`). It must be excluded:
 * after a switch the instance still holds the **union** (the previous version's elements are only `display:none`, not removed),
 * and measuring them would make the overlay draw a glow around **an edge that cannot be drawn**: the **dangling smears**.
 * The rule in one line: **the overlay hugs what is drawn, not what is present.**
 */
function measureDiffGeom(cy: any, hidden: ReadonlySet<string>): DiffGeometry {
  const nodes: Record<string, NodeBox> = {};
  cy.nodes().forEach((n: any) => {
    if (hidden.has(n.id())) return;
    const p = n.position();
    nodes[n.id()] = { x: p.x, y: p.y, w: n.outerWidth(), h: n.outerHeight() };
  });
  /* Measure both added and removed edges: single column and right column use the added, left uses the removed; the overlay picks.
   * These are **model coordinates** (sourceEndpoint/controlPoints/targetEndpoint all are),
   * so one outer `<g transform>` takes care of pan and zoom. */
  const edges: DiffGeometry['edges'] = [];
  cy.edges('.gb-added, .gb-removed').forEach((e: any) => {
    if (hidden.has(e.id()) || hidden.has(e.source().id()) || hidden.has(e.target().id())) return;
    try {
      const d = edgePath(e.sourceEndpoint(), e.controlPoints() ?? [], e.targetEndpoint());
      if (d.includes('NaN')) return;                       // same: measured before landing, drop it
      edges.push({
        id: e.id(),
        kind: e.hasClass('gb-added') ? 'added' : 'removed',
        source: e.source().id(), target: e.target().id(), d,
      });
    } catch { /* degenerate cases like coincident endpoints make cytoscape throw; just skip this one */ }
  });
  return { nodes, edges };
}

/**
 * The right column (inspector) drawer: opening and closing are both a slide, and the canvas widens / narrows with it instead of
 * jumping. When closing, the last content stays to play its exit. On narrow screens it is a sheet pulled up from the bottom (see style.ts).
 */
function Drawer({ children }: { children: ReactNode }) {
  const last = useRef<ReactNode>(children);
  if (children) last.current = children;
  const [gone, setGone] = useState(!children);
  const open = !!children;
  useEffect(() => {
    if (open) { setGone(false); return; }
    const t = setTimeout(() => setGone(true), DRAWER_MS);
    return () => clearTimeout(t);
  }, [open]);
  const content = children || (gone ? null : last.current);
  if (!content) return null;
  return <div className={`gb-drawer${open ? '' : ' is-closing'}`}>{content}</div>;
}
const DRAWER_MS = 200;

export default function GraphCanvas(props: GraphCanvasProps) {
  const {
    model, profile: baseProfile = defaultProfile, theme: baseTheme = LIGHT_THEME, pool,
    className, style, compact, detailPanel = true, renderText, onSelect, onIssues,
    showIssues = true, note, emptyMessage, onReady, onEdit, renderEditor, resolveUrl,
    animate = true, matchKey, onTransition, onBusy, layout: presetLayout = null, layoutMode = 'fresh', onLayout, diff = null, diffOnly = null,
    diffLayout, onDiffLayout, readable = true, nodeScale = 1, labelSpacing = LABEL_SPACING,
    semanticOpacity = SEMANTIC_OPACITY, emphasis: hostEmphasis = null, legend = true,
  } = props;
  /* Look: colors / sizes the viewer changed in the legend, layered over profile and theme (controlled or self-owned, like the view). */
  const [innerLook, setInnerLook] = useState<GraphLook>(props.defaultLook ?? {});
  const look = props.look ?? innerLook;
  const setLook = useCallback((l: GraphLook) => {
    if (!props.look) setInnerLook(l);
    props.onLookChange?.(l);
  }, [props.look, props.onLookChange]);
  const lookProfile = useMemo(() => applyLook(baseProfile, look), [baseProfile, look]);
  const theme = useMemo(() => (look.skeleton ? { ...baseTheme, skeleton: look.skeleton } : baseTheme), [baseTheme, look.skeleton]);
  /** The class pointed at in the legend overrides the host's emphasis. */
  const [legendEmphasis, setLegendEmphasis] = useState<{ nodeKinds?: string[]; edgeKinds?: string[] } | null>(null);
  const emphasis = legendEmphasis ?? hostEmphasis;
  /** On a narrow canvas (phone, small embed) the legend starts collapsed: judged by the canvas's own width, not the window. */
  const [legendCollapsed, setLegendCollapsed] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if ((stageRef.current?.clientWidth ?? 1000) < 640) setLegendCollapsed(true);
  }, []);
  /** The main instance (the legend reads marks from it). Replaced on rebuild. */
  const [liveCy, setLiveCy] = useState<unknown>(null);
  /** `profile` below is always the one without look (see useShapeOf): it stays put when only the palette changes, so the instance is not rebuilt.
   *  The stylesheet is always assembled fresh from the latest `lookProfile`. */
  const profile = useShapeOf(lookProfile);
  // `error` is a nested group: a language pack that gives only a few entries must still fall back to English for the rest.
  const strings = useMemo(() => ({ ...EN, ...props.strings, error: { ...EN.error, ...props.strings?.error } }), [props.strings]);

  const [innerView, setInnerView] = useState<GraphView>({ ...FULL_VIEW, ...props.defaultView });
  const rawView = props.view ?? innerView;
  const setView = useCallback((patch: Partial<GraphView>) => {
    const next = { ...(props.view ?? innerView), ...patch };
    if (!props.view) setInnerView(next);
    props.onViewChange?.(next);
  }, [props.view, props.onViewChange, innerView]);

  const containerRef = useRef<HTMLDivElement>(null);
  /** This canvas, as the owner of its layout runs (see computeLayout): another canvas on the page never supersedes them. */
  const [layoutOwner] = useState(() => ({}));
  const cyRef = useRef<any>(null);
  /** The left column **mirror**. A dumb instance: no layout, no view algebra, no transitions. It does three
   *  things: lay down the same coordinates, hide what exists only in the new version, follow the main instance's
   *  viewport. All the "smarts" stay in the main instance, so the two columns cannot disagree. */
  const mirrorRef = useRef<any>(null);
  const mirrorElRef = useRef<HTMLDivElement>(null);
  /** Loop guard for two-way viewport sync. */
  const syncingRef = useRef(false);
  const baseRef = useRef<Positions>({});
  const tightenedRef = useRef(false);
  const runRef = useRef(0);
  const platesRef = useRef<Plate[]>([]);
  /** Coordinates **on screen right now**. Differs from baseRef (this round's layout target) mid-tween:
   *  this holds the half-interpolated values. It is the start of the next transition and the seed of the next layout.
   *  It lives in a ref because it must **survive instance rebuilds**: when the element set changes cytoscape is new,
   *  and the previous version's coordinates exist only here. */
  const dispRef = useRef<Positions>({});
  /** The model actually rendered. Normally = the `model` prop; during a data switch = **the union of old and new**.
   *  This is the pivot of the whole animation: during the transition both versions are present, so each position has only
   *  one end point (from the union layout), and "how to align two versions" never arises.
   *
   *  In diff mode it is **the host's union** (with a switch union on top). The right column draws only "now" but holds
   *  both versions: sizes are measured, framing is computed and the camera is solved for both columns together, and all
   *  three need "every element present". **Present is present; drawn or not is display's business.** */
  const [renderModel, setRenderModel] = useState<GraphModel>(model);
  /** The model from the previous prop: the "before" side of the next switch. */
  const prevModelRef = useRef<GraphModel | null>(null);
  /** Which profile the previous model was drawn under. A new profile (layers, parsing, which edges carry force may all differ)
   *  is a new world: the two models have no comparable "same node", so nothing plays; it just switches. */
  const prevProfileRef = useRef<GraphProfile | null>(null);
  /** The model the left column actually renders. Normally = the old side; during a switch = **the union of both versions' old sides**. */
  const [pastRenderModel, setPastRenderModel] = useState<GraphModel | null>(null);
  /* **The data drawn and the profile must belong to the same world.** On a dataset switch the host gives a new profile
   * and a new model in the same render, but `renderModel` only changes in the effect below. In the beat between, the element
   * table is "old data + new profile": a short-lived instance gets built, layout takes the new data's coordinates while layer
   * membership looks up the old data's table, misses, and everything lands on layer 0, flattened and recorded as "previous
   * frame"; next beat the right instance is built and the transition flies from those flat coordinates up to the stacked
   * ones (the whole graph floats up from the bottom, the overview crosses the whole picture). So when the profile changes,
   * the drawn data is swapped in this very render: one instance, one landing, start to finish. */
  const [renderWorld, setRenderWorld] = useState(profile);
  if (renderWorld !== profile) {
    setRenderWorld(profile);
    setRenderModel(model);
    setPastRenderModel(null);
  }
  /** What this switch will play. It starts only once layout is done (before that the end point is unknown). */
  const pendingRef = useRef<GraphDelta | null>(null);
  /** Which set of marks this transition reads (browse = the diffModels set, diff = the stepUnion set). */
  const marksRef = useRef<Marks>(DIFF_MARKS);
  /** The left column's previous model, and the union it plays this time. **The mirror needs both versions present too**: if
   *  only the main instance had a union, the left column could only jump to the new past version, while what the user watches is "both sides change together". */
  const prevPastRef = useRef<GraphModel | null>(null);
  const pendingPastRef = useRef<GraphDelta | null>(null);
  /** The half the left column tucks away after the scene. */
  const leftPastRef = useRef<Set<string>>(new Set());
  /** The half tucked away after the scene (the past). **Toggles display, no rebuild, no relayout**: reuses the library's
   *  rule that "the view only decides what is visible"; removing elements is not a new mechanism. */
  const leftRef = useRef<Set<string>>(new Set());
  /** Nodes that changed skin in this switch (decided when the delta is computed, because the previous model is still at hand then). */
  const pendingSkinsRef = useRef<SkinChange[]>([]);
  /** **Frame 0 of this transition is already on the canvas.**
   *
   *  The base points of the "presence" and "look" channels need no coordinates (entering from 0, leaving from 1, reskins
   *  put the old values on first), so they can be written the moment the union mounts, without waiting for layout. Between
   *  them sit an await, a React render and a few paints, and those frames used to belong to nobody: `gb-added` is just an
   *  ordinary class in browse mode, so new nodes and edges **were drawn in full with default styles**. The audience saw
   *  "the new stuff is already here" and only then the cut and the sprout, which made both meaningless. Reskins were worse:
   *  they jumped to the new skin first and were covered back with the old one when the transition started, **playing backwards once**.
   *
   *  `disarm` undoes these inline styles: the curtain, landing directly and re-arming all go through it. */
  const armedRef = useRef<{
    groups: Record<FadeName, any>;
    skins: SkinGroup[];
    changes: SkinChange[];
    disarm: () => void;
  } | null>(null);
  const tweenRef = useRef<{ raf: number; safety: ReturnType<typeof setTimeout> } | null>(null);
  const layoutMsRef = useRef(0);
  /** The previous instance's viewport. Reused across rebuilds; otherwise the camera resets to zoom=1, which is exactly
   *  where the "whole graph unfolds from scratch" feeling came from. */
  const prevViewportRef = useRef<{ zoom: number; pan: { x: number; y: number } } | null>(null);
  /** Measured leaf sizes (layout needs them). Note they are measured **before layout**, without compound expansion,
   *  so diff halos do not use them; they use haloBoxes measured from cytoscape after landing. */
  const dimsRef = useRef<Record<string, { w: number; h: number }>>({});
  /** The label channel's ledger. In a ref for the same reason as dispRef: it must **survive instance rebuilds**, so the
   *  new instance's frame 0 is written from it and the text on screen matches the previous frame. */
  const labelsRef = useRef(new Map<string, LabelState>());
  /** Frame id of the fade loop. Runs only while some label is changing and stops itself when all have arrived. */
  const labelRafRef = useRef<number | null>(null);
  /** Hover: the delayed clear timer after leaving. */
  const hoverOutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The main instance's painter (see paint.ts). Lives and dies with the instance. */
  const painterRef = useRef<Painter | null>(null);
  /** Selection ring entrance times (node id → timestamp) and the frame id of that short animation. */
  const ringsRef = useRef(new Map<string, number>());
  const ringRafRef = useRef<number | null>(null);
  /** The text layer (stacked above cytoscape), plus the pen and cache used to measure text width (size|text → width). */
  const labelCanvasRef = useRef<HTMLCanvasElement>(null);
  /** The set for the diff left column (mirror): ledger and canvas. Each column lays out its own text; same code, picked per instance. */
  const mirrorLabelsRef = useRef(new Map<string, LabelState>());
  const mirrorCanvasRef = useRef<HTMLCanvasElement>(null);
  const laneOf = (cy: any) => (cy && cy === mirrorRef.current
    ? { book: mirrorLabelsRef, canvas: mirrorCanvasRef }
    : { book: labelsRef, canvas: labelCanvasRef });
  const measureRef = useRef<{ ctx: CanvasRenderingContext2D | null; cache: Map<string, number> } | null>(null);
  /** The rAF coalescing gate for re-verdicts (one storm of viewport events computes once), the idle breathing timer and phase,
   *  and the timestamp of "someone last touched it": breathing only runs while nobody does. */
  const readabilityRafRef = useRef<number | null>(null);
  /** How long the last re-verdict took, and the catch-up timer after the viewport stops (see LABEL_REPLAN_BUDGET_MS). */
  const replanCostRef = useRef(0);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const breathTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const breathPhaseRef = useRef(0);
  const lastInteractionRef = useRef(0);

  /** **Flat** coordinates from layout (not yet raised to 2.5D), and which layer each node is on. Raising and flattening
   *  layers project from this (`projectAt`), so switching does not recompute. */
  const rawRef = useRef<Positions>({});
  const layerOfRef = useRef<Map<string, string>>(new Map());
  /** How far the layer affine has gone (0 = flat, 1 = 2.5D), how bright each layer is, which view is already on screen
   *  (`planeKey`), and the frame id of that tween. */
  const planeTRef = useRef(0);
  const layerAlphaRef = useRef(new Map<string, number>());
  const planeKeyRef = useRef('');
  const planeTweenRef = useRef<number | null>(null);
  /** Frame id of the search fly-to. */
  const flyRef = useRef<number | null>(null);
  /** At its curtain `requestLayout` continues with a layer switch, but `playPlanes` is defined after it: go through a ref. */
  const playPlanesRef = useRef<((cy: any) => void) | null>(null);
  const sightRef = useRef('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [selected, setSelected] = useState<SelectedNode | null>(null);
  /** The edit panel is open (it takes the detail panel's place). */
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const editable = !!onEdit && !diff;
  const onEditRef = useRef(onEdit); onEditRef.current = onEdit;
  /** A just-created node: once its entrance has played, select it and fly to it. */
  const pendingPickRef = useRef<string | null>(null);
  /** This data change was caused by an edit: keep the selection across the instance rebuild. */
  const keepSelRef = useRef<string | null>(null);
  const pickRef = useRef<(id: string) => void>(() => {});
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null);
  const [plates, setPlates] = useState<Plate[]>([]);
  /** The layer whose name is hovered in 2.5D: its nodes are spotlighted (see respot) and its plate deepens. */
  const [hotLayer, setHotLayer] = useState<string | null>(null);
  const hotLayerRef = useRef<string | null>(null);
  /** Plate opacity: exactly how far the affine has gone. Plates appear as layers rise and fade as they flatten. */
  const [plateAlpha, setPlateAlpha] = useState(0);
  const plateAlphaRef = useRef(0);
  const [viewport, setViewport] = useState({ zoom: 1, pan: { x: 0, y: 0 } });

  const built = useMemo(
    () => buildElements(renderModel, profile),
    [renderModel, profile],
  );
  /** Layers that actually hold something in this data. If the profile declares two layers and this version has one, there are no "layers" to pick.
   *  Ask the host's `model`, not the union being drawn: after a scene the union still holds the tucked-away half of the previous version. */
  const layersHere = useMemo(() => {
    const has = new Set(model.nodes.map((n) => n.layer ?? profile.layers[0].id));
    return profile.layers.filter((l) => has.has(l.id));
  }, [model, profile.layers]);
  /** A multi-layer graph has only two views, "one layer" and "all (2.5D)", see `planeView`. Every `view` below is normalized. */
  /** Sources also come from the host's model: files that really exist in this version. A view pointing elsewhere counts as not given (see `originView`). */
  const origins = useMemo(() => originsOf(model), [model]);
  const view = useMemo(
    () => planeView(originView(rawView, origins), layersHere),
    [rawView, origins, layersHere],
  );
  const resolved = useMemo(() => resolveView(renderModel, built.elements, view), [renderModel, built, view]);
  /** The stats line under the ⋯ menu: nodes and edges **visible right now**, counted the same way as the legend (data nodes,
   *  containers included; only data edges, containment is parent not an edge), minus what the view filters and the legend
   *  hides. With no filter and nothing hidden it equals the data totals. Nodes used to count "visible leaves" while edges
   *  counted "all data edges": two different bases that matched neither the legend nor the host's own counts. */
  const stats = useMemo(() => {
    const hn = new Set(view.hiddenNodeKinds ?? []), he = new Set(view.hiddenEdgeKinds ?? []);
    const seen = (id: string) => {
      const n = model.index.get(id);
      return !!n && resolved.visible.has(id) && !hn.has(n.kind ?? '');
    };
    let nodes = 0, edges = 0;
    for (const n of model.nodes) if (seen(n.id)) nodes++;
    for (const e of model.edges) if (!he.has(e.kind ?? '') && seen(e.source) && seen(e.target)) edges++;
    return { nodes, edges };
  }, [model, resolved, view.hiddenNodeKinds, view.hiddenEdgeKinds]);
  /** Each version's own model (both in the union's namespace). Coordinates need it, and so does the left column. */
  const diffSides = useMemo(() => (diff ? unionSides(diff) : null), [diff]);
  /** **The left column draws the old version's own element table, not the union.**
   *
   *  In the union, nodes present in both versions take the new version's content; drawing the left column from the union
   *  would show "new content on the old structure", both columns would be the same version, and that is exactly the
   *  question the two columns are meant to answer. Also the old version's containment edges are generated from **the old parents**; from the union even the left edges would be the new set.
   *
   *  Both element tables share one set of coordinates (`baseRef`) and one id namespace, so "unchanged things are the
   *  same pixel in both columns" still holds. */
  const pastBuilt = useMemo(
    () => (pastRenderModel
      ? buildElements(pastRenderModel, profile, { past: true })
      : null),
    [pastRenderModel, profile],
  );
  // Validation reports on **the host's model**: during a transition half the union is "ghosts of the past", and reporting
  // problems on that would only scare people.
  const issues = useMemo(() => validateModel(model, profile), [model, profile]);

  // Callbacks go through refs: an inline arrow from the host must not re-fire them on every render.
  const onIssuesRef = useRef(onIssues); onIssuesRef.current = onIssues;
  useEffect(() => { onIssuesRef.current?.(issues); }, [issues]);
  // The stylesheet must be in before the first layout: the toolbar measures things in a layout effect. Idempotent, injected once.
  injectCss();

  // Latest readings for async callbacks, without making them dependencies (that would rebuild the canvas for nothing).
  const viewRef = useRef(view); viewRef.current = view;
  // cy event handlers are registered once on mount; a direct closure would hold the mount frame's setView forever
  // (changing the view would wipe other changes made in between). Forward through a ref to get the latest.
  const setViewRef = useRef(setView); setViewRef.current = setView;
  const builtRef = useRef(built); builtRef.current = built;
  const resolvedRef = useRef(resolved); resolvedRef.current = resolved;
  const emphasisRef = useRef(emphasis); emphasisRef.current = emphasis;
  /** Semantic edges hidden by kind last time (one set for main, one for the mirror): next time only restore what should no longer hide, only hide what newly should. */
  const kindOffRef = useRef(new Set<string>());
  const mirrorKindOffRef = useRef(new Set<string>());
  const animateRef = useRef(animate); animateRef.current = animate;
  const diffRef = useRef(diff); diffRef.current = diff;
  const diffSidesRef = useRef(diffSides); diffSidesRef.current = diffSides;
  const diffLayoutRef = useRef(diffLayout); diffLayoutRef.current = diffLayout;
  const onDiffLayoutRef = useRef(onDiffLayout); onDiffLayoutRef.current = onDiffLayout;
  const matchKeyRef = useRef(matchKey); matchKeyRef.current = matchKey;
  const profileRef = useRef(profile); profileRef.current = profile;
  const presetRef = useRef(presetLayout); presetRef.current = presetLayout;
  const layoutModeRef = useRef(layoutMode); layoutModeRef.current = layoutMode;
  const onLayoutRef = useRef(onLayout); onLayoutRef.current = onLayout;
  /** The set last reported to `onLayout` (without the virtual root). */
  const reportedRef = useRef<Positions | null>(null);
  const onTransitionRef = useRef(onTransition); onTransitionRef.current = onTransition;
  const onBusyRef = useRef(onBusy); onBusyRef.current = onBusy;
  const nodeScaleRef = useRef(nodeScale); nodeScaleRef.current = nodeScale;
  const readableRef = useRef(readable); readableRef.current = readable;
  const semanticOpacityRef = useRef(semanticOpacity); semanticOpacityRef.current = semanticOpacity;
  const labelSpacingRef = useRef(labelSpacing); labelSpacingRef.current = labelSpacing;
  const lookRef = useRef(lookProfile); lookRef.current = lookProfile;
  const themeRef = useRef(theme); themeRef.current = theme;
  const compactRef = useRef(compact); compactRef.current = compact;
  /** The whole stylesheet for right now. `scale` defaults to the slider; in diff mode both columns are 1 (they must be the same pixel).
   *  With the readability field on, node labels are drawn by the canvas layer; cytoscape's labels remain only for measuring. */
  const sheetFor = useCallback((diffMode: boolean, scale?: number) => graphStyle(
    themeRef.current, lookRef.current,
    {
      diff: diffMode, nodeScale: diffMode ? 1 : scale ?? nodeScaleRef.current,
      overlayLabels: readableRef.current,
    },
  ), []);

  /** Playing. **No new data is accepted until the scene ends** (see `onBusy`). */
  const busyRef = useRef(false);
  /** New data arrived while playing: one more scene is owed after the curtain. */
  const missedRef = useRef(false);
  /** A change needing relayout arrived while playing (layout / layoutMode / "Relayout" / fusion knobs): one more after the curtain.
   *  `force` = someone pressed "Relayout" among them. See `layoutNow`. */
  const owedLayoutRef = useRef<{ force: boolean } | null>(null);
  /** The relayout still owed at the curtain (`layoutNow` is defined after requestLayout, go through a ref). */
  const flushOwedRef = useRef<(() => void) | null>(null);
  /** The trigger for the owed scene: the prop did not change, so that effect has to run again by itself. */
  const [resume, setResume] = useState(0);
  const markBusy = useCallback((v: boolean) => {
    if (busyRef.current === v) return;
    busyRef.current = v;
    // Curtain up: clear hover immediately, no fade; during the scene every frame's opacity belongs to the transition.
    if (v) painterRef.current?.hover(null, true);
    onBusyRef.current?.(v);
  }, []);

  /** Rename the previous frame (coordinates + label ledger) along with matching. `draft~X` became `X`, and the
   *  previous frame is recorded under the old name; without renaming it is "matched, but position starts from zero", which looks
   *  like a whole-graph relayout. Labels too: matched nodes would suddenly lose their text on frame 0. */
  const carryLastFrame = useCallback((resolved: Map<string, string>) => {
    if (!resolved.size) return;
    const carried: Positions = { ...dispRef.current };
    const book = labelsRef.current;
    for (const [oldId, unionId] of resolved) {
      const p = dispRef.current[oldId];
      if (p && !carried[unionId]) carried[unionId] = p;
      const s = book.get(oldId);
      if (s && !book.has(unionId)) book.set(unionId, { ...s });
    }
    dispRef.current = carried;
  }, []);

  /* ── One data switch = one union transition ──────────────────────────────────────
   * When the model prop changes, it is not swapped directly: **the union of old and new** is mounted first; once layout
   * is done the scene plays, and afterwards the "past" half is tucked away. In diff mode the model already is the host's
   * union; do not wrap it again. */
  useEffect(() => {
    /* **No new data midway through a scene.** Swapping midway cuts the scene in half: fragments of the previous one are
     * still in mid-air while the whole union is replaced by another. So queue it and play after the curtain, keeping only
     * the latest; the versions in between were never drawn, and skipping them loses nothing. */
    if (busyRef.current) { missedRef.current = true; return; }
    missedRef.current = false;
    const prev = prevModelRef.current;
    prevModelRef.current = model;
    const sameWorld = prevProfileRef.current === profileRef.current;
    prevProfileRef.current = profileRef.current;
    const spec = resolveSpec(animateRef.current);
    const sides = diffRef.current ? (diffSidesRef.current ?? unionSides(diffRef.current)) : null;
    /** Play nothing, just switch. */
    const settleNow = () => {
      pendingRef.current = null;
      pendingPastRef.current = null;
      pendingSkinsRef.current = [];
      leftRef.current = new Set();
      leftPastRef.current = new Set();
      setRenderModel(model);
      /* **This line cannot go.** It is the left column's "previous version" for the next switch; without it, the **first**
       * switch after entering compare mode has no previous version on the left, `pastStep` is null, and the right column
       * plays while the left jumps. That asymmetry is the hardest to spot: wrong once, right every time after.
       * Cleared when leaving compare mode, or the next entry would compare against a stale "previous version". */
      prevPastRef.current = sides ? sides.before : null;
      setPastRenderModel(sides ? sides.before : null);
    };
    /* **A new world (another profile = another dataset) is a blank page.** The "previous frame" coordinate table accumulates:
     * only things leaving in a transition get crossed out, and a world switch plays no transition, so the previous dataset's
     * coordinates stay in the table. Switching back later, the transition would start from those stale coordinates: the whole
     * graph flies in from somewhere unrelated, and the overview every dataset has (same id) crosses the picture each time. A world switch clears the table, everything appears in place. */
    if (!sameWorld) { dispRef.current = {}; labelsRef.current = new Map(); }
    /* An empty side has nothing to animate, and the empty view unmounts the canvas: going busy there would never end. */
    if (!spec || !prev || prev === model || !sameWorld || !model.nodes.length || !prev.nodes.length) { settleNow(); return; }

    /* ── Diff mode: **each side plays its own scene on one shared timeline** ──────────────────
     *
     * This used to return right here, so in diff mode switching a version "became new instantly": the instance was destroyed
     * and rebuilt, the old data was gone on the spot, and all that could play was a motion that was often zero. To play, both
     * versions must **be present together** as in browse mode: mount "old union ∪ new union", tuck the old half away after.
     *
     * But this union cannot come from `diffModels`: the host's union already carries `gb-added` /
     * `gb-removed` (meaning "this is a change"), and another layer of the same marks would be misread. `stepUnion` only
     * tracks presence, with its own `gb-step-*`, so the two stay separate.
     *
     * Same for the left column, except it compares **the old sides of both versions**. The two deltas differ but share one
     * timeline (one `sampleTransition`), so "both sides change together" is one sample feeding two places, not two animations. */
    if (sides) {
      const prevPast = prevPastRef.current;
      prevPastRef.current = sides.before;
      /* **Match with the host's `matchKey`, not verbatim ids.** `unionSides` renames old-side ids to the new side's
       * (`resolved`), so the same reference version has two names in "against A" and "against B". Verbatim comparison
       * would judge an untouched column "all in, all out" and fade the whole column out and in. */
      const step = stepUnion(prev, model, matchKeyRef.current);
      const pastStep = prevPast ? stepUnion(prevPast, sides.before, matchKeyRef.current) : null;
      // No entries or exits on either side, nodes or edges = no "presence" to play in this step. Positions may still change; planTransition
      // decides that itself (worth). This only avoids building two unions and rebuilding two instances for nothing.
      if (!stirs(step) && !(pastStep && stirs(pastStep))) { settleNow(); return; }
      /* **Coordinates are renamed with matching.** The previous frame is recorded under old names; without renaming it is
       * "matched, but position starts from zero", which looks like a whole-graph relayout. Both sides' rename tables are applied. */
      carryLastFrame(step.resolved);
      if (pastStep) carryLastFrame(pastStep.resolved);
      pendingRef.current = step;
      pendingPastRef.current = pastStep;
      marksRef.current = STEP_MARKS;
      pendingSkinsRef.current = planSkins(step, prev, model, profileRef.current);
      leftRef.current = new Set();
      leftPastRef.current = new Set();
      /* **Take the glows down the moment the switch starts.** They hug post-landing geometry (compound sizes, edge control
       * points) that changes every frame of the coming relayout + tween. Keeping them pins old marks onto a new graph,
       * and in between sit an instance rebuild and an async import, frames nobody controls. */
      setDiffGeom(EMPTY_GEOM);
      setPastGeom(EMPTY_GEOM);
      markBusy(true);
      setRenderModel(step.model);
      setPastRenderModel(pastStep ? pastStep.model : sides.before);
      return;
    }
    /* Reaching here means browse mode (the diff branch returned above). Clear the left column's books and switch the
     * mark vocabulary back to the `diffModels` set. */
    prevPastRef.current = null;
    setPastRenderModel(null);
    marksRef.current = DIFF_MARKS;
    const delta = diffModels(prev, model, { key: matchKeyRef.current });
    // Nothing changed at all: do nothing. No union, no rebuild, no relayout. **This is change detection**,
    // and it comes before any debounce: debounce stops "too frequent", this stops "nothing changed".
    // Edges count: a linking step changes no node, only adds edges, and that is the whole point of the step.
    if (!stirs(delta)) { settleNow(); return; }
    carryLastFrame(delta.resolved);
    pendingRef.current = delta;
    // The skin must be computed **here**: only now is the previous model still at hand (the next line replaces it).
    pendingSkinsRef.current = planSkins(delta, prev, model, profileRef.current);
    leftRef.current = new Set();
    // The gate closes until the curtain. The layout wait counts too: the screen holds the previous frame then, and it belongs to this switch.
    markBusy(true);
    setRenderModel(delta.model);
  }, [model, resume]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Diff marks are drawn hugging the primitives, so they need a "post-landing geometry" snapshot (node boxes + changed edge paths).
   *  **Not updated during the tween**: marks chasing the animation could not keep up and would mean nothing; they match once after landing. */
  const [diffGeom, setDiffGeom] = useState<DiffGeometry>(EMPTY_GEOM);
  /** The left column's geometry. The columns have different visible sets, so compound sizes and edge control points differ; each is measured. */
  const [pastGeom, setPastGeom] = useState<DiffGeometry>(EMPTY_GEOM);

  /** The set of nodes that should be visible now. **Do not use the `:visible` selector**: cytoscape caches visible(),
   *  and querying right after changing display returns the previous round (which made subview tightening not work at all).
   *  resolveView's result is the source of truth and always right. */
  const visibleNodes = useCallback((cy: any) => {
    const { visible } = resolvedRef.current;
    const left = leftRef.current;
    return cy.nodes().filter((n: any) => visible.has(n.id()) && !left.has(n.id()));
  }, []);

  /** Fit to "visible nodes ∪ layer plates". cy.fit only knows nodes, and plates extend beyond the nodes by design;
   *  without merging them in half a plate gets cut off. */
  const fitAll = useCallback((cy: any, coll?: any, animate = false) => {
    const vis = coll ?? visibleNodes(cy);
    // After tightening, wait a frame before fitting: right after landing cytoscape's bounding box cache is stale,
    // and fitting immediately (or animating to fit) computes against an outdated box with a clearly wrong zoom.
    const go = (eles: any, padding: number) => {
      // Once a frame is scheduled, guard against the instance disappearing meanwhile: a changed element set is a new
      // instance, the old one is destroyed at once, and this callback is still queued. Calling fit on a destroyed instance
      // blows up inside cytoscape on `isHeadless`, with a stack that does not show who scheduled the frame.
      // Do not zoom small graphs too far: a dozen nodes filling the screen look like coins with headline labels, not like a graph.
      const fit = () => {
        cy.fit(eles, padding);
        if (cy.zoom() > FIT_MAX_ZOOM) cy.zoom({ level: FIT_MAX_ZOOM, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
      };
      if (animate) requestAnimationFrame(() => { if (!cy.destroyed()) fit(); });
      else fit();
    };
    if (!viewRef.current.planes || platesRef.current.length === 0) {
      /* **Framing has one basis: the visible nodes.**
       *
       * It cannot fall back to `cy.fit()` (no collection = every element): during a transition "the half about to leave" is not
       * display:none yet and sits at the previous version's coordinates (the median move of one step is four digits), so framing
       * that box gives a big empty area.
       *
       * There used to be a `cy.fit()` fast path for "no filter and no exits", so **one graph had two bases**, and which one
       * depended on **whether the previous step had exits**: 1→2 had 17 exits → the camera it left used the node basis;
       * right after, 2→3 had none → it measured the all-elements basis (edges and edge labels included). The two boxes differ,
       * and "did the previous step have exits" has nothing to do with "how should this step be framed": the previous scene leaked into this one.
       * One basis makes framing a pure function of the visible set. */
      // Padding must leave room for the top-left toolbar row (36 high + 12 margin), or nodes at the top hide under the search box.
      if (vis.length) go(vis, compactRef.current ? 24 : FIT_PAD);
      return;
    }
    const nb = vis.boundingBox();
    let [x1, y1, x2, y2] = [nb.x1, nb.y1, nb.x2, nb.y2];
    for (const p of platesRef.current) for (const [x, y] of p.points) {
      x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y);
    }
    go({ x1, y1, x2, y2, w: x2 - x1, h: y2 - y1 }, compactRef.current ? 24 : FIT_PAD);
  }, [visibleNodes]);

  /** What to spotlight: the host's spotlighted classes (`emphasis`) override search hits; the rest dims (same as hover) and their
   *  labels rank first. The tucked-away half does not count. */
  const respot = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const em = emphasisRef.current;
    let ids = resolvedRef.current.hits;
    const hot = hotLayerRef.current;
    if (hot) {
      // A hovered layer name wins over search and emphasis while it lasts: that layer, and the edges inside it.
      const lid = (id: string) => layerOfRef.current.get(id) ?? profileRef.current.layers[0]?.id;
      ids = new Set();
      cy.nodes().forEach((n: any) => { if (lid(n.id()) === hot) ids.add(n.id()); });
      cy.edges().forEach((e: any) => { if (ids.has(e.source().id()) && ids.has(e.target().id())) ids.add(e.id()); });
    } else if (em?.nodeKinds?.length || em?.edgeKinds?.length) {
      const nk = new Set(em.nodeKinds ?? []), ek = new Set(em.edgeKinds ?? []);
      ids = new Set();
      if (nk.size) cy.nodes().forEach((n: any) => { if (nk.has(n.data('kind'))) ids.add(n.id()); });
      if (ek.size) cy.edges().forEach((e: any) => {
        if (ek.has(e.data('kind'))) { ids.add(e.id()); ids.add(e.source().id()); ids.add(e.target().id()); }
      });
    }
    const left = leftRef.current;
    painterRef.current?.spotlight(ids.size ? new Set([...ids].filter((id) => !left.has(id))) : null);
  }, []);

  /** Raise the flat coordinates to fraction `t`: positions and layer plates. A single-layer graph has none of this and returns as is. */
  const projectAt = useCallback((raw: Positions, t: number): { positions: Positions; plates: Plate[] } => {
    const layers = profileRef.current.layers;
    if (layers.length < 2) return { positions: { ...raw }, plates: [] };
    // Filtered by source: plates only enclose what is visible (see frame in planes.ts).
    const frame = isNarrowing(viewRef.current) ? resolvedRef.current.visible : null;
    return projectPlanes(raw, layerOfRef.current, layers, {}, t, frame);
  }, []);
  const showPlates = useCallback((plates: Plate[], alpha: number) => {
    platesRef.current = plates;
    plateAlphaRef.current = alpha;
    setPlates(plates);
    setPlateAlpha(alpha);
  }, []);

  /* ── Visibility: every action of a view switch lives here, never touching the instance or the element set ────────── */
  const applyView = useCallback((opts?: { fit?: boolean }) => {
    const cy = cyRef.current;
    if (!cy) return;
    const v = viewRef.current;
    const { visible, hits } = resolvedRef.current;
    const filtering = isFiltering(v);
    const left = leftRef.current;

    cy.batch(() => {
      if (!filtering) cy.nodes().removeStyle('display');
      else cy.nodes().forEach((n: any) => n.style('display', visible.has(n.id()) ? 'element' : 'none'));
      cy.nodes('.gb-hit').removeClass('gb-hit');
      for (const id of hits) cy.$id(id).addClass('gb-hit');
      /* Hide by kind. With a painter present it owns this (display untouched, being brought out is instant, see mute in paint.ts);
       * without a painter (compare columns, readability field off) there is no "brought out", so hide by kind directly. */
      const hn = new Set(v.hiddenNodeKinds ?? []), he = new Set(v.hiddenEdgeKinds ?? []);
      const byPainter = !diffRef.current && readableRef.current;
      if (!byPainter && hn.size) cy.nodes().forEach((n: any) => { if (hn.has(n.data('kind'))) n.style('display', 'none'); });
      kindOffRef.current = hideEdgesByKind(cy, byPainter ? new Set() : hn, byPainter ? new Set() : he, kindOffRef.current);
      painterRef.current?.mute(byPainter ? [...hn] : [], byPainter ? [...he] : []);
      cy.edges('.crosslayer').toggleClass('gb-planes', !!v.planes);
      /* The half tucked away after a transition: same path as view filtering (only display), so neither an instance
       * rebuild nor a relayout. That is why "removal" is cheap enough to need no new mechanism.
       * **Last in the whole batch**: the passes above write display wholesale by class or by collection, and in one
       * batch the last write wins. What is tucked away must have the last word. */
      for (const id of left) cy.$id(id).style('display', 'none');
      // The passes above wrote display wholesale by class / collection, so the past half must be hidden again (see hideGhosts).
      if (diffRef.current) hideGhosts(cy);
    });
    respot();

    /* When stacked, a source change makes plates close in / open up (coordinates stay, only the plates change). */
    if (v.planes && planeTRef.current > 0 && Object.keys(rawRef.current).length) {
      showPlates(litPlates(projectAt(rawRef.current, planeTRef.current).plates, shownIn(v)), plateAlphaRef.current);
    }

    // Strategy: global coordinates are the anchor. Entering a subview "tightens" the visible part once (no random init:
    // positions stay recognizable but are no longer sparse); leaving restores the global coordinates.
    const vis = visibleNodes(cy);
    const visEdges = vis.edgesWith(vis);
    /* **No tightening in diff**: tightening only applies to the main instance (right column), while the mirror lays down the
     * global `baseRef` coordinates. One tightening and the columns disagree, and "both columns share one set of coordinates" is the whole value of two columns. */
    const wantTighten = isNarrowing(v) && !v.planes && vis.length > 1 && vis.length <= TIGHTEN_MAX
      && !diffRef.current;
    if (wantTighten) {
      try {
        // Two kinds of subview, two ways to tighten:
        //  · structure remains (edges or nesting) → force layout, **no random init**, positions stay recognizable.
        //  · structure was filtered away (e.g. "axiom layer only" leaves a pile of unconnected nodes) → no relative
        //    arrangement to keep and force cannot pull it together, so lay it out as a grid.
        const structureless = visEdges.length === 0 && vis.filter((n: any) => !n.isChildless()).length === 0;
        const seed = vis.length <= SEED_MAX;
        if (!structureless && seed) {
          // The subgraph is "cut out" of the global layout, nodes are often separated by large hidden areas and it looks
          // empty. First scale the seed coordinates down to the proper density by node count, then let force resolve overlaps:
          // the relative arrangement (the "still recognizable" part) is kept and the holes are gone.
          const bb = vis.boundingBox();
          const want = Math.sqrt(vis.length) * NODE_PITCH;
          const k = want / Math.max(1, bb.w, bb.h);
          if (k < 1) {
            // Careful not to name the center cy: in this scope cy is the cytoscape instance.
            const mx = bb.x1 + bb.w / 2, my = bb.y1 + bb.h / 2;
            cy.batch(() => vis.forEach((n: any) => {
              const p = n.position();
              n.position({ x: mx + (p.x - mx) * k, y: my + (p.y - my) * k });
            }));
          }
        }
        // animate must be false: a layout on a **subset** like `eles.layout()` silently does nothing in cytoscape when
        // animated. Land synchronously + animate the viewport instead: looks the same, behaves deterministically.
        vis.union(visEdges).layout(structureless
          ? { name: 'grid', fit: false, animate: false, avoidOverlap: true, condense: true }
          : {
            name: 'fcose', quality: 'default', randomize: !seed, animate: false, fit: false,
            nodeSeparation: 45, idealEdgeLength: 60, nodeRepulsion: 8000,
            packComponents: true, tile: true, tilingPaddingVertical: 8, tilingPaddingHorizontal: 8,
          }).run();
        tightenedRef.current = true;
        if (opts?.fit !== false) fitAll(cy, vis, true);
        return;
      } catch { /* the subset layout rejects this combination; fall back to global coordinates */ }
    }
    if (tightenedRef.current) {
      cy.batch(() => {
        cy.nodes(':childless').forEach((n: any) => { const p = baseRef.current[n.id()]; if (p) n.position(p); });
      });
      tightenedRef.current = false;
    }
    if (opts?.fit !== false) fitAll(cy, vis);
  }, [fitAll, visibleNodes, respot, projectAt, showPlates]);

  /** Note "someone just touched it": breathing only runs while nobody does; this is the only criterion. */
  const touchInteraction = useCallback(() => { lastInteractionRef.current = Date.now(); }, []);

  /** A scene is playing: a switch from acceptance to curtain (including the layout wait), or any tween (including layer raise / flatten). */
  const labelsFrozen = useCallback(() => busyRef.current || tweenRef.current != null || planeTweenRef.current != null, []);

  /** Measure text width (screen px). The verdict needs the box width to judge right, and "what is judged" must be "what is drawn",
   *  so it measures with the drawing font instead of estimating. */
  const measureLabel = useCallback((text: string, px: number, bold = false): number => {
    let m = measureRef.current;
    if (!m) m = measureRef.current = { ctx: document.createElement('canvas').getContext('2d'), cache: new Map() };
    const key = `${bold ? 'b' : ''}${px}|${text}`;
    let w = m.cache.get(key);
    if (w === undefined) {
      if (!m.ctx) return text.length * px * 0.56;
      m.ctx.font = labelCss(px, bold);
      w = m.ctx.measureText(text).width;
      m.cache.set(key, w);
    }
    return w;
  }, []);

  /** The part of the name shown on the graph: truncated with "…" beyond `LABEL_MAX_EM` font sizes. Judging and drawing both use it,
   *  so the boxes match. Binary search for the longest prefix, cached by font size. */
  const fitCache = useRef(new Map<string, string>());
  const fitLabel = useCallback((text: string, px: number, bold = false): string => {
    const max = px * LABEL_MAX_EM;
    if (measureLabel(text, px, bold) <= max) return text;
    const key = `${bold ? 'b' : ''}${px}|${text}`;
    const hit = fitCache.current.get(key);
    if (hit !== undefined) return hit;
    const chars = [...text];
    let lo = 0, hi = chars.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (measureLabel(chars.slice(0, mid).join('').trimEnd() + '…', px, bold) <= max) lo = mid; else hi = mid - 1;
    }
    const out = chars.slice(0, lo).join('').trimEnd() + '…';
    fitCache.current.set(key, out);
    return out;
  }, [measureLabel]);

  /** A node's on-screen radius: label placement and drawing both avoid it. In browse mode nodes are drawn by paint.ts, and from far
   *  away heavy nodes are bigger than the stylesheet says (see HOLD_LEAF there), so use the drawn size. */
  const dotRadius = (ele: any): number =>
    Math.max(ele.renderedOuterHeight() / 2, painterRef.current?.radiusOf(ele.id()) ?? 0);

  /**
   * Draw text from the ledger onto the upper layer. Redrawn on every cytoscape redraw (pan, zoom, nodes moving in a tween):
   * positions are asked from cytoscape each time, so text always sticks to its node with no coordinate tracking of its own.
   * Opacity = the ledger opacity × the node's actual opacity right now (nodes fading in a transition take their text along).
   */
  const drawLabels = useCallback((cy: any) => {
    const lane = laneOf(cy);
    const cv = lane.canvas.current;
    if (!cv) return;
    /* **Size follows the container, with CSS size in pixels.** It used to be CSS `width:100%`: when the container narrowed (inspector
     * sliding out) the browser first **squashed the previous bitmap horizontally** and only snapped back on the next redraw. Nodes are in
     * cytoscape's layer (fixed pixels, not squashed), text and the selection ring in this one (squashed), so in the 200 ms the inspector
     * opens or closes, text crept left frame by frame and it looked like "the picture shifted". With fixed pixels this layer is only cropped, not moved a pixel. */
    const host = cv.parentElement;
    const w = host?.clientWidth ?? cv.clientWidth, h = host?.clientHeight ?? cv.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      cv.style.width = `${w}px`; cv.style.height = `${h}px`;
    }
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!readableRef.current || !cy || cy.destroyed()) return;
    const th = themeRef.current;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    /* Selection ring: drawn on the text layer, so it stays prominent when hover dims cytoscape's layer. Selection is "identity"
     * and does not share a channel with "attention". A soft glow + a solid ring, closing in from outside on entrance. Ring
     * first, text after, so text stays on top. */
    const now = performance.now();
    cy.nodes(':selected').forEach((n: any) => {
      if (!n.visible()) return;
      const t0 = ringsRef.current.get(n.id()) ?? 0;
      const k = Math.min(1, (now - t0) / RING_IN_MS);
      const e = 1 - Math.pow(1 - k, 3);
      const pad = RING_GAP + RING_IN_FROM * (1 - e);
      ctx.beginPath();
      if (n.isParent()) {
        const bb = n.renderedBoundingBox({ includeLabels: false });
        ctx.roundRect(bb.x1 - pad, bb.y1 - pad, bb.w + pad * 2, bb.h + pad * 2, 10);
      } else {
        const p = n.renderedPosition();
        ctx.arc(p.x, p.y, n.renderedOuterWidth() / 2 + pad, 0, Math.PI * 2);
      }
      ctx.strokeStyle = th.selected;
      ctx.globalAlpha = 0.22 * e;
      ctx.lineWidth = RING_WIDTH * 3.5;
      ctx.stroke();
      ctx.globalAlpha = e;
      ctx.lineWidth = RING_WIDTH;
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
    for (const [id, s] of lane.book.current) {
      if (s.o <= 0) continue;
      const ele = cy.$id(id);
      if (ele.empty() || !ele.visible()) continue;
      // Things in focus (hovered, its neighbors, selected) lose all translucency; the rest stay at 70% and dim along with
      // their nodes on hover.
      const painter = painterRef.current;
      const focused = ele.selected() || !!painter?.focused(id);
      const a = smoothstep(s.o) * ele.effectiveOpacity() * (focused ? 1 : LABEL_ALPHA * (painter?.dimOf(id) ?? 1));
      if (a < 0.02) continue;
      const p = ele.renderedPosition();
      const b = labelBox(p.x, p.y, dotRadius(ele), s.f, s.w, s.side);
      // Color is asked every frame: during a reskin nodes change color and the halo follows (a new color is a new sprite).
      const sp = labelSprite(fitLabel(ele.data('label') ?? '', s.f, ele.selected()), s.f, ele.selected(), tintOf(ele.pstyle('background-color').value), th, dpr,
        markOf(diffRef.current?.byId.get(id)?.kind));
      ctx.globalAlpha = a;
      ctx.drawImage(sp, b.x - sp.cssW / 2, b.y + 0.5 - sp.cssH / 2, sp.cssW, sp.cssH);
    }
    ctx.globalAlpha = 1;
  }, [fitLabel]);

  /** The selection ring's short entrance: redraw every frame, stop when done. */
  const runRing = useCallback((cy: any) => {
    if (ringRafRef.current != null) return;
    const step = () => {
      ringRafRef.current = null;
      if (cy.destroyed()) return;
      drawLabels(cy);
      const now = performance.now();
      if ([...ringsRef.current.values()].some((t0) => now - t0 < RING_IN_MS)) ringRafRef.current = requestAnimationFrame(step);
    };
    ringRafRef.current = requestAnimationFrame(step);
  }, [drawLabels]);

  /** Fade loop: each frame nudges every label's opacity toward its verdict and redraws if anything changed; stops when all arrive.
   *  Opacity is continuous: a verdict changed midway turns back from midway instead of jumping to the start. */
  const runLabelFade = useCallback(() => {
    if (labelRafRef.current != null) return;
    let last = performance.now();
    const step = (now: number) => {
      labelRafRef.current = null;
      const k = Math.max(0, now - last) / LABEL_FADE_MS;
      last = now;
      let any = false;
      for (const cy of [cyRef.current, mirrorRef.current]) {
        if (!cy || cy.destroyed()) continue;
        let moved = false;
        for (const s of laneOf(cy).book.current.values()) {
          if (s.next && s.o === 0) { s.side = s.next; s.next = undefined; s.t = 1; }
          if (s.o === s.t) continue;
          s.o = s.t > s.o ? Math.min(s.t, s.o + k) : Math.max(s.t, s.o - k);
          moved = true;
        }
        if (moved) { drawLabels(cy); any = true; }
      }
      if (!any) return;
      labelRafRef.current = requestAnimationFrame(step);
    };
    labelRafRef.current = requestAnimationFrame(step);
  }, [drawLabels]);

  /**
   * Re-verdict: measure the viewport, score every present node, place greedily, record verdicts in the ledger for the fade loop to play.
   * Labels already shown get the hysteresis bonus; while `breathing` a slow phase drift is added too. Both go through one
   * `bias`, so breathing is not a separate animation, it just lets the inequality flip now and then.
   */
  const replanLabels = useCallback((cy: any, breathing = false) => {
    if (!readableRef.current || cy.destroyed()) return;
    const el = containerRef.current;
    const w = el?.clientWidth ?? 0, h = el?.clientHeight ?? 0;
    if (!w || !h) return;
    const t0 = performance.now();
    const lane = laneOf(cy);
    const book = lane.book.current;
    const changed = diffRef.current?.byId;
    const inputs: LabelInput[] = [];
    const bias = new Map<string, number>();
    const hovered = painterRef.current?.hoveredId() ?? null;
    const painterNow = painterRef.current;
    cy.nodes().forEach((n: any) => {
      if (!n.visible()) return;
      // Hidden ones (not brought out) get no label and take nobody's place.
      if (painterNow?.hidden(n.id())) return;
      const id = n.id(), p = n.renderedPosition();
      const fontPx = labelFontOf(n.data('leaves') ?? 0);
      const label = fitLabel(n.data('label') ?? '', fontPx, n.selected());
      inputs.push({
        id, sx: p.x, sy: p.y, r: dotRadius(n), share: n.data('share') ?? 0,
        label, fontPx, w: measureLabel(label, fontPx, n.selected()),
        // In box mode a container is an area that should hold text; only points are obstacles.
        obstacle: n.isChildless(),
        side: book.get(id)?.next ?? book.get(id)?.side,
        // The selected and the hovered one: name always shown. Search hits only get a bonus (see below): forcing hundreds of hits
        // would pile into a heap, the same problem as a large hovered cluster.
        pinned: n.selected() || id === hovered,
      });
      const held = book.get(id);
      // The hovered hop and search hits are not forced (forcing a large cluster piles it up); they get a bonus to rank first, and those that do not fit still yield.
      const b = (held && (held.t === 1 || held.next) ? LABEL_HOLD : 0)
        + (painterRef.current?.focused(id) ? HOVER_BOOST : 0)
        + (changed?.has(id) ? CHANGE_BOOST : 0)
        + (breathing ? BREATH_AMPLITUDE * Math.sin(breathPhaseRef.current * 0.6 + idPhase(id)) : 0);
      if (b) bias.set(id, b);
    });
    const plan = planLabels(inputs, { viewport: { w, h }, padding: labelSpacingRef.current, bias });
    // Absent (invisible) ones leave the ledger: back on stage they fade in again from dark.
    const next = new Map<string, LabelState>();
    for (const [id, p] of plan) {
      const was = book.get(id);
      const o = was?.o ?? 0;
      // A lit label switched sides: fade out in place first, then light up at the new spot (the fade loop does the second half),
      // rather than jumping to the other side of the node. Dark labels go to the new spot directly.
      next.set(id, was && o > 0 && p.opacity === 1 && was.side !== p.side
        ? { o, t: 0, f: p.fontPx, w: p.w, side: was.side, next: p.side }
        : { o, t: p.opacity, f: p.fontPx, w: p.w, side: p.side });
    }
    lane.book.current = next;
    replanCostRef.current = performance.now() - t0;
    drawLabels(cy);
    runLabelFade();
  }, [drawLabels, runLabelFade, measureLabel, fitLabel]);

  /** Every viewport move lands here, coalesced by rAF (one drag / zoom only computes the final frame). While a scene plays there is
   *  no re-verdict: labels follow nodes via cytoscape's render event. Frozen or not is checked **when this frame actually runs**:
   *  one scheduled at the curtain runs after the show is over, and that is the one re-verdict. */
  const scheduleReadability = useCallback((cy: any) => {
    if (!readableRef.current || readabilityRafRef.current != null) return;
    readabilityRafRef.current = requestAnimationFrame(() => {
      readabilityRafRef.current = null;
      if (cyRef.current !== cy || cy.destroyed() || labelsFrozen()) return;
      replanLabels(cy);
      // The diff left column is judged too: both columns share one viewport, a move in one is a move in both.
      const m = mirrorRef.current;
      if (diffRef.current && m && !m.destroyed()) replanLabels(m);
    });
  }, [labelsFrozen, replanLabels]);

  /** Entry for viewport events: if a re-verdict is cheap, follow every frame (as above); if expensive, judge once after it stops. */
  const scheduleViewportReadability = useCallback((cy: any) => {
    if (replanCostRef.current <= LABEL_REPLAN_BUDGET_MS) { scheduleReadability(cy); return; }
    if (settleTimerRef.current != null) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null;
      if (cyRef.current === cy && !cy.destroyed()) scheduleReadability(cy);
    }, LABEL_SETTLE_MS);
  }, [scheduleReadability]);

  /**
   * Hover: focus one element plus its hop: for a node that is the node, its neighbors and connected edges; for an edge, the edge and both ends.
   * Focused names are always shown and lose all translucency; the rest **dims only slightly** (selected nodes too: they stand out
   * through the ring on the text layer). How it plays on screen is in paint.ts: the whole graph times an opacity, the hop drawn again
   * on top, no element style changed. **Browse mode only**: diff columns are two instances, and dimming one column would break
   * "unchanged things are the same pixel in both columns" (and drawing there is not paint.ts's business anyway).
   */
  const applyHover = useCallback((cy: any, target: any | null, fade = true) => {
    const painter = painterRef.current;
    if (cy.destroyed() || !painter) return;
    painter.hover(diffRef.current ? null : target, !fade);
    // The forced set changed: re-verdict right away (no rAF wait), so labels follow the hand.
    if (readableRef.current && !diffRef.current && !labelsFrozen()) replanLabels(cy);
  }, [labelsFrozen, replanLabels]);

  const emphasisKey = JSON.stringify(emphasis ?? null);
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || cy.destroyed() || diffRef.current) return;
    respot();
    if (readableRef.current && !labelsFrozen()) replanLabels(cy);
  }, [emphasisKey, respot, labelsFrozen, replanLabels]);

  /** Hover entry. Leaving does not clear at once: sweeping between nodes, the brief "nothing hovered" in between would flash the
   *  dimming off and on. Wait a moment; moving onto a new element meanwhile switches straight to it. Hover is disabled while a scene plays. */
  const setHover = useCallback((cy: any, target: any | null) => {
    if (hoverOutRef.current != null) { clearTimeout(hoverOutRef.current); hoverOutRef.current = null; }
    if (labelsFrozen()) { applyHover(cy, null, false); return; }
    if (target) {
      if (painterRef.current?.hoveredId() != null) { applyHover(cy, target); return; }
      hoverOutRef.current = setTimeout(() => { hoverOutRef.current = null; applyHover(cy, target); }, HOVER_IN_MS);
      return;
    }
    hoverOutRef.current = setTimeout(() => { hoverOutRef.current = null; applyHover(cy, null); }, HOVER_OUT_MS);
  }, [labelsFrozen, applyHover]);

  /** Idle breathing: a self-rescheduling setTimeout chain, not a permanent RAF loop. When nobody is watching the cost is
   *  "compute once every few seconds", not "compute every frame". The same discipline as "no permanent animation" for the
   *  diff overlay in style.ts, kept a cheaper way: a low-frequency timer instead of a frame loop, yielding at once to any
   *  interaction or scene. */
  const armBreath = useCallback((cy: any) => {
    if (!readableRef.current || breathTimerRef.current != null) return;
    const tick = () => {
      breathTimerRef.current = null;
      const live = cyRef.current;
      if (!live || live !== cy || live.destroyed() || diffRef.current) return;
      const idleFor = Date.now() - lastInteractionRef.current;
      if (idleFor < BREATH_IDLE_MS) {
        breathTimerRef.current = setTimeout(tick, BREATH_IDLE_MS - idleFor);
        return;
      }
      if (!labelsFrozen()) {
        breathPhaseRef.current += 1;
        replanLabels(live, true);
      }
      breathTimerRef.current = setTimeout(tick, BREATH_INTERVAL_MS);
    };
    breathTimerRef.current = setTimeout(tick, BREATH_IDLE_MS);
  }, [labelsFrozen, replanLabels]);

  /* Pure look changes (theme, palette, node size) only swap the stylesheet: no rebuild, no relayout. cytoscape keeps inline values on
   * elements when swapping (keepBypasses), so the transition's frame 0 and the label channel stay as they are. */
  useEffect(() => {
    const cy = cyRef.current;
    if (cy && !cy.destroyed()) cy.style(sheetFor(!!diffRef.current));
    const m = mirrorRef.current;
    if (m && !m.destroyed()) m.style(sheetFor(true));
    // Node size changed, so label anchors move; the readability field toggled, so who draws text changes. Either way, re-verdict once.
    if (cy && !cy.destroyed()) { if (readable) scheduleReadability(cy); else drawLabels(cy); }
  }, [lookProfile.nodePalette, lookProfile.edgePalette, lookProfile.nodeSize, lookProfile.edgeWidth, lookProfile.placeholderFlags, theme, nodeScale,
    readable, sheetFor, scheduleReadability, drawLabels]);

  /* Semantic edge strength: one redraw only. */
  useEffect(() => { painterRef.current?.repaint(); }, [semanticOpacity]);

  /* Label spacing is a pure verdict parameter: no stylesheet swap, just a re-verdict. */
  useEffect(() => {
    const cy = cyRef.current;
    if (cy && !cy.destroyed()) scheduleReadability(cy);
  }, [labelSpacing, scheduleReadability]);

  /**
   * Arm the **mirror**: form the four groups of the "presence" channel and write their base points.
   *
   * Shares `presenceGroups` with the main instance because both face the same problem, each comparing its own
   * version. The mirror has no reskin path (the left column's skin is fixed by its own element table), so only presence.
   * Returns the undo key; without a mirror returns null, and `syncMirror` aligns it in one go at the curtain.
   */
  const armMirror = useCallback((live: boolean) => {
    const m = mirrorRef.current;
    if (!m || m.destroyed()) return null;
    const groups = presenceGroups(m, live, marksRef.current);
    m.batch(() => { for (const n of FADE_NAMES) groups[n].style('opacity', FADE_BASE[n]); });
    return {
      groups,
      disarm: () => {
        try {
          if (m.destroyed()) return;
          m.batch(() => { for (const n of FADE_NAMES) groups[n].removeStyle('opacity'); });
        } catch { /* the instance may already be gone */ }
      },
    };
  }, []);

  /** Copy three things from the main instance to the mirror: coordinates, visibility, viewport. **No fit**: sharing one framing
   *  is the only value of two columns, and a mirror framing itself would throw that away. */
  const syncMirror = useCallback(() => {
    const m = mirrorRef.current;
    if (!m || m.destroyed()) return;
    const cy = cyRef.current;
    const { visible } = resolvedRef.current;
    const filtering = isFiltering(viewRef.current);
    m.batch(() => {
      /* **During a tween coordinates belong to the frame loop.** `syncMirror` is called on mirror mount, view change and container
       * resize, and all of those happen during a switch; `baseRef` then still holds the previous round's target coordinates,
       * and writing them would yank the moving left column back to the previous frame. */
      if (!busyRef.current) {
        m.nodes(':childless').forEach((n: any) => { const p = baseRef.current[n.id()]; if (p) n.position(p); });
      }
      /* **Always write display explicitly, never removeStyle.** Measured: after `removeStyle('display')`
       * the `node.flat.container` nodes report `visible()` false (the inline value is gone and so is the computed
       * one), so no container on the left is drawn; and once both ends of a containment edge are invisible,
       * cytoscape does not draw the edge either. That is how **the left column ended up with no edges at all**.
       * Writing explicit values does not depend on that fallback path. */
      m.nodes().forEach((n: any) => n.style('display', !filtering || visible.has(n.id()) ? 'element' : 'none'));
      // The mirror is compare mode's left column and has no painter: hide by kind directly (same rule as the right column, see applyView).
      const hn = new Set(viewRef.current.hiddenNodeKinds ?? []), he = new Set(viewRef.current.hiddenEdgeKinds ?? []);
      if (hn.size) m.nodes().forEach((n: any) => { if (hn.has(n.data('kind'))) n.style('display', 'none'); });
      mirrorKindOffRef.current = hideEdgesByKind(m, hn, he, mirrorKindOffRef.current);
      /* No need to hide "only in new": the left column draws **the old version's own element table**, those are not even present.
       * But after the scene the leaving half of this switch is tucked away: the same thing as the right column's `leftRef`.
       * **Last**: in one batch the last write wins. */
      for (const id of leftPastRef.current) m.$id(id).style('display', 'none');
    });
    if (cy && !cy.destroyed()) {
      syncingRef.current = true;
      m.viewport({ zoom: cy.zoom(), pan: { ...cy.pan() } });
      syncingRef.current = false;
    }
    /* **No geometry published before the scene ends.** `syncMirror` is called on mirror mount, view change and container
     * resize, and all of those happen during a switch. What gets measured then is half-done ("new elements still piled at the
     * origin, old ones at the previous frame"); publishing it would paste the glows just taken down back onto a moving graph.
     * The curtain's `syncMirror` runs after `markBusy(false)`, so it still publishes. */
    if (!busyRef.current) setPastGeom(measureDiffGeom(m, leftPastRef.current));
  }, []);

  /* ── Transition: pour coordinates in, interpolated ─────────────────────────────────────────
   *
   * cytoscape's animation API is not used anywhere. Coordinates are computed by the library and poured in (preset),
   * so "motion" is pouring the interpolated result every frame. That also sidesteps `eles.layout({animate:true})`
   * silently failing (see the end of the README), because cytoscape is never asked to move anything itself.
   *
   * Only leaves are poured: compound parent boxes are derived by cytoscape from their children, so boxes growing / reshaping /
   * merging come for free. */
  /** Element → detail panel. Clicking a node and clicking a diff halo take the same path; do not write it twice. */
  const selectEle = useCallback((el: any) => {
    if (!el || el.empty?.()) return;
    const d = el.data();
    if (d.id === VIRTUAL_ROOT) return;
    setSelected({
      id: d.id, label: d.label, kind: d.kind, layer: d.layer, origin: d.origin,
      container: builtRef.current.containers.has(d.id),
      flags: (el.classes() as string[]).filter((c) => !['gb-node', 'flat', 'container', 'gb-hit', d.kind].includes(c)),
      detail: d.detail ?? null,
    });
  }, []);

  const cancelFrames = useCallback(() => {
    const tw = tweenRef.current;
    if (tw) { cancelAnimationFrame(tw.raf); clearTimeout(tw.safety); tweenRef.current = null; }
  }, []);
  /** Someone moved the camera mid-flight (wheel, drag, another search): stop right there, the hand beats the animation. */
  const cancelFly = useCallback(() => {
    if (flyRef.current != null) { cancelAnimationFrame(flyRef.current); flyRef.current = null; }
  }, []);


  /**
   * **Write this transition's frame 0 to the canvas, then wait.**
   *
   * It does three things, none needing coordinates: form the four "presence" groups, compute the reskin style tweens, and
   * write both channels' **base points** (entering opacity=0, leaving opacity=1, reskins covered with old values). So in the
   * frames between the union mounting and the layout finishing, the picture is identical to the last frame before the switch:
   * a slower layout only lingers longer on the previous frame, instead of first flashing "the new stuff is already here".
   *
   * Groups and tweens are computed once and used directly by the frame loop.
   */
  const armTransition = useCallback((cy: any, live = true) => {
    armedRef.current?.disarm();
    /* **Read, do not consume.** Arming may happen more than once: toggling boxes / lines before layout finishes rebuilds the instance
     * and arms again. Consuming it would leave the second arm an empty skin list, so positions and opacity play while the reskinned
     * batch jumps to its new color on frame 0. This list lives and dies with the delta and is rewritten by that effect on each switch.
     * Likewise when `live` is false (layout algorithm changed, "Recompute" pressed) none of it should be used: it is left over from
     * the **previous** switch. */
    const changes = live ? pendingSkinsRef.current : [];
    const marks = marksRef.current;
    const groups = presenceGroups(cy, live, marks);
    const skins = planSkinTweens(cy, changes);
    cy.batch(() => {
      /* These are **absolute values** and override the stylesheet's opacity for these elements. One known edge case: in 2.5D
       * `edge.crosslayer.gb-planes` is normally 0.55 and on exit first brightens to 1 before fading. Fixing it would mean
       * reading each element's own base opacity, exactly the kind of code rule ④ forbids. Not worth it; noted here. */
      for (const n of FADE_NAMES) groups[n].style('opacity', FADE_BASE[n]);
      // Interpolatable ones take p=0 (the old value); those with no in-between get the old value directly.
      for (const g of skins) g.eles.style({ ...sampleSkinStyle(g.tween, 0), ...g.steps });
    });
    const disarm = () => {
      if (armedRef.current?.disarm === disarm) armedRef.current = null;
      try {
        if (cy.destroyed()) return;
        cy.batch(() => {
          for (const n of FADE_NAMES) groups[n].removeStyle('opacity');
          // Inline styles sit above classes, so removing them is correct; no "switch back" fix-up needed.
          for (const g of skins) g.eles.removeStyle(g.props);
        });
      } catch { /* the instance may be gone; then there is nothing to give back */ }
    };
    const armed = { groups, skins, changes, disarm };
    armedRef.current = armed;
    return armed;
  }, []);

  /** Write a set of coordinates to the canvas and update the "what is on screen" ledger. */
  const applyPositions = useCallback((cy: any, pos: Positions, settle: boolean) => {
    cy.batch(() => {
      cy.nodes(':childless').forEach((n: any) => { const p = pos[n.id()]; if (p) n.position(p); });
    });
    // Only diff mode needs this geometry; measuring otherwise is wasted (and not cheap on large graphs).
    // Measure only after landing: mid-tween measuring cannot keep up and means nothing, and compound sizes and edge control
    // points are not final until the children finish moving.
    if (settle && diffRef.current) setDiffGeom(measureDiffGeom(cy, leftRef.current));
  }, []);

  /** Land directly, no animation. */
  const settleTo = useCallback((cy: any, target: Positions, after?: () => void) => {
    dispRef.current = { ...target };
    applyPositions(cy, target, true);
    after?.();
  }, [applyPositions]);

  /**
   * Play one union transition.
   *
   * Wall-clock time is **the only input**; all three channels are pure functions of it:
   *   position   base + Σ(track progress × vector); base is the previous frame's position, the end is always the union coordinates
   *   presence   four envelopes, each `base + Σ(track progress × increment)`, four batch style calls per frame
   *   look       old skin → new skin, progress is the "arrive" track (rule ③)
   *
   * The **frame 0 of the last two is not written here** but in `armTransition`, the moment the union mounts.
   * This only plays from frame 0 on.
   *
   * The camera rides the same timeline as the content: open up to the union framing, then close in to the new framing (open / close legs).
   */
  const playTransition = useCallback((
    cy: any, union: Positions,
    /** @param cameraPlaced the transition already placed the camera; the caller **must not fit again**: another fit is
     *  one extra jump at the end. */
    after?: (cameraPlaced: boolean) => void,
  ) => {
    const spec = resolveSpec(animateRef.current);
    const delta = pendingRef.current;
    const pastDelta = pendingPastRef.current;
    pendingRef.current = null;
    pendingPastRef.current = null;
    cancelFrames();
    cancelFly();

    /**
     * Tuck away the leaving half of this switch: nodes and edges together, **selected by class**, the most precise (edge removals included).
     *
     * **Select by the mark set used this time.** In diff mode `gb-removed` means "this is a change",
     * something to look at; tucking it away would leave a hole in both columns. What leaves this time is `gb-step-removed`.
     * Picking the wrong set does not tuck away a few too few; it hides a whole field of what the user is looking at.
     *
     * **No switch does not mean touch nothing.** Changing the layout algorithm, pressing "Recompute" and dragging the fusion slider all
     * come here without a delta, and "leaving" only happens in a switch. Clearing the list would let the very next `applyView`
     * `removeStyle('display')` put the half tucked away by the previous switch back on stage: **press
     * "Recompute" and deleted nodes come back to life.**
     */
    const collectLeft = () => {
      if (!delta && !pastDelta) return;
      leftRef.current = goneIn(cy, marksRef.current);
      leftPastRef.current = goneIn(mirrorRef.current, marksRef.current);
    };
    /* **What is tucked away is crossed off the "previous frame" ledger.** `dispRef` records what is on screen right now and where; the
     * leaving half drifts off and is hidden, and its last coordinates (drifted half a graph away) are nothing on screen.
     * Keeping them only shows up when it **comes back**: next time it enters as new, mounting seats it at the stale ledger
     * coordinates and planning treats it as an anchor "present in the previous frame", so its children grow from that point off the graph.
     * A step with only additions starts "arrive" almost at once, so for an instant the screen is full of long lines flung off the graph. */
    const forgetLeft = () => {
      for (const id of leftRef.current) delete dispRef.current[id];
    };

    /* ── Frame 0 has long been on the canvas ────────────────────────────────────────────
     *
     * The "presence" and "look" channels were in place the moment the union mounted (`armTransition`); this just keeps
     * playing. The path that skips mounting (changed layout algorithm, "Recompute": element set unchanged, so no instance
     * rebuild) fills it in now with the same function, so both paths give the same frame 0. */
    const armed = armedRef.current ?? armTransition(cy, !!delta);
    const { groups, skins: skinGroups } = armed;
    /* The mirror's frame 0. It is another instance with another delta, but **shares one timeline**: the one `sampleTransition`
     * in the frame function below feeds both sides. So "both sides change together" is not two animations
     * but one sample feeding two places.
     *
     * **Ask who the mirror is every frame; do not pin it when the scene starts.** The two instances mount asynchronously and
     * independently (each awaits an import), with no guaranteed order, and switching views or layout algorithms replaces the
     * mirror midway. Pinning it means a late mirror misses the whole scene: that is where "sometimes after many clicks the
     * animation is gone" came from. */
    let mirrorAt: { m: any; leaves: any; armed: ReturnType<typeof armMirror> } | null = null;
    const mirrorNow = () => {
      const m = mirrorRef.current;
      if (!m || m.destroyed()) return null;
      if (mirrorAt?.m !== m) mirrorAt = { m, leaves: m.nodes(':childless'), armed: armMirror(!!pastDelta) };
      return mirrorAt;
    };
    mirrorNow();
    /* A closure is not a style choice: in straight-line code TS would narrow `mirrorAt` to null all the way
     * (it is only assigned inside `mirrorNow`). */
    const disarmMirror = () => { mirrorAt?.armed?.disarm(); };

    const planOpts = {
      skins: armed.changes, spec: spec ?? undefined,
      // "Where does it grow from" asks about parent-child relations **on screen**: the virtual root is in the element table,
      // not in the model. The canvas holds the authoritative one, so hand it that.
      parentOf: (id: string) => builtRef.current.parentOf.get(id),
      // Who enters and leaves follows the marks on screen (the virtual root is not in the delta). No switch means no entries
      // or exits: the marks on the union are left over, and planning by them would replay the previous batch.
      presence: delta ? presenceOf(cy, marksRef.current) : undefined,
    };

    const tooBig = !!spec && Object.keys(union).length > spec.maxNodes;
    // No animation in a subview: applyView is about to "tighten" the visible part (a subset layout), and both would
    // fight over the same coordinates, last write wins. Viewing one layer is not a subview (see isNarrowing).
    const filtering = isNarrowing(viewRef.current);
    // If the page is in the background, land directly: rAF is suspended there, nobody watches, and the animation would stall midway.
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';

    // Empty delta = the data did not change, only the coordinates did ("Recompute" does this). That is still a real move and
    // should play too. It used to land directly here, making Recompute the only teleporting action of all, while it is the one
    // with the biggest moves.
    if (!spec || tooBig || filtering || hidden) {
      onTransitionRef.current?.({
        ...planTransition(delta, dispRef.current, union, planOpts).report,
        layoutMs: layoutMsRef.current, animated: false,
      });
      collectLeft();
      armed.disarm();
      disarmMirror();
      settleTo(cy, union, () => after?.(false));
      forgetLeft();
      return;
    }

    /* **Take diff marks down before the scene, measure again and put them back after.**
     *
     * Glows hug **post-landing** geometry: compound sizes and edge control points change every frame of the tween and can
     * only be computed once cytoscape has laid things out. Left up, they would be pinned at the previous frame's position,
     * smeared together with the moving primitives.
     *
     * Coordinates are different: those can be computed every frame, so both columns move together as usual (see the frame function).
     * What comes down is "measured geometry", not "computed coordinates". */
    const dropMarks = () => { setDiffGeom(EMPTY_GEOM); setPastGeom(EMPTY_GEOM); };

    const t = planTransition(delta, dispRef.current, union, planOpts);
    onTransitionRef.current?.({ ...t.report, layoutMs: layoutMsRef.current, animated: t.worth });
    if (!t.worth) { collectLeft(); armed.disarm(); disarmMirror(); settleTo(cy, union, () => after?.(false)); forgetLeft(); return; }
    if (diffRef.current) dropMarks();

    /* ── The camera rides **the same timeline** as the nodes ──────────────────────────────────
     * It used to wait for the nodes to finish before fitting, so the camera was a full beat late: nodes finished moving out of view
     * while people still saw the old framing. The camera must move with the content.
     *
     * Measuring the target framing: put nodes at their end, **exclude the leaving half first**, fit once, record
     * zoom/pan, then restore everything. Excluding the leavers is the key: the union's bounding box is a ring bigger than the
     * new version, and framing the union leaves a big empty area (the "shrinking into a corner" feeling).
     * Borrowing fitAll beats computing from bounding boxes: the visible set, 2.5D plates and padding all live there. */
    const cam = () => ({ zoom: cy.zoom(), pan: { ...cy.pan() } });
    const v0 = cam();
    const leftBefore = leftRef.current;
    applyPositions(cy, union, false);
    leftRef.current = new Set();          // only affects what visibleNodes returns, display untouched
    fitAll(cy);
    const vU = cam();                     // union framing: includes the half about to vanish
    leftRef.current = t.leaving;
    fitAll(cy);
    const v1 = cam();                     // new version framing
    leftRef.current = leftBefore;
    applyPositions(cy, sampleTransition(t, 0).pos, false);
    cy.viewport(v0);

    /* The camera moves the **framing box**, not the two numbers zoom/pan.
     *   ① zoom is multiplicative; linear interpolation runs visibly fast / slow midway, while the box half-width interpolated geometrically is even.
     *   ② pan is coupled with zoom; interpolating each separately makes the picture slide oddly while zooming.
     * Converted to "center + half-width", the center goes linear and the half-width geometric, independent of each other. */
    const W = cy.width() || 1, H = cy.height() || 1;
    /* **When "open" does not happen there is no union framing to pass through.**
     *
     * The camera is the sum of two legs: `(rU−r0)·open + (r1−rU)·close`. Only when both finish is the sum `r1−r0`.
     * When a step only reskins, "open" is trimmed away entirely as an empty beat (no falling leaves, no moves, nothing to
     * open up and show), the first leg never applies, the camera stops at `r0+(r1−rU)` and the curtain's `viewport(v1)` yanks it
     * once more: another jump. Collapsing the waypoint to `r0` makes the sum of both legs always `r1−r0`. */
    const r0 = toRect(v0, W, H), r1 = toRect(v1, W, H);
    const rU = t.score.open.to > t.score.open.from ? toRect(vU, W, H) : r0;

    /** The one way out: finished, instance gone, page sent to the background, all land here. */
    const finish = () => {
      const tw = tweenRef.current;
      if (tw) { cancelAnimationFrame(tw.raf); clearTimeout(tw.safety); }
      tweenRef.current = null;
      if (cyRef.current !== cy || cy.destroyed()) { armedRef.current = null; return; }
      collectLeft();
      armed.disarm();
      disarmMirror();
      /* At the curtain, no coordinates for "things about to hide": they have drifted away while the union still records
       * their original positions, and writing those is a yank of hundreds of units. The next line sets display:none and they
       * cannot be drawn, but "the whole transition has no jump" should not rely on "nobody sees it anyway". */
      const settled: Positions = { ...union };
      for (const id of t.leaving) { const q = dispRef.current[id]; if (q) settled[id] = q; }
      // The camera already reached v1 during the scene; this only lands it exactly. **Nobody may fit again.**
      settleTo(cy, settled, () => { cy.viewport(v1); after?.(true); });
      forgetLeft();
    };

    /** The batch whose coordinates are written every frame. **Computed once outside the loop**: see the comment in the frame function. */
    const leaves = cy.nodes(':childless');
    /* The mirror moves along. "Unchanged things are the same pixel in both columns" is the whole value of two columns, **and it must
     * hold during animation too**: if only the right column moved, the columns would be out of step for the second of the tween,
     * exactly the second someone stares at. The cost is one more position write per frame (left nodes ≤ union), no re-measuring. */
    let present = false;
    /* **Beats this step does not have take no time.** `span` is what remains after trimming the empty start; the window is already
     * normalized back to [0,1], and here wall-clock time is scaled back by the same ratio, so the two scalings cancel: each beat
     * takes exactly as many milliseconds as in the full storyboard, the whole scene just ends earlier (a reskin-only / growth-only step ≈ 648 ms). */
    const span = spec.duration * t.score.span;
    const t0 = performance.now();
    const frame = (now: number) => {
      // A frame leaking in after the curtain is ignored: finish cleared tweenRef, and going on would read a fallback timer
      // that no longer exists. On the normal path cancelAnimationFrame stops it; this only keeps a timing accident from
      // becoming an exception.
      if (!tweenRef.current) return;
      if (cyRef.current !== cy || cy.destroyed()) { finish(); return; }
      // **Time only.** Curves belong to each track (the storyboard), so there is no longer "ease first, then compare
      // against times": that is exactly the trap that used to squash every time to the start.
      const raw = Math.min(1, (now - t0) / span);
      const { pos, fade, open, close } = sampleTransition(t, raw);
      // Written in place. `{...dispRef.current, ...pos}` rebuilds a table of thousands of keys every frame, pure garbage:
      // nobody holds the previous frame's snapshot.
      Object.assign(dispRef.current, pos);
      cy.batch(() => {
        // `leaves` is computed once outside the loop: the element set does not change during a transition (if it did, it is a new
        // instance and the two lines above finish at once). Inside the frame it would be 60 selector queries + 60 new collections per second.
        leaves.forEach((n: any) => { const q = pos[n.id()]; if (q) n.position(q); });
        // Four envelopes, four batch style calls per frame (rule ④). Writing per element is hundreds per frame.
        // Overshooting easing can leave [0,1] slightly, and cytoscape rejects out-of-range opacity (drops it all and warns).
        for (const n of FADE_NAMES) groups[n].style('opacity', clamp01(fade[n]));
        /* Everything "now" is driven by one number: as far as new things have appeared, the old skin has become the new one.
         * Those with no in-between (dashed→solid) drop the old value covering them on the frame this envelope leaves 0:
         * that is the start of the "arrive" beat, the only "now it begins" of the whole scene. */
        for (const g of skinGroups) g.eles.style(sampleSkinStyle(g.tween, fade.in));
        if (!present && fade.in > 0) {
          present = true;
          for (const g of skinGroups) if (g.stepProps) g.eles.removeStyle(g.stepProps);
        }
      });
      /* If the mirror changed, adopt the new one on the spot (and give it frame 0's base points); if there is none, skip it this frame. */
      const mir = mirrorNow();
      if (mir) {
        mir.m.batch(() => {
          mir.leaves.forEach((n: any) => { const q = pos[n.id()]; if (q) n.position(q); });
          // The same fade, so entries and exits on both sides fit exactly; one side never finishes fading before the other starts.
          if (mir.armed) for (const n of FADE_NAMES) mir.armed.groups[n].style('opacity', clamp01(fade[n]));
        });
      }
      // Open first, close after: first to the union framing (room to watch falling leaves / splits), then to the new framing
      // (dropping the empty space). The two legs add up, the same model as element motion.
      cy.viewport(toView({
        cx: r0.cx + (rU.cx - r0.cx) * open + (r1.cx - rU.cx) * close,
        cy: r0.cy + (rU.cy - r0.cy) * open + (r1.cy - rU.cy) * close,
        hw: r0.hw * Math.pow(rU.hw / r0.hw, open) * Math.pow(r1.hw / rU.hw, close),
      }, W, H));
      if (raw < 1) {
        tweenRef.current = { raf: requestAnimationFrame(frame), safety: tweenRef.current!.safety };
        return;
      }
      finish();
    };
    // **A fallback timer, not a fuse.** When the page goes to the background the browser suspends rAF entirely: the transition stops
    // midway, and the "curtain" is a step with side effects (tuck the past half away, write back dispRef, measure diff geometry).
    // setTimeout is only throttled in the background and still fires.
    tweenRef.current = {
      raf: requestAnimationFrame(frame),
      safety: setTimeout(finish, span + 250),
    };
  }, [applyPositions, applyView, settleTo, cancelFrames, cancelFly, armTransition, fitAll, visibleNodes]);

  useEffect(() => cancelFrames, [cancelFrames]);

  /* ── Layout: measure sizes → engine (instant on a cache hit) → pour coordinates → apply the view ─────────── */
  const requestLayout = useCallback(async (cy: any, force = false) => {
    /* **Measure the graph itself, not its current look.** Node size is a look knob; if it went into sizes, the same data would
     * solve to different layouts at different slider positions. So swap to the 1× stylesheet, measure, restore; all synchronous,
     * with no frame showing "how it looked while measuring". On-screen text is on another layer and never comes in here. */
    const scaled = !diffRef.current && nodeScaleRef.current !== 1;
    if (scaled) cy.style(sheetFor(false, 1));
    /* The reskin channel is covering the old skin's width and height (frame 0 is the previous frame). Layout needs the **new skin's**
     * size; measuring the old one, the same data switched from different previous versions would solve differently. So remove before
     * measuring and put back after; all synchronous, no frame drawn at the new size. */
    const sizeProps = SKIN_SIZE_PROPS.join(' ');
    const worn: [any, Record<string, string>][] = [];
    for (const g of armedRef.current?.skins ?? []) {
      if (!SKIN_SIZE_PROPS.some((p) => g.props.split(' ').includes(p))) continue;
      g.eles.forEach((el: any) => {
        worn.push([el, Object.fromEntries(SKIN_SIZE_PROPS.map((p) => [p, el.style(p)]))]);
      });
    }
    // Sizes must be measured with everything visible: hidden nodes measure 0×0.
    // (cytoscape caches label sizes; one no-op display toggle forces a recompute.)
    cy.batch(() => {
      for (const [el] of worn) el.removeStyle(sizeProps);
      cy.nodes().style('display', 'none'); cy.nodes().removeStyle('display');
    });
    const dims: Record<string, { w: number; h: number }> = {};
    cy.nodes(':childless').forEach((n: any) => {
      const d = n.layoutDimensions({ nodeDimensionsIncludeLabels: true });
      dims[n.id()] = { w: d.w, h: d.h };
    });
    dimsRef.current = dims;
    if (scaled) cy.style(sheetFor(false));
    if (worn.length) cy.batch(() => { for (const [el, v] of worn) el.style(v); });
    /* **Hide the past half again right after measuring.** The "show everything, then undo" above makes cytoscape recompute
     * label sizes (hidden nodes measure 0×0), at the cost of clearing all display values, which wipes the hiding done on mount.
     * It is restored here, before the first await: from the union mounting to the curtain, not a single frame of the right
     * column draws both versions. */
    if (diffRef.current) hideGhosts(cy);
    const run = ++runRef.current;
    // This run pays off the owed relayout (reading the latest props right now); if the debt was a "Relayout", only a forced run counts.
    if (owedLayoutRef.current && (force || !owedLayoutRef.current.force)) owedLayoutRef.current = null;
    const t0 = performance.now();
    setProg({ done: 0, total: 0 });
    const runnerPool = pool ?? inlinePool;

    /* Both sides' exits. They have no place in the new round of coordinates (they only existed in the previous version); restoring the
     * previous frame lets them fade out in place. Otherwise they drop to (0,0) and then fade, a line flung from the graph to the origin. */
    // Who exits asks only the marks on screen (see presenceOf): the virtual root, absent from the data, fades in place too.
    const leaving = pendingRef.current || pendingPastRef.current
      ? new Set([...goneIn(cy, marksRef.current), ...goneIn(mirrorRef.current, marksRef.current)])
      : new Set<string>();
    const common = {
      dims, layoutName: 'cose-bilkent' as const, pool: runnerPool,
      namespace: profile.id, owner: layoutOwner,
    };

    /** This version's own coordinates. Order as in the `layout` prop: full preset → local cache → solve (fresh / continue).
     *  Browse and compare's new side **use the same function**: same version, same source, so toggling compare moves no node on the new side.
     *  "Relayout" (force) skips all three and deliberately takes no seed: with one it would converge back to what is on screen, as if not pressed. */
    const ownLayout = async (els: CyElement[]): Promise<{ positions: Positions; source: LayoutInfo['source'] }> => {
      const ids = placedIdsOf(els);
      const preset = presetRef.current;
      if (!force && preset && ids.length && ids.every((id) => preset[id])) {
        const positions: Positions = {};
        for (const id of ids) positions[id] = { x: preset[id].x, y: preset[id].y };
        return { positions, source: 'preset' };
      }
      let known: Positions | undefined;
      if (!force && layoutModeRef.current === 'continue') {
        const all = { ...preset, ...rawRef.current };
        known = {};
        for (const id of ids) if (all[id]) known[id] = all[id];
        if (!Object.keys(known).length) known = undefined;
      }
      /* continue = **every node recomputed**, just starting from existing coordinates instead of random: force solves with a seed,
       * the result hugs the previous version, surviving nodes move a little, but new parent-child relations can still pull them
       * together. It used to be "pin known nodes, only place new ones": when one step added a batch of group containers and
       * reparented old nodes, the pinned old coordinates fought the new structure, long lines everywhere. */
      const res = await computeLayout({
        ...common, elements: els, force, seed: known, variant: layoutModeRef.current,
        onProgress: (done, total) => { if (runRef.current === run) setProg({ done, total }); },
      });
      return {
        positions: { ...res.positions },
        source: res.source !== 'solved' ? 'cache' : force ? 'relayout' : known ? 'continue' : 'fresh',
      };
    };

    try {
      /* ── diff: **the union is never solved** ──────────────────────────────────────────
       *
       * Solve each version once, then shift the "only in old" parts over as a block next to their surviving anchors
       * (`diffPositions`). Freely solving the union was the old path; it treats "two times" as "one bigger graph":
       * AB→CD lays out as four tiles side by side, and **the surviving part gets relaid out too**:
       * CD's coordinates in the union have nothing to do with what you see when browsing CD.
       *
       * The new side's layout input is **byte-identical** to browsing that version (`shapeHash` only reads structure, and
       * `unionSides` changes nothing), and the source is the same (`ownLayout`: preset → cache → layoutMode),
       * so it gets the same coordinates: **toggling compare moves no node on the new side.** This side used to ignore the
       * preset and layoutMode, so it jumped when turned on and jumped back when turned off.
       *
       * **Not in parallel**: `current` in the engine is a singleton, two solves at once would each consider the other "superseded". Old
       * first, new second, so the memo left in memory is the new version's, and leaving diff for browse hits it at once. */
      const dl = diffRef.current;
      let positions: Positions;
      let layerOf: Map<string, string>;
      /** Where browse mode's coordinates came from (reported to onLayout); diff does not report, left empty. */
      let layoutSource: LayoutInfo['source'] | null = null;
      if (dl) {
        const sides = diffSidesRef.current ?? unionSides(dl);
        const bEls = buildElements(sides.before, profile);
        const aEls = buildElements(sides.after, profile);
        const rb = await computeLayout({ ...common, elements: bEls.elements });
        if (runRef.current !== run || cyRef.current !== cy) return;
        // The new side uses exactly the same source as browsing this version (preset / cache / layoutMode), see `ownLayout`.
        const ra = await ownLayout(aEls.elements);
        if (runRef.current !== run || cyRef.current !== cy) return;
        /* Each fusion step is a **local relaxation**, not another force run.
         *
         * The force path was tried and measured not to work (numbers and reasoning are at the top of layout/relax.ts):
         * cose-bilkent with `numIter < 400` throws asynchronously inside its own tick, `layoutstop`
         * never arrives and the canvas hangs on "Preparing layout"; fcose does not throw, but `numIter` is not a step size at all
         * (1 and 1200 move the same); and even with a seed one solve moves shared nodes by a median of 586,
         * coordinates that snap then pushes back, so the unique ones land relative to a skeleton that teleported.
         *
         * And what "compute again" was meant to solve is not rearranging but **a shift without collision checks lands on top of
         * others**. That is a local problem, a local operator is enough, and it naturally takes the "iterate a few steps" knob. */
        const solve: DiffSolve = async (side, seed, iterations, fixed) => {
          const els = side === 'before' ? bEls : aEls;
          const ids = els.elements.filter((el) => !el.data.source).map((el) => el.data.id as string);
          return relaxOverlaps(seed, relaxNodes(ids, dims, fixed), iterations);
        };
        /* **In a single column rounds are always 0.** Fusion assumes "only in old" and "only in new" never share a frame,
         * which is why they may occupy the same area; in a single column both are drawn, the assumption fails, and fusion would
         * only overlap them. */
        const spec = {
          ...diffLayoutRef.current,
          rounds: diffLayoutRef.current?.rounds ?? 1,
        };
        const fused = await solveDiffLayout(sides, { before: rb.positions, after: ra.positions }, solve, spec);
        if (runRef.current !== run || cyRef.current !== cy) return;
        /* Both columns' coordinates merged into one set and poured in: the shared part is byte-identical in both, so merging is safe.
         * Both instances get **the same** coordinates; the only difference between columns is "who is visible". So framing has one
         * basis too (the union), and the columns line up. */
        positions = { ...fused.past, ...fused.now };
        layerOf = new Map([...bEls.layerOf, ...aEls.layerOf]);
        onDiffLayoutRef.current?.({ steps: fused.steps, layoutMs: Math.round(performance.now() - t0) });
      } else {
        /* **Layout solves "the new version itself", not the union.**
         *
         * The union is for animation (it only plays with both versions present), but it should not decide coordinates:
         *   ① the leavers only fade out and should not take space; otherwise the end is "the union's arrangement with dozens of holes",
         *      not the new version's equilibrium, and the next switch would immediately pull together again.
         *   ② worse, **the element sets do not match**: the union often has 2+ top-level nodes, so a virtual root is
         *      synthesized; the new version alone has one top level and no root. One node apart, the layout input hash
         *      differs, "the same input is solved once" never hits, and every switch solves again; a new solve always
         *      differs from the last (force has no reproducible fixed point), so the graph moves a lot even when the data
         *      did not change.
         *
         * So elements are built fresh from the new version's model instead of subtracting from the union. Subtraction cannot
         * produce an equivalent; only the same source guarantees the next run gets the same input.
         *
         * The test is **whether what is drawn is the union**, not "is a transition running": after a scene `renderModel`
         * stays on that union (leavers are just display:none), so pressing "Recompute" or switching the layout algorithm
         * right after used to throw those dozens of invisible ghosts into the force layout. */
        const forLayout = renderModel === model
          ? built.elements
          : buildElements(model, profile).elements;
        const own = await ownLayout(forLayout);
        positions = own.positions;
        layoutSource = own.source;
        layerOf = built.layerOf;
      }
      if (runRef.current !== run || cyRef.current !== cy) return;
      layoutMsRef.current = Math.round(performance.now() - t0);
      if (layoutSource && onLayoutRef.current) {
        // The synthetic virtual root belongs to the library and stays out of what the host stores.
        const { [VIRTUAL_ROOT]: _root, ...own } = positions;
        reportedRef.current = own;
        onLayoutRef.current(own, { source: layoutSource, ms: layoutMsRef.current });
      }
      /* A node's coordinates, three levels of priority, earlier is more authoritative:
       *   ① this round's solve: it is still present, the solve decides
       *   ② the previous frame: it leaves this time and fades in place
       *   ③ sit nearby: neither has it (the synthetic virtual root exists only in the union)
       *
       * ② **fills, never overrides**. One id can be both an exit on the left and a live node on the right: after switching the
       * reference, the old reference's unique nodes hit this rule in bulk (107 in one measured run). Overriding would pin most of
       * the right column to the previous round's coordinates, and since they are not in `t.leaving`, from==to,
       * and they would not move at all.
       *
       * ③ comes **after** ②. The other way round, leavers would first get a "sit nearby" spot near the centroid,
       * and ②'s fill would never get its turn: fading in place would become teleporting to the centroid and then fading. */
      const stay = [...leaving].filter((id) => !positions[id] && dispRef.current[id]);
      seatOrphans(positions, built);
      /* What the solve gives is flat; it is raised by the current view (one layer / all) to the right fraction before going to the
       * transition. ②'s fill comes after this: the previous frame already is screen coordinates and must not be projected again. */
      rawRef.current = positions;
      layerOfRef.current = layerOf;
      const t = viewRef.current.planes ? 1 : 0;
      const placed = projectAt(positions, t);
      for (const id of stay) placed.positions[id] = dispRef.current[id];
      planeTRef.current = t;
      planeKeyRef.current = planeKey(viewRef.current);
      layerAlphaRef.current = new Map();
      baseRef.current = placed.positions;
      tightenedRef.current = false;
      showPlates(litPlates(placed.plates, shownIn(viewRef.current)), t);
      setProg(null);
      playTransition(cy, placed.positions, (cameraPlaced) => {
        // Curtain, gate opens. The queued one plays now (the prop did not change, so pull the trigger ourselves).
        markBusy(false);
        if (missedRef.current) setResume((v) => v + 1);
        if (cyRef.current !== cy) return;
        // On the path that played, the camera is already at v1, so **no fit here**: another fit is one extra jump
        // after the curtain. Only the path that did not play (landing directly) sets the camera here.
        applyView({ fit: !cameraPlaced });
        sightRef.current = sightKey(viewRef.current);
        if (plateAlphaRef.current > 0 || diffRef.current) setViewport({ zoom: cy.zoom(), pan: { ...cy.pan() } });
        syncMirror();
        // A relayout was owed during the scene: pay it now (a data switch takes priority, it relays out by itself). A layer switch rides along.
        if (!missedRef.current && owedLayoutRef.current) { flushOwedRef.current?.(); return; }
        // The view changed (one layer / all) during the scene: play that part now.
        if (planeKeyRef.current !== planeKey(viewRef.current)) playPlanesRef.current?.(cy);
        // After the show, re-verdict labels once and fade to the new verdict. If the camera did not move there is no viewport event, so call it ourselves.
        scheduleReadability(cy);
        const want = pendingPickRef.current;
        if (want) { pendingPickRef.current = null; pickRef.current(want); }
      });
    } catch (err) {
      // A crashed layout must still open the gate, or this canvas never accepts new data again.
      pendingRef.current = null;
      markBusy(false);
      // Data that arrived during the failed run is still owed a scene.
      if (missedRef.current) setResume((v) => v + 1);
      // **Do not swallow it.** Last time it was swallowed the canvas stopped on "Preparing layout" with no clue on screen
      // that anything happened: not crashed but stuck, which is much harder to debug than a crash.
      console.error('[glassbrain] layout failed', err);
    } finally {
      /* The overlay is removed by **this** run, including the paths that return early. Without this line, any early-exit
       * path would leave the canvas on "Preparing layout" forever. Not removed when superseded by a newer run:
       * that overlay belongs to it now. */
      if (runRef.current === run) setProg(null);
    }
  }, [built, pool, profile, applyView, playTransition, markBusy, sheetFor, scheduleReadability, projectAt, showPlates]);

  /* ── Layers: raise, flatten, switch layer ─────────────────────────────────────────
   *
   * There is only one set of coordinates (flat); one layer and all are the same affine map run partway (`projectAt(raw, t)`),
   * so nothing is recomputed or rebuilt here, just three things following the same moment:
   *   position  t from one end to the other, projected every frame
   *   presence  the incoming layer brightens 0 → 1, the outgoing one dims 1 → 0 (an edge takes the darker of its ends)
   *   camera    the framing box from now to the end (end = visible set under the new view + plates)
   * Plate opacity is t. Switching again midway continues from the current t and brightness, never backwards. */
  const playPlanes = useCallback((cy: any) => {
    if (planeTweenRef.current != null) { cancelAnimationFrame(planeTweenRef.current); planeTweenRef.current = null; }
    cancelFly();
    const v = viewRef.current;
    const prevKey = planeKeyRef.current;
    planeKeyRef.current = planeKey(v);
    sightRef.current = sightKey(v);
    const raw = rawRef.current;
    const t0 = planeTRef.current, t1 = v.planes ? 1 : 0;
    const end = projectAt(raw, t1);
    const shownBefore = prevKey.split('|')[1];
    const before = shownBefore ? new Set(shownBefore.split(',')) : null;
    const after = v.layers?.length ? new Set(v.layers) : null;
    const layers = profileRef.current.layers.map((l) => l.id);
    const a0 = new Map(layers.map((l) => [l, layerAlphaRef.current.get(l) ?? (!before || before.has(l) ? 1 : 0)]));
    const a1 = new Map(layers.map((l) => [l, !after || after.has(l) ? 1 : 0]));
    const endPlates = litPlates(end.plates, (l) => a1.get(l) ?? 1);
    const insts = [cy, mirrorRef.current].filter((x) => x && !x.destroyed());

    /* The incoming layer goes on stage first (display), brightness from 0. Without that its bounding box cannot be measured
     * and framing would not include it. The outgoing layer stays on stage to fade; applyView tucks it away at the curtain. */
    const { visible } = resolvedRef.current;
    const left = leftRef.current;
    const layerOf = (n: any) => n.data('layer') as string;
    const groups = insts.map((inst) => {
      const nodes = new Map<string, any[]>(), edges = new Map<string, any[]>();
      inst.batch(() => {
        inst.nodes().forEach((n: any) => {
          const l = layerOf(n);
          if (a0.get(l) === a1.get(l)) return;
          (nodes.get(l) ?? nodes.set(l, []).get(l)!).push(n);
          if (a1.get(l) && visible.has(n.id()) && !left.has(n.id())) n.style({ display: 'element', opacity: a0.get(l) });
          else n.style('opacity', a0.get(l));
        });
        inst.edges().forEach((e: any) => {
          const ls = layerOf(e.source()), lt = layerOf(e.target());
          if (a0.get(ls) === a1.get(ls) && a0.get(lt) === a1.get(lt)) return;
          const k = `${ls}\n${lt}`;
          (edges.get(k) ?? edges.set(k, []).get(k)!).push(e);
        });
      });
      return {
        inst,
        nodes: [...nodes].map(([l, arr]) => [l, inst.collection(arr)] as const),
        edges: [...edges].map(([k, arr]) => [k.split('\n'), inst.collection(arr)] as const),
        leaves: inst.nodes(':childless'),
      };
    });
    const alphaAt = (k: number) => new Map(layers.map((l) => [l, Math.min(1, Math.max(0, a0.get(l)! + (a1.get(l)! - a0.get(l)!) * k))]));
    const paintAlpha = (al: Map<string, number>) => {
      for (const g of groups) g.inst.batch(() => {
        for (const [l, c] of g.nodes) c.style('opacity', al.get(l));
        for (const [[ls, lt], c] of g.edges) c.style('opacity', Math.min(al.get(ls) ?? 1, al.get(lt) ?? 1));
      });
    };
    const place = (pos: Positions) => {
      for (const g of groups) g.inst.batch(() => g.leaves.forEach((n: any) => { const q = pos[n.id()]; if (q) n.position(q); }));
      Object.assign(dispRef.current, pos);
    };

    const finish = () => {
      planeTweenRef.current = null;
      if (cyRef.current !== cy || cy.destroyed()) return;
      planeTRef.current = t1;
      layerAlphaRef.current = new Map();
      place(end.positions);
      baseRef.current = { ...baseRef.current, ...end.positions };
      for (const g of groups) {
        if (g.inst.destroyed()) continue;
        g.inst.batch(() => {
          for (const [, c] of g.nodes) c.removeStyle('opacity');
          for (const [, c] of g.edges) c.removeStyle('opacity');
        });
      }
      showPlates(endPlates, t1);
    };

    // Subview (tightened coordinates), animation off, page in the background: land directly.
    const spec = resolveSpec(animateRef.current);
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    if (!spec || hidden || isNarrowing(v) || !Object.keys(raw).length) {
      finish();
      applyView();
      syncMirror();
      scheduleReadability(cy);
      return;
    }

    // End framing: place at the end, measure once, put back as it was. Same frame, never seen on screen.
    const W = cy.width() || 1, H = cy.height() || 1;
    const v0: Viewport = { zoom: cy.zoom(), pan: { ...cy.pan() } };
    const from = { ...dispRef.current };
    const platesBefore = platesRef.current;
    cy.batch(() => groups[0].leaves.forEach((n: any) => { const q = end.positions[n.id()]; if (q) n.position(q); }));
    platesRef.current = endPlates;
    fitAll(cy);
    const v1: Viewport = { zoom: cy.zoom(), pan: { ...cy.pan() } };
    platesRef.current = platesBefore;
    cy.batch(() => groups[0].leaves.forEach((n: any) => { const q = from[n.id()]; if (q) n.position(q); }));
    cy.viewport(v0);
    const r0 = toRect(v0, W, H), r1 = toRect(v1, W, H);

    const start = performance.now();
    const frame = (now: number) => {
      planeTweenRef.current = null;
      if (cyRef.current !== cy || cy.destroyed()) return;
      const k = Math.min(1, (now - start) / PLANE_MS);
      const e = easeInOut(k);
      const t = t0 + (t1 - t0) * e;
      const at = projectAt(raw, t);
      place(at.positions);
      planeTRef.current = t;
      const al = alphaAt(e);
      layerAlphaRef.current = al;
      paintAlpha(al);
      showPlates(litPlates(at.plates, (l) => al.get(l) ?? 1), t);
      cy.viewport(toView(lerpRect(r0, r1, e), cy.width() || W, cy.height() || H));
      if (k < 1) { planeTweenRef.current = requestAnimationFrame(frame); return; }
      finish();
      applyView({ fit: false });
      cy.viewport(v1);
      syncMirror();
      scheduleReadability(cy);
    };
    planeTweenRef.current = requestAnimationFrame(frame);
  }, [projectAt, showPlates, fitAll, applyView, syncMirror, scheduleReadability, cancelFly]);
  playPlanesRef.current = playPlanes;

  /** Fly to a node: far ones pull back first and then push in (see zoomPath in camera.ts), landing at a size where the label fits.
   *  `around` = frame it and its hop (double click): the whole hop fits on screen with a margin, but it never pushes in beyond
   *  "the label fits", so a lone node is not shoved to full screen. */
  const flyTo = useCallback((id: string, around = false) => {
    const cy = cyRef.current;
    if (!cy || cy.destroyed() || busyRef.current || planeTweenRef.current != null) return;
    const n = cy.$id(id);
    if (n.empty() || !n.visible()) return;
    cancelFly();
    const W = cy.width() || 1, H = cy.height() || 1;
    const p = n.position();
    let cx = p.x, cyy = p.y;
    let z1 = Math.min(cy.maxZoom(), Math.max(cy.zoom(), FLY_ZOOM));
    if (around) {
      const hood = n.closedNeighborhood('node').filter((x: any) => x.visible() && x.id() !== VIRTUAL_ROOT);
      const bb = hood.boundingBox({ includeLabels: false });
      cx = (bb.x1 + bb.x2) / 2; cyy = (bb.y1 + bb.y2) / 2;
      const PAD = 60;
      const fit = Math.min((W - 2 * PAD) / Math.max(bb.w, 1), (H - 2 * PAD) / Math.max(bb.h, 1));
      z1 = Math.max(cy.minZoom(), Math.min(cy.maxZoom(), FLY_ZOOM * 1.5, fit));
    }
    const a = toRect({ zoom: cy.zoom(), pan: cy.pan() }, W, H);
    const b = { cx, cy: cyy, hw: W / (2 * z1) };
    if (!resolveSpec(animateRef.current)) { cy.viewport(toView(b, W, H)); return; }
    const path = zoomPath(a, b);
    const dur = Math.min(FLY_MS.max, Math.max(FLY_MS.min, path.S * FLY_MS_PER_S));
    const start = performance.now();
    const frame = (now: number) => {
      flyRef.current = null;
      if (cyRef.current !== cy || cy.destroyed()) return;
      const k = Math.min(1, (now - start) / dur);
      // Measure the canvas every frame: the detail panel may open mid-flight and narrow the canvas; the framing box is in graph coordinates, so the center still matches.
      cy.viewport(toView(path.at(easeInOut(k)), cy.width() || W, cy.height() || H));
      if (k < 1) flyRef.current = requestAnimationFrame(frame);
    };
    flyRef.current = requestAnimationFrame(frame);
  }, [cancelFly]);

  const flyToRef = useRef(flyTo); flyToRef.current = flyTo;

  /* ── Instance lifecycle: rebuild only when the element set really changed ─────────────────────────── */
  useEffect(() => {
    if (!containerRef.current) return;
    let cy: any = null;
    let ro: ResizeObserver | null = null;
    let detach: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      // fcose is only for subview tightening (applyView); whole-graph layout runs in layout/.
      const [{ default: cytoscape }, { default: fcose }, { default: coseBilkent }] = await Promise.all([
        import('cytoscape'), import('cytoscape-fcose'), import('cytoscape-cose-bilkent'),
      ]);
      if (cancelled || !containerRef.current) return;
      cytoscape.use(fcose as any); cytoscape.use(coseBilkent as any);
      cy = cytoscape({
        container: containerRef.current,
        elements: built.elements,
        style: sheetFor(!!diffRef.current),
        // The real layout runs in requestLayout below (sizes first); preset only keeps this frame from flying around.
        layout: { name: 'preset' },
        // We take over the wheel ourselves (see below), so cytoscape's default "wheel = zoom" is off.
        userZoomingEnabled: false, minZoom: 0.02, maxZoom: 4,
      });

      // A changed element set is a new instance: every node in it piles at (0,0) and the camera resets to
      // zoom=1/pan=0. Until requestLayout finishes the picture is empty: a flash on every data update,
      // nobody sees "what the previous version looked like", and there is nothing to animate from.
      //
      // So the rebuild must be **invisible**: coordinates laid back from the previous frame, viewport carried over, and the two
      // channels that need no coordinates (presence, look) get their base points right here. The union contains every element
      // of the previous version, so coordinates are complete; after this block the picture is the last frame before the switch, and a slow layout only lingers longer.
      const prevView = prevViewportRef.current;
      if (prevView) cy.viewport(prevView);
      seatFromLastFrame(cy, dispRef.current, (q) => built.parentOf.get(q));
      /* **Frame 0 in place.** Positions are already laid back from the previous frame; the "presence" and "look" channels are
       * completed here (their base points need no coordinates). Up to this line the picture equals the last frame before the switch;
       * however long layout takes does not matter, it just lingers on the previous frame. */
      armedRef.current = null;       // the previous one belonged to the previous instance and went with it
      if (pendingRef.current && resolveSpec(animateRef.current)) armTransition(cy);
      /* Painter: in browse mode nodes and edges are drawn by paint.ts (cytoscape still owns data, style, layout and transitions).
       * Same switch as the text layer: when we draw text we draw nodes and edges too; in diff columns or with the readability field
       * off everything is cytoscape as is. Asked every frame, so flipping the switch takes effect without rebuilding. */
      painterRef.current = installPainter(cy, {
        active: () => !diffRef.current && readableRef.current,
        theme: () => themeRef.current,
        semanticOpacity: () => semanticOpacityRef.current,
        nodeScale: () => nodeScaleRef.current,
      });
      // Hidden kinds apply right away: waiting for applyView would draw them through the whole layout + transition.
      if (!diffRef.current && readableRef.current) {
        painterRef.current.mute(viewRef.current.hiddenNodeKinds ?? [], viewRef.current.hiddenEdgeKinds ?? []);
      }
      // Third channel: labels drawn from the ledger. The text layer survives rebuilds and so does the ledger, so this frame's text is
      // the previous frame's; after that each cytoscape redraw redraws the text (nodes move, text sticks to them).
      drawLabels(cy);
      cy.on('render', () => drawLabels(cy));

      /* Frame everything the first time the canvas gets a size; later size changes (inspector opening, window resize) **do not move
       * the camera**: same zoom, same pan; the canvas's top-left did not move, so the graph does not move a pixel. Only when the selected
       * node would be covered does it shift just enough to show it.
       *
       * Without a selection it used to be "the point at the center stays at the center", so opening and closing were asymmetric: click a
       * node to open the inspector (selected, no move), click empty space to close (selection gone first, centered, shifts right by half
       * an inspector); a few rounds and the graph walked off screen. One rule, symmetric open and close, so nothing accumulates. */
      let lastW = 0, lastH = 0;
      const refit = () => {
        const el = containerRef.current;
        if (!el) return;
        const w = el.clientWidth, h = el.clientHeight;
        if (w === 0 || h === 0 || (w === lastW && h === lastH)) return;
        const first = lastW === 0;
        lastW = w; lastH = h;
        const pan = cy.pan();
        cy.resize();
        if (first) { fitAll(cy); return; }
        const sel = cy.nodes(':selected').filter((n: any) => n.visible());
        if (!sel.length) return;
        const x = sel[0].renderedPosition().x, margin = 72;
        if (x > w - margin) cy.pan({ x: pan.x - (x - (w - margin)), y: pan.y });
        // The text layer follows the new size at once, without waiting for cytoscape's next render.
        drawLabels(cy);
      };
      ro = new ResizeObserver(refit);
      ro.observe(containerRef.current);

      cy.on('mouseover', 'node, edge', (evt: any) => { touchInteraction(); setHover(cy, evt.target); });
      cy.on('mouseout', 'node, edge', () => setHover(cy, null));
      // Select / deselect: the forced-label set changed, re-verdict.
      cy.on('select', 'node', (evt: any) => { ringsRef.current.set(evt.target.id(), performance.now()); runRing(cy); });
      cy.on('unselect', 'node', (evt: any) => { ringsRef.current.delete(evt.target.id()); drawLabels(cy); });
      cy.on('select unselect', 'node', () => scheduleReadability(cy));
      /* The synthetic virtual root (called Overview by default) is not data and has no details. It used to be selectable: a
       * selection ring appeared but the inspector did not open, which looked broken. Now it is not selectable; clicking it is clicking empty space. */
      cy.$id(VIRTUAL_ROOT).unselectify();
      cy.on('tap', 'node', (evt: any) => {
        touchInteraction();
        if (evt.target.id() === VIRTUAL_ROOT) setSelected(null);
        else selectEle(evt.target);
      });
      cy.on('tap', (evt: any) => { touchInteraction(); if (evt.target === cy) setSelected(null); });
      cy.on('tapstart', () => cancelFly());
      // Double click = zoom to a good view (the map-app habit): frame it and its hop. Only the camera moves; no "what to look at"
      // state changes, so there is nothing to exit. Double click is detected here instead of cytoscape's dbltap: that one fires
      // inconsistently across input devices / versions, and here all we need is "the same node clicked twice within 350 ms".
      let lastTap = { id: '', t: 0 };
      cy.on('tap', 'node', (evt: any) => {
        const id = evt.target.id();
        const now = Date.now();
        const isDouble = lastTap.id === id && now - lastTap.t < 350;
        lastTap = { id, t: now };
        if (!isDouble || id === VIRTUAL_ROOT) return;
        // The first click just opened the detail panel and the canvas is narrowing: wait for the new size (two frames) before framing, or the box uses the old width.
        requestAnimationFrame(() => requestAnimationFrame(() => flyToRef.current(id, true)));
      });

      // Trackpad / mouse input model (as in Figma / tldraw): pinch or Ctrl(⌘)+wheel → zoom at the cursor;
      // everything else (two-finger pan, plain wheel) → pan.
      const el = containerRef.current!;
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        touchInteraction();
        cancelFly();
        if (e.ctrlKey || e.metaKey) {
          const rect = el.getBoundingClientRect();
          cy.zoom({
            level: cy.zoom() * Math.exp(-e.deltaY * 0.01),
            renderedPosition: { x: e.clientX - rect.left, y: e.clientY - rect.top },
          });
        } else cy.panBy({ x: -e.deltaX, y: -e.deltaY });
      };
      el.addEventListener('wheel', onWheel, { passive: false });
      // When the mouse leaves the canvas straight from an element cytoscape sends no mouseout, and the dimming would stay.
      const onLeave = () => setHover(cy, null);
      el.addEventListener('mouseleave', onLeave);
      detach = () => { el.removeEventListener('wheel', onWheel); el.removeEventListener('mouseleave', onLeave); };
      cy.on('viewport', () => {
        // Layer plates and diff halos are "overlays drawn in graph coordinates"; if present they must follow (including while plates fade out).
        if (plateAlphaRef.current > 0 || diffRef.current) setViewport({ zoom: cy.zoom(), pan: { ...cy.pan() } });
        // The mirror follows. `syncingRef` is the loop guard: the mirror syncs back too.
        const m = mirrorRef.current;
        if (m && !m.destroyed() && !syncingRef.current) {
          syncingRef.current = true;
          m.viewport({ zoom: cy.zoom(), pan: { ...cy.pan() } });
          syncingRef.current = false;
        }
        // The label channel follows the viewport: zoom / pan / programmatic fit / the camera in a transition all come in through here;
        // scheduleReadability decides whether to re-verdict (not during a scene); on large graphs it waits until motion stops.
        touchInteraction();
        scheduleViewportReadability(cy);
      });

      cyRef.current = cy;
      // New data usually invalidates the selection. Edits are the exception: the edited node is the one in hand, the detail panel should not blink away.
      const keep = keepSelRef.current;
      keepSelRef.current = null;
      if (keep && cy.$id(keep).nonempty()) cy.$id(keep).select();
      else setSelected(null);
      setLiveCy(cy);
      onReady?.(cy);
      // A new instance's first layout counts as "playing" too: changes needing relayout that arrive meanwhile queue behind it instead of competing.
      markBusy(true);
      requestLayout(cy);
      armBreath(cy);
    })();
    return () => {
      cancelled = true;
      cancelFrames();
      if (cy && !cy.destroyed()) prevViewportRef.current = { zoom: cy.zoom(), pan: { ...cy.pan() } };
      if (readabilityRafRef.current != null) { cancelAnimationFrame(readabilityRafRef.current); readabilityRafRef.current = null; }
      if (settleTimerRef.current != null) { clearTimeout(settleTimerRef.current); settleTimerRef.current = null; }
      if (breathTimerRef.current != null) { clearTimeout(breathTimerRef.current); breathTimerRef.current = null; }
      if (hoverOutRef.current != null) { clearTimeout(hoverOutRef.current); hoverOutRef.current = null; }
      if (planeTweenRef.current != null) { cancelAnimationFrame(planeTweenRef.current); planeTweenRef.current = null; }
      cancelFly();
      painterRef.current?.dispose(); painterRef.current = null;
      ro?.disconnect(); detach?.(); cy?.destroy(); cyRef.current = null;
    };
    // The only dependency is built, and built only changes with model / profile.
    // Layers / sources / search / focus are not among them, so they never come here to rebuild the instance.
    // `!!diff` is a boolean: rebuild only when **entering or leaving diff mode** (the stylesheet gains or loses a layer);
    // a different delta does not count: then the model changed too, and built handles it.
  }, [built, profile, !!diff]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── The left column mirror ────────────────────────────────────────────────────────
   * Independent of the main instance's lifecycle because it can be toggled at any time without rebuilding the main one… but the stylesheet and
   * two separate effects also make "the mirror does nothing smart" visible in the code: it has no
   * requestLayout, no applyView, no armTransition. */
  useEffect(() => {
    if (!diff || !pastBuilt || !mirrorElRef.current) return;
    let m: any = null;
    let ro: ResizeObserver | null = null;
    let detach: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      const { default: cytoscape } = await import('cytoscape');
      if (cancelled || !mirrorElRef.current) return;
      m = cytoscape({
        container: mirrorElRef.current,
        elements: pastBuilt.elements,
        style: sheetFor(true),
        layout: { name: 'preset' },
        userZoomingEnabled: false, minZoom: 0.02, maxZoom: 4,
      });
      /* **Frame 0 coordinates.** Same reason as when the main instance mounts, and the left column needs it more: its ids get
       * renamed by matching, and none of the old names in `baseRef` match. */
      seatFromLastFrame(m, dispRef.current, (q) => pastBuilt.parentOf.get(q));
      mirrorRef.current = m;
      // Clicking a node on the left takes the same path as on the right: there is one detail panel.
      m.$id(VIRTUAL_ROOT).unselectify();
      m.on('tap', 'node', (evt: any) => { if (evt.target.id() === VIRTUAL_ROOT) setSelected(null); else selectEle(evt.target); });
      m.on('tap', (evt: any) => { if (evt.target === m) setSelected(null); });
      // Drag / zoom on the left and the right follows (the main instance's viewport event brings the overlay along).
      m.on('viewport', () => {
        const cy = cyRef.current;
        if (!cy || cy.destroyed() || syncingRef.current) return;
        syncingRef.current = true;
        cy.viewport({ zoom: m.zoom(), pan: { ...m.pan() } });
        syncingRef.current = false;
      });
      const el = mirrorElRef.current;
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) {
          const rect = el.getBoundingClientRect();
          m.zoom({ level: m.zoom() * Math.exp(-e.deltaY * 0.01), renderedPosition: { x: e.clientX - rect.left, y: e.clientY - rect.top } });
        } else m.panBy({ x: -e.deltaX, y: -e.deltaY });
      };
      el.addEventListener('wheel', onWheel, { passive: false });
      detach = () => el.removeEventListener('wheel', onWheel);
      ro = new ResizeObserver(() => { if (!m.destroyed()) { m.resize(); syncMirror(); } });
      ro.observe(el);
      syncMirror();
      // Text: redrawn with its own column; judged once on mount.
      m.on('render', () => drawLabels(m));
      const cy = cyRef.current;
      if (cy && !cy.destroyed()) scheduleReadability(cy);
      /* **Frame 0 in place.** Same reason as when the main instance mounts: several frames pass between the union mounting and
       * layout finishing, and without base points the batch about to "grow" this time would **first be drawn in full with default
       * styles** and only then play: the audience sees "the new stuff is already here" and the growth afterwards is wasted.
       * The undo key is not kept here: `playTransition` arms again and gives it back. */
      if (pendingPastRef.current && resolveSpec(animateRef.current)) armMirror(true);
    })();
    return () => {
      cancelled = true;
      ro?.disconnect(); detach?.();
      if (m && !m.destroyed()) m.destroy();
      mirrorRef.current = null;
      mirrorLabelsRef.current = new Map();
    };
  }, [pastBuilt, profile, !!diff, selectEle, syncMirror, armMirror, drawLabels, scheduleReadability]);

  // When the view changes, the mirror aligns once (coordinates / visibility / viewport may all have moved).
  useEffect(() => { syncMirror(); }, [resolved, syncMirror]);

  /* The view changed. Three cases, three paths, none rebuilds or relays out:
   *   · the view changed (one layer / all) → play an affine (playPlanes). If a scene is playing, wait and play it at the curtain.
   *   · the visible set changed (focus, source) → toggle display, reframe.
   *   · only the search term changed → toggle highlights, **camera stays**: a camera jump per keystroke is unusable. */
  useEffect(() => {
    const cy = cyRef.current;
    const live = cy && !cy.destroyed() && Object.keys(rawRef.current).length > 0;
    if (live && planeKey(view) !== planeKeyRef.current) {
      if (!busyRef.current) playPlanes(cy);
      return;
    }
    const sight = sightKey(view);
    applyView({ fit: sight !== sightRef.current });
    sightRef.current = sight;
    if (cy && !cy.destroyed()) scheduleReadability(cy);
  }, [resolved, view.hiddenNodeKinds, view.hiddenEdgeKinds, applyView]); // eslint-disable-line react-hooks/exhaustive-deps
  /* ── Changes needing relayout: always queued while playing ──────────────────────────────────
   * layout / layoutMode / "Relayout" / fusion knobs all come through here. While playing, note "one relayout owed" (and whether
   * someone pressed "Relayout"), and pay it once at the curtain; any number of changes midway pay once, reading the latest props.
   * They used to each do their own thing: some were dropped while playing (clearing layout, nothing ever moved again), some did not wait and cut the playing scene off.
   * Data switches do not come here; they have their own mechanism (`missedRef`) and relayout by themselves. */
  const layoutNow = useCallback((force = false) => {
    const cy = cyRef.current;
    if (!cy) return;
    if (busyRef.current) { owedLayoutRef.current = { force: force || !!owedLayoutRef.current?.force }; return; }
    markBusy(true);
    requestLayout(cy, force);
  }, [requestLayout, markBusy]);
  flushOwedRef.current = () => {
    const owed = owedLayoutRef.current;
    owedLayoutRef.current = null;
    if (owed) layoutNow(owed.force);
  };
  /* "Relayout" in the canvas menu: solve the same data again from a random start and animate as usual. Not in diff (that has fusion knobs). */
  const relayout = useCallback(() => { if (!diffRef.current) layoutNow(true); }, [layoutNow]);
  /* `layout` / `layoutMode` changed: fetch coordinates again in order (preset → cache → solve) and animate as usual. They used to be
   * read only on the next data switch: setting layout to null got no reaction at all. Same in compare mode: the new side uses the same source. */
  const seenLayoutProps = useRef({ preset: presetLayout, mode: layoutMode });
  useEffect(() => {
    /* Changed or not is judged by **content** (see `samePositions`); the host passing back exactly what `onLayout` just reported is not a change:
     * that is what is on screen. */
    const seen = seenLayoutProps.current;
    seenLayoutProps.current = { preset: presetLayout, mode: layoutMode };
    if (seen.mode === layoutMode
      && (samePositions(seen.preset, presetLayout) || samePositions(reportedRef.current, presetLayout))) return;
    layoutNow();
  }, [presetLayout, layoutMode]); // eslint-disable-line react-hooks/exhaustive-deps
  /* Fusion knobs moved: recompute coordinates once. */
  const firstFuse = useRef(true);
  useEffect(() => {
    if (firstFuse.current) { firstFuse.current = false; return; }
    if (diffRef.current) layoutNow();
  }, [diffLayout?.rounds, diffLayout?.iterations, diffLayout?.snap]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSelectRef = useRef(onSelect); onSelectRef.current = onSelect;
  const firstSelect = useRef(true);
  // Only real changes: not the initial `null` on mount.
  useEffect(() => { if (firstSelect.current) { firstSelect.current = false; if (selected === null) return; } onSelectRef.current?.(selected); }, [selected]);

  const zoomBy = useCallback((dir: 1 | -1) => {
    const cy = cyRef.current, el = containerRef.current;
    if (!cy || !el) return;
    cancelFly();
    cy.animate({
      zoom: { level: cy.zoom() * (dir === 1 ? 1.4 : 1 / 1.4), renderedPosition: { x: el.clientWidth / 2, y: el.clientHeight / 2 } },
      duration: 180, easing: 'ease-out-cubic',
    });
  }, [cancelFly]);
  const fit = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cancelFly();
    // Fit to window flies too, no jump: measure the end and take the same path.
    const W = cy.width() || 1, H = cy.height() || 1;
    const v0: Viewport = { zoom: cy.zoom(), pan: { ...cy.pan() } };
    fitAll(cy);
    const v1: Viewport = { zoom: cy.zoom(), pan: { ...cy.pan() } };
    cy.viewport(v0);
    if (!resolveSpec(animateRef.current)) { cy.viewport(v1); return; }
    const path = zoomPath(toRect(v0, W, H), toRect(v1, W, H));
    const dur = Math.min(FLY_MS.max, Math.max(FLY_MS.min, path.S * FLY_MS_PER_S));
    const start = performance.now();
    const frame = (now: number) => {
      flyRef.current = null;
      if (cyRef.current !== cy || cy.destroyed()) return;
      const k = Math.min(1, (now - start) / dur);
      cy.viewport(toView(path.at(easeInOut(k)), cy.width() || W, cy.height() || H));
      if (k < 1) flyRef.current = requestAnimationFrame(frame);
    };
    flyRef.current = requestAnimationFrame(frame);
  }, [fitAll, cancelFly]);

  const controls = useMemo(() => {
    const out = {} as Record<ControlId, boolean>;
    for (const c of ALL_CONTROLS) out[c] = props.controls?.[c] ?? true;
    return out;
  }, [props.controls]);

  /* ── Search: the entries in the dropdown ──────────────────────────────────────────────
   * Hits are already ranked by similarity (`searchNodes`). The dropdown lists the first few, each with where it hangs (the nearest two
   * parent levels) and its color on the graph, which tells same-named ones apart. When other layers have hits too, a line at the
   * bottom says so, and one click switches to that layer. */
  const query = view.query?.trim() ?? '';
  const search = useMemo(() => {
    if (!query) return null;
    const idx = indexModel(renderModel);
    const left = leftRef.current;
    const hits = [...resolved.hits].filter((id) => !left.has(id));
    const results: SearchResult[] = hits.slice(0, SEARCH_LIST).map((id) => {
      const n = renderModel.index.get(id)!;
      const path = idx.ancestorsOf(id).slice(0, 2).reverse()
        .map((a) => renderModel.index.get(a)?.label).filter((x): x is string => !!x);
      return { id, label: n.label, path, kind: n.kind ? profile.kindLabels[n.kind] ?? n.kind : undefined };
    });
    const elsewhere: { layer: string; label: string; count: number }[] = [];
    if (layersHere.length > 1 && view.layers) {
      const here = new Set(view.layers ?? []);
      const count = new Map<string, number>();
      for (const id of searchNodes(renderModel, query)) {
        if (left.has(id)) continue;
        const l = renderModel.index.get(id)?.layer ?? profile.layers[0].id;
        if (!here.has(l)) count.set(l, (count.get(l) ?? 0) + 1);
      }
      for (const l of layersHere) if (count.get(l.id)) elsewhere.push({ layer: l.id, label: l.label, count: count.get(l.id)! });
    }
    return { results, total: hits.length, elsewhere };
  }, [query, resolved, renderModel, profile, layersHere, view.planes, view.layers]);
  /** The color dot in the list: ask the canvas what color this node is right now (palette and reskins included). */
  const colorOf = useCallback((id: string): string | undefined => {
    const cy = cyRef.current;
    if (!cy || cy.destroyed()) return undefined;
    const n = cy.$id(id);
    return n.nonempty() ? n.style('background-color') : undefined;
  }, []);
  /** Arrow keys to preview: light it and its hop up like a hover, the camera flies there. null = close the preview. */
  const preview = useCallback((id: string | null) => {
    const cy = cyRef.current;
    if (!cy || cy.destroyed()) return;
    const n = id ? cy.$id(id) : null;
    applyHover(cy, n && n.nonempty() ? n : null);
    if (id) flyTo(id);
  }, [applyHover, flyTo]);
  /** Hover a layer name in 2.5D: spotlight that layer (null = leave). */
  const hoverLayer = useCallback((layer: string | null) => {
    hotLayerRef.current = layer;
    setHotLayer(layer);
    const cy = cyRef.current;
    if (!cy || cy.destroyed() || diffRef.current) return;
    respot();
    if (readableRef.current && !labelsFrozen()) replanLabels(cy);
  }, [respot, labelsFrozen, replanLabels]);
  /** Enter / click an entry: select it (ring + detail panel), fly there, close search. */
  const pick = useCallback((id: string) => {
    const cy = cyRef.current;
    if (!cy || cy.destroyed()) return;
    const n = cy.$id(id);
    if (n.empty()) return;
    applyHover(cy, null);
    cy.$(':selected').unselect();
    n.select();
    selectEle(n);
    flyTo(id);
    setView({ query: '' });
  }, [applyHover, flyTo, selectEle, setView]);
  pickRef.current = pick;

  /* The model changed (usually right after an edit): the detail panel follows the new content, and closes if the selection is gone. */
  useEffect(() => {
    if (diff) return;
    setSelected((s) => {
      const n = s && model.index.get(s.id);
      if (!s || !n) return null;
      return {
        ...s, label: n.label, kind: n.kind ?? '', layer: n.layer, detail: n.data ?? null,
        flags: n.flags ?? [], container: model.nodes.some((x) => x.parent === n.id),
      };
    });
    setEditing((e) => (e?.what === 'node' && e.id && !model.index.has(e.id) ? null : e));
  }, [model]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!editable) setEditing(null); }, [editable]);

  /** One op from the edit panel: validate, then hand to the host. */
  const submitEdit = useCallback((input: EditOp) => {
    // Filtering by a source: the new node goes into that source, or it would be filtered out and invisible right after creation.
    const only = view.origins?.length === 1 ? view.origins[0] : undefined;
    const op: EditOp = input.op === 'addNode' && only && !input.origin ? { ...input, origin: only } : input;
    const err = checkEdit(model, op);
    if (err) return err;
    if (op.op === 'addNode') pendingPickRef.current = op.id;
    else if (op.op === 'removeNode') setSelected(null);
    else keepSelRef.current = selected?.id ?? null;
    onEditRef.current?.(op);
    return null;
  }, [model, selected, view.origins]);
  const startAdd = useCallback((what: 'node' | 'edge') => {
    setEditing(what === 'node' ? { what, parent: selected?.id ?? null } : { what, source: selected?.id });
  }, [selected]);
  const editPanel = editing && (
    <EditPanel
      target={editing} model={model} onSubmit={submitEdit} renderEditor={renderEditor} colorOf={colorOf}
      onCancel={() => setEditing(null)} onRetarget={setEditing}
    />
  );

  /* Keyboard: `/` or ⌘K to the search box, `+` `-` to zoom, `0` to fit. Only for **this** canvas: the pointer is over it or
   * focus is inside it. Otherwise the keys belong to the host (its own ⌘K palette, another canvas on the page). */
  useEffect(() => {
    if (compact) return;
    const onKey = (e: KeyboardEvent) => {
      const root = stageRef.current?.parentElement;
      const el = document.activeElement as HTMLElement | null;
      if (!root || !(root.contains(el) || root.matches(':hover'))) return;
      const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      const mod = e.metaKey || e.ctrlKey;
      if ((mod && e.key.toLowerCase() === 'k') || (!typing && !mod && e.key === '/')) {
        if (!searchInputRef.current) return;
        e.preventDefault();
        searchInputRef.current.focus();
        searchInputRef.current.select();
        return;
      }
      if (typing || mod || e.altKey) return;
      if (e.key === '+' || e.key === '=') zoomBy(1);
      else if (e.key === '-' || e.key === '_') zoomBy(-1);
      else if (e.key === '0') fit();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [compact, zoomBy, fit]);

  if (model.nodes.length === 0 && model.errors.length === 0) {
    return (
      <StringsContext.Provider value={strings}>
        <div className={`gb-root ${className ?? ''}`} style={style}>
          <div className="gb-empty">
            <div>{emptyMessage ?? strings.empty}</div>
            {editable && !editing && <button className="gb-link" onClick={() => startAdd('node')}>{strings.addNode}</button>}
          </div>
          {editPanel}
        </div>
      </StringsContext.Provider>
    );
  }

  const filtering = isFiltering(view);
  /* diff is two columns. 2.5D plates are not shown in two columns: one plate drawn twice carries no information and eats
     into columns that are already narrow. */
  const panes = !!diff;
  const platesOn = !panes && plates.length > 0 && plateAlpha > 0.01;
  return (
    <StringsContext.Provider value={strings}>
    <div className={`gb-root ${className ?? ''}`} style={style}>
      <div className="gb-stage" ref={stageRef} style={{ background: theme.canvas }}>
        {/* Plates must render **before** the canvas: both are absolute inset:0, DOM order is stacking order,
            and after it they would cover the graph. Opacity follows how far the layers have risen. */}
        {platesOn && (
          <svg className="gb-planes" style={{ opacity: plateAlpha }}>
            <g transform={`translate(${viewport.pan.x},${viewport.pan.y}) scale(${viewport.zoom})`}>
              {plates.map((p) => {
                const c = plateColors(theme, p.color);
                // Translucent, so where one floor overlaps another both still read; the hovered layer's plate deepens.
                return (
                  <polygon
                    key={p.layer} opacity={(p.alpha ?? 1) * (hotLayer && hotLayer !== p.layer ? 0.45 : 1)}
                    points={p.points.map(([x, y]) => `${x},${y}`).join(' ')}
                    fill={p.color} fillOpacity={hotLayer === p.layer ? 0.16 : 0.07}
                    stroke={c.stroke} strokeWidth={(hotLayer === p.layer ? 3 : 2) / viewport.zoom}
                  />
                );
              })}
            </g>
          </svg>
        )}
        {/* Diff marks are drawn **under** the canvas and must come **before** it (both are absolute
            inset:0, DOM order is stacking order). The light shows from behind the primitives, so the diff covers not one pixel of
            the user's primitives. Reasons at the top of DiffOverlay.tsx. */}
        {/* **Both branches need a key.** Without one they are both same-level `div`s and React reuses the DOM node
            in place, changing only className, while that node is occupied by cytoscape as its container (it puts a
            canvas inside and writes its own inline styles on it). After reuse React puts two columns into the same node,
            fighting cytoscape for the same DOM, and **the whole stage goes blank**. The key forces an unmount and rebuild,
            and the instance effects rerun with it. */}
        {panes ? (
          /* Left = before, right = now, sharing one set of coordinates and one viewport: "unchanged things are the same
             screen pixel in both columns" is the whole value of two columns. */
          <div className="gb-panes" key="panes">
            <div className="gb-pane">
              {!prog && (
                <DiffOverlay
                  delta={diff!} geom={pastGeom} viewport={viewport} only={diffOnly}
                  side="past"
                  // Nodes filtered out by the view take their marks with them, or a ring of light with no owner would float in empty space.
                  visible={filtering ? resolved.visible : null}
                />
              )}
              <div ref={mirrorElRef} className="gb-canvas" />
              <canvas ref={mirrorCanvasRef} className="gb-labels" />
              <div className="gb-pane-tag">{diff!.labels.before} · {strings.past}</div>
            </div>
            <div className="gb-pane">
              {!prog && (
                <DiffOverlay
                  delta={diff!} geom={diffGeom} viewport={viewport} only={diffOnly}
                  side="now"
                  visible={filtering ? resolved.visible : null}
                />
              )}
              <div ref={containerRef} className="gb-canvas" />
              <canvas ref={labelCanvasRef} className="gb-labels" />
              <div className="gb-pane-tag gb-pane-now">{diff!.labels.after} · {strings.now}</div>
            </div>
            {/* Which way time flows. Centered on the seam between the columns, **purely indicative**: takes no events, no width.
                Built on a circle of radius 12.16: both sides of the 90° head are tangent to it, the shaft is its diameter and half the head's
                height; the shaft is long enough that shaft : head is the golden ratio, and its area centroid sits on the seam (box centered, nudged 1.5px right). */}
            <div className="gb-flow" aria-hidden>
              <svg viewBox="-32 -25 64 50"><path d="M-31.84,-12.16 H7.52 V-24.32 L31.84,0 L7.52,24.32 V12.16 H-31.84 Z" fill={theme.canvas} /></svg>
            </div>
          </div>
        ) : (
          <div ref={containerRef} className="gb-canvas" key="solo" />
        )}
        {/* The text layer: stacked above cytoscape, so text is always above every node. Takes no events.
            The two diff columns each have one, in their own column. */}
        {!panes && <canvas ref={labelCanvasRef} className="gb-labels" />}
        {platesOn && (
          <svg className="gb-plane-labels" style={{ opacity: plateAlpha }}>
            <g transform={`translate(${viewport.pan.x},${viewport.pan.y}) scale(${viewport.zoom})`}>
              {plates.map((p) => (
                <text
                  key={p.layer} opacity={p.alpha ?? 1} x={p.anchor[0]} y={p.anchor[1]}
                  fontSize={22 / viewport.zoom} fill={plateColors(theme, p.color).text} fontWeight={700}
                  stroke={theme.canvas} strokeWidth={4 / viewport.zoom} paintOrder="stroke"
                  style={{ userSelect: 'none', pointerEvents: 'auto', cursor: 'default' }}
                  onMouseEnter={() => hoverLayer(p.layer)} onMouseLeave={() => hoverLayer(null)}
                >{p.label}</text>
              ))}
            </g>
          </svg>
        )}
        {!compact && (
          <Toolbar
            view={view} setView={setView}
            layers={layersHere} origins={origins}
            stats={stats}
            busy={!!prog} controls={controls}
            search={search} colorOf={colorOf} onPreview={preview} onPick={pick}
            inputRef={searchInputRef} onAdd={editable ? startAdd : undefined}
            onRelayout={controls.relayout && !diff ? relayout : undefined}
          />
        )}
        {(note || model.errors.length > 0 || (legend && !compact)) && (
          /* Bottom left: the host's caption (if any) on top, the legend below. Top left is tools, bottom right is the camera. */
          <div className="gb-bl">
            {((note && !(legend && !compact)) || model.errors.length > 0) && (
              <div className="gb-note">
                {!(legend && !compact) && note}
                {model.errors.length > 0 && (
                  // The names must appear on this line. Reporting only a number, "16 sources could not be parsed" sends people back to
                  // try the files one by one, while locating them only takes printing the origin. The full list is in title.
                  <span className="gb-warn" title={model.errors.map((e) => `${e.origin}: ${e.message}`).join('\n')}>
                    {strings.parseErrors(model.errors.length,
                      model.errors.slice(0, 2).map((e) => e.origin).join(', ') + (model.errors.length > 2 ? ', …' : ''))}
                  </span>
                )}
              </div>
            )}
            {legend && !compact && (
              <div className={`gb-legend${legendCollapsed ? ' is-collapsed' : ''}`}>
                <Legend
                  model={model} profile={lookProfile} theme={theme}
                  look={look} onLook={setLook} cy={liveCy} delta={diff}
                  hidden={{ nodes: view.hiddenNodeKinds ?? [], edges: view.hiddenEdgeKinds ?? [] }}
                  onToggle={(which, kind) => {
                    const key = which === 'nodes' ? 'hiddenNodeKinds' : 'hiddenEdgeKinds';
                    const cur = view[key] ?? [];
                    setView({ [key]: cur.includes(kind) ? cur.filter((x) => x !== kind) : [...cur, kind] });
                  }}
                  onEmphasis={setLegendEmphasis}
                  onShowAll={() => setView({ hiddenNodeKinds: [], hiddenEdgeKinds: [] })}
                  collapsed={legendCollapsed} onCollapsed={setLegendCollapsed} caption={note}
                />
              </div>
            )}
          </div>
        )}
        {!compact && (
          <ZoomDock
            zoom={controls.zoom} onZoom={zoomBy} onFit={fit}
            issues={showIssues ? issues : []} onPick={pick}
          />
        )}
        {prog && (
          <div className="gb-mask">
            <div><span className="gb-spin" />{prog.total > 0 ? strings.layingOut(prog.done, prog.total) : strings.preparing}</div>
          </div>
        )}
        {compact && (
          <div style={{ position: 'absolute', bottom: 4, left: 8, fontSize: 10.5, opacity: 0.6, pointerEvents: 'none' }}>
            {strings.stats(stats.nodes, stats.edges)}
          </div>
        )}
      </div>
      <Drawer>
        {editPanel || (detailPanel && selected ? (
          <DetailPanel
            key={selected.id}
            node={selected} spec={profile.detail} kindLabels={profile.kindLabels}
            onClose={() => setSelected(null)} renderText={renderText}
            onEdit={editable ? () => setEditing({ what: 'node', id: selected.id }) : undefined}
            color={colorOf(selected.id)}
            markdown={{
              resolveUrl: resolveUrl ? (u) => { const n = model.index.get(selected.id); return n ? resolveUrl(u, n) : null; } : undefined,
              onNodeLink: pick,
            }}
          />
        ) : null)}
      </Drawer>
    </div>
    </StringsContext.Provider>
  );
}

export type { SelectedNode };
