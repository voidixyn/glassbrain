/* Transition choreography is pure functions, run directly in node.
 *
 * Two claims are pinned here:
 *   ① **position has one end point (the union coordinates)**, so "how do two versions line up" does not exist.
 *   ② a switch is **a sum of several tracks**, not interpolation along one curve: position = base +
 *      Σ(track progress × vector). Leaves, motion and sprouts each have their own window and curve.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchorOf, buildElements, buildModel, defineProfile, diffModels, diffSkinStyle, easeDrift,
  easeOutBack, easeOutCubic, edgeFade, edgeTraffic, makeScore, planSkins, planTransition, sampleSkinStyle,
  sampleTransition, stepUnion, leavingOf, trackAt, trackLin, DEFAULT_ANIMATE, FADE_BASE, FADE_NAMES, SNAP_DIM,
  type GraphNode } from '../dist/internal.js';

const n = (id: string, extra: Partial<GraphNode> = {}): GraphNode => ({ id, label: id, ...extra });
const P = (x: number, y: number) => ({ x, y });
/** Where an element is at some moment. Every assertion goes through this: how legs are split is implementation, position is the claim. */
const posAt = (t: ReturnType<typeof planTransition>, time: number, id: string) =>
  sampleTransition(t, time).pos[id];
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

test('what stays: walks from its previous frame position to its union position', () => {
  const d = diffModels(buildModel([n('a')], []), buildModel([n('a')], []));
  const t = planTransition(d, { a: P(0, 0) }, { a: P(10, 20) });
  assert.deepEqual(posAt(t, 0, 'a'), P(0, 0));
  assert.deepEqual(posAt(t, 1, 'a'), P(10, 20));
  assert.equal(t.report.moved, 1);
  assert.ok(t.worth);
});

test('nothing moved, nothing added or removed: not worth playing', () => {
  const d = diffModels(buildModel([n('a')], []), buildModel([n('a')], []));
  const t = planTransition(d, { a: P(5, 5) }, { a: P(5, 5.4) });
  assert.equal(t.worth, false);
});

test('added: shoots out **of its parent**, not flying in from afar but growing', () => {
  const a = buildModel([n('p')], []);
  const b = buildModel([n('p'), n('kid', { parent: 'p' })], []);
  const t = planTransition(diffModels(a, b), { p: P(0, 0) }, { p: P(0, 0), kid: P(99, 0) });
  assert.deepEqual(posAt(t, 0, 'kid'), P(0, 0), 'starts stuck to its parent');
  assert.deepEqual(posAt(t, 1, 'kid'), P(99, 0));
  // Midway it must be on the "parent → itself" line: a shoot, not a flight.
  const xs = [0.2, 0.5, 0.8, 0.95].map((time) => posAt(t, time, 'kid'));
  for (const q of xs) { assert.equal(q.y, 0); assert.ok(q.x >= 0); }
  // The bounce only shows as overshoot along this line, and it is overshoot of **position**, not size.
  assert.ok(Math.max(...xs.map((q) => q.x)) > 99, 'slightly overshoots, then settles back');
  assert.ok(Math.max(...xs.map((q) => q.x)) < 99 * 1.12);
  assert.equal(t.report.entering, 1);
});

test('added with no parent (top level): fades in only, no motion', () => {
  const t = planTransition(
    diffModels(buildModel([n('a')], []), buildModel([n('a'), n('b')], [])),
    { a: P(0, 0) }, { a: P(0, 0), b: P(99, 99) },
  );
  assert.deepEqual(posAt(t, 0, 'b'), P(99, 99));
  assert.deepEqual(posAt(t, 1, 'b'), P(99, 99));
});

test('removed: springs off once, then drifts away along "parent → it"', () => {
  const a = buildModel([n('p'), n('gone', { parent: 'p' })], []);
  const b = buildModel([n('p')], []);
  const t = planTransition(
    diffModels(a, b), { p: P(0, 0), gone: P(0, 50) }, { p: P(0, 0), gone: P(0, 50) },
  );
  const end = posAt(t, 1, 'gone');
  const far = Math.hypot(end.x, end.y);
  assert.ok(far > 50, 'drifts outward, does not stay put');
  // Each fragment varies on its own (±30% plus a little sideways swing), so only a band can be asserted.
  assert.ok(far > 50 * (1 + 0.7 * DEFAULT_ANIMATE.drift) * 0.98);
  assert.ok(far < 50 * (1 + 1.3 * DEFAULT_ANIMATE.drift) * 1.06);
  assert.deepEqual([...t.leaving], ['gone']);
  assert.deepEqual([...leavingOf(diffModels(a, b))], ['gone']);
});

