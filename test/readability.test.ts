/* The contract of the readability field:
 *
 *   ① When sparse, **greedy placement approximates no culling** — every candidate asks "is this patch of screen still free?"; where there is room
 *      nobody has to compete with anybody.
 *   ② When dense or locally crowded, **greedy placement** by score culls the late ones: the score decides who picks first, and those that find no room
 *      gave way to earlier ones, not cut by one global quota number — this is the key point, because a global
 *      area quota is bound to be wrong on a graph that is "half sparse, half crowded" (the old approach in the roadmap).
 *   ③ Structural importance (share) and focus distance: whoever is closer scores higher — this decides whether
 *      "zoom out to see the trunk, zoom in to see the leaves" holds.
 *   ④ Labels do not cover dots: however high the score, a label whose box covers another dot is not shown.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idPhase, labelBox, planLabels, type LabelInput } from '../dist/internal.js';

const n = (id: string, sx: number, sy: number, share = 0, label = id): LabelInput =>
  ({ id, sx, sy, r: 4, share, label });

test('sparse: labels are far apart, nobody has to be culled', () => {
  const nodes = [n('a', 100, 100), n('b', 500, 100), n('c', 100, 400), n('d', 500, 400)];
  const plan = planLabels(nodes, { viewport: { w: 800, h: 600 } });
  for (const nd of nodes) assert.equal(plan.get(nd.id)!.opacity, 1);
});

test('local crowding: high scores take the spots, low scores with no room left are culled', () => {
  // 100 nodes squeezed into one corner of the screen — whatever the viewport size, this small patch cannot hold 100 labels.
  const nodes: LabelInput[] = [];
  for (let i = 0; i < 100; i++) nodes.push(n(`n${i}`, 50 + (i % 10) * 8, 50 + Math.floor(i / 10) * 8, i / 100));
  const plan = planLabels(nodes, { viewport: { w: 2000, h: 2000 } });
  const opacities = nodes.map((nd) => plan.get(nd.id)!.opacity);
  assert.ok(opacities.some((o) => o === 0), 'the crowded corner should have culled labels');
  assert.ok(opacities.some((o) => o === 1), 'the highest-scoring ones should take their spots');
  // The highest score (largest share, in the bottom row with no other dot under its label) must get its spot — greedy picks in score order.
  assert.equal(plan.get('n99')!.opacity, 1);
});

test('in the same graph, a sparse corner must not suffer for a crowded one', () => {
  const crowded: LabelInput[] = [];
  for (let i = 0; i < 60; i++) crowded.push(n(`c${i}`, 50 + (i % 8) * 8, 50 + Math.floor(i / 8) * 8, 0.1));
  const lonely = n('lonely', 1800, 1800, 0); // the opposite corner of the graph, alone for miles around
  const plan = planLabels([...crowded, lonely], { viewport: { w: 2000, h: 2000 } });
  assert.equal(plan.get('lonely')!.opacity, 1, 'a global quota would wrongly cull it; greedy placement does not');
});

test('with equal share, the one closer to the focus gets a spot more easily than a far one', () => {
  const focus = { x: 400, y: 300 };
  const near = n('near', 400, 300, 0.5);
  const far = n('far', 402, 300, 0.5); // only 2px from near, bound to compete for the same spot
  const plan = planLabels([near, far], { viewport: { w: 800, h: 600 }, focus });
  assert.equal(plan.get('near')!.opacity, 1);
  assert.equal(plan.get('near')!.side, 'below', 'the one closer to the focus picks first and takes the preferred spot below');
  assert.notEqual(plan.get('far')!.side, 'below', 'the late one has to move to another side');
});

test('bias: the one already holding a spot gets a hysteresis bonus, so a tiny position change does not make it give way', () => {
  // In the previous case far always loses; give it the incumbent bias (it is showing right now) and a tiny focus difference cannot flip it.
  const focus = { x: 400, y: 300 };
  const near = n('near', 400, 300, 0.5);
  const far = n('far', 402, 300, 0.5);
  const plan = planLabels([near, far], {
    viewport: { w: 800, h: 600 }, focus, bias: new Map([['far', 0.1]]),
  });
  assert.equal(plan.get('far')!.opacity, 1);
  assert.equal(plan.get('far')!.side, 'below');
  assert.notEqual(plan.get('near')!.side, 'below');
});

test('search hits / the selection always keep their spot, even when the area is already full', () => {
  const crowded: LabelInput[] = [];
  for (let i = 0; i < 40; i++) crowded.push(n(`c${i}`, 400 + i, 300, 0.9));
  const pinned: LabelInput = { id: 'hit', sx: 405, sy: 300, r: 4, share: 0, label: 'hit', pinned: true };
  const plan = planLabels([...crowded, pinned], { viewport: { w: 800, h: 600 } });
  assert.equal(plan.get('hit')!.opacity, 1);
});

test('do not cover named dots: unnamed dots may be covered, and a covered dot shows no name itself', () => {
  const top = n('top', 300, 300, 1);          // highest score, its label hangs below it
  const below = n('below', 300, 318, 0);      // sits right inside top's label box
  const plan = planLabels([top, below], { viewport: { w: 800, h: 600 } });
  assert.equal(plan.get('top')!.opacity, 1, 'when zoomed far out, "no dot may ever be covered" would mean no label fits at all');
  assert.equal(plan.get('below')!.opacity, 0, 'its dot is already under top\'s label, so its name could not be matched to it');
});

test('once an earlier one has a name, later labels avoid its dot: they move to the top, right or left', () => {
  const hub = n('hub', 300, 300, 1);
  const kid = n('kid', 300, 285, 0.5);        // hub is right below kid, so kid's label below would cover hub
  const plan = planLabels([hub, kid], { viewport: { w: 800, h: 600 } });
  assert.equal(plan.get('hub')!.opacity, 1);
  assert.equal(plan.get('kid')!.opacity, 1);
  assert.notEqual(plan.get('kid')!.side, 'below');
});

test('whichever side was used last time is tried first: labels do not jump around their dot', () => {
  const a: LabelInput = { ...n('a', 300, 300, 1), side: 'right' };
  assert.equal(planLabels([a], { viewport: { w: 800, h: 600 } }).get('a')!.side, 'right');
});

test('property: for any pile of dots, shown labels never overlap each other or cover any named dot', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const nodes: LabelInput[] = [];
  for (let i = 0; i < 300; i++) {
    nodes.push({ id: `p${i}`, sx: rnd() * 600, sy: rnd() * 400, r: 2 + rnd() * 6, share: rnd(), label: 'x'.repeat(1 + Math.floor(rnd() * 12)) });
  }
  const plan = planLabels(nodes, { viewport: { w: 600, h: 400 }, padding: 2 });
  const shown = nodes.filter((nd) => plan.get(nd.id)!.opacity === 1);
  assert.ok(shown.length > 20, `small and dense should still fit a batch (this time ${shown.length})`);
  const boxOf = (nd: LabelInput) => { const p = plan.get(nd.id)!; return labelBox(nd.sx, nd.sy, nd.r, p.fontPx, p.w, p.side); };
  for (const a of shown) {
    const A = boxOf(a);
    for (const b of shown) {
      if (a === b) continue;
      const B = boxOf(b);
      assert.ok(!(Math.abs(A.x - B.x) * 2 < A.w + B.w && Math.abs(A.y - B.y) * 2 < A.h + B.h), `labels of ${a.id} and ${b.id} overlap`);
      const dx = Math.max(Math.abs(b.sx - A.x) - A.w / 2, 0), dy = Math.max(Math.abs(b.sy - A.y) - A.h / 2, 0);
      assert.ok(dx * dx + dy * dy >= b.r * b.r, `the label of ${a.id} covers the named ${b.id}`);
    }
  }
});

test('dots side by side in a row do not block each other\'s labels: the label hangs below its dot, the neighbor\'s dot is above the box', () => {
  // a's label box reaches right below b's dot, but b's dot is at the same height as a's own dot — not covered.
  const a: LabelInput = { ...n('a', 100, 100, 1), w: 40 };
  const b = n('b', 118, 100, 0);
  for (const padding of [0, 6, 24]) {
    assert.equal(planLabels([a, b], { viewport: { w: 800, h: 600 }, padding }).get('a')!.opacity, 1);
  }
});

test('the gap knob: the wider the required gap, the fewer labels shown', () => {
  const grid: LabelInput[] = [];
  for (let i = 0; i < 20; i++) for (let j = 0; j < 20; j++) grid.push(n(`g${i}-${j}`, 20 + i * 30, 20 + j * 22, 0, 'label'));
  const count = (padding: number) =>
    [...planLabels(grid, { viewport: { w: 800, h: 600 }, padding }).values()].filter((p) => p.opacity === 1).length;
  assert.ok(count(0) > count(12), `0px ${count(0)}, 12px ${count(12)}`);
  assert.ok(count(12) > 0);
});

test('the label box geometry lives in one place: top edge = bottom of the dot + one gap; what is checked is what is drawn', () => {
  const b = labelBox(0, 0, 10, 13, 50);
  assert.equal(b.x, 0);
  assert.equal(b.w, 50);
  assert.ok(b.y - b.h / 2 > 10, 'the label box is below the dot and does not overlap it');
  assert.equal(planLabels([{ ...n('x', 0, 0), w: 50, fontPx: 13 }], { viewport: { w: 800, h: 600 } })
    .get('x')!.fontPx, 13);
});

test('idPhase: the same id always gets the same phase, within [0, 2π)', () => {
  assert.equal(idPhase('same-id'), idPhase('same-id'));
  const p = idPhase('anything');
  assert.ok(p >= 0 && p < 2 * Math.PI + 1e-9);
});
