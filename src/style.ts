/* glassbrain · styles
 *
 * **Hue comes from configuration; everything else is computed from data.**
 *
 * All nodes are equal: a default node and a feature node differ in nothing essential, each is "a kind + how much hangs under it".
 *   color = kind. One flat color per kind (`profile.nodePalette`), not varying with size: color answers
 *           "what is it", size answers "how much hangs off it", one channel says one thing. Kinds not in the palette (containers,
 *           the virtual root, placeholders) are **default nodes**: they are the skeleton itself, so they use the skeleton ramp: the more
 *           hangs off them the brighter, the same color family as the containment edges of their level.
 *   size  = floor × (1 + a log(descendant leaves) share), capped at 1.8×: visible, but not stealing the show.
 *           Nodes with content (kind in the palette) get another ×1.5 on the floor: content is the star, default nodes are the backdrop.
 *
 * Structural hierarchy is carried by **edges**: containment edges (connected mode) use the full skeleton ramp, trunk dark and thick, leaves light and thin;
 * in box mode it is the nesting itself. Each semantic edge kind gets one color (`edgePalette`); width and line opacity follow weight.
 *
 * So there is only one structural color to configure (`theme.skeleton`): containment edges and default nodes both use its ramp. Placeholders (declared in the structure, content not filled yet) are default nodes; see `profile.placeholderFlags`.
 *
 * Four stylesheet layers, later wins, assembled in one place (`graphStyle`):
 *   ① base `baseStyle`           default nodes, skeleton, common look
 *   ② palette `paletteStyle`     semantic colors, plus "placeholders fall back to default"
 *   ③ `profile.style`            the escape hatch: shapes, dashes, whatever colors cannot express
 *   ④ diff                       lifts selection / hits back to the top
 *
 * **The stylesheet holds only "what it looks like"; inline styles on elements belong to the canvas.** Inline styles (cytoscape bypasses) are
 * used by GraphCanvas's time channels: transition presence / reskin. Hosts should not write inline styles on elements: doing so
 * fights these channels over the same property, last write wins. Node labels are not drawn by cytoscape while the readability field is on but by
 * a layer the canvas stacks on top (text always above nodes); see GraphCanvas's label channel.
 *
 * **Widths and thicknesses are graph units.** In browse mode the picture is drawn by paint.ts: it reads values computed from this sheet and
 * converts them by zoom to on-screen sizes (too small to draw becomes fainter, the skeleton has a floor from afar, semantic edges are hairlines);
 * those rules are at the top of paint.ts. This only says "how big on the graph, and what color".
 *
 * cytoscape cannot read CSS variables (canvas rendering), so the theme is an object; to reskin, the host passes
 * a theme in. Default is light.
 */
import { cls } from './elements';
import type { GraphProfile } from './profile';

export interface GraphTheme {
  /** Canvas background. The skeleton's light end is mixed from it, so a dark theme with a new background gets a matching skeleton automatically. */
  canvas: string;
  /** Skeleton color: the dark end of the containment edge ramp; default nodes take its light end. The only structural color to configure. */
  skeleton: string;
  nodeBorder: string; nodeText: string;
  /** Semantic edges with no palette entry. */
  edge: string; edgeText: string; edgeTextBg: string;
  selected: string; hit: string;
  /** Color of the faint glow around the hovered element. */
  halo: string;
}

/** Default hues for 2.5D layer plates (used in rotation when a layer has no color). Hue only, theme independent: the plate's
 *  actual color is mixed from the canvas background by `plateColors`. */
export const PLANE_HUES = ['#64748b', '#6366f1', '#14b8a6', '#ef4444'];

/** How layer plates are colored: the layer color only gives a hue; the plate is the canvas color with a little of it, the stroke a bit more, the layer name in the pure color.
 *  Same idea as default nodes taking "the skeleton's light end": on a dark background, plates automatically become a faint tint over dark. */
export const plateColors = (theme: GraphTheme, hue: string) => ({
  fill: mixHex(theme.canvas, hue, 0.1),
  stroke: mixHex(theme.canvas, hue, 0.45),
  text: mixHex(theme.canvas, hue, 0.85),
});

export const LIGHT_THEME: GraphTheme = {
  canvas: '#ffffff', skeleton: '#2563eb',
  // Strokes use the canvas color to outline nodes against edges / neighbors: nodes carry most of the visual weight and have no box to give them presence.
  nodeBorder: '#ffffff', nodeText: '#1f2937',
  edge: '#94a3b8', edgeText: '#6b7280', edgeTextBg: '#ffffff',
  selected: '#0ea5e9', hit: '#f59e0b', halo: '#475569',
};

/** Dark. No adding transparency to nodes and edges to "sort of work on both": translucent nodes darken as they stack and edges show through
 *  nodes, which looks dirty. Colors are mixed from `canvas` anyway: the light ends of default nodes and containment edges follow a new background
 *  automatically, so this only swaps background, text and stroke to the dark set and brightens the skeleton a notch (on dark it must be bright enough
 *  for the ramp to read). Semantic colors (palette) belong to the profile; mid-tone solids hold up on dark as they are. */
export const DARK_THEME: GraphTheme = {
  canvas: '#0f172a', skeleton: '#60a5fa',
  nodeBorder: '#0f172a', nodeText: '#e2e8f0',
  edge: '#64748b', edgeText: '#94a3b8', edgeTextBg: '#0f172a',
  selected: '#38bdf8', hit: '#fbbf24', halo: '#e2e8f0',
};

/* Style curve (visual only, no effect on forces, changing it does not trigger relayout):
 * t = share^GAMMA. γ<1 = "from the center outward: slow decline first, then the periphery thins and fades fast". */
const STYLE_GAMMA = 0.4;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const mixHex = (a: string, b: string, t: number) => {
  const c = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  return '#' + [1, 3, 5].map((i) => Math.round(lerp(c(a, i), c(b, i), t)).toString(16).padStart(2, '0')).join('');
};

/** The containment edge ramp: t=0 is the canvas color, t=1 the skeleton color. The leaf end starts at 0.45: the skeleton is the graph's structure,
 *  and even the finest level must stand apart from the canvas (it used to start at 0.2, and on dark the leaf level was nearly the background,
 *  so from afar the whole frame disappeared). */
const EDGE_FLOOR = 0.45;
/** share mapped to a ramp position t ∈ (0,1]. Containment edge color, default node color and the skeleton's far-away floor
 *  (paint.ts) all read this one number. */
export const shareT = (share: number) => Math.pow(Math.max(0.005, Math.min(1, share)), STYLE_GAMMA);

/** Containment edge color at a given share. The stylesheet and the host's legend use the same function: the ramp in the legend must
 *  be the one on the graph, not a second copy. */
export const skeletonColor = (theme: GraphTheme, share: number) =>
  mixHex(theme.canvas, theme.skeleton, lerp(EDGE_FLOOR, 1, shareT(share)));

/** Default node color: on the skeleton ramp, starting a notch higher than containment edges (a node must stand out from the lines
 *  it hangs on). The more hangs off it, the brighter: default nodes are modules, groups, overviews, they are the skeleton.
 *  It used to be a constant (0.4 of the skeleton color) and nearly merged with the background on dark. */
const NODE_FLOOR = 0.65;
export const defaultNodeColor = (theme: GraphTheme, share = 0) =>
  mixHex(theme.canvas, theme.skeleton, lerp(NODE_FLOOR, 1, shareT(share)));

/** Node size: floor diameter × (1 + up to 80%), growing with the log of descendant leaves, capped at 64 leaves.
 *  Absolute leaf counts rather than a share of the whole graph: the same module should be the same size in a large graph and a small one.
 *  With huge node counts, nodes come first and text is an extra layer (see layout/readability.ts); what grows is density, not nodes. */
export const NODE_BASE = 30;
const NODE_GROWTH = 0.8;
const LEAVES_SATURATE = 64;
/** Nodes with content (kind in the palette) get this much more floor: they are the stars of the graph, default nodes the backdrop.
 *  Still one rule, "content stands out more", not a special case for some kind. */
export const CONTENT_SCALE = 1.5;

/** A normalized "how much hangs off it" ∈[0,1]: node size, label font size and who gets a spot first all read this one number. */
export const nodeWeight = (leaves: number): number =>
  Math.min(1, Math.log2(1 + Math.max(0, leaves)) / Math.log2(1 + LEAVES_SATURATE));

/** Node diameter. scale is a pure look knob (GraphCanvas's `nodeScale`), so it goes into the stylesheet instead of
 *  being written per element: one new sheet changes everything, and a rebuilt instance gets it from the new sheet naturally. */