test('each piece drifts its own way: expanding all by one ratio looks like "a shell growing"', () => {
  const kids = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'];
  const a = buildModel([n('p'), ...kids.map((k) => n(k, { parent: 'p' }))], []);
  const b = buildModel([n('p')], []);
  // All stacked on one point: any remaining difference can only come from each piece's own jitter.
  const at0: Record<string, { x: number; y: number }> = { p: P(0, 0) };
  for (const k of kids) at0[k] = P(0, 2000);
  const t = planTransition(diffModels(a, b), at0, at0);
  assert.equal(t.report.pieces, 6, 'the parent is alive, so six children are six pieces');
  const ends = kids.map((k) => posAt(t, 1, k));
  const uniq = new Set(ends.map((q) => `${q.x.toFixed(3)},${q.y.toFixed(3)}`));
  assert.equal(uniq.size, 6, 'six pieces must not end at one point');
  const far = Math.max(...ends.map((q, i) => Math.max(...ends.slice(i + 1)
    .map((r) => Math.hypot(q.x - r.x, q.y - r.y)))), 0);
  const len = Math.hypot(ends[0].x, ends[0].y - 2000);
  assert.ok(far > len * 0.25, `spread ${far}, drift ${len}: the jitter must be visible`);
  // The same data must grow the same way every time, or "play it again" would differ.
  assert.deepEqual(posAt(planTransition(diffModels(a, b), at0, at0), 1, 'g1'), ends[0]);
});

test('drift ends with non-zero speed, or fragments "stop and fade", no different from fading in place', () => {
  const tail = (f: (t: number) => number) => f(1) - f(0.9);
  assert.ok(tail(easeOutCubic) < 0.002, 'easeOutCubic barely moves at the end');
  assert.ok(tail(easeDrift) > 0.04, 'drift must keep drifting');
  // The impulse of breaking off belongs to the `snap` beat on its own; this curve only handles the long drift after it: nearly even.
  assert.ok(Math.abs(easeDrift(0.5) - 0.5) < 0.08, 'the drift is even, not front-loaded');
  assert.equal(easeDrift(1), 1);
});

test('once cut it no longer follows: hair on the floor means the person walked away', () => {
  // Being cut and following contradict each other. A previous version made leavers "follow the parent" to cure "stretched edges",
  // and the cut cures that now, so following only had side effects: dragging a cut piece along for thousands of units
  // (measured 4016), only to yank it back at the curtain.
  const a = buildModel([n('p'), n('gone', { parent: 'p' })], []);
  const b = buildModel([n('p')], []);
  const from = { p: P(0, 0), gone: P(0, 1000) };
  const t = planTransition(diffModels(a, b), from, { p: P(4000, 0), gone: P(0, 1000) });
  const end = posAt(t, 1, 'gone');
  const travel = Math.hypot(end.x, end.y - 1000);
  assert.ok(travel < 4000 * DEFAULT_ANIMATE.drift * 2, `should drift only a little, actually moved ${travel}`);
});

test('edges get no **chance** to stretch: the cut is done before the tree starts moving', () => {
  // Stronger than "compensate positions to keep relative positions": not compensation, no overlap in time at all.
  const sc = makeScore(DEFAULT_ANIMATE, { leaf: true, move: true, present: true });
  assert.ok(sc.cut.to <= sc.move.from, `the cut ${sc.cut.to} should finish before motion starts ${sc.move.from}`);
});

test('fragments drift longer than sprouts grow: "how much removed vs added" is visible at a glance', () => {
  const sc = makeScore(DEFAULT_ANIMATE, { leaf: true, move: true, present: true });
  assert.ok(sc.leaf.to > sc.sprout.from, 'fragments are still drifting when sprouts begin');
  assert.ok(sc.leaf.to - sc.leaf.from > sc.move.to - sc.move.from, 'leaving is the longest beat of the scene');
});

test('moved to another branch: it **still starts where it was in the previous frame**, not at the old parent box', () => {
  // Starting from the old parent box makes frame 0 a teleport: a second-level node jumps onto its parent on the spot.
  // And the jump happens before any frame moves, so frame-to-frame motion measurement never sees it.
  const a = buildModel([n('p1'), n('p2'), n('c', { parent: 'p1' })], []);
  const b = buildModel([n('p1'), n('p2'), n('c', { parent: 'p2' })], []);
  const t = planTransition(
    diffModels(a, b),
    { p1: P(0, 0), p2: P(100, 0), c: P(7, 50) },
    { p1: P(0, 0), p2: P(100, 0), c: P(100, 50) },
  );
  assert.deepEqual(posAt(t, 0, 'c'), P(7, 50), 'frame 0 must still be in place');
  assert.deepEqual(posAt(t, 1, 'c'), P(100, 50));
  assert.equal(t.report.relocated, 1);
});

test('**nothing may move on frame 0**: every kind of change starts from its previous frame position', () => {
  // This is the foundation of the whole transition's continuity: if one class of elements does not start at "where it was in the previous frame",
  // that class teleports at curtain-up, and comparing the motion of adjacent frames never catches it.
  const a = buildModel([
    n('p1'), n('p2'), n('keep'), n('moves', { parent: 'p1' }), n('gone', { parent: 'p1' }),
  ], []);
  const b = buildModel([n('p1'), n('p2'), n('keep'), n('moves', { parent: 'p2' }), n('fresh', { parent: 'p2' })], []);
  const from = { p1: P(0, 0), p2: P(500, 0), keep: P(10, 10), moves: P(30, 60), gone: P(-40, 70) };
  const union = { ...from, p1: P(5, 5), keep: P(900, 900), moves: P(520, 60), fresh: P(560, 90) };
  const t = planTransition(diffModels(a, b), from, union);
  for (const id of ['p1', 'p2', 'keep', 'moves', 'gone']) {
    assert.deepEqual(posAt(t, 0, id), from[id as keyof typeof from], `${id} moved on frame 0`);
  }
});

