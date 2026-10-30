/* glassbrain · transitions: one data switch is one "union transition"
 *
 * ─── Claim ──────────────────────────────────────────────────────────────
 *
 * Switching data is not "replace the old with the new" but **let old and new be present together, play it, then tuck
 * the past half away**. That is the same base as diff:
 *
 *     diff = the union, paused        animation = the union, played, then the past half tucked away
 *
 * So there is no "build the union" code here: `diffModels` is it. This module answers one thing only:
 * **for every element in the union, where it is, how transparent and what it looks like at time t.**
 *
 * ─── The whole model in one sentence ────────────────────────────────────────────────
 *
 *     every channel = base + Σ(track progress × increment)
 *
 * Three channels: **position** (x,y), **presence** (opacity), **look** (skin). Exactly the same shape,
 * and the base is always "the value in the last frame before the switch". So at t=0 every track's progress is 0 and every
 * channel equals its base:
 *
 *     **"Frame 0 is identical to the previous frame" is not a rule to keep; it is a consequence of the model.**
 *
 * This was paid for. Position used to be the only additive one; opacity was three hard-coded scalars and the skin hung on
 * the "enter" number, so every channel had to keep the rule **on its own**, and some place always failed: the frames between
 * mounting the union and finishing layout belonged to nobody. `gb-added` is an ordinary class in browse mode, so new nodes and
 * edges were drawn in full with default styles, the audience **first saw "the new stuff is already here"**, and the "cut"
 * played afterwards meant nothing. Now frame 0 depends on neither the storyboard nor coordinates (all bases, see `FADE_BASE`),
 * so **it can be written the moment the union mounts**; a slow layout only lingers longer on the previous frame.
 *
 * ─── Storyboard: a switch is a scene with an order, not one interpolation ──────────────────────
 *
 * From the director's side, a step1→step2 goes like this: **first the part that disappears is cut off the branch: edges break
 * first, the piece springs off a little and dims a notch, then drifts away and fades like a falling leaf; halfway through, what stays
 * swings to its new position; as that settles, new things sprout from their parents like shoots, and only at the end are they connected
 * to the existing structure. The camera opens up first to give room to watch all this, then closes in and drops the empty space.**
 *
 * Reversed, step2→step1 is the same storyboard; only the data differ (43 leaves and 0 sprouts one way, the other way
 * round). So no "two choreographies" are needed, nor any check for "growing or shrinking this time".
 *
 * The storyboard is **symmetric**: one "change connections" action at each end, motion in the middle.
 *
 *   cut      edges into the leaving piece break first; without that, what drifts away pulls a thread
 *   snap     the cut piece springs off a short distance + dims a notch: the "break" has to be visible
 *   leaf     then drifts away slowly and fades out (the piece keeps its shape)
 *   move     what stays goes to the union coordinates (sigmoid: it does not start at frame 0)
 *   present  new things appear + old skin becomes new (one scalar, see rule ③)
 *   sprout   new things grow out of their parent (slight overshoot)
 *   graft    only at the end, edges "new node → existing structure" connect (mirror of cut)
 *   camera   open to the framing of "old ∪ new" first, then close to the framing of "new"
 *
 * Windows overlap: move starts before the leaves finish drifting, sprout begins as move settles. **Not a queue**
 * (a queue takes three times as long), and **not in lockstep** (lockstep leaves no order to read).
 *
 * Motion happens only in these cases, each with a definite meaning:
 *
 *   kept/changed   previous frame → position in the union    the small difference between union and single-version layout
 *   moved          previous frame → new position              "it moved to another branch" (it does not start from the old parent box)
 *   merged         follows its match + converges onto it     "these things merged into it"
 *   removed        springs off a little + drifts away         "it was cut off"
 *   added          follows its anchor + shoots to its place   "it grew"
 *
 * Six rules; drop one and "this one played, that one did not" appears:
 *   ① **An edge is defined by its two ends; change one and it is another edge.** So "moved to another branch" is not a node
 *      attribute but one containment edge gone + one containment edge come. In connected mode "containment" is synthesized at render time,
 *      and those edges used to never carry marks, so this add-and-remove **was invisible to marks alone**: the new one connects "new parent →
 *      it" while on frame 0 it still stands at the old position, and at curtain-up a thick line across the whole graph appeared from nowhere. The fix
 *      is not a special case for containment edges in the "presence" channel; it is having `buildElements` honestly emit both,
 *      each with its mark, so downstream never needs to know about "containment edges" at all.
 *   ② **Time and speed are not the same number.** A track's window is **time**, its curve is **speed**. It used to be
 *      that p went through a global easing first and was then compared against times, so all times collapsed to the start
 *      (with easeOutCubic, 0.4 landed at 15.7% of wall-clock). Now there is one input: wall-clock time.
 *   ③ **Everything "now" is driven by one number**: the opacity of what enters and the old-to-new skin progress are
 *      the single scalar `fade.in`. No second timeline means they cannot drift apart.
 *   ④ **Group by "skin", never write styles per element.** Nodes with the same old/new skin pair differ in exactly the same way,
 *      so one batch style call per frame is enough (measured: 206 nodes, 4 properties, 2.79 ms/frame, the same order as what the "presence"
 *      channel already spends); per element is 6.06 ms/frame, the kind of code that cooks the machine.
 *      Presence likewise: only four envelopes in total, four style calls per frame.
 *   ⑤ **Overshoot belongs in curves, never in sizes.** Positions are written every frame anyway (the floor price of any motion
 *      animation), so a different curve costs nothing; "spring from 0.85 to 1" means writing width/height every frame,
 *      which triggers style recalculation, bounding box invalidation and parent box recomputation: a different order of magnitude. So "sprout" is
 *      **motion**, not scaling.
 *   ⑥ **No shadow elements.** The fix for "n2 fades out, n1 moves, and the edge still drags n1" is not a copy of an
 *      invisible n1 but splitting the two things into two additive legs. One multiply-add in the frame function: no extra
 *      elements, no id clashes, no layout side effects.
 *
 * Pure computation: no React, no cytoscape, no DOM; directly testable in node.
 */