export const nodeDiameter = (leaves: number, scale = 1): number =>
  NODE_BASE * (1 + NODE_GROWTH * nodeWeight(leaves)) * scale;

/** Edge weight (0–1, the data's "strength", e.g. confidence) → width and line opacity. Edges without weight
 *  are unaffected. Uses `line-opacity` rather than `opacity`: the latter belongs to the transition's "presence" channel. */
const weightOf = (el: any): number | null => {
  const w = el.data('weight');
  return typeof w === 'number' ? Math.max(0, Math.min(1, w)) : null;
};
/** Base width of semantic edges (model units): what an edge without weight gets. The painter treats it as 1 screen pixel and draws
 *  other widths proportionally: weight and per-kind multipliers (`profile.edgeWidth`) multiply this. */
export const EDGE_W = 4.2;
const edgeWidthOf = (el: any) => { const w = weightOf(el); return w === null ? EDGE_W : lerp(3, 9, w); };

/** The widest a name may be on the graph (in multiples of the font size, about 16 CJK characters / 28 letters). Longer ones are truncated with an ellipsis:
 *  a long sentence on the graph reads like a paragraph, not a name, and wrapping turns the label box into a block. The full name is in the detail panel and search dropdown. Layout measures
 *  label boxes with this width (the stylesheet's `text-max-width`), and drawing uses it too: what is judged, placed and drawn is one box. */
export const LABEL_MAX_EM = 16;

export function baseStyle(theme: GraphTheme = LIGHT_THEME, nodeScale = 1): any[] {
  const edgeSkeleton = (el: any) => skeletonColor(theme, el.data('share') ?? 0);
  const nodeSize = (el: any) => nodeDiameter(el.data('leaves') ?? 0, nodeScale);
  const nodeFill = (el: any) => defaultNodeColor(theme, el.data('share') ?? 0);
  return [
    {
      selector: 'node',
      style: {
        shape: 'ellipse', width: nodeSize, height: nodeSize, 'underlay-shape': 'ellipse',
        'border-width': 1.5, 'border-color': theme.nodeBorder, 'background-color': nodeFill,
        // Labels hang below the node and do not enlarge it. This is the label size of **the graph itself** (what layout measures).
        // With the readability field on this text is not shown; on-screen text is drawn by the layer the canvas stacks on top (graphStyle's
        // overlayLabels). When it is off, and in the two diff columns, it is this text.
        label: 'data(label)', 'font-size': 13, 'font-family': 'ui-sans-serif, system-ui, sans-serif',
        color: theme.nodeText, 'text-valign': 'bottom', 'text-halign': 'center',
        'text-wrap': 'ellipsis', 'text-max-width': `${13 * LABEL_MAX_EM}px`,
        'text-margin-y': 10, 'text-background-color': theme.edgeTextBg, 'text-background-opacity': 0.8,
        'text-background-padding': '1px',
      },
    },
    {
      selector: 'edge',
      style: {
        width: edgeWidthOf,
        'line-opacity': (el: any) => { const w = weightOf(el); return w === null ? 1 : lerp(0.35, 1, w); },
        'curve-style': 'unbundled-bezier', 'control-point-distances': 30,
        'control-point-weights': 0.5, 'target-arrow-shape': 'triangle',
        'line-color': theme.edge, 'target-arrow-color': theme.edge,
        label: 'data(label)', 'font-size': 9, color: theme.edgeText,
        'text-background-color': theme.edgeTextBg, 'text-background-opacity': 0.85,
        'text-background-padding': '2px',
        // Semantic edges are drawn **above** containment edges. Structure comes from containment; semantic edges are drawn on top, so they sit on top.
        // Containment edges are thick and dense, a backdrop by nature; semantic edges are thin and sparse, exactly the layer to look at.
        'z-index': 2,
      },
    },
    // Structural containment edges (connected mode): the skeleton ramp, thicker and darker toward the center, leaves thinnest and lightest. Structural
    // hierarchy is their job, so nodes no longer shout. They are the backdrop, so below semantic edges (and still below all nodes).
    {
      selector: 'edge.contains',
      style: {
        width: (el: any) => lerp(3, 15, shareT(el.data('share') ?? 0)), 'curve-style': 'bezier',
        'line-color': edgeSkeleton, 'target-arrow-color': edgeSkeleton,
        'target-arrow-shape': 'triangle', 'arrow-scale': 0.7, label: '', 'z-index': 1,
      },
    },
    // Box mode containers (compound parents): an **area**, not a point; a solid fill would bury everything inside.
    // So the fill is only a thin tint and the stroke uses the skeleton ramp (same as containment edges); each level of nesting adds
    // a layer, deeper means darker, and the structure shows by itself. The color is still its own kind's color.
    {
      selector: 'node:parent',
      style: {
        shape: 'round-rectangle', 'underlay-shape': 'round-rectangle', 'background-opacity': 0.12,
        'border-width': 1.5, 'border-color': edgeSkeleton,
      },
    },
    // Cross-layer edges: in 2.5D these are the "links between layers", toned down to thin and translucent so they do not compete with structure.
    { selector: 'edge.crosslayer.gb-planes', style: { width: EDGE_W, opacity: 0.55, 'curve-style': 'straight' } },
    /* ── Hover and selection: two orthogonal channels that can stack ──────────────────────────────
     * Hover = attention, temporary. **It is not in this sheet**: in browse mode the picture belongs to paint.ts, and hover multiplies
     * the whole graph by an opacity while drawing, then draws the focused hop again on top: one hover changes no element's style.
     * (It used to add classes to thousands of elements and let cytoscape tween them: hundreds of ms per hover.)
     * Selection = identity, persistent. Here nodes only get an accent stroke; the truly prominent ring is drawn on the text layer, so it
     * stays prominent while hover dims what is below. */
    { selector: 'node:selected', style: { 'border-width': 3, 'border-color': theme.selected } },
    { selector: 'node.gb-hit', style: { 'border-width': 3, 'border-color': theme.hit } },
  ];
}

/* ── Dark: the palette switches to a matching set automatically, configured once ───────────────────────────────
 *
 * Palettes are designed for a light background. Used as is on dark, black breaks first: the most prominent color on light (hubs)
 * merges with the background on dark. The approach: **flip each color's lightness by "how far it is from the canvas"**, keeping hue and chroma:
 *   · Lightness is OKLCH's L, the perceptually uniform one (how bright it is in a black-and-white photo), not an RGB average.
 *   · However far a color is from the white background on light, it is that proportion from the dark background on dark: `L' = lc + (1−L)(1−lc)`,
 *     where `lc` is the canvas's own lightness. Dark is not pure black, the usable range is shorter, so everything scales down proportionally.
 *   · One formula for every color, no thresholds: the order of light and dark is the same on both sides; light candy colors become dark colors
 *     of the same hue on dark, and the darkest color on light (the hubs' black) becomes the brightest on dark.
 * Chroma is carried over **relatively**, not as an absolute value: the fraction of the maximum chroma sRGB allows at that lightness
 * stays the same at the new lightness. Absolute values cannot be carried: the dark end cannot hold a yellow as vivid as the light end, it
 * would be clipped, and clipping cannot be undone; carried proportionally, both ends fit. So a darkened yellow is an equally "full" dark yellow (i.e. brown), and the flip is a one-to-one
 * map that can be solved back: picking white in the color picker under dark stores black, and showing it again gives white (`untheme`).
 * Light backgrounds return as is. */

type Lch = [number, number, number];
const srgbToLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linToSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function hexToLch(hex: string): Lch {
  const [r, g, b] = [1, 3, 5].map((i) => srgbToLin(parseInt(hex.slice(i, i + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), Math.atan2(B, A)];
}
function lchToRgb([L, C, H]: Lch): number[] {
  const A = C * Math.cos(H), B = C * Math.sin(H);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(linToSrgb);
}
/** Back to sRGB; when out of gamut, only reduce chroma (hue and lightness unchanged) until it fits. */
function lchToHex(c: Lch): string {
  let [L, C, H] = c;
  L = Math.min(1, Math.max(0, L));
  const fits = (k: number) => lchToRgb([L, k, H]).every((v) => v >= -1e-4 && v <= 1 + 1e-4);
  if (!fits(C)) { let lo = 0, hi = C; for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; if (fits(mid)) lo = mid; else hi = mid; } C = lo; }
  return '#' + lchToRgb([L, C, H]).map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
}
const canvasL = (theme: GraphTheme) => hexToLch(theme.canvas)[0];
/** The maximum chroma sRGB can hold at this lightness and hue. */
function maxChroma(L: number, H: number): number {
  let lo = 0, hi = 0.4;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (lchToRgb([L, mid, H]).every((v) => v >= -1e-4 && v <= 1 + 1e-4)) lo = mid; else hi = mid;
  }
  return lo;
}
/** Change lightness with hue fixed, carrying chroma as "the fraction of the maximum possible at this lightness": both ends fit, so
 *  this step is strictly invertible (up to hex rounding). */