test('merge: old nodes fade while **converging onto what they merged into**: that is the swing', () => {
  const a = buildModel([n('old1'), n('old2')], []);
  const b = buildModel([n('new1')], []);
  const d = diffModels(a, b, { mapping: { old1: 'new1', old2: 'new1' } });
  const union = { new1: P(50, 50), old1: P(0, 0), old2: P(100, 0) };
  const t = planTransition(d, union, union);
  for (const id of ['old1', 'old2']) {
    assert.deepEqual(posAt(t, 1, id), P(50, 50), `${id} should converge onto new1`);
  }
  assert.equal(t.report.converging, 2);
});

test('convergence chases the match\'s **current** position, not its end', () => {
  // The match moves too. Watching only the end, old nodes would converge onto a place "it has not reached yet".
  const a = buildModel([n('old'), n('keep')], []);
  const b = buildModel([n('keep')], []);
  const d = diffModels(a, b, { mapping: { old: 'keep' } });
  const t = planTransition(d, { old: P(0, 0), keep: P(0, 0) }, { old: P(0, 0), keep: P(800, 0) });
  for (const time of [0.2, 0.34, 0.5]) {
    const { pos } = sampleTransition(t, time);
    assert.ok(pos.old.x <= pos.keep.x + 1e-6, `t=${time}: should not run ahead of its match`);
  }
  assert.deepEqual(posAt(t, 1, 'old'), P(800, 0));
});

test('sampling: both ends fit exactly; opacity is **a sum of legs** and takes no curve', () => {
  const d = diffModels(buildModel([n('a'), n('gone')], []), buildModel([n('a'), n('fresh')], []));
  const union = { a: P(0, 0), gone: P(1, 1), fresh: P(2, 2) };
  const t = planTransition(d, { a: P(10, 100) }, union);
  assert.deepEqual(posAt(t, 0, 'a'), P(10, 100));
  assert.deepEqual(posAt(t, 1, 'a'), P(0, 0));

  assert.deepEqual(sampleTransition(t, 0).fade, FADE_BASE);
  const end = sampleTransition(t, 1).fade;
  assert.deepEqual(end, { cut: 0, out: 0, in: 1, graft: 1 });
  // Each leg is linear within its window: halfway through the window is exactly half.
  const { leaf, present } = t.score;
  const half = (tr: { from: number; to: number }) => tr.from + (tr.to - tr.from) / 2;
  assert.ok(near(sampleTransition(t, half(present)).fade.in, 0.5, 1e-9));
  // The leaf leg only covers what is beyond SNAP_DIM: the snap beat already dropped a notch.
  assert.ok(near(sampleTransition(t, half(leaf)).fade.out, (1 - SNAP_DIM) * 0.5, 1e-9));
});

test('**time is wall-clock time**, no longer squashed to the start by speed', () => {
  // Before: p = easing(raw) was compared against windows, and with easeOutCubic 15.7% of wall-clock counted as 0.4,
  // so "the past" half finished fading at 110 ms of 700. Now there is one input.
  const d = diffModels(buildModel([n('a'), n('gone')], []), buildModel([n('a')], []));
  const t = planTransition(d, { a: P(0, 0) }, { a: P(10, 0), gone: P(5, 5) });
  const { snap, leaf } = t.score;
  assert.ok(near(sampleTransition(t, leaf.to).fade.out, 0, 1e-9));
  // The notch dropped by the snap beat does not count: the rest must follow the wall-clock faithfully.
  const rest = (time: number) => sampleTransition(t, time).fade.out / (1 - SNAP_DIM);
  assert.ok(near(rest(snap.to + (leaf.to - snap.to) * 0.5), 0.5, 0.02), 'half faded only past half the window');
});

test('empty beats leave no gap: a reskin-only switch should not make "present" wait until 62%', () => {
  const a = buildModel([n('x', { flags: ['unfilled'] })], []);
  const b = buildModel([n('x')], []);
  const d = diffModels(a, b);
  const skins = planSkins(d, a, b, defineProfile({ id: 't' }));
  const t = planTransition(d, { x: P(0, 0) }, { x: P(0, 0) }, { skins });
  assert.equal(t.score.present.from, 0, 'nothing before it, so the whole timeline shifts forward and fills up');
  assert.ok(sampleTransition(t, 0.5).fade.in > 0.4);
  // With leaves, follow the storyboard as written.
  const withLeaf = planTransition(
    diffModels(buildModel([n('x'), n('g')], []), buildModel([n('x')], [])),
    { x: P(0, 0), g: P(1, 1) }, { x: P(0, 0), g: P(1, 1) },
  );
  assert.equal(withLeaf.score.cut.from, 0, 'with something to cut, cutting comes first');
  assert.ok(withLeaf.score.present.from > 0.5);
});

test('both ends of a curve are pinned: floating-point residue becomes "frame 0 moved a hair"', () => {
  // easeOutBack(0.6) at 0 is -1.1e-16, which times a displacement is a 1e-14 unit move.
  // Numerically irrelevant, but wrong in principle: frame 0 must **exactly** equal the previous frame, not approximately.
  const back = easeOutBack(DEFAULT_ANIMATE.bounce);
  assert.notEqual(back(0), 0, 'the curve itself has residue');
  const tr = { from: 0, to: 1, ease: back };
  assert.equal(trackAt(tr, 0), 0, 'the track pins it');
  assert.equal(trackAt(tr, 1), 1);
});

