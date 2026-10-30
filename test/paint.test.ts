/* Painting rules (the four at the top of paint.ts): true geometry, conserved ink, a floor for the skeleton from afar, semantics as hairlines,
 * and a dot's form depends only on how big it is on screen. Painting itself needs a real browser; this only pins the rules. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dotOf, gapOf, skeletonLineOf, semanticAlphaOf, clippedLength, hazeOf, detailed, reachOf, hittable, focusAlphaOf, FOCUS_INK,
  MIN_DOT, MIN_LINE, SKEL_FLOOR, SEM_INK, SEM_BOOST, DETAIL_LEAF, GAP, HOLD_LEAF, EDGE_REACH, shareT,
  NODE_BASE, nodeDiameter, nodeWeight,
} from '../dist/internal.js';

const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

test('dots: scale proportionally with zoom; once too small to draw they stop shrinking and fade by area instead', () => {
  assert.deepEqual(dotOf(30, 1), [30, 1]);
  assert.deepEqual(dotOf(30, 0.5), [15, 1]);
  const [s, a] = dotOf(30, 0.05);   // 1.5px
  assert.equal(s, MIN_DOT);
  assert.ok(close(a, (1.5 / MIN_DOT) ** 2), 'ink = ratio of areas');
});

test('heavy dots shrink less from afar: while leaves are at least HOLD_LEAF nothing changes, further out full dots stop and leaves keep shrinking', () => {
  const hub = nodeDiameter(1000), leaf = nodeDiameter(0), w = nodeWeight(1000);
  const leafPx = (z: number) => NODE_BASE * z;
  // When a small graph fits the window (leaves ≥ HOLD_LEAF px) everything is as before.
  const zNear = HOLD_LEAF / NODE_BASE;
  assert.deepEqual(dotOf(hub, zNear, w, leafPx(zNear)), dotOf(hub, zNear));
  assert.deepEqual(dotOf(hub, 0.3, w, leafPx(0.3)), dotOf(hub, 0.3));
  // Further out: full dots stay at their size at zNear, leaves keep shrinking (then fade by conserved ink).
  const zFar = zNear / 2;
  assert.ok(close(dotOf(hub, zFar, w, leafPx(zFar))[0], hub * zNear));
  assert.deepEqual(dotOf(leaf, zFar, 0, leafPx(zFar)), dotOf(leaf, zFar));
  // Dots with a middle share are in between.
  const mid = dotOf(nodeDiameter(30), zFar, nodeWeight(30), leafPx(zFar))[0];
  assert.ok(mid > nodeDiameter(30) * zFar && mid < hub * zNear);
});

test('edge hit range = (hit width + half the line width) × ink: narrows continuously, with no threshold and no floor', () => {
  assert.equal(reachOf(1, 1), EDGE_REACH + 0.5);
  assert.ok(close(reachOf(0.5, 1), (EDGE_REACH + 0.5) / 2));
  assert.ok(reachOf(0.01, 1) < 0.1, 'a line you can barely see can barely be touched');
  assert.equal(reachOf(0, 1), 0);
  assert.ok(reachOf(1, 4) > reachOf(1, 1), 'the range of a thick line follows its width');
  assert.ok(reachOf(1, 1, true) > reachOf(1, 1), 'wider on touch screens');
  // A band narrower than one pixel does not count.
  assert.ok(hittable(reachOf(1, 1, false, 0)), 'hit width 0, solid: clickable right on the line');
  assert.ok(!hittable(reachOf(0.9, 1, false, 0)), 'hit width 0, slightly faded: not clickable');
  assert.ok(hittable(reachOf(0.2, 1, false, 3)) && !hittable(reachOf(0.1, 1, false, 3)));
});

test('semantic edges one hop from the hover: solid up to a few, beyond that they fade by √, total ink still grows with the count', () => {
  assert.equal(focusAlphaOf(1), 1);
  assert.equal(focusAlphaOf(FOCUS_INK), 1);
  assert.ok(close(focusAlphaOf(FOCUS_INK * 4), 0.5));
  assert.ok(focusAlphaOf(460) * 460 > focusAlphaOf(46) * 46, 'more connections still look like more');
});

test('skeleton lines: scale with zoom; fade below 1px; from afar a floor by share, the trunk thicker than the leaf level', () => {
  assert.deepEqual(skeletonLineOf(10, 1, 0.1), [10, 1]);
  const trunk = skeletonLineOf(10, 0.01, 1);
  assert.equal(trunk[0], SKEL_FLOOR, 'the trunk stops at the floor from afar');
  assert.equal(trunk[1], 1);
  const leaf = skeletonLineOf(4, 0.01, shareT(0));
  assert.equal(leaf[0], MIN_LINE);
  assert.ok(leaf[1] < 1, 'the leaf level falls back to a faint line');
  assert.ok(skeletonLineOf(4, 0.05, shareT(0.3))[0] > leaf[0] || skeletonLineOf(4, 0.05, shareT(0.3))[1] > leaf[1]);
});

test('semantic edges: ink per screen is conserved — the given opacity when just right, fainter when denser, sparse ones at most a few times more solid', () => {
  assert.ok(close(semanticAlphaOf(0.5, SEM_INK), 0.5));
  assert.ok(close(semanticAlphaOf(0.5, SEM_INK * 4), 0.25), 'four times denser, half as opaque');
  assert.ok(close(semanticAlphaOf(0.3, SEM_INK / 100), 0.3 * SEM_BOOST), 'sparse has a ceiling');
  assert.equal(semanticAlphaOf(0.9, 0), 1, 'never above 1');
});

test('clippedLength: only counts the part on screen', () => {
  assert.ok(close(clippedLength(10, 10, 40, 50, 100, 100), 50));
  assert.ok(close(clippedLength(-50, 50, 150, 50, 100, 100), 100));
  assert.equal(clippedLength(-50, -10, 150, -10, 100, 100), 0);
});

test('a dot\'s form changes continuously: the haze fades out over the same range in which the gap grows', () => {
  assert.equal(gapOf(GAP[0]), 0);
  assert.equal(gapOf(1), 0);
  assert.ok(gapOf(GAP[1]) > 0);
  assert.equal(gapOf(GAP[1]), gapOf(GAP[1] * 4), 'once full it stops changing');
  assert.ok(hazeOf(1) > 0);
  assert.equal(hazeOf(GAP[1]), 0, 'the haze is gone exactly when the gap is full');
  const mid = (GAP[0] + GAP[1]) / 2;
  assert.ok(hazeOf(mid) > 0 && gapOf(mid) > 0, 'both are present in the handover range, with no gap between them');
});

test('details (dashes, arrows on semantic edges) are only drawn up close', () => {
  assert.equal(detailed(DETAIL_LEAF - 0.1), false);
  assert.equal(detailed(DETAIL_LEAF), true);
});