function relight(hex: string, to: (L: number) => number): string {
  const [L, C, H] = hexToLch(hex);
  const s = Math.min(1, C / Math.max(1e-6, maxChroma(L, H)));
  const L2 = Math.min(1, Math.max(0, to(L)));
  return lchToHex([L2, s * maxChroma(L2, H), H]);
}

/** What a palette color is drawn as under this theme. Light backgrounds return as is. */
export function themeColor(theme: GraphTheme, hex: string): string {
  const lc = canvasL(theme);
  if (!/^#[0-9a-f]{6}$/i.test(hex) || lc >= 0.5) return hex;
  return relight(hex, (L) => lc + (1 - L) * (1 - lc));
}

/** The inverse of `themeColor`: a color picked in the color picker under dark is stored as what it should be on light. */
export function untheme(theme: GraphTheme, hex: string): string {
  const lc = canvasL(theme);
  if (!/^#[0-9a-f]{6}$/i.test(hex) || lc >= 0.5) return hex;
  return relight(hex, (L) => 1 - (L - lc) / (1 - lc));
}

/**
 * Palette → cytoscape rules (layer ②). Semantics only: node fill (plus "content gets a size bigger floor"),
 * edge line / arrow color, plus per-kind size multipliers (`nodeSize` / `edgeWidth`). Colors go through `themeColor`: on dark they switch to the matching set automatically.
 *
 * At the end each of `placeholderFlags` gets a "fall back to default" rule: placeholder nodes carry their own kind (they **are**
 * feature nodes, just still empty), so they hit the kind's semantic color first; the rule after it pushes them back to
 * the default node color. Same priority, later wins: the order is the semantics.
 */
export function paletteStyle(
  profile: Pick<GraphProfile, 'nodePalette' | 'edgePalette' | 'placeholderFlags'> & Partial<Pick<GraphProfile, 'nodeSize' | 'edgeWidth'>>,
  theme: GraphTheme = LIGHT_THEME,
  nodeScale = 1,
): any[] {
  const out: any[] = [];
  const contentSize = (el: any) => nodeDiameter(el.data('leaves') ?? 0, nodeScale) * CONTENT_SCALE;
  const plainSize = (el: any) => nodeDiameter(el.data('leaves') ?? 0, nodeScale);
  for (const [kind, color] of Object.entries(profile.nodePalette ?? {})) {
    out.push({
      selector: `node.${cls(kind)}`,
      style: { 'background-color': themeColor(theme, color), width: contentSize, height: contentSize },
    });
  }
  for (const [kind, raw] of Object.entries(profile.edgePalette ?? {})) {
    const color = themeColor(theme, raw);
    out.push({
      selector: `edge.${cls(kind)}`,
      style: { 'line-color': color, 'target-arrow-color': color, 'source-arrow-color': color },
    });
  }
  for (const [kind, k] of Object.entries(profile.nodeSize ?? {})) {
    if (k === 1) continue;
    const base = kind in (profile.nodePalette ?? {}) ? contentSize : plainSize;
    const size = (el: any) => base(el) * k;
    out.push({ selector: `node.${cls(kind)}`, style: { width: size, height: size } });
  }
  for (const [kind, k] of Object.entries(profile.edgeWidth ?? {})) {
    if (k !== 1) out.push({ selector: `edge.${cls(kind)}`, style: { width: (el: any) => edgeWidthOf(el) * k } });
  }
  for (const flag of profile.placeholderFlags ?? []) {
    out.push({
      selector: `node.${cls(flag)}`,
      style: { 'background-color': (el: any) => defaultNodeColor(theme, el.data('share') ?? 0), width: plainSize, height: plainSize },
    });
  }
  return out;
}

/** A complete stylesheet, four layers, later wins (see the file header). diff coming last is required: the color channel normally
 *  belongs to the user, and diff mode must be able to take it back.
 *
 *  `overlayLabels`: node text is drawn by the layer the canvas stacks on top; cytoscape's own labels remain only for layout to measure
 *  sizes (`text-opacity` 0 does not change sizes) and are not shown. cytoscape draws element by element, "node then label",
 *  so a later node always covers an earlier label: "text always above every node" can only be kept with a separate layer. */
export function graphStyle(
  theme: GraphTheme,
  profile: Pick<GraphProfile, 'nodePalette' | 'edgePalette' | 'placeholderFlags' | 'style'> & Partial<Pick<GraphProfile, 'nodeSize' | 'edgeWidth'>>,
  opts: { diff?: boolean; nodeScale?: number; overlayLabels?: boolean } = {},
): any[] {
  return [
    ...baseStyle(theme, opts.nodeScale), ...paletteStyle(profile, theme, opts.nodeScale),
    ...(profile.style as any[]),
    ...(opts.diff ? diffStyle(theme) : []),
    ...(opts.overlayLabels ? [{ selector: 'node', style: { 'text-opacity': 0, 'text-background-opacity': 0 } }] : []),
  ];
}

/* ── diff UI language ───────────────────────────────────────────────────── */

/**
 * **One rule runs through all of it: the column carries the information, hue only reinforces.**
 *
 * Primitive colors normally belong to the user (`profile.style` writes whatever it likes). diff used to map five change categories
 * to one color each, which **squeezes the "time" dimension into the "color" dimension**, and the color budget is
 * small to begin with and must also carry domain semantics and selection / hits. Overflowing it is structural.
 *
 * With two columns there is nothing to argue: **"which column" already says added and removed**. Only on the left means removed,
 * only on the right means added, and hue becomes redundant reinforcement, which is the only safe use of red and green.
 *
 *   added (right only)  teal-leaning green      removed (left only)  dark red      changed (marked in both)  pale yellow
 *
 * It must also work for red-green color blindness (about 8% of men), three things together:
 *
 *   ① **columns**: red and green **are never side by side**. Within a column only two pairs need telling apart: left "removed vs changed",
 *      right "added vs changed".
 *   ② **green leans toward teal**: red-green color blind people keep the blue-yellow axis, so the right pair becomes blue vs yellow, at a glance.
 *   ③ **red pushed darker, yellow lifted lighter**: on the red-green axis the left pair merges into one yellow-brown, so **lightness**
 *      does the work: the three levels go removed < added < changed, separable by lightness alone. (Added and removed are close in lightness, but
 *      they are never in the same column and need no lightness to tell apart.)
 *
 * **The exact values may change any time; only the principles are written here.** For the current colors look at the lines below, do not
 * look for a second copy elsewhere: the CSS fallback and the demo legend both read from here.
 */
export const DIFF_INK = {
  /** Only in the new version. **Teal-leaning green**, not pure green. */
  added: '#009a50',
  /** Only in the old version. **Dark red**, not pure red: the darkest of the three. */
  removed: '#9d3b3b',
  /** In both but different. **Pale yellow**: the brightest level, and bright enough by a clear margin. */
  changed: '#e3d497',
  /** Ink for the "merged" counterpart line. **Its only user**: on the left, "which new one did the old one merge into" is
   *  the one relation no edge can express, so a line is drawn for it. */
  past: '#94a3b8',
};

/** The classes that belong only to the reference version (the "past"). */
export const PAST_KINDS = new Set(['removed', 'merged']);

/** Ink for legend swatches. The graph and the legend must be one truth. */
export const DIFF_COLORS: Record<string, string> = {
  added: DIFF_INK.added,
  changed: DIFF_INK.changed,
  moved: DIFF_INK.changed,
  removed: DIFF_INK.removed,
  merged: DIFF_INK.removed,
};

/**
 * The diff mode style layer. **Appended after the profile**, so it can override domain colors, but it now overrides
 * no domain rule at all:
 *
 * The left column is the old version itself and the right the new version itself; both should look as they always do, **neither side needs
 * to be desaturated**. All change marks come from the overlay, and the overlay is drawn **under** the canvas, so diff covers not one
 * pixel of the user's primitives.
 *
 * The remaining two rules lift selection / hits back to the top: that is the user's attention right now, ahead of any mark.
 */
export function diffStyle(theme: GraphTheme = LIGHT_THEME): any[] {
  return [
    { selector: 'node:selected', style: { 'border-width': 4, 'border-color': theme.selected } },
    { selector: 'node.gb-hit', style: { 'border-width': 4, 'border-color': theme.hit } },
  ];
}

/** Styles for host UI (toolbar / detail panel). CSS variables the host can override, with defaults,
 *  so an offline single-file page looks good without configuring any. */
export const GK_CSS = `
.gb-root { display:flex; height:100%; min-height:0; font-family: var(--gb-font, ui-sans-serif, system-ui, sans-serif);
  color: var(--gb-text, #1f2937); position:relative; container-type:inline-size; container-name:gk; }
.gb-stage { flex:1; min-width:0; position:relative; }
.gb-canvas { position:absolute; inset:0; }
/* The node text layer: cytoscape's canvases are z-index 1–3; this one sits above them and below the toolbar.
   canvas is a replaced element; inset alone is not enough, it needs an explicit 100%. */
.gb-labels { position:absolute; left:0; top:0; pointer-events:none; z-index:4; }
/* ── Two columns ────────────────────────────────────────────────────────────────
 * The two columns are two views of the same union graph, **sharing one set of coordinates and one viewport**. So this only
 * splits the stage in two and does nothing else: "unchanged things are the same screen pixel in both columns" is computed,
 * not laid out. */
.gb-panes { position:absolute; inset:0; display:flex; }
.gb-pane { flex:1; min-width:0; position:relative; overflow:hidden; }
.gb-pane + .gb-pane { border-left:1px solid var(--gb-border,#e2e8f0); }
/* Column names hug the seam at the bottom edge: top left is the toolbar, bottom left the legend, bottom right the camera; the bottom edge on either side of
 * the seam is the only place empty in both columns, and left-then-right reads as "before → now". */
.gb-pane-tag { position:absolute; bottom:12px; right:12px; z-index:6; pointer-events:none;
  font-size:11px; font-weight:600; letter-spacing:.02em; color: var(--gb-muted,#64748b);
  background: var(--gb-panel,rgba(255,255,255,.88)); border:1px solid var(--gb-border,#e2e8f0);
  border-radius:var(--gb-r-face,10px); padding:3px 8px; }
.gb-pane-now { color: var(--gb-text,#1f2937); right:auto; left:12px; }
/* The direction of time. **Purely indicative**: takes no events, no width (absolutely positioned, centered on the seam). A big hollow
 * block arrow stamped on the seam, not a round button: nothing about it should invite a click. Filled with the canvas color
 * (set inline) so labels behind it do not show through. */
.gb-flow { position:absolute; left:50%; top:50%; transform:translate(calc(-50% + 1.5px),-50%); z-index:6; pointer-events:none; }
.gb-flow svg { width:64px; height:50px; display:block; overflow:visible; }
.gb-flow path { stroke: var(--gb-muted2,#94a3b8); stroke-opacity:.7; stroke-width:1.4;
  stroke-linejoin:round; vector-effect:non-scaling-stroke; }
/* The in-column truncation notice sits one line above the column name. */
.gb-pane .gb-diff-trunc { top:auto; left:auto; bottom:44px; right:12px; }
.gb-planes, .gb-plane-labels { position:absolute; inset:0; width:100%; height:100%;
  pointer-events:none; overflow:hidden; }
/* svg is a replaced element: inset:0 alone falls back to its intrinsic 300x150, so it needs an explicit 100%. */
/* Plates are drawn **under** the graph (cytoscape's canvases are z-index 1–3); layer names **above**,
   or nodes at the same spot would cover them. */
.gb-plane-labels { z-index: 5; }
/* ── Tools resident on the canvas ──────────────────────────────────────────────────────
 * Top left is "what to look at" (search, layers, view ⋯), bottom right is the camera. All float over the graph: translucent background + blur,
 * radius 10, a very faint shadow: the graph is the star, the tools are a few buttons on glass. */
.gb-bar { position:absolute; top:12px; left:12px; right:12px; z-index:10; display:flex; flex-wrap:wrap;
  align-items:flex-start; gap:8px; pointer-events:none; }
.gb-bar > * { pointer-events:auto; }
.gb-ico { display:block; flex:none; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
/* Only four radius levels, which the host can override as a set:
 *   --gb-r-face    faces floating on the canvas (search box, zoom group, caption, column labels)
 *   --gb-r-pop     layers that pop out (dropdowns, panels, cards on overlays)
 *   --gb-r-in-face / --gb-r-in-pop   controls inside a face: outer radius minus padding (concentric), 10−3, 12−6
 *   --gb-r-chip    small inline tags (keycaps, kind tags, focus tags) */
.gb-field, .gb-segm, .gb-icon-btn, .gb-group, .gb-pill, .gb-note, .gb-chip, .gb-legend {
  background: var(--gb-panel, rgba(255,255,255,.86)); border:1px solid var(--gb-border,#e2e8f0);
  box-shadow: 0 1px 2px rgba(15,23,42,.05), 0 6px 18px -6px rgba(15,23,42,.12);
  -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); border-radius:var(--gb-r-face,10px); }
.gb-bar button, .gb-dock button { font-family:inherit; cursor:pointer; }
.gb-bar button:focus-visible, .gb-dock button:focus-visible { outline:2px solid var(--gb-accent,#0284c7); outline-offset:1px; }

/* Search: fixed width (it does not widen on focus: widening would push the layer toggle away, jumping sideways on every focus and blur),
 * a bit wider with a focus tag; the dropdown is a solid card (text must be readable, the graph must not show through), wider than the box. */
.gb-search { position:relative; width:260px; max-width:100%; transition: width .22s cubic-bezier(.3,.7,.2,1); }
.gb-field { display:flex; align-items:center; gap:7px; height:36px; padding:0 8px 0 11px;
  color: var(--gb-muted,#64748b); transition: border-color .15s, box-shadow .15s; }
.gb-search.is-focus .gb-field { border-color: var(--gb-accent,#0284c7);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--gb-accent,#0284c7) 16%, transparent), 0 6px 18px -6px rgba(15,23,42,.14); }
.gb-field input { flex:1; min-width:0; height:100%; border:0; background:transparent; outline:none; padding:0;
  font: inherit; font-size:13px; color: var(--gb-text,#1f2937); }
.gb-field input::placeholder { color: var(--gb-muted2,#94a3b8); }
.gb-field kbd, .gb-drop-keys kbd { font: 500 10.5px/1 ui-monospace, SFMono-Regular, monospace; color: var(--gb-muted,#64748b);
  border:1px solid var(--gb-border,#e2e8f0); border-bottom-width:2px; border-radius:var(--gb-r-chip,5px); padding:2px 5px;
  background: var(--gb-tint,#f8fafc); }
.gb-clear { display:grid; place-items:center; width:22px; height:22px; border:0; border-radius:var(--gb-r-chip,5px);
  background:transparent; color: var(--gb-muted2,#94a3b8); padding:0; }
.gb-clear:hover { background: var(--gb-tint,#f1f5f9); color: var(--gb-text,#1f2937); }
.gb-token { display:inline-flex; align-items:center; gap:4px; height:24px; max-width:140px; padding:0 3px 0 7px;
  border-radius:var(--gb-r-chip,5px); background: var(--gb-active,#e0f2fe); color: var(--gb-text,#1f2937); font-size:12px; flex:none; }
.gb-token > span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.gb-token button { display:grid; place-items:center; width:18px; height:18px; border:0; border-radius:calc(var(--gb-r-chip,5px) - 1px); padding:0;
  background:transparent; color: var(--gb-muted,#64748b); }
.gb-token button:hover { background: rgba(127,127,127,.18); color: var(--gb-text,#1f2937); }

.gb-drop, .gb-panel { position:absolute; top:calc(100% + 6px); left:0; z-index:12;
  background: var(--gb-panel2,#fff); border:1px solid var(--gb-border,#e2e8f0); border-radius:var(--gb-r-pop,12px);
  box-shadow: 0 2px 6px rgba(15,23,42,.06), 0 18px 40px -12px rgba(15,23,42,.24);
  padding:6px; transform-origin: top left; animation: gb-pop .14s cubic-bezier(.2,.8,.3,1); }
.gb-drop { width:max(100%, 360px); max-width:calc(100vw - 24px); }
.gb-drop ul { list-style:none; margin:0; padding:0; }
.gb-drop li { display:flex; align-items:center; gap:10px; padding:7px 9px; border-radius:var(--gb-r-in-pop,6px); cursor:pointer; }
.gb-drop li.on { background: var(--gb-tint,#f1f5f9); }
.gb-dot { width:9px; height:9px; border-radius:50%; flex:none; background: var(--gb-muted2,#94a3b8);
  box-shadow: 0 0 0 2px var(--gb-panel2,#fff), 0 0 0 3px var(--gb-border,#e2e8f0); }
.gb-r-main { flex:1; min-width:0; display:flex; flex-direction:column; gap:1px; }
.gb-r-label { font-size:13px; color: var(--gb-text,#1f2937); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.gb-r-label mark { background:none; color:inherit; font-weight:650;
  text-decoration: underline 2px color-mix(in srgb, var(--gb-accent,#0284c7) 45%, transparent); text-underline-offset:3px; }
.gb-r-path { font-size:11px; color: var(--gb-muted2,#94a3b8); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.gb-r-kind { flex:none; font-size:10.5px; color: var(--gb-muted,#64748b); border:1px solid var(--gb-border,#e2e8f0);
  border-radius:var(--gb-r-chip,5px); padding:1px 6px; }
.gb-drop-empty { padding:10px 9px; font-size:12.5px; color: var(--gb-muted,#64748b); }
.gb-drop-foot { display:flex; flex-direction:column; align-items:flex-start; gap:4px; margin-top:4px; padding:8px 9px 2px;
  border-top:1px solid var(--gb-border,#e2e8f0); font-size:11.5px; color: var(--gb-muted2,#94a3b8); }
.gb-drop-foot button { display:inline-flex; align-items:center; gap:4px; border:0; background:none; padding:0;
  font-size:12px; color: var(--gb-accent,#0284c7); }
.gb-drop-foot button:hover { text-decoration:underline; }
.gb-drop-keys { display:flex; align-items:center; gap:4px; padding:8px 9px 3px; font-size:10.5px; color: var(--gb-muted2,#94a3b8); }
.gb-drop-keys kbd { padding:1px 4px; }
.gb-drop-keys kbd + kbd { margin-left:-1px; }

/* Filtering by source: a tag you can × away, the same height as the toolbar. */
.gb-chip { display:inline-flex; align-items:center; gap:6px; height:36px; box-sizing:border-box; padding:0 6px 0 11px;
  max-width:220px; font-size:12.5px; color: var(--gb-text,#1f2937); background: var(--gb-active,#e0f2fe); }
.gb-chip > span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.gb-chip .gb-ico { color: var(--gb-accent,#0284c7); }
.gb-chip button { display:grid; place-items:center; width:22px; height:22px; border:0; padding:0; border-radius:var(--gb-r-chip,5px);
  background:transparent; color: var(--gb-muted,#64748b); }
.gb-chip button:hover { background: rgba(127,127,127,.18); color: var(--gb-text,#1f2937); }

/* Segmented: a backing slides to the current item. */
.gb-segm { position:relative; display:inline-flex; height:36px; padding:3px; box-sizing:border-box; }
.gb-segm > button { position:relative; z-index:1; height:28px; padding:0 12px; border:0; border-radius:var(--gb-r-in-face,7px);
  background:transparent; font-size:12.5px; font-weight:500; color: var(--gb-muted,#64748b); white-space:nowrap;
  transition: color .2s, background-color .2s; }
.gb-segm > button:hover:not(.on):not(:disabled) { color: var(--gb-text,#1f2937); }
.gb-segm > button.on { color: var(--gb-text,#1f2937); }
.gb-segm > button:disabled { cursor:default; opacity:.5; }
.gb-thumb { position:absolute; top:3px; left:0; height:28px; border-radius:var(--gb-r-in-face,7px); background: var(--gb-active,#e0f2fe);
  box-shadow: 0 1px 2px rgba(15,23,42,.08); transition: transform .3s cubic-bezier(.3,.7,.2,1), width .3s cubic-bezier(.3,.7,.2,1); }
/* Stacked layers on: layer names are multi-select, each lit on its own; no slider. */
.gb-layers.is-multi > button[data-v].on { background: var(--gb-active,#e0f2fe); box-shadow: 0 1px 2px rgba(15,23,42,.08); }
.gb-sep { align-self:center; width:1px; height:18px; margin:0 3px; background: var(--gb-border,#e2e8f0); }
.gb-segm > button.gb-stack { display:grid; place-items:center; width:30px; padding:0; color: var(--gb-muted2,#94a3b8); }
.gb-segm > button.gb-stack:hover:not(:disabled) { color: var(--gb-text,#1f2937); background: var(--gb-tint,#f1f5f9); }
.gb-segm > button.gb-stack.on { color: var(--gb-accent,#0284c7); background: var(--gb-active,#e0f2fe); }

.gb-menu { position:relative; }
.gb-icon-btn { display:grid; place-items:center; width:36px; height:36px; padding:0; color: var(--gb-muted,#64748b);
  transition: color .15s, background-color .15s; }
.gb-icon-btn:hover, .gb-icon-btn.on { color: var(--gb-text,#1f2937); }
.gb-icon-btn.on { background: var(--gb-active,#e0f2fe); }
.gb-panel { min-width:228px; }
.gb-panel-up { top:auto; bottom:calc(100% + 6px); left:auto; right:0; transform-origin: bottom right; animation-name: gb-pop-up; }
.gb-panel-sec + .gb-panel-sec { margin-top:4px; padding-top:4px; border-top:1px solid var(--gb-border,#e2e8f0); }
.gb-panel-h { padding:6px 8px 4px; font-size:10.5px; font-weight:600; letter-spacing:.05em; text-transform:uppercase;
  color: var(--gb-muted2,#94a3b8); }
.gb-panel-foot { margin-top:6px; padding:7px 8px 2px; border-top:1px solid var(--gb-border,#e2e8f0);
  font-size:11.5px; color: var(--gb-muted2,#94a3b8); font-variant-numeric: tabular-nums; }
.gb-select { width:100%; height:32px; margin:2px 0 4px; padding:0 8px; border:1px solid var(--gb-border,#e2e8f0);
  border-radius:var(--gb-r-in-pop,6px); background: var(--gb-panel2,#fff); color: var(--gb-text,#1f2937); font: inherit; font-size:12.5px; }

/* Bottom right: the camera. */
.gb-dock { position:absolute; right:12px; bottom:12px; z-index:10; display:flex; align-items:flex-end; gap:8px; }
.gb-group { display:inline-flex; overflow:hidden; }
.gb-group > button { display:grid; place-items:center; width:34px; height:34px; padding:0; border:0; background:transparent;
  color: var(--gb-muted,#64748b); transition: color .15s, background-color .15s; }
.gb-group > button:hover { color: var(--gb-text,#1f2937); background: var(--gb-tint,#f1f5f9); }
.gb-group > button:active { background: var(--gb-active,#e0f2fe); }
.gb-group > button + button { border-left:1px solid var(--gb-border,#e2e8f0); }
.gb-pill { display:inline-flex; align-items:center; gap:6px; height:34px; padding:0 11px; font-size:12.5px; }
.gb-issues { width:320px; max-height:340px; overflow:auto; padding-bottom:6px; }
.gb-issues details { border-top:1px solid var(--gb-border,#e2e8f0); }
.gb-issues summary { display:flex; align-items:center; gap:8px; padding:7px 12px; cursor:pointer; font-size:12.5px;
  color: var(--gb-text,#1f2937); list-style:none; }
.gb-issues summary::-webkit-details-marker { display:none; }
.gb-issues summary::before { content:''; width:5px; height:5px; border:solid var(--gb-muted2,#94a3b8); border-width:0 1.5px 1.5px 0;
  transform: rotate(-45deg); transition: transform .15s; flex:none; }
.gb-issues details[open] > summary::before { transform: rotate(45deg); }
.gb-issues summary:hover { background: var(--gb-tint,#f1f5f9); }
.gb-issues summary span { flex:1; }
.gb-issues summary b { font-weight:500; font-variant-numeric: tabular-nums; color: var(--gb-muted,#64748b); }
.gb-issues summary.is-err b { color: var(--gb-err,#dc2626); }
.gb-issues ul { margin:0; padding:0 0 6px; list-style:none; font-size:11.5px; line-height:1.5; color: var(--gb-muted,#64748b); }
.gb-issues li { overflow-wrap:break-word; padding:3px 12px 3px 25px; }
.gb-issues li.is-link { cursor:pointer; }
.gb-issues li.is-link:hover { color: var(--gb-text,#1f2937); background: var(--gb-tint,#f1f5f9); }
.gb-issues li.gb-more { font-style:italic; }
.gb-err { color: var(--gb-err,#dc2626); border-color: var(--gb-err-border,#fca5a5); background: var(--gb-err-bg,#fef2f2); }
.gb-hint { color: var(--gb-muted,#64748b); }
.gb-hint .gb-ico { color: var(--gb-warn,#b45309); }
@keyframes gb-pop { from { opacity:0; transform: translateY(-4px) scale(.98); } }
@keyframes gb-pop-up { from { opacity:0; transform: translateY(4px) scale(.98); } }
@media (prefers-reduced-motion: reduce) {
  .gb-search, .gb-thumb { transition:none; }
  .gb-drop, .gb-panel { animation:none; }
}
/* The caption goes **bottom left**: top left is tools, bottom right is the camera. The right side leaves room for the camera group so they do not collide on narrow screens. */
.gb-bl { position:absolute; bottom:12px; left:12px; z-index:10; max-width:calc(100% - 180px);
  display:flex; flex-direction:column; align-items:flex-start; gap:8px; pointer-events:none; }
.gb-bl > * { pointer-events:auto; }
.gb-note { font-size:11px; color: var(--gb-muted,#64748b); padding:4px 8px; display:flex; gap:8px; align-items:center; }
.gb-warn { color: var(--gb-warn,#b45309); border-color: var(--gb-warn-border,#fcd34d); background: var(--gb-warn-bg,#fffbeb); }
.gb-mask { position:absolute; inset:0; z-index:20; display:grid; place-items:center; background: var(--gb-mask,rgba(248,250,252,.6)); }
.gb-mask > div { display:flex; align-items:center; gap:10px; border:1px solid var(--gb-border,#e2e8f0);
  border-radius:var(--gb-r-pop,12px); box-shadow: 0 2px 6px rgba(15,23,42,.06), 0 18px 40px -12px rgba(15,23,42,.24); background: var(--gb-panel,#fff); padding:10px 16px; font-size:12.5px; color: var(--gb-muted,#64748b); }
.gb-spin { width:14px; height:14px; border-radius:50%; border:2px solid var(--gb-accent,#0284c7);
  border-top-color:transparent; animation: gb-spin 0.8s linear infinite; }
@keyframes gb-spin { to { transform: rotate(360deg); } }
.gb-empty { flex:1; display:grid; place-content:center; gap:10px; color: var(--gb-muted2,#94a3b8); font-size:13px; text-align:center; padding:0 24px; }

/* ── Legend (bottom left): marks with the same shape and color as on the graph, read from the graph. Resting on an entry pops this class's panel: eye, swatch,
 * size, one row; while the panel is open this class lights up on the graph. Same variables and radii as the toolbar. */
.gb-legend { padding:6px 8px; font-size:11.5px; position:relative; }
.gb-legend.is-collapsed { padding:0; border:0; background:none; box-shadow:none; -webkit-backdrop-filter:none; backdrop-filter:none; }
.gb-lg { display:flex; flex-direction:column; gap:3px; padding-right:52px; }
.gb-lg-row { display:flex; flex-wrap:wrap; align-items:center; gap:1px 4px; }
.gb-lg-item { position:relative; display:inline-flex; color: var(--gb-muted,#64748b); }
.gb-lg-hit { display:inline-flex; align-items:center; gap:5px; height:24px; padding:0 6px; border:0; border-radius:var(--gb-r-in-pop,6px);
  background:none; font:inherit; color:inherit; cursor:pointer; transition: background-color .12s, color .12s; }
.gb-lg-hit:hover, .gb-lg-item.is-open .gb-lg-hit { background: var(--gb-tint,#f1f5f9); color: var(--gb-text,#1f2937); }
.gb-lg-item b { font-weight:600; color: var(--gb-muted2,#94a3b8); font-variant-numeric: tabular-nums; }
.gb-lg-item.off { color: var(--gb-muted2,#94a3b8); }
.gb-lg-item.off .gb-lg-hit > span { text-decoration:line-through; text-decoration-color: var(--gb-muted2,#94a3b8); }
.gb-lg-item.off b { opacity:.7; }
.gb-lg-mark { flex:none; display:block; overflow:visible; }
.gb-lg-hit:focus-visible, .gb-lg-pop button:focus-visible, .gb-lg-well:has(input:focus-visible), .gb-lg-btn:focus-visible, .gb-lg-toggle:focus-visible {
  outline:2px solid var(--gb-accent,#0284c7); outline-offset:1px; }
.gb-lg-pop { position:absolute; left:-6px; bottom:calc(100% + 6px); z-index:30;
  display:flex; align-items:center; gap:4px; padding:6px; white-space:nowrap;
  background: var(--gb-panel2,#fff); border:1px solid var(--gb-border,#e2e8f0); border-radius:var(--gb-r-pop,12px);
  box-shadow: 0 2px 6px rgba(15,23,42,.06), 0 18px 40px -12px rgba(15,23,42,.24);
  animation: gb-pop-up .14s cubic-bezier(.2,.8,.3,1); }
/* The gap between panel and entry counts as panel: moving the mouse up from the entry is not leaving. */
.gb-lg-pop::after { content:''; position:absolute; left:0; right:0; top:100%; height:8px; }
.gb-lg-eye, .gb-lg-well { position:relative; display:grid; place-items:center; width:28px; height:28px; padding:0;
  border:0; border-radius:var(--gb-r-in-pop,6px); background:none; color: var(--gb-text,#1f2937); cursor:pointer; }
.gb-lg-eye.off { color: var(--gb-muted2,#94a3b8); }
.gb-lg-eye:hover, .gb-lg-well:hover { background: var(--gb-tint,#f1f5f9); }
.gb-lg-well i { width:16px; height:16px; border-radius:4px; box-shadow: inset 0 0 0 1px rgba(127,127,127,.4); }
.gb-lg-well input[type=color] { position:absolute; inset:0; width:100%; height:100%; opacity:0; cursor:pointer; border:0; padding:0; }
.gb-lg-sep { width:1px; height:16px; margin:0 2px; background: var(--gb-border,#e2e8f0); }
.gb-lg-segm { display:inline-flex; height:28px; padding:2px; gap:2px; box-sizing:border-box;
  border-radius:var(--gb-r-in-pop,6px); background: var(--gb-tint,#f1f5f9); }
.gb-lg-segm button { display:grid; place-items:center; width:26px; height:24px; border:0; border-radius:calc(var(--gb-r-in-pop,6px) - 2px);
  background:none; color: var(--gb-muted2,#94a3b8); cursor:pointer; }
.gb-lg-segm button:hover { color: var(--gb-text,#1f2937); }
.gb-lg-segm button.on { background: var(--gb-panel2,#fff); color: var(--gb-text,#1f2937); box-shadow: 0 1px 2px rgba(15,23,42,.12); }
.gb-lg-diff { padding-top:4px; margin-top:2px; border-top:1px solid var(--gb-border,#e2e8f0); gap:4px 12px; }
.gb-lg-chg { display:inline-flex; align-items:center; gap:6px; height:22px; padding:0 4px; color: var(--gb-text,#1f2937); }
.gb-lg-chg.past { color: var(--gb-muted,#64748b); }
.gb-lg-chg i { width:8px; height:8px; border-radius:2px; flex:none; }
.gb-lg-chg b { font-weight:600; font-variant-numeric: tabular-nums; }
.gb-lg-act { position:absolute; top:6px; right:6px; display:flex; gap:2px; }
.gb-lg-cap { padding:2px 6px 6px; margin-bottom:2px; border-bottom:1px solid var(--gb-border,#e2e8f0); color: var(--gb-muted,#64748b); }
.gb-lg-cap b { color: var(--gb-text,#1f2937); font-weight:600; }
.gb-lg-foot { display:flex; gap:10px; padding:2px 6px 0; font-size:10.5px; color: var(--gb-muted2,#94a3b8); }
.gb-lg-foot button { border:0; background:none; padding:0; font:inherit; color: var(--gb-accent,#0284c7); cursor:pointer; }
.gb-lg-foot button:hover { text-decoration:underline; }
.gb-lg-btn { display:grid; place-items:center; width:22px; height:22px; padding:0; border:0; border-radius:var(--gb-r-chip,5px);
  background:none; color: var(--gb-muted2,#94a3b8); cursor:pointer; }
.gb-lg-btn:hover { background: var(--gb-tint,#f1f5f9); color: var(--gb-text,#1f2937); }
.gb-lg-toggle { display:grid; place-items:center; width:36px; height:36px; padding:0; cursor:pointer; color: var(--gb-muted,#64748b);
  background: var(--gb-panel, rgba(255,255,255,.86)); border:1px solid var(--gb-border,#e2e8f0); border-radius:var(--gb-r-face,10px);
  box-shadow: 0 1px 2px rgba(15,23,42,.05), 0 6px 18px -6px rgba(15,23,42,.12);
  -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); }
.gb-lg-toggle:hover { color: var(--gb-text,#1f2937); }

/* ── Inspector: the right column outside the canvas, about "this object". Details and editing share one shell ─────────────
 * Header (kind dot + name · actions), a scrolling body, a footer pinned at the bottom. Fields look like the canvas overlays:
 * inputs look like the search box, the node picker dropdown like the search dropdown, nodes carry their color on the graph. */
/* Drawer: opening and closing animate width, the canvas changes with it instead of jumping. Hosts use --gb-inspector-bg to match their own
 * sidebar (symmetric on both sides, with the canvas in between). */
.gb-drawer { flex:none; width:320px; overflow:hidden; display:flex; animation: gb-drawer-in .2s cubic-bezier(.2,.8,.3,1); }
.gb-drawer.is-closing { animation: gb-drawer-out .2s cubic-bezier(.4,0,.6,1) forwards; pointer-events:none; }
@keyframes gb-drawer-in { from { width:0; } }
@keyframes gb-drawer-out { to { width:0; } }
.gb-detail { width:320px; flex-shrink:0; display:flex; flex-direction:column; min-height:0;
  border-left:1px solid var(--gb-inspector-border, var(--gb-border,#e2e8f0));
  background: var(--gb-inspector-bg, var(--gb-panel2,#fff)); }
.gb-dh { flex:none; display:flex; align-items:center; justify-content:space-between; gap:8px;
  height:52px; padding:0 10px 0 16px; border-bottom:1px solid var(--gb-inspector-border, var(--gb-border,#e2e8f0)); }
.gb-dh-title { display:inline-flex; align-items:center; gap:8px; min-width:0; font-size:12.5px; font-weight:600;
  color: var(--gb-text,#1f2937); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.gb-kind { font-weight:500; color: var(--gb-muted,#64748b); }
.gb-dh-act { display:inline-flex; align-items:center; gap:2px; flex:none; }
.gb-ibtn { display:inline-flex; align-items:center; justify-content:center; gap:5px; min-width:28px; height:28px; padding:0 6px;
  border:0; border-radius:var(--gb-r-in-face,7px); background:transparent; color: var(--gb-muted,#64748b);
  font:inherit; font-size:12.5px; cursor:pointer; transition: color .15s, background-color .15s; }
.gb-ibtn:hover { background: var(--gb-tint,#f1f5f9); color: var(--gb-text,#1f2937); }
.gb-ibtn:focus-visible, .gb-btn:focus-visible, .gb-add:focus-visible, .gb-pick-cur:focus-visible {
  outline:2px solid var(--gb-accent,#0284c7); outline-offset:1px; }
.gb-ibtn-text { padding:0 10px 0 8px; color: var(--gb-text,#1f2937); border:1px solid var(--gb-border,#e2e8f0); }
.gb-db { flex:1; min-height:0; overflow:auto; padding:16px; font-size:12.5px; line-height:1.55; }
.gb-dt { font-size:15px; font-weight:600; line-height:1.35; margin-bottom:12px; overflow-wrap:anywhere; color: var(--gb-text,#1f2937); }
.gb-flag { font-size:11.5px; color: var(--gb-muted,#64748b); background: var(--gb-tint,#f8fafc);
  border-radius:var(--gb-r-in-pop,6px); padding:7px 10px; margin-bottom:12px; }
.gb-dempty { color: var(--gb-muted2,#94a3b8); }
.gb-line { display:grid; grid-template-columns: minmax(64px, 30%) 1fr; gap:10px; padding:5px 0; overflow-wrap:anywhere; }
.gb-k { font-size:10.5px; font-weight:600; letter-spacing:.05em; text-transform:uppercase; color: var(--gb-muted2,#94a3b8); }
.gb-line .gb-k { padding-top:2px; }
.gb-desc { color: var(--gb-muted,#475569); margin:6px 0 14px; }
.gb-sect { margin:12px 0; }
.gb-sect .gb-k { display:block; margin-bottom:6px; }
.gb-sect ul { margin:0; padding-left:16px; }
.gb-sect li { margin-bottom:3px; overflow-wrap:anywhere; }
.gb-extras { margin-top:14px; padding-top:10px; border-top:1px solid var(--gb-border,#e2e8f0); }
.gb-df { flex:none; display:flex; align-items:center; justify-content:space-between; gap:8px;
  padding:10px 12px 10px 16px; border-top:1px solid var(--gb-inspector-border, var(--gb-border,#e2e8f0));
  background: var(--gb-inspector-bg, var(--gb-panel2,#fff)); }

/* markdown (long text in details): body font size, images span the column, code on a faint background. */
.gb-md > * + * { margin-top:8px; }
.gb-md p, .gb-md ul, .gb-md ol, .gb-md blockquote { margin:0; }
.gb-md ul, .gb-md ol { padding-left:18px; }
.gb-md li + li { margin-top:3px; }
.gb-md a { color: var(--gb-accent,#0284c7); text-decoration:none; }
.gb-md a:hover { text-decoration:underline; }
.gb-md code { font: 11.5px ui-monospace, SFMono-Regular, Menlo, monospace; padding:1px 4px; border-radius:4px;
  background: var(--gb-tint,#f1f5f9); }
.gb-md pre { margin:0; padding:9px 11px; border-radius:var(--gb-r-in-pop,6px); background: var(--gb-tint,#f1f5f9); overflow:auto; }
.gb-md pre code { padding:0; background:none; }
.gb-md blockquote { padding-left:10px; border-left:2px solid var(--gb-border,#e2e8f0); color: var(--gb-muted,#64748b); }
.gb-md-h { font-weight:600; color: var(--gb-text,#1f2937); }
.gb-md-h1 { font-size:13.5px; } .gb-md-h2 { font-size:13px; } .gb-md-h3 { font-size:12.5px; }
.gb-md-img { display:block; max-width:100%; height:auto; margin:4px 0; border-radius:var(--gb-r-in-pop,6px);
  border:1px solid var(--gb-border,#e2e8f0); }
.gb-md-alt { color: var(--gb-muted2,#94a3b8); font-style:italic; }

/* Narrow canvas (phone, small embed): the inspector is a sheet pulled up from the bottom, the legend is collapsed, search spans the row. */
@container gk (max-width: 640px) {
  .gb-drawer { position:absolute; left:0; right:0; bottom:0; z-index:25; width:auto; max-height:62%;
    border-radius:16px 16px 0 0; box-shadow: 0 -12px 40px -12px rgba(15,23,42,.3);
    animation: gb-sheet-in .24s cubic-bezier(.2,.8,.3,1); }
  .gb-drawer.is-closing { animation: gb-sheet-out .2s cubic-bezier(.4,0,.6,1) forwards; }
  .gb-drawer > .gb-detail { width:100%; border-left:0; }
  .gb-dh::before { content:''; position:absolute; left:50%; top:6px; width:36px; height:4px; margin-left:-18px;
    border-radius:2px; background: var(--gb-border,#e2e8f0); }
  .gb-dh { position:relative; }
  .gb-search { width:auto; flex:1; min-width:0; }
  .gb-bar { right:12px; }
  .gb-bl { max-width:calc(100% - 140px); }
}
@keyframes gb-sheet-in { from { transform: translateY(100%); } }
@keyframes gb-sheet-out { to { transform: translateY(100%); } }
@media (prefers-reduced-motion: reduce) {
  .gb-drawer, .gb-drawer.is-closing { animation-duration:.01s; }
}

/* What a node looks like: its color on the graph (.gb-dot, as in the search dropdown) + name (+ a grey line). */
.gb-ref-main { display:flex; flex-direction:column; min-width:0; flex:1; text-align:left; }
.gb-ref-label { font-size:12.5px; color: var(--gb-text,#1f2937); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.gb-ref-sub { font-size:11px; color: var(--gb-muted2,#94a3b8); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

/* ── Editing: the two items in ⋯, and the form in the inspector ── */
.gb-menu-list { display:flex; flex-direction:column; }
.gb-menu-item { display:flex; align-items:center; text-align:left; border:0; background:none; padding:8px 9px;
  border-radius:var(--gb-r-in-pop,6px); font:inherit; font-size:12.5px; color: var(--gb-text,#1f2937); }
.gb-menu-item:hover:not(:disabled) { background: var(--gb-tint,#f1f5f9); }
.gb-menu-item:disabled { opacity:.5; cursor:default; }
.gb-link { border:0; background:none; padding:0; font:inherit; font-size:12.5px; color: var(--gb-accent,#0284c7); cursor:pointer; }
.gb-link:hover { text-decoration:underline; }
.gb-form { display:flex; flex-direction:column; gap:18px; }
.gb-fld { display:flex; flex-direction:column; gap:7px; }
.gb-fld .gb-k em { font-style:normal; font-weight:500; letter-spacing:0; text-transform:none; margin-left:4px; opacity:.8; }
.gb-fld small { font-size:11px; color: var(--gb-muted2,#94a3b8); }
.gb-fld small.is-bad { color: var(--gb-err,#dc2626); }
/* Inputs: look like the search box: white background, thin border, a glow on focus. */
.gb-input { width:100%; box-sizing:border-box; height:36px; padding:0 11px; border:1px solid var(--gb-border,#e2e8f0);
  border-radius:var(--gb-r-in-face,8px); background: var(--gb-panel2,#fff); color: var(--gb-text,#1f2937);
  font: inherit; font-size:13px; outline:none; box-shadow: 0 1px 2px rgba(15,23,42,.04);
  transition: border-color .15s, box-shadow .15s; }
.gb-input:focus, .gb-input:focus-within { border-color: var(--gb-accent,#0284c7);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--gb-accent,#0284c7) 16%, transparent); }
.gb-input.is-bad { border-color: var(--gb-err,#dc2626); }
.gb-input::placeholder, .gb-input input::placeholder { color: var(--gb-muted2,#94a3b8); }
.gb-json { height:auto; min-height:168px; padding:10px 11px; resize:vertical; tab-size:2; white-space:pre;
  font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--gb-tint,#f8fafc); }
.gb-json:focus { background: var(--gb-panel2,#fff); }
.gb-id { display:block; padding:8px 11px; border-radius:var(--gb-r-in-face,8px); background: var(--gb-tint,#f8fafc);
  font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--gb-muted,#64748b); overflow-wrap:anywhere; }
/* Node picker: unselected it is a search box with a magnifier and a dropdown like search's; selected it is a colored tag. */
.gb-pick { position:relative; }
.gb-pick-field { display:flex; align-items:center; gap:8px; color: var(--gb-muted2,#94a3b8); }
.gb-pick-field input { flex:1; min-width:0; height:100%; border:0; outline:none; background:transparent; padding:0;
  font:inherit; font-size:13px; color: var(--gb-text,#1f2937); }
.gb-pick-cur { display:flex; align-items:center; gap:10px; width:100%; height:44px; padding:0 8px 0 12px; text-align:left;
  border:1px solid var(--gb-border,#e2e8f0); border-radius:var(--gb-r-in-face,8px); background: var(--gb-panel2,#fff);
  font:inherit; cursor:pointer; transition: border-color .15s; }
.gb-pick-cur:hover { border-color: color-mix(in srgb, var(--gb-accent,#0284c7) 45%, var(--gb-border,#e2e8f0)); }
.gb-pick-x { display:grid; place-items:center; width:24px; height:24px; flex:none; border-radius:var(--gb-r-chip,5px);
  color: var(--gb-muted2,#94a3b8); }
.gb-pick-x:hover { background: var(--gb-tint,#f1f5f9); color: var(--gb-text,#1f2937); }
.gb-pick-list { position:absolute; left:0; right:0; top:calc(100% + 6px); z-index:5; margin:0; padding:6px; list-style:none;
  background: var(--gb-panel2,#fff); border:1px solid var(--gb-border,#e2e8f0); border-radius:var(--gb-r-pop,12px);
  box-shadow: 0 2px 6px rgba(15,23,42,.06), 0 18px 40px -12px rgba(15,23,42,.24);
  animation: gb-pop .14s cubic-bezier(.2,.8,.3,1); }
.gb-pick-list li { display:flex; align-items:center; gap:10px; padding:7px 9px; border-radius:var(--gb-r-in-pop,6px); cursor:pointer; }
.gb-pick-list li.on { background: var(--gb-tint,#f1f5f9); }
/* Edge list: direction · other end · kind · ×. */
.gb-rel { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; }
.gb-rel li { display:flex; align-items:center; gap:9px; min-height:34px; padding:0 2px 0 6px; border-radius:var(--gb-r-in-pop,6px); }
.gb-rel li:hover { background: var(--gb-tint,#f8fafc); }
.gb-rel-dir { width:12px; flex:none; color: var(--gb-muted2,#94a3b8); font-size:12px; }
.gb-rel .gb-ibtn { min-width:24px; height:24px; padding:0; opacity:0; }
.gb-rel li:hover .gb-ibtn, .gb-rel .gb-ibtn:focus-visible { opacity:1; }
.gb-add { align-self:flex-start; display:inline-flex; align-items:center; gap:6px; height:30px; padding:0 10px 0 8px;
  border:1px dashed var(--gb-border,#e2e8f0); border-radius:var(--gb-r-in-face,7px); background:none;
  font:inherit; font-size:12px; color: var(--gb-muted,#64748b); cursor:pointer; }
.gb-add:hover { color: var(--gb-accent,#0284c7); border-color: var(--gb-accent,#0284c7); }
/* Buttons: same height and radius as the canvas overlays. */
.gb-form-act { display:flex; align-items:center; gap:8px; }
.gb-btn { height:32px; padding:0 14px; border:1px solid var(--gb-border,#e2e8f0); border-radius:var(--gb-r-in-face,7px);
  background: var(--gb-panel2,#fff); color: var(--gb-text,#1f2937); font:inherit; font-size:12.5px; font-weight:500; cursor:pointer;
  transition: background-color .15s, border-color .15s, opacity .15s; }
.gb-btn:hover:not(:disabled) { background: var(--gb-tint,#f1f5f9); }
.gb-btn:disabled { opacity:.45; cursor:default; }
.gb-primary { border-color:transparent; background: var(--gb-accent,#0284c7); color: var(--gb-on-accent,#fff);
  box-shadow: 0 1px 2px rgba(15,23,42,.12); }
.gb-primary:hover:not(:disabled) { background: color-mix(in srgb, var(--gb-accent,#0284c7) 88%, #000); }
.gb-danger { border-color:transparent; background: var(--gb-err,#dc2626); color:#fff; }
.gb-danger:hover:not(:disabled) { background: color-mix(in srgb, var(--gb-err,#dc2626) 88%, #000); }
.gb-danger-text { border-color:transparent; background:none; color: var(--gb-err,#dc2626); padding:0 8px; }
.gb-danger-text:hover:not(:disabled) { background: var(--gb-err-bg,#fef2f2); }
.gb-confirm { font-size:12.5px; color: var(--gb-text,#1f2937); }
.gb-edit-err { flex:none; margin:0 16px 10px; padding:8px 10px; font-size:12px; border-radius:var(--gb-r-in-pop,6px);
  color: var(--gb-err,#dc2626); background: var(--gb-err-bg,#fef2f2); border:1px solid var(--gb-err-border,#fca5a5); }

/* ── diff overlay ─────────────────────────────────────────────────────────
 * **Drawn under the canvas** (cytoscape's canvases are z-index 1–3 and transparent). This is not an
 * implementation detail; it is the premise of the whole UI language: diff never covers one pixel of the user's primitives; light shows
 * from behind them, ghosts show from behind them. So "the color channel belongs to the user" needs no exception.
 *
 * **No animation.** Permanent blinking costs a full-viewport frame every frame wherever it is drawn (opacity animation on a <g>
 * means "draw the whole group into an offscreen buffer and composite it"; it saves cytoscape, not the compositor);
 * more importantly it **hides information half the time**: blinking is for "spotting a difference", not for
 * "understanding one". So comparison is an action a person presses (diffPast), not something always blinking.
 *
 * **The whole layer has a single-digit number of DOM elements**: rounded rectangles and curves of the same color and level join into one d, one path
 * draws a whole class. Whether three or three thousand changes are marked, the browser draws the same number of elements. */
.gb-diff-under { position:absolute; inset:0; width:100%; height:100%;
  pointer-events:none; overflow:hidden; z-index:0; }
/* Glow: the same path stroked three times, wide to narrow, faint to strong; no filter:blur(),
   which runs once per element and costs a fortune on large graphs. */
.gb-glow { fill:none; stroke-linejoin:round; stroke-linecap:round; }
/* **The three inks come from DIFF_INK**, not hard-coded again here. Two copies fail in a very specific way: change
   DIFF_INK, the legend follows while the graph does not budge, and nothing tells you which one fell behind. */
.gb-glow-new { stroke: var(--gb-diff-added,   ${DIFF_INK.added}); }
.gb-glow-del { stroke: var(--gb-diff-removed, ${DIFF_INK.removed}); }
.gb-glow-mod { stroke: var(--gb-diff-changed, ${DIFF_INK.changed}); }
/* Counterpart line: only for "merged", the one correspondence no edge can express. */
.gb-pastwire { fill:none; stroke: var(--gb-diff-past, ${DIFF_INK.past}); stroke-linecap:round; }
.gb-diff-trunc { position:absolute; top:8px; left:8px; z-index:6; pointer-events:none;
  font-size:11px; color: var(--gb-muted2,#94a3b8);
  background: var(--gb-panel,rgba(255,255,255,.85)); border:1px solid var(--gb-border,#e2e8f0);
  border-radius:var(--gb-r-face,10px); padding:3px 7px; }
`;