test('the bounce is a curve, not a size; bounce=0 reduces exactly to easeOutCubic', () => {
  const back = easeOutBack(DEFAULT_ANIMATE.bounce);
  const peak = Math.max(...Array.from({ length: 101 }, (_, i) => back(i / 100)));
  assert.ok(peak > 1 && peak < 1.12, `overshoot should be "slight", measured ${peak}`);
  assert.equal(back(1), 1);
  const none = easeOutBack(0);
  for (const x of [0, 0.3, 0.7, 1]) assert.ok(near(none(x), easeOutCubic(x), 1e-12));
});

test('storyboard windows overlap: an order to read, without three times the duration', () => {
  const sc = makeScore(DEFAULT_ANIMATE, { leaf: true, move: true, present: true });
  assert.ok(sc.move.from < sc.leaf.to, 'motion starts before the leaves finish drifting');
  assert.ok(sc.sprout.from < sc.move.to, 'sprouts start as motion settles');
  assert.ok(sc.open.to < sc.close.from, 'the camera opens, then closes, without overlap');
  assert.equal(sc.close.to, 1);
});

test('unchanged data with new coordinates only (recompute) must still play', () => {
  const t = planTransition(null, { a: P(0, 0), b: P(10, 0) }, { a: P(500, 500), b: P(600, 500) });
  assert.equal(t.items.length, 2);
  assert.ok(t.worth, 'recompute is the action with the biggest moves; it should not land directly');
  assert.deepEqual(posAt(t, 1, 'a'), P(500, 500));
});

const P0 = defineProfile({ id: 't' });

test('reskin: a changed flag is a reskin, even when data has not changed a character', () => {
  // That is how it really happens: `unfilled` depends on whether **other** nodes filled it; its own data stays.
  const a = buildModel([{ id: 'x', label: 'x', kind: 'feature', flags: ['unfilled'] }], []);
  const b = buildModel([{ id: 'x', label: 'x', kind: 'feature' }], []);
  const d = diffModels(a, b);
  assert.equal(d.changes.length, 0, 'data did not change, so diff should report no change');
  const skins = planSkins(d, a, b, P0);
  assert.deepEqual(skins, [{ id: 'x', past: 'gb-node feature unfilled', now: 'gb-node feature' }]);
});

test('reskins are worth playing too, or the one thing this step wants to say is skipped', () => {
  const a = buildModel([{ id: 'x', label: 'x', flags: ['unfilled'] }], []);
  const b = buildModel([{ id: 'x', label: 'x' }], []);
  const d = diffModels(a, b);
  const t = planTransition(d, { x: P(0, 0) }, { x: P(0, 0) }, { skins: planSkins(d, a, b, P0) });
  assert.equal(t.report.restyled, 1);
  assert.ok(t.worth, 'not moving, only reskinned, still has to play');
  assert.equal(t.skins.length, 1);
});

test('reskins are recorded under **the identity in the union**, not the old id, so they connect after matching renames', () => {
  const a = buildModel([{ id: 'ns~x', label: 'x', flags: ['unfilled'] }], []);
  const b = buildModel([{ id: 'x', label: 'x' }], []);
  const key = (n: GraphNode) => n.id.replace(/^[^~]+~/, '');
  const d = diffModels(a, b, { key });
  const skins = planSkins(d, a, b, P0);
  assert.deepEqual(skins.map((s) => s.id), ['x']);
});

test('skins contain no gb-* marks: the previous version may itself be a union (switching back from compare)', () => {
  const v1 = buildModel([{ id: 'x', label: 'x' }], []);
  const v2 = buildModel([{ id: 'x', label: 'x' }, { id: 'y', label: 'y' }], []);
  const union = diffModels(v1, v2).model;           // x carries gb-kept
  const next = buildModel([{ id: 'x', label: 'x', kind: 'feature' }], []);
  const d = diffModels(union, next);
  const skins = planSkins(d, union, next, P0);
  assert.deepEqual(skins, [{ id: 'x', past: 'gb-node', now: 'gb-node feature' }]);
});

test('no previous version means no skin to compare (the first render must not flash)', () => {
  const b = buildModel([{ id: 'x', label: 'x' }], []);
  assert.deepEqual(planSkins(diffModels(b, b), null, b, P0), []);
});

/* ── Color tweens ──────────────────────────────────────────────────────────
 * The core knows no specific color: it only asks "are the two versions different" and "do these two values have an in-between". */

test('colors interpolate per component; half is half', () => {
  const { tween, steps } = diffSkinStyle(
    { 'background-color': 'rgb(0,100,200)' },
    { 'background-color': 'rgb(100,200,100)' },
  );
  assert.deepEqual(steps, {});
  assert.equal(sampleSkinStyle(tween, 0)['background-color'], 'rgba(0,100,200,1)');
  assert.equal(sampleSkinStyle(tween, 0.5)['background-color'], 'rgba(50,150,150,1)');
  assert.equal(sampleSkinStyle(tween, 1)['background-color'], 'rgba(100,200,100,1)');
});