import { DIFF_FLAG, STEP_FLAG, type ChangeKind, type GraphDelta } from './diff';
import { nodeClasses, VIRTUAL_ROOT } from './elements';
import type { GraphModel, GraphNode } from './model';
import type { GraphProfile } from './profile';
import type { Positions } from './layout/planes';

export interface AnimateSpec {
  /** How long **a whole scene** plays, in ms. Default 1800: the storyboard has seven beats with overlapping ends and does not fit
   *  the old 700; and this scene is for people to see "how much was removed vs added", not a transition effect, so too fast is just a
   *  blur. Set by dragging a slider.
   *
   *  **Beats this step does not have take no time**: a reskin-only / growth-only step actually plays `duration × score.span`
   *  ≈ 648 ms, and each of its beats takes **exactly** as many ms as in the full storyboard. See `makeScore`. */
  duration?: number;
  /** The curve of **the "move" beat**. Default easeInOutCubic: move does not start at frame 0
   *  (the leaves drift for a while first), and without ease-in it would shoot off from nowhere. Other beats have their own curves, see BEATS. */
  easing?: (t: number) => number;
  /** How far leaves drift, **as a fraction of the whole graph's span**. 0 = no drift, just fade. Default 0.08 (8% of the span).
   *
   *  **Keep it small.** This beat should stress "the tip was cut", not "it exploded": a lock of hair falling scatters
   *  a short distance and still looks like the same lock. Drifting far hides the cut instead.
   *
   *  The unit can only be "a fraction of the picture": the camera frames the graph, so a few percent of the span = a few percent
   *  of the screen, for any graph at any zoom. A version based on "my distance to my parent" did not work:
   *  that distance varies by two orders of magnitude in one graph (a leaf hugging its parent 140, a top level under the virtual root 2400);
   *  the near ones drifted 60 units while following their parent over a thousand, completely drowned.
   *  Each fragment varies ±30% around this value, so it is an average, not a fixed amount.
   *
   *  The exact number can only be set with a slider: 8% is the line between "you can tell something fell off" and "it exploded". */
  drift?: number;
  /** Sprout overshoot (the easeOutBack coefficient). 0 = no bounce, reduces to easeOutCubic. Default 0.6:
   *  about 1.3% past the mark. **The point is "it came alive", not a spring.** */
  bounce?: number;
  /** Above this many union elements, land directly without playing: during motion every frame redraws the whole layer,
   *  and on large graphs it only shows a dropped-frame smear; better clean and quick. Default 3000. */
  maxNodes?: number;
}

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t: number) => (t < 0.5
  ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
/** Overshoot. With `s = 0` it **reduces exactly to easeOutCubic**, so "no bounce" is not a separate branch. */
export const easeOutBack = (s: number) => (t: number) => {
  const u = t - 1;
  return 1 + (s + 1) * u * u * u + s * u * u;
};
/**
 * Drift: **drift at a steady speed**.
 *
 * The impulse of "being cut" is already played by the `snap` beat on its own (spring off a short way + dim a notch), so this
 * curve only handles the long drift after it: nearly linear, **with non-zero final speed**. That is a hard requirement:
 * easeOutCubic finishes the motion in the first 20%, and for the rest the fragment "stops there and fades", which looks no
 * different from fading in place.
 */
export const easeDrift = (t: number) => 0.2 * (1 - Math.pow(1 - t, 3)) + 0.8 * t;

export const DEFAULT_ANIMATE: Required<AnimateSpec> = {
  duration: 1800, easing: easeInOutCubic, drift: 0.08, bounce: 0.6, maxNodes: 3000,
};

export function resolveSpec(a: boolean | AnimateSpec | undefined): Required<AnimateSpec> | null {
  if (a === false) return null;
  if (a === true || a === undefined) return DEFAULT_ANIMATE;
  return { ...DEFAULT_ANIMATE, ...a };
}

/* ── Storyboard ──────────────────────────────────────────────────────────────
 *
 * Each track has its own window (when) and curve (how). **Symmetric**: `cut` breaks the old connections at the start,
 * `graft` makes the new connections at the end, motion is in the middle. */
const BEATS: Record<TrackName, [number, number]> = {
  cut: [0, 0.10],
  snap: [0.07, 0.20],
  leaf: [0.18, 0.95],
  move: [0.22, 0.74],
  present: [0.64, 0.94],
  sprout: [0.68, 1],
  graft: [0.86, 1],
  open: [0, 0.30],
  close: [0.58, 1],
};

export type TrackName =
  | 'cut' | 'snap' | 'leaf' | 'move' | 'present' | 'sprout' | 'graft' | 'open' | 'close';
export const TRACK_NAMES = Object.keys(BEATS) as TrackName[];
export interface Track {
  from: number; to: number;
  /** How to move within the window. **Opacity takes no curve** (see ENVELOPES); only position and camera do. */
  ease: (t: number) => number;
}
/** The storyboard + **how much of the timeline it actually uses**. */
export type Score = Record<TrackName, Track> & {
  /** What remains after trimming the empty start (0–1). **Multiply the wall-clock duration by it.** See `makeScore`. */
  span: number;
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/**
 * A track's linear progress at time t (clamped to 0/1 outside the window).
 *
 * **Zero width = this beat does not happen**, not "finishes instantly". Zero width has one source: trimming empty beats pushed
 * the whole window before lead (this switch has no such content). It used to divide by a 1e-6 floor, so it saturated to 1 on the first frame.
 * Content tracks did not care (those groups were empty anyway), **but the camera eats the same number**: in a reskin-only step
 * "open" was trimmed to zero width, so the camera teleported to the union framing on frame 1 and spent the whole scene drifting back. Frame 0
 * was continuous, frame 1 jumped.
 */
export const trackLin = (tr: Track, t: number) => {
  const span = tr.to - tr.from;
  return span > 0 ? clamp01((t - tr.from) / span) : 0;
};
/**
 * A track's progress at time t (through its curve).
 *
 * **Both ends pinned.** Curves leave floating-point residue at 0/1: `easeOutBack(0.6)` at 0 is
 * `-1.1e-16`, which times a displacement is "frame 0 moved a hair". "Frame 0 is identical to the previous frame" must hold **exactly**,
 * not approximately; pinning it here makes it count for every curve, current and future.
 */
export const trackAt = (tr: Track, t: number) => {
  const p = trackLin(tr, t);
  return p <= 0 ? 0 : p >= 1 ? 1 : tr.ease(p);
};

/* ── Presence channel ────────────────────────────────────────────────────────────
 *
 * Opacity has **the same shape** as position: base + Σ(track progress × increment). There are only four envelopes, each
 * for one group of elements, so only four batch style calls per frame (rule ④). */

/** One envelope. The increment is "how much opacity changes once this track finishes". */
export interface Envelope { base: number; legs: { track: TrackName; d: number }[] }

/** How much the cut piece dims during the "snap" beat. **The rest is left for the leaf to fade slowly.**
 *  Fading evenly to nothing from the start leaves no trace of the "break" in opacity; dropping a notch first and then fading
 *  slowly gives the cut its weight. */
export const SNAP_DIM = 0.4;

export type FadeName = 'cut' | 'out' | 'in' | 'graft';
export const FADE_NAMES: FadeName[] = ['cut', 'out', 'in', 'graft'];

export const ENVELOPES: Record<FadeName, Envelope> = {
  /** Edges across the cut: **break at once**, faster than anything. */
  cut: { base: 1, legs: [{ track: 'cut', d: -1 }] },
  /** The leaving piece: dims a notch when it springs off, then fades the whole way while drifting. */
  out: { base: 1, legs: [{ track: 'snap', d: -SNAP_DIM }, { track: 'leaf', d: -(1 - SNAP_DIM) }] },
  /** Entering nodes and the edges growing with them. */
  in: { base: 0, legs: [{ track: 'present', d: 1 }] },
  /** New edges into the existing structure: **connected last**. */
  graft: { base: 0, legs: [{ track: 'graft', d: 1 }] },
};

/** An element's situation in this switch. */
export type EndState = 'gone' | 'new' | 'stay';

/**
 * **Which envelope an edge belongs to.** Only the situation at both ends and its own mark matter; it knows nothing about "containment edges".
 *
 * One axiom is enough: **additions grow, removals drift; and an edge is defined by its ends, change one and it is another edge.**
 * (So "moved to another branch" is an old containment edge removed + a new one added, emitted honestly by `buildElements`,
 * and here it is exactly like any other added or removed edge.)
 *
 * The rest is only computing what "follow both ends" means. **An edge has no position of its own**: it can only be drawn between its ends,
 * so:
 *
 *   ends share a fate → follow them: the whole piece drifts together (out) / grows along with the new branch (in), length unchanged throughout
 *   ends differ in fate → cannot follow, can only break; so it shows up during the time **when neither end moves**
 *
 * Start and end look asymmetric (leavers rush at the start, arrivals wait for the end), but it is one criterion: **the past side
 * still has to move, the future side has already stopped.** A leaving edge's living end is about to go to its new position (move
 * 22–74%); if it does not break cleanly before that it gets pulled into a thread across the whole graph. An entering edge's old end has
 * long been in place, so it can wait, and connects once motion stops (86–100%).
 *
 * This is also the final answer to "should a transparent node pin the edge": **no.** The stretched length comes from **the living
 * end**, so pinning the dying end is useless; avoiding the stretch would mean pinning both ends, which is a frozen copy of the old graph,
 * exactly back to "interpolating between two coordinate sets", which the union exists to eliminate. Use timing, not compensation.
 */
export function edgeFade(
  from: EndState, to: EndState, flag: 'added' | 'removed' | null,
): FadeName | null {
  if (flag === 'removed' || from === 'gone' || to === 'gone') {
    return from === 'gone' && to === 'gone' ? 'out' : 'cut';
  }
  if (flag === 'added' || from === 'new' || to === 'new') {
    return from === 'new' || to === 'new' ? 'in' : 'graft';
  }
  return null;
}

/** Opacity at time 0: all bases, **needing neither a storyboard nor coordinates**.
 *
 *  So the four groups can be written the moment the union mounts, without waiting for layout. This is where "frame 0 = previous frame"
 *  turns from a rule into a consequence: the bases of `in` and `graft` are 0, so new things are invisible before layout has even
 *  given them a position. */
export const FADE_BASE: Record<FadeName, number> = {
  cut: ENVELOPES.cut.base, out: ENVELOPES.out.base, in: ENVELOPES.in.base, graft: ENVELOPES.graft.base,
};

/** An envelope's value at time t. **Takes only the window's linear progress, not the curve**: easing an opacity makes
 *  it linger and then suddenly drop. For "drop a notch, then fade slowly" add another leg instead of bending a curve. */
export const fadeAt = (name: FadeName, sc: Score, t: number) => {
  const e = ENVELOPES[name];
  let v = e.base;
  for (const l of e.legs) v += l.d * trackLin(sc[l.track], t);
  return v;
};

/**
 * Build a storyboard.
 *
 * **Empty beats leave no gap, and the rest must not be stretched.** If this switch has no leaves and no motion, "present" should not
 * wait until 64% to start: trim the empty start (shift windows forward, renormalize to [0,1]) **and multiply the wall-clock duration by
 * `span`**. The two scalings cancel exactly, so:
 *
 *     **How long a beat plays does not depend on how many beats this step has.**
 *
 * It used to only shift forward: the remainder was stretched back to [0,1] with the duration unchanged, so a "content only" step slowed
 * the present beat by 2.78× and still played the full 1800 ms. What the audience waited for was not an empty beat but a stretched one.
 *
 * (The tail is not trimmed: the camera always closes there.)
 */
export function makeScore(
  spec: Required<AnimateSpec>,
  active: { leaf?: boolean; move?: boolean; present?: boolean } = {},
): Score {
  const on: TrackName[] = [];
  if (active.leaf) on.push('cut', 'snap', 'leaf');
  if (active.move) on.push('move');
  if (active.present) on.push('present', 'sprout', 'graft');
  const lead = on.length ? Math.min(...on.map((n) => BEATS[n][0])) : 0;
  /** What remains after trimming the empty start. Windows are normalized by it and **wall-clock is shortened by it**: the same number
   *  in both places cancels cleanly (dividing by it instead of multiplying by its inverse lands `cut(1)` exactly on 1). */
  const span = Math.max(1e-6, 1 - lead);
  const cut = (v: number) => clamp01((v - lead) / span);
  const ease: Record<TrackName, (t: number) => number> = {
    cut: (t) => t,                      // a cut is an instant, not a stretch
    snap: easeOutCubic,                 // spring off: fastest at first, stops on arrival
    leaf: easeDrift,                    // then drift steadily to the end
    move: spec.easing,                  // sigmoid
    present: (t) => t,                  // envelopes take no curve
    sprout: easeOutBack(spec.bounce),
    graft: (t) => t,
    open: easeInOutCubic,
    close: easeInOutCubic,
  };
  const out = { span } as Score;
  for (const n of TRACK_NAMES) {
    out[n] = { from: cut(BEATS[n][0]), to: cut(BEATS[n][1]), ease: ease[n] };
  }
  return out;
}

/**
 * How many edges enter and leave in a delta, under either vocabulary (`diffModels` or `stepUnion`).
 *
 * `changes` only lists nodes, so a step that only links (no node added, removed or changed) has an empty `changes` and
 * still has everything to show. "Nothing changed" has to ask the edges too.
 */
export function edgeTraffic(delta: GraphDelta): { in: number; out: number } {
  let i = 0, o = 0;
  for (const e of delta.model.edges) {
    const f = e.flags;
    if (!f) continue;
    if (f.includes(DIFF_FLAG.added) || f.includes(STEP_FLAG.added)) i++;
    else if (f.includes(DIFF_FLAG.removed) || f.includes(STEP_FLAG.removed)) o++;
  }
  return { in: i, out: o };
}

/** One leg: how far this track has pushed this element once the track finishes. */
export interface Leg { track: TrackName; dx: number; dy: number }

export interface TransitionItem {
  id: string;
  /** Base (position at time 0). **Always where it was in the previous frame**, no exceptions. */
  x: number; y: number;
  /** Additive displacement components. Empty = no motion at all, only opacity changes. */
  legs: Leg[];
}

/** Reskin: the same thing looks different in the two versions. */
export interface SkinChange {
  id: string;
  /** The previous version's class string. */
  past: string;
  /** This version's class string. */
  now: string;
}

/** A computed style (property → value). Values are exactly what the renderer gives; nothing is assumed about them. */
export type StyleMap = Record<string, string | number>;

/** One interpolatable property. Colors interpolate per component, numbers linearly; nothing else gets in here. */
export interface StyleTween {
  prop: string;
  from: number[];
  to: number[];
  /** true = these four numbers are rgba and go back into `rgba(...)`; false = a single number. */
  color: boolean;
}

/* Properties the look channel **does not touch**, two kinds:
 *   ① owned by another channel: display is view filtering, opacity is the "presence" channel, z-/events/
 *      transition-* belong to the renderer. Two channels writing one property means the last write wins: guaranteed conflict.
 *   ② text and box geometry: padding, font size, shape, text position. Text is drawn on the canvas's own layer (label channel),
 *      padding sizes boxes, shape is an enum: none of them belong here.
 *
 * **Node width and height belong here**, on the same progress as color: when a placeholder is filled, the node turns green and grows
 * at the same time instead of jumping in size first and changing color slowly. They used to be under ② on the grounds that "coordinates use
 * the new skin's size, reverting to the old size mid-tween would not match"; that does not hold for nodes: a coordinate is a node's center,
 * independent of size; edge endpoints and parent box bounds in box mode are recomputed by cytoscape each frame from current sizes. The one thing to keep is that
 * **layout measures the new skin**, not tween values: that belongs to the canvas (remove the width/height written here before measuring, put them back after). */
const NOT_OURS = /^(display|visibility|opacity|z-|transition-|events|text-events|min-zoomed)/;
const GEOMETRY = /^(padding|shape|font-|text-|label|source-arrow-shape|target-arrow-shape)/;
/** The look properties that change node size: the canvas removes them before measuring. */
export const SKIN_SIZE_PROPS = ['width', 'height'];

const RGB = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)$/;
function asColor(v: unknown): number[] | null {
  const m = RGB.exec(String(v));
  return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null;
}
/** A number: bare, or with px (the renderer gives width/height and stroke width as "30px"). Other units (%, em) are not interpolated. */
function asNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const m = /^(-?[\d.]+)(px)?$/.exec(String(v).trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * The difference of two computed styles → one tween + a set of hard cuts.
 *
 * **The core knows no specific color.** It asks two questions only: is this property the same in both versions? If not,
 * can these two values have an in-between? If yes (colors, numbers), interpolate; if not (`dashed`→`solid`, shapes and other
 * enums with no in-between), switch at that moment. So any profile, any palette, any style property added later
 * takes this path automatically, with nothing to register in advance.
 */
export function diffSkinStyle(past: StyleMap, now: StyleMap): {
  tween: StyleTween[]; steps: StyleMap;
} {
  const tween: StyleTween[] = [];
  const steps: StyleMap = {};
  for (const prop of Object.keys(now)) {
    // The renderer gives the same thing in both kebab and camel case; one is enough.
    if (/[A-Z]/.test(prop) || NOT_OURS.test(prop) || GEOMETRY.test(prop)) continue;
    const a = past[prop], b = now[prop];
    if (a === undefined || a === b || String(a) === String(b)) continue;
    const [ca, cb] = [asColor(a), asColor(b)];
    if (ca && cb) { tween.push({ prop, from: ca, to: cb, color: true }); continue; }
    const [na, nb] = [asNumber(a), asNumber(b)];
    if (na !== null && nb !== null) { tween.push({ prop, from: [na], to: [nb], color: false }); continue; }
    steps[prop] = a;   // records the **past** value: goes on at the start, removed at the right moment to return to the current value
  }
  return { tween, steps };
}

/** One frame of the tween. Progress is the "enter" envelope: new things appearing and the old skin becoming new are the same number. */
export function sampleSkinStyle(tween: StyleTween[], p: number): StyleMap {
  const out: StyleMap = {};
  for (const t of tween) {
    const v = t.from.map((f, i) => f + (t.to[i] - f) * p);
    out[t.prop] = t.color
      ? `rgba(${Math.round(v[0])},${Math.round(v[1])},${Math.round(v[2])},${v[3]})`
      : v[0];
  }
  return out;
}

export interface Transition {
  items: TransitionItem[];
  /** This switch's storyboard: which track runs when and on which curve. */
  score: Score;
  /** Look channel: old skin → new skin, progress is the "present" envelope. */
  skins: SkinChange[];
  /** Ids of elements leaving: the canvas tucks them away after the scene. */
  leaving: Set<string>;
  /** Whether anything is worth playing. When false the caller lands directly. */
  worth: boolean;
  /** Readings for logs / tests. */
  report: TransitionReport;
}

export interface TransitionReport {
  /** How many elements in the union take part. */
  total: number;
  /** Ones whose position actually changes (kept/changed moved by the union layout) */
  moved: number;
  /** The **median** of those moves (graph coordinates). A count alone lies: after a seeded re-solve every node settles
   *  slightly, so `moved` equals everyone while things only moved a few units. To judge "did it actually move",
   *  look at this number, not that count. */
  movedMedian: number;
  entering: number;
  leaving: number;
  /** Moved to another branch */
  relocated: number;
  /** Merged and converging */
  converging: number;
  /** Reskinned (same position, same presence, but looks different) */
  restyled: number;
  /** How many **pieces** the leavers form: a piece drifts as a whole, so this counts "pieces cut off", not nodes. */
  pieces: number;
  /** Added / removed **edges**. A step that only adds edges and moves no node is common (typically the linking beat);
   *  not counting them would judge it "nothing to play", while that step has nothing but edges to see. */
  edgesIn: number;
  edgesOut: number;
}

const MOVED_EPS = 1.5;
/** The fraction of the total drift distance covered by the "snap" beat; the rest belongs to the leaf. */
const SNAP_KICK = 0.3;

/**
 * **Where it grows from**: up the parent chain, the first ancestor "present in the previous frame".
 *
 * Mount seating (where the canvas puts new elements the moment it mounts the union) and the "sprout" base use **the same
 * function**: both places give the same number, so "mount frame = sample 0" is a fact by construction, not a convention written twice that
 * sooner or later diverges. When the whole parent chain is new (an entire new tree) it returns undefined, and the thing only
 * fades in without moving.
 */
export function anchorOf(
  id: string,
  seen: (id: string) => boolean,
  parentOf: (id: string) => string | undefined,
): string | undefined {
  const walked = new Set<string>([id]);
  let cur = parentOf(id);
  while (cur && !walked.has(cur)) {      // walked doubles as a cycle guard
    if (seen(cur)) return cur;
    walked.add(cur);
    cur = parentOf(cur);
  }
  return undefined;
}

/**
 * From the delta + previous frame coordinates + union coordinates, derive how each element moves in this transition.
 *
 * @param delta  the result of diffModels(previous, new). **May be empty**: the data did not change, only the coordinates did
 *               ("Recompute" does this); then every element only "shifts a bit",
 *               with no additions, removals or fades, but it should still play.
 * @param from   previous frame's on-screen coordinates. Elements without one (new ones) start at their anchor's position.
 * @param union  coordinates from the union layout: **the only source of end points**
 */
export function planTransition(
  delta: GraphDelta | null,
  from: Positions,
  union: Positions,
  opts: {
    skins?: SkinChange[];
    spec?: Required<AnimateSpec>;
    /** Parent-child relations in the element table (the canvas has the authoritative one: the virtual root is in it).
     *  If omitted, derived from the union model: the parent of a top level is the virtual root, if present. */
    parentOf?: (id: string) => string | undefined;
    /**
     * Who enters and leaves on screen: what the canvas read from the marks on elements, the **same source** as the "presence" channel's
     * fades and the curtain. The data change is only part of it: synthetic things in the element table (the virtual root) are not
     * in the data but still enter and leave. If the two places each kept their own, one node would be fading out while being planned
     * as "staying" and framed in. So delta handles details (what merged into what), and entering / leaving falls back to this.
     */
    presence?: Map<string, 'gone' | 'new'>;
  } = {},
): Transition {
  const skins = opts.skins ?? [];
  const spec = opts.spec ?? DEFAULT_ANIMATE;
  const drift = spec.drift;
  const items: TransitionItem[] = [];
  const leaving = new Set<string>();
  const report: TransitionReport = {
    total: 0, moved: 0, movedMedian: 0, entering: 0, leaving: 0, relocated: 0, converging: 0,
    restyled: skins.length, pieces: 0, edgesIn: 0, edgesOut: 0,
  };
  const dists: number[] = [];
  if (delta) ({ in: report.edgesIn, out: report.edgesOut } = edgeTraffic(delta));

  /** Where it was in the previous frame. Without one (new arrivals) it is its end point. */
  const at = (id: string) => from[id] ?? union[id];
  const ids = Object.keys(union);
  /** How it changes this time: the data decides (with details like "what merged into it"); for what the data lacks, the marks on screen. */
  const kindOf = (id: string): ChangeKind | undefined => {
    const k = delta?.byId.get(id)?.kind;
    if (k) return k;
    const p = opts.presence?.get(id);
    return p === 'gone' ? 'removed' : p === 'new' ? 'added' : undefined;
  };
  /* **The parent of a top-level node is the virtual root.** In connected mode the renderer synthesizes a root that gathers all top levels
   * (`buildElements`), but the model has no such parent. Going by the model alone, new top-level nodes fall into
   * the "no parent → fade in, no motion" branch, and in the cauliflower view most new branches are exactly top-level,
   * so the "sprout" beat would never happen. If it has coordinates in the union, it is present. */
  const parentOf = opts.parentOf ?? (() => {
    const model = new Map<string, string>();
    for (const n of delta?.model.nodes ?? []) if (n.parent) model.set(n.id, n.parent);
    const root = union[VIRTUAL_ROOT] ? VIRTUAL_ROOT : undefined;
    return (id: string) => model.get(id) ?? (id === root ? undefined : root);
  })();
  /** Whole-graph centroid: the reference for "outward" when there is no virtual root (several top levels in box view). */
  const hub = { x: 0, y: 0 };
  for (const id of ids) { hub.x += union[id].x / ids.length; hub.y += union[id].y / ids.length; }
  /* **Each fragment drifts its own way.** Expanding all by one ratio looks like "a shell growing", not drifting.
   * Each piece gets a little of its own: distance varies ±30%, plus a small sideways swing (perpendicular to the "parent → it"
   * direction). The seed is a hash of the id, so the same data always grows the same way; otherwise "replay" would differ.
   * Computed once when building the storyboard; the frame is still one multiply-add. */
  const jitter = (seed: string) => {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ((h >>> 0) % 2048) / 2048;
  };
  /** Whole-graph span: the ruler for drifting. */
  const bb = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
  for (const id of ids) {
    const q = union[id];
    bb.x1 = Math.min(bb.x1, q.x); bb.x2 = Math.max(bb.x2, q.x);
    bb.y1 = Math.min(bb.y1, q.y); bb.y2 = Math.max(bb.y2, q.y);
  }
  const span = Math.max(bb.x2 - bb.x1, bb.y2 - bb.y1) || 0;

  /* ── Leavers grouped into "pieces" ──────────────────────────────────────────────
   *
   * **The unit of the leaf beat is "a whole thing cut off", not a node.** A piece = a group of leaving nodes connected by the parent
   * chain (= one pruned subtree). Every node in a piece shares **the same legs**, so the
   * whole piece translates with its shape intact: a lock of hair falling, not a handful of particles exploding.
   *
   * Computing each node separately caused a very visible accident: the top node of a piece has a living parent (following it over a
   * thousand units), its children's parent is leaving too (Δ=0, not following), **so the upper half of one thing follows and the lower half
   * does not, and it gets pulled into a thread on the spot**. */
  const cutIds = new Set<string>();
  for (const id of ids) if (kindOf(id) === 'removed') cutIds.add(id);
  /** Walk up the parent chain while the parent is leaving too: the last one reached represents the piece. */
  const topOf = new Map<string, string>();
  const climb = (id: string) => {
    const path: string[] = [];
    let cur = id;
    for (;;) {
      const hit = topOf.get(cur);
      if (hit) { for (const q of path) topOf.set(q, hit); return hit; }
      const pa = parentOf(cur);
      if (!pa || !cutIds.has(pa) || path.includes(cur)) break;   // path.includes guards against cycles
      path.push(cur);
      cur = pa;
    }
    for (const q of path) topOf.set(q, cur);
    topOf.set(cur, cur);
    return cur;
  };
  const crew = new Map<string, string[]>();
  for (const id of cutIds) {
    const top = climb(id);
    const list = crew.get(top);
    if (list) list.push(id); else crew.set(top, [id]);
  }
  /** Piece representative → the legs shared by the piece. */
  const piece = new Map<string, Leg[]>();
  for (const [top, mates] of crew) {
    const pa = parentOf(top);
    const anchor = pa && union[pa] ? at(pa) : hub;
    /* **Once cut, it no longer follows.**
     *
     * Being cut and following contradict each other: something that has fallen off no longer moves with the tree. A previous version
     * made leavers "follow the parent" to fix "edges get stretched"; that problem is now solved by **the cut**,
     * more thoroughly, so following is not only redundant but drags a cut piece along for four thousand units (that is what was
     * measured), only to yank it back at the curtain. Hair on the floor means the person walked away, not the hair following them. */
    const legs: Leg[] = [];
    // Direction: from the attach point toward the piece's centroid, outward. If the piece sits exactly on the attach point, spread an angle by id.
    let cx = 0, cy = 0;
    for (const m of mates) { cx += at(m).x / mates.length; cy += at(m).y / mates.length; }
    const r = Math.hypot(cx - anchor.x, cy - anchor.y);
    const ang = jitter(`${top}@`) * Math.PI * 2;
    const ux = r > 1e-6 ? (cx - anchor.x) / r : Math.cos(ang);
    const uy = r > 1e-6 ? (cy - anchor.y) / r : Math.sin(ang);
    const len = drift * span * (0.7 + 0.6 * jitter(top));   // how far (varies ±30% **per piece**)
    const side = 0.32 * (jitter(`${top}~`) * 2 - 1);        // sideways swing
    const [dx, dy] = [(ux - uy * side) * len, (uy + ux * side) * len];
    /* The drift is split into **two beats**: `snap` springs off 30% as one impulse, `leaf` drifts the remaining 70% steadily.
     * Both legs are collinear and share the piece's direction, so the piece still moves as a rigid body; and the "cut" finally has
     * a short, sharp start in position, which together with the notch the `out` envelope dims in the same beat makes the cut
     * readable. One curve cannot do this: a curve only changes speed, it cannot make "two beats". */
    if (len > 0) {
      legs.push({ track: 'snap', dx: dx * SNAP_KICK, dy: dy * SNAP_KICK });
      legs.push({ track: 'leaf', dx: dx * (1 - SNAP_KICK), dy: dy * (1 - SNAP_KICK) });
    }
    piece.set(top, legs);
  }
  report.pieces = crew.size;

  for (const id of ids) {
    const to = union[id];
    const c = delta?.byId.get(id);
    const kind = kindOf(id);
    report.total++;

    /* The past half: leaving.
     *   removed  cut off: springs off once, then drifts away
     *   merged   follows **what it merged into**, then converges onto it
     * The two go in opposite directions, so one glance tells them apart: flung out means gone, drawn in means merged. */
    if (kind === 'removed' || kind === 'merged') {
      leaving.add(id);
      report.leaving++;
      const base = at(id);
      const pair = kind === 'merged' && c!.pairId ? c!.pairId : undefined;
      if (pair && union[pair]) {
        report.converging++;
        const pf = at(pair);
        items.push({
          id, x: base.x, y: base.y,
          legs: [
            { track: 'move', dx: union[pair].x - pf.x, dy: union[pair].y - pf.y },
            { track: 'leaf', dx: pf.x - base.x, dy: pf.y - base.y },
          ],
        });
        continue;
      }
      items.push({ id, x: base.x, y: base.y, legs: piece.get(topOf.get(id) ?? id) ?? [] });
      continue;
    }

    /* New arrivals: shoot out of **where they grow from**.
     *
     * The old dogma was "new things only fade in, never move", because "flying a transparent thing across half the graph carries no information".
     * The reason holds, but the conclusion was too broad: growing out of its own anchor is a distance locked by parent-child spacing, not
     * a flight; that is a shoot. So now: **not flying in from afar, but growing out of where it grows from.** */
    if (kind === 'added') {
      report.entering++;
      const anc = anchorOf(id, (q) => !!from[q], parentOf);
      if (anc && union[anc]) {
        const pf = from[anc];
        items.push({
          id, x: pf.x, y: pf.y,
          legs: [
            { track: 'move', dx: union[anc].x - pf.x, dy: union[anc].y - pf.y },
            { track: 'sprout', dx: to.x - union[anc].x, dy: to.y - union[anc].y },
          ],
        });
      } else {
        items.push({ id, x: to.x, y: to.y, legs: [] });
      }
      continue;
    }

    /* Moved to another branch: **it still starts where it was in the previous frame.**
     *
     * This used to start it from "the old parent box" (the "it moved to another branch" story). But it was somewhere else in the previous
     * frame, so the transition's frame 0 was a teleport: a second-level node jumped onto its parent and only then started moving.
     * Measured 449 units, and **it happened before any frame moved**, so measuring frame-to-frame motion could never see it.
     *
     * "It came from the old branch" is told by walking from its old position to its new one: the old position already
     * sits on the old branch. A more explicit pointer is the overlay's job (it draws a line back to the old parent box), not
     * something to act out with positions. */
    if (kind === 'moved') {
      report.relocated++;
      const a0 = at(id);
      items.push({ id, x: a0.x, y: a0.y, legs: [{ track: 'move', dx: to.x - a0.x, dy: to.y - a0.y }] });
      continue;
    }

    // What stays: walks from its previous frame position to its union position (the difference is the small shift the union layout brings).
    const a = at(id);
    const d = Math.hypot(a.x - to.x, a.y - to.y);
    if (d > MOVED_EPS) { report.moved++; dists.push(d); }
    items.push({ id, x: a.x, y: a.y, legs: [{ track: 'move', dx: to.x - a.x, dy: to.y - a.y }] });
  }

  if (dists.length) {
    dists.sort((x, y) => x - y);
    report.movedMedian = Math.round(dists[dists.length >> 1]);
  }
  const worth = report.moved + report.entering + report.leaving + report.relocated
    + report.restyled + report.edgesIn + report.edgesOut > 0;
  /* The storyboard is laid out for the beats that have content. Edges count too: a step that only adds or removes edges without moving
   * nodes is common (typically the linking beat), and all its content is in the "presence" channel. */
  const score = makeScore(spec, {
    // A branch move counts on both sides: it is **one containment edge gone + one containment edge come**, so both cut and graft
    // have content. Counting only node additions and removals would judge the step "motion only", then empty-beat trimming
    // squeezes cut to zero width, and the old link would not "break" but "vanish within a frame".
    leaf: report.leaving + report.edgesOut + report.relocated > 0,
    move: report.moved + report.relocated > 0,
    present: report.entering + report.edgesIn + report.restyled + report.relocated > 0,
  });
  return { items, skins, score, leaving, worth, report };
}

/**
 * Look channel: **the same node looks different in two versions**.
 *
 * The typical case is "a placeholder got filled": the `unfilled` flag drops and grey dashes become solid color. Note this is not
 * `changed`: `changed` compares data, while the skin is computed from kind/flags/whether it is a container,
 * and either can happen alone (that flag often depends on whether **other** nodes exist, with not one character of
 * its own data changed). So this does not look at change categories, only at skins: **for every matched node, compute classes for the previous
 * and this version; if they differ, it is a reskin.**
 *
 * @param delta  the diff of the two versions; only its `resolved` is used (old id → identity in the union)
 * @param prev   the previous model
 * @param next   this model (not the union: the union carries gb-* marks, which are the diff channel, not skin)
 */
export function planSkins(
  delta: GraphDelta | null, prev: GraphModel | null, next: GraphModel,
  profile: GraphProfile,
): SkinChange[] {
  if (!delta || !prev) return [];
  const kids = (m: GraphModel) => {
    const s = new Set<string>();
    for (const n of m.nodes) if (n.parent) s.add(n.parent);
    return s;
  };
  const [pKids, nKids] = [kids(prev), kids(next)];
  // The previous version may itself be a union (switching from compare back to browse), carrying gb-* marks. Those are the diff
  // channel, not skin; mixing them in would describe "the previous look" as "the previous version was marked".
  const skin = (n: GraphNode) => (n.flags?.some((f) => f.startsWith('gb-'))
    ? { ...n, flags: n.flags.filter((f) => !f.startsWith('gb-')) } : n);
  const out: SkinChange[] = [];
  for (const [oldId, unionId] of delta.resolved) {
    const a = prev.index.get(oldId), b = next.index.get(unionId);
    if (!a || !b) continue;
    const past = nodeClasses(skin(a), profile, { container: pKids.has(oldId) });
    const now = nodeClasses(skin(b), profile, { container: nKids.has(unionId) });
    if (past !== now) out.push({ id: unionId, past, now });
  }
  return out;
}

/** The half tucked away after the scene (the past). Also used to land directly on the new version when not playing. */
export function leavingOf(delta: GraphDelta | null): Set<string> {
  const out = new Set<string>();
  for (const c of delta?.changes ?? []) if (c.kind === 'removed' || c.kind === 'merged') out.add(c.id);
  return out;
}

/**
 * Sample one frame.
 *
 * **One input only: time t (wall-clock progress, no easing).** Curves belong to the tracks:
 * the window says "when", the curve says "how". It used to pass p through a global easing first and compare it against times,
 * so all times collapsed to the start (with easeOutCubic, 0.4 landed at 15.7% of wall-clock). The track model fills
 * that hole at the root: time and speed are no longer the same number.
 *
 * position = base + Σ(leg vector × its track's progress); opacity is isomorphic, see ENVELOPES.
 * At `t = 0` both equal their base, so **this frame is the last frame before the switch**.
 */
export function sampleTransition(t: Transition, time: number): {
  pos: Positions;
  /** Current opacity of the four envelopes. The caller sets style once on each of the four sets (rule ④).
   *  `fade.in` is also the look channel's progress (rule ③). */
  fade: Record<FadeName, number>;
  /** Progress of the camera's two legs: open to the union framing first, then close to the new framing. */
  open: number; close: number;
} {
  const sc = t.score;
  const s = {} as Record<TrackName, number>;
  for (const n of TRACK_NAMES) s[n] = trackAt(sc[n], time);
  const pos: Positions = {};
  for (const it of t.items) {
    let { x, y } = it;
    for (const l of it.legs) { const k = s[l.track]; x += l.dx * k; y += l.dy * k; }
    pos[it.id] = { x, y };
  }
  const fade = {} as Record<FadeName, number>;
  for (const n of FADE_NAMES) fade[n] = fadeAt(n, sc, time);
  return { pos, fade, open: s.open, close: s.close };
}