test('numbers interpolate too; those with no in-between (dashed→solid) switch at that moment', () => {
  const { tween, steps } = diffSkinStyle(
    { 'background-opacity': '0.7', 'border-style': 'dashed' },
    { 'background-opacity': '1', 'border-style': 'solid' },
  );
  assert.equal(sampleSkinStyle(tween, 0.5)['background-opacity'], 0.85);
  // Records the **past** value: goes on at the start, removed at the right moment to return to the current value.
  assert.deepEqual(steps, { 'border-style': 'dashed' });
});

test('properties owned by other channels, and text and box geometry, are never touched', () => {
  const { tween, steps } = diffSkinStyle(
    { opacity: '1', display: 'element', 'font-size': '11', padding: '4px', backgroundColor: 'rgb(1,2,3)' },
    { opacity: '0.2', display: 'none', 'font-size': '13', padding: '8px', backgroundColor: 'rgb(9,9,9)' },
  );
  assert.deepEqual(tween, [], 'opacity belongs to "presence", display to the view, text to the label channel, padding sizes boxes');
  assert.deepEqual(steps, {});
});

test('node width and height follow the same progress as color: a filled placeholder changes color and grows together, no jump in size first', () => {
  const { tween, steps } = diffSkinStyle(
    { width: '30px', height: '30px', 'background-color': 'rgb(0,0,0)' },
    { width: '45px', height: '45px', 'background-color': 'rgb(100,100,100)' },
  );
  assert.deepEqual(steps, {});
  assert.deepEqual(tween.map((t) => t.prop).sort(), ['background-color', 'height', 'width']);
  assert.equal(sampleSkinStyle(tween, 0).width, 30, 'frame 0 is the previous frame');
  assert.equal(sampleSkinStyle(tween, 0.5).width, 37.5);
});

test('equal properties stay out of the tween: of five hundred-odd properties only a few really differ', () => {
  const same = { 'background-color': 'rgb(1,2,3)', 'border-color': 'rgb(4,5,6)' };
  assert.deepEqual(diffSkinStyle(same, { ...same }), { tween: [], steps: {} });
});


test('the parent of a top level is the virtual root: in the cauliflower view nearly all new branches are top level', () => {
  // In connected mode the renderer synthesizes a root gathering the top levels; the model has no such parent. Going by the model alone,
  // new top levels fall into "no parent → fade in, no motion", and the "sprout" beat never happens.
  const a = buildModel([n('old')], []);
  const b = buildModel([n('old'), n('fresh')], []);
  const d = diffModels(a, b);
  const union = { __gk_root__: P(0, 0), old: P(-10, 0), fresh: P(100, 0) };
  const t = planTransition(d, { __gk_root__: P(0, 0), old: P(-10, 0) }, union);
  assert.deepEqual(posAt(t, 0, 'fresh'), P(0, 0), 'shoots out of the root');
  assert.deepEqual(posAt(t, 1, 'fresh'), P(100, 0));
  // Without a virtual root (several top levels in box view) it falls back to the old behavior: fade in only, no motion.
  const flat = planTransition(d, { old: P(-10, 0) }, { old: P(-10, 0), fresh: P(100, 0) });
  assert.deepEqual(posAt(flat, 0, 'fresh'), P(100, 0));
});

test('a piece translates **as a whole**: its shape does not change at all', () => {
  // Computing each node separately causes an accident: the top one in a piece has a living parent (it follows), its children's parent is
  // leaving too (does not follow), so the upper half of one thing follows and the lower half does not, pulled into a thread on the spot.
  const a = buildModel([
    n('alive'), n('top', { parent: 'alive' }), n('mid', { parent: 'top' }), n('leaf', { parent: 'mid' }),
  ], []);
  const b = buildModel([n('alive')], []);
  const from = { alive: P(0, 0), top: P(0, 100), mid: P(0, 200), leaf: P(0, 300) };
  const t = planTransition(diffModels(a, b), from, { ...from, alive: P(1500, 0) });
  assert.equal(t.report.pieces, 1, 'one pruned subtree is one piece');
  for (const time of [0, 0.2, 0.4, 0.7, 1]) {
    const { pos } = sampleTransition(t, time);
    assert.ok(near(pos.mid.x - pos.top.x, 0, 1e-9), `t=${time}: the piece was torn apart`);
    assert.ok(near(pos.mid.y - pos.top.y, 100, 1e-9), `t=${time}: the piece was torn apart`);
    assert.ok(near(pos.leaf.y - pos.top.y, 200, 1e-9), `t=${time}: the piece was torn apart`);
  }
});

test('cutting is much faster than fading: break first, then drift', () => {
  const sc = makeScore(DEFAULT_ANIMATE, { leaf: true, move: true, present: true });
  assert.equal(sc.cut.from, 0);
  assert.ok(sc.cut.to < sc.leaf.to / 4, 'the cut is an instant, leaving is a whole stretch');
  assert.ok(sc.leaf.from > 0, 'at the instant of the cut it has not started drifting, so it reads as a "break"');
  const d = diffModels(buildModel([n('a'), n('g')], []), buildModel([n('a')], []));
  const t = planTransition(d, { a: P(0, 0), g: P(0, 90) }, { a: P(0, 0), g: P(0, 90) });
  const mid = sampleTransition(t, sc.cut.to);
  assert.equal(mid.fade.cut, 0, 'by now the edges are completely broken');
  assert.ok(mid.fade.out > 0.85, 'while the piece itself is still mostly solid');
});

/* ── Frame 0 is a consequence, not a rule ────────────────────────────────────────────── */

test('**frame 0 may not change opacity or skin either**: three channels of one shape, all equal to their base at t=0', () => {
  // Position had been kept long ago, but "presence" and "look" each used to be written their own way, so the frames between mounting the union
  // and finishing layout belonged to nobody: new nodes and edges were drawn in full with default styles, the audience first saw "the new stuff is already here",
  // and the cut played afterwards meant nothing. With all three channels additive, frame 0 depends on neither the storyboard nor
  // coordinates (all bases), so it can be written the moment of mounting.
  const a = buildModel([n('keep'), n('gone')], []);
  const b = buildModel([n('keep'), n('fresh')], []);
  const from = { keep: P(0, 0), gone: P(30, 40) };
  const t = planTransition(diffModels(a, b), from, { keep: P(500, 0), gone: P(30, 40), fresh: P(9, 9) });
  for (const id of ['keep', 'gone']) {
    assert.deepEqual(posAt(t, 0, id), from[id as keyof typeof from], `${id} moved on frame 0`);
  }
  assert.deepEqual(sampleTransition(t, 0).fade, FADE_BASE, 'frame 0 opacity must be the base');
  assert.equal(FADE_BASE.in, 0, 'new things are invisible before they get a position');
  assert.equal(FADE_BASE.graft, 0);
  assert.equal(FADE_BASE.out, 1);
  assert.equal(FADE_BASE.cut, 1);
  // The base does not depend on this switch's storyboard: the same after trimming empty beats.
  const onlyIn = planTransition(
    diffModels(buildModel([n('x')], []), buildModel([n('x'), n('y')], [])),
    { x: P(0, 0) }, { x: P(0, 0), y: P(5, 5) },
  );
  assert.deepEqual(sampleTransition(onlyIn, 0).fade, FADE_BASE);
});

test('anchor: the first ancestor up the parent chain **present in the previous frame**; seating and sprouting ask the same function', () => {
  const par = new Map([['kid', 'branch'], ['branch', 'trunk']]);
  const parentOf = (id: string) => par.get(id);
  // A whole new branch: skip over it and hang on the trunk still present.
  assert.equal(anchorOf('kid', (q) => q === 'trunk', parentOf), 'trunk');
  assert.equal(anchorOf('kid', (q) => q === 'branch', parentOf), 'branch');
  // A whole new tree: nowhere to hang, so fade in only, no motion.
  assert.equal(anchorOf('kid', () => false, parentOf), undefined);
  // A cycle must stop too.
  const ring = (id: string) => (id === 'a' ? 'b' : 'a');
  assert.equal(anchorOf('a', () => false, ring), undefined);
});

test('the parent of an added node is new too: skip it and shoot out of the grandparent still present', () => {
  const a = buildModel([n('root0')], []);
  const b = buildModel([n('root0'), n('branch', { parent: 'root0' }), n('kid', { parent: 'branch' })], []);
  const t = planTransition(diffModels(a, b), { root0: P(0, 0) },
    { root0: P(0, 0), branch: P(50, 0), kid: P(80, 0) });
  assert.deepEqual(posAt(t, 0, 'kid'), P(0, 0), 'the parent has no position yet, so it hangs on the grandparent');
  assert.deepEqual(posAt(t, 1, 'kid'), P(80, 0));
});

/* ── Cutting is two beats: spring off, then drift ────────────────────────────────────────── */

test('the cut must be visible: a sudden short spring + one notch darker, then a slow drift', () => {
  // One curve cannot do this: a curve only changes speed, not "two beats". So the "spring" is a separate leg,
  // and both position and opacity hang on it: a short impulse in position, one notch down in opacity.
  const a = buildModel([n('p'), n('gone', { parent: 'p' })], []);
  const b = buildModel([n('p')], []);
  const at0 = { p: P(0, 0), gone: P(0, 1000) };
  const t = planTransition(diffModels(a, b), at0, at0);
  const sc = t.score;
  const away = (time: number) => Math.hypot(posAt(t, time, 'gone').x, posAt(t, time, 'gone').y - 1000);
  const total = away(1);

  // ① spring: only 20% of the time has passed and about 30% of the motion is done.
  assert.ok(sc.snap.to < 0.25, `springing off is an instant (${sc.snap.to}), not a stretch`);
  const kicked = away(sc.snap.to) / total;
  assert.ok(kicked > 0.25 && kicked < 0.45, `the snap beat should cover about 30%, actually ${kicked}`);

  // ② dim: in the same beat opacity drops a notch, the rest is left for the leaf to fade slowly.
  const dimmed = 1 - sampleTransition(t, sc.snap.to).fade.out;
  assert.ok(Math.abs(dimmed - SNAP_DIM) < 0.05, `should drop ${SNAP_DIM}, actually ${dimmed}`);
  // Fast then slow: during the snap beat it drops several times faster per unit time than in the long stretch after.
  const early = dimmed / (sc.snap.to - sc.snap.from);
  const late = (1 - dimmed) / (sc.leaf.to - sc.snap.to);
  assert.ok(early > late * 3, `the cut needs weight: early ${early}/unit time vs late ${late}`);

  // ③ the two legs are collinear, so the piece stays rigid: its direction never changes.
  const dir = (time: number) => Math.atan2(posAt(t, time, 'gone').y - 1000, posAt(t, time, 'gone').x);
  for (const time of [sc.snap.to, 0.5, 1]) assert.ok(near(dir(time), dir(1), 1e-9));
});

test('the storyboard is symmetric: cut at the start, graft at the end, motion in the middle', () => {
  const sc = makeScore(DEFAULT_ANIMATE, { leaf: true, move: true, present: true });
  assert.equal(sc.cut.from, 0, 'cutting comes first');
  assert.equal(sc.graft.to, 1, 'grafting comes last');
  assert.ok(sc.graft.from > sc.sprout.from, 'grow first, then connect');
  assert.ok(sc.graft.from > sc.move.to, 'connect only once everything is in place');
  // Both ends "change connections", both short and unambiguous.
  assert.ok(sc.cut.to - sc.cut.from < 0.2 && sc.graft.to - sc.graft.from < 0.2);
});

test('four envelopes, four batch style calls per frame: per element is hundreds per frame', () => {
  assert.deepEqual(FADE_NAMES, ['cut', 'out', 'in', 'graft']);
});

/* ── An edge is defined by its two ends; change one and it is another edge ────────────────────────────────── */

test('another branch = one containment edge gone + one containment edge come', () => {
  // "Containment" is a synthesized edge generated from parent, and a moved node in the union carries its **new parent**.
  // Emitting only the new one: it connects "new parent → it" while on frame 0 it still stands at the old position, so at curtain-up
  // a thick line across the whole graph appears from nowhere; meanwhile the old one just vanishes. Both ends are abrupt, and marks alone
  // never reveal it: synthesized edges never had marks. The fix is emitting both honestly, each with its mark.
  const a = buildModel([n('p1'), n('p2'), n('c', { parent: 'p1' })], []);
  const b = buildModel([n('p1'), n('p2'), n('c', { parent: 'p2' })], []);
  const d = diffModels(a, b);
  assert.equal(d.model.index.get('c')!.prevParent, 'p1', 'the union remembers where it hung in the previous version');
  const els = buildElements(d.model, P0).elements;
  const link = (parent: string) => els.find((e) => String(e.data.id) === `contains:${parent}->c`);
  assert.equal(link('p2')?.classes, 'contains gb-added', 'the new one is marked as new');
  assert.equal(link('p1')?.classes, 'contains gb-removed', 'the old one must be present to play its exit');
  assert.equal(link('p1')!.data._force, false, 'the old one only plays an exit and carries no force');
});

test('no branch change means one edge, without marks', () => {
  const a = buildModel([n('p'), n('c', { parent: 'p' })], []);
  const d = diffModels(a, a);
  const els = buildElements(d.model, P0).elements;
  const links = els.filter((e) => String(e.data.id).startsWith('contains:'));
  assert.equal(links.length, 1);
  assert.equal(links[0].classes, 'contains');
});

test('which envelope an edge belongs to: one axiom + "an edge has no position of its own"', () => {
  // Axiom: additions grow, removals drift; an edge is defined by its two ends, change one and it is another edge.
  // Corollary: an edge can only be drawn between its ends, so it can follow only when both ends share a fate; otherwise it must break, and breaking picks
  //       the time when "neither end moves", so leavers rush before motion and arrivals wait until after it.
  assert.equal(edgeFade('gone', 'gone', null), 'out', 'both ends share a fate: drifts with the piece, length unchanged');
  assert.equal(edgeFade('stay', 'gone', null), 'cut', 'the living end is about to move → break first');
  assert.equal(edgeFade('new', 'new', null), 'in');
  assert.equal(edgeFade('stay', 'new', null), 'in', 'the old end has long been in place; grows along with the new branch');
  assert.equal(edgeFade('stay', 'stay', 'added'), 'graft', 'the new link of a branch move: connects after motion stops');
  assert.equal(edgeFade('stay', 'stay', 'removed'), 'cut', 'the old link of a branch move: breaks before motion');
  assert.equal(edgeFade('stay', 'stay', null), null, 'unchanged edges belong to no group');
  // Touching both (rare) counts as the past half: fading "in" something about to disappear means nothing.
  assert.equal(edgeFade('gone', 'new', null), 'cut');
});

test('in a step with only branch moves, cut and graft still need width', () => {
  // Trimming empty beats by node additions and removals alone would judge this step "motion only" and squeeze the cut beat to zero width:
  // the old link would not "break" but vanish within one frame.
  const a = buildModel([n('p1'), n('p2'), n('c', { parent: 'p1' })], []);
  const b = buildModel([n('p1'), n('p2'), n('c', { parent: 'p2' })], []);
  const t = planTransition(diffModels(a, b),
    { p1: P(0, 0), p2: P(100, 0), c: P(7, 50) },
    { p1: P(0, 0), p2: P(100, 0), c: P(100, 50) });
  assert.equal(t.report.relocated, 1);
  assert.ok(t.score.cut.to > 0.05, `the cut needs width, actually ${t.score.cut.to}`);
  assert.ok(t.score.cut.to <= t.score.move.from, 'the tree starts moving only after the cut is clean');
  assert.ok(t.score.graft.from >= t.score.move.to, 'connect only once everything is in place');
});

test('a step that only links still plays: no node changed, the edges are the whole step', () => {
  // `changes` lists nodes only. Reading "no changes" as "nothing to play" landed every linking step in one frame.
  const a = buildModel([n('x'), n('y'), n('z')], []);
  const b = buildModel([n('x'), n('y'), n('z')], [{ source: 'x', target: 'y', kind: 'calls' }]);
  const at = { x: P(0, 0), y: P(100, 0), z: P(0, 100) };
  for (const d of [diffModels(a, b), stepUnion(a, b)]) {
    assert.equal(d.changes.length, 0);
    assert.deepEqual(edgeTraffic(d), { in: 1, out: 0 });
    const t = planTransition(d, at, at);
    assert.equal(t.report.edgesIn, 1);
    assert.ok(t.worth);
  }
  assert.deepEqual(edgeTraffic(stepUnion(b, a)), { in: 0, out: 1 });
});

test('a zero-width track left by trimming empty beats **does not happen**, or the camera teleports on frame 1', () => {
  // In a reskin-only step (no leaves, no motion) lead trims the camera's "open" to zero width. A zero-width window used to be
  // divided by a 1e-6 floor, saturating to 1 on the first frame: content tracks did not care (those groups were
  // empty), **but the camera eats the same number**: the picture teleported to the union framing on frame 1 and spent the whole scene
  // drifting back. Frame 0 continuous, frame 1 jumped: exactly the shape of a "somersault".
  const skinOnly = makeScore(DEFAULT_ANIMATE, { present: true });
  assert.equal(skinOnly.open.to - skinOnly.open.from, 0, '"open" was trimmed away entirely');
  for (const time of [0, 0.001, 0.5, 1]) {
    assert.equal(trackLin(skinOnly.open, time), 0, `t=${time}: this beat should not happen`);
    assert.equal(trackAt(skinOnly.open, time), 0);
  }
  // Beats with content run their full course as usual.
  const full = makeScore(DEFAULT_ANIMATE, { leaf: true, move: true, present: true });
  assert.ok(full.open.to > full.open.from);
  assert.equal(trackAt(full.open, full.open.to), 1);
  assert.equal(trackAt(full.cut, full.cut.to), 1);
});

test('**how long a beat plays does not depend on how many beats the step has**: no gaps for empty beats, and no stretching the rest', () => {
  // It used to only shift forward: after trimming the empty start the rest was stretched back to [0,1] with the wall-clock duration unchanged, so
  // a "content only" step slowed the present beat by 2.78× and still played the full 1800 ms. The audience was not waiting on empty beats
  // but on a stretched one. Now windows are still normalized, but wall-clock is multiplied by span, and the two scalings cancel.
  const D = DEFAULT_ANIMATE.duration;
  const full = makeScore(DEFAULT_ANIMATE, { leaf: true, move: true, present: true });
  const skinOnly = makeScore(DEFAULT_ANIMATE, { present: true });
  const moveOnly = makeScore(DEFAULT_ANIMATE, { move: true });

  assert.equal(full.span, 1, 'a full scene is the whole duration');
  assert.ok(Math.abs(skinOnly.span - 0.36) < 1e-9, `present only: ${skinOnly.span}`);
  assert.ok(Math.abs(moveOnly.span - 0.78) < 1e-9, `motion only: ${moveOnly.span}`);
  assert.ok(D * skinOnly.span < 700, `a reskin-only / growth-only step should be brisk, measured ${D * skinOnly.span}ms`);

  // The same beat must take the same **milliseconds** in both storyboards.
  const ms = (sc: typeof full, k: 'present' | 'sprout' | 'move') =>
    (sc[k].to - sc[k].from) * sc.span * D;
  assert.ok(near(ms(skinOnly, 'present'), ms(full, 'present'), 1e-9), 'the present beat was stretched');
  assert.ok(near(ms(skinOnly, 'sprout'), ms(full, 'sprout'), 1e-9), 'the sprout beat was stretched');
  assert.ok(near(ms(moveOnly, 'move'), ms(full, 'move'), 1e-9), 'the move beat was stretched');
});

test('recoloring is the same scalar as "present": as far as it has appeared, the old skin has become the new', () => {
  // Rule ③: no second timeline, so they cannot drift apart. Growth (sprout) is the **position** leg of the same beat, its window
  // deliberately slightly offset: opacity may not take the bounce curve (bounce belongs to position only).
  const a = buildModel([{ id: 'x', label: 'x', flags: ['unfilled'] }, n('p')], []);
  const b = buildModel([{ id: 'x', label: 'x' }, n('p'), n('fresh', { parent: 'p' })], []);
  const d = diffModels(a, b);
  const t = planTransition(d, { x: P(0, 0), p: P(50, 0) },
    { x: P(0, 0), p: P(50, 0), fresh: P(90, 0) }, { skins: planSkins(d, a, b, P0) });
  // 2 reskins: x lost unfilled, p gained a child and became a container; the latter is exactly the kind where "skin is not
  // changed": p's data did not change a character, **other** nodes changed how it looks.
  assert.equal(t.report.restyled, 2);
  assert.equal(t.report.entering, 1);
  for (const time of [0, 0.3, 0.7, 1]) {
    const f = sampleTransition(t, time);
    // The look channel's progress is fade.in itself: there is no second number in the sample to choose.
    assert.equal(f.fade.in, trackLin(t.score.present, time));
  }
  assert.ok(t.score.sprout.from > t.score.present.from, 'appear first, then shoot out');
  assert.equal(t.score.sprout.to, 1);
});
