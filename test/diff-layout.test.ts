/* diff coordinates have only one rule:
 *
 *   > Things only in the old version use **the old version's own solve**, translated as a block to line up with surviving anchors.
 *
 * Everything this layer should pin follows from it: no surviving node moves; a ghost blob follows its anchors as a block
 * with its shape unchanged; a block with no anchor at all parks beside, shape still unchanged; with no ghosts the function is the identity.
 *
 * There is also one **cross-module** invariant, and it is the real source of "press compare and the graph does not move":
 * the **new side** `unionSides` restores has **a layout input byte-identical to the host's own new model**.
 * Identical means the same `shapeHash`, so it hits the same cache and the same coordinates. Without a test this would
 * only be a slogan: it relies on unionSides not changing a character of structure, which is easy to break casually later.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildElements, buildModel, defaultProfile, DIFF_FLAG, diffModels, diffPositions, KEPT_FLAG,
  relaxOverlaps, solveDiffLayout, unionSides,
  type CyElement, type GraphNode, type Positions,
} from '../dist/internal.js';

const n = (id: string, extra: Partial<GraphNode> = {}): GraphNode => ({ id, label: id, ...extra });
const e = (source: string, target: string) => ({ source, target });

/** The three things `shapeHash` reads: which nodes exist, who each one's parent is, which edges carry force. Restated in the test,
 *  because what is compared is exactly "is the layout input the same", not "is the model the same". */
const sig = (els: CyElement[]) => els
  .map((el) => (el.data.source
    ? (el.data._force === false ? '' : `E ${el.data.source}>${el.data.target}`)
    : `N ${el.data.id}|${el.data.parent ?? ''}|${el.data._struct === false ? 'a' : 's'}`))
  .filter(Boolean).sort().join('\n');

const elsOf = (m: { nodes: GraphNode[]; edges: any[]; errors: any[]; index: Map<string, GraphNode> }) =>
  buildElements(m, defaultProfile).elements;

test('new side = the host\'s new version: layout input byte-identical, so not one coordinate moves', () => {
  const before = buildModel(
    [n('root'), n('a', { parent: 'root' }), n('b', { parent: 'root' }), n('gone', { parent: 'root' })],
    [e('a', 'b'), e('a', 'gone')],
  );
  const after = buildModel(
    [n('root'), n('a', { parent: 'root' }), n('b', { parent: 'root' }), n('fresh', { parent: 'root' })],
    [e('a', 'b'), e('b', 'fresh')],
  );
  const sides = unionSides(diffModels(before, after));
  assert.equal(sig(elsOf(sides.after)), sig(elsOf(after)));
  // Same for the old side (a cache can only hit within one namespace, but the structure should match regardless).
  assert.equal(sig(elsOf(sides.before)), sig(elsOf(before)));
});

test('branch move: each side hangs under its own parent, and prevParent always points to "the other version"', () => {
  const before = buildModel([n('root'), n('x'), n('y'), n('m', { parent: 'x' })], []);
  const after = buildModel([n('root'), n('x'), n('y'), n('m', { parent: 'y' })], []);
  const sides = unionSides(diffModels(before, after));
  assert.equal(sides.before.index.get('m')!.parent, 'x');
  assert.equal(sides.after.index.get('m')!.parent, 'y');
  // The old side's prevParent = the **new** version's parent: that is how the left column marks "the containment edge about to go".
  assert.equal(sides.before.index.get('m')!.prevParent, 'y');
  // The new side does not carry it: only the union does (for transitions); in a single-version layout it would conjure an extra edge.
  assert.equal(sides.after.index.get('m')!.prevParent, undefined);
});

test('containment edges are marked only on a branch move: they are the only ones who can tell it', () => {
  const before = buildModel([n('x'), n('y'), n('m', { parent: 'x' }), n('gone', { parent: 'x' })], []);
  const after = buildModel([n('x'), n('y'), n('m', { parent: 'y' }), n('fresh', { parent: 'y' })], []);
  const d = diffModels(before, after);
  const sides = unionSides(d);
  const contains = (m: typeof sides.before, past: boolean) =>
    Object.fromEntries(buildElements(m, defaultProfile, { past }).elements
      .filter((el) => el.data.kind === 'contains')
      .map((el) => [`${el.data.source}->${el.data.target}`, el.classes ?? '']));

  /* The right column draws **the union** (`delta.model`), not `sides.after`: the latter is for layout and
   * deliberately strips `prevParent` (kept, it would conjure an extra edge and the layout input would no longer match browsing this version). */
  const now = contains(d.model, false);
  const past = contains(sides.before, true);
  // Branch move: on the right the new one "came", on the left the old one "went". Each column says its own half.
  assert.match(now['y->m'], /gb-added/);
  assert.match(past['x->m'], /gb-removed/);
  // The left column must **not** have an edge pointing to the new parent.
  assert.equal(past['y->m'], undefined);
  // Added / removed nodes: their containment edges carry no mark at all; the node's own glow already says it all,
  // and the edge saying it again would only drown it (edges are long and large).
  assert.equal(now['y->fresh'], 'contains');
  assert.equal(past['x->gone'], 'contains');
});

test('the left column\'s "containment edge about to go" still carries force: it is the old version\'s structure', () => {
  const before = buildModel([n('x'), n('y'), n('m', { parent: 'x' })], []);
  const after = buildModel([n('x'), n('y'), n('m', { parent: 'y' })], []);
  const sides = unionSides(diffModels(before, after));
  const els = buildElements(sides.before, defaultProfile, { past: true }).elements;
  const own = els.find((el) => el.data.source === 'x' && el.data.target === 'm')!;
  assert.equal(own.data._force, true, 'if the old version\'s own containment edges carried no force, the left layout would fall apart');
});

test('the old side carries **the old content**: the left column depends entirely on this', () => {
  const before = buildModel([n('root'), n('x', { parent: 'root', label: 'old name', data: { v: 1 } })], []);
  const after = buildModel([n('root'), n('x', { parent: 'root', label: 'new name', data: { v: 2 } })], []);
  const d = diffModels(before, after);
  const sides = unionSides(d);
  // In the union, nodes in both versions always **take the new version**, so drawing the left column from the union would draw the new version.
  assert.equal(d.model.index.get('x')!.label, 'new name');
  assert.equal(sides.before.index.get('x')!.label, 'old name');
  assert.deepEqual(sides.before.index.get('x')!.data, { v: 1 });
  assert.equal(sides.after.index.get('x')!.label, 'new name');
  // Marks are copied from the union, or the left column would not know what changed.
  assert.ok(sides.before.index.get('x')!.flags?.includes(DIFF_FLAG.changed));
});

test('the old side\'s ids move into the union\'s namespace: otherwise the columns do not match and coordinates cannot reattach', () => {
  const before = buildModel([n('a~x', { label: 'old' })], []);
  const after = buildModel([n('x', { label: 'new' })], []);
  const d = diffModels(before, after, { key: (node) => node.id.replace(/^[^~]+~/, '') });
  const sides = unionSides(d);
  assert.ok(sides.before.index.has('x'), 'the old side should use the union\'s ids');
  assert.equal(sides.before.index.get('x')!.label, 'old');
  assert.equal(sides.after.index.get('x')!.label, 'new');
});

test('old side edge marks are recomputed in place: still in the new version is unchanged, absent is gone after', () => {
  const before = buildModel([n('a'), n('b'), n('c')], [e('a', 'b'), e('b', 'c')]);
  const after = buildModel([n('a'), n('b'), n('c')], [e('a', 'b')]);
  const sides = unionSides(diffModels(before, after));
  const flagsOf = (src: string, tgt: string) =>
    sides.before.edges.find((x) => x.source === src && x.target === tgt)!.flags ?? [];
  assert.ok(flagsOf('a', 'b').includes(KEPT_FLAG));
  assert.ok(flagsOf('b', 'c').includes(DIFF_FLAG.removed));
});

test('no surviving node moves: in the result they are posAfter itself', () => {
  const before = buildModel([n('a'), n('b'), n('gone')], [e('a', 'b'), e('b', 'gone')]);
  const after = buildModel([n('a'), n('b')], [e('a', 'b')]);
  const sides = unionSides(diffModels(before, after));
  const pb: Positions = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, gone: { x: 20, y: 0 } };
  const pa: Positions = { a: { x: 500, y: 300 }, b: { x: 510, y: 300 } };
  const out = diffPositions(sides, pb, pa);
  assert.deepEqual(out.a, pa.a);
  assert.deepEqual(out.b, pa.b);
});

test('a ghost blob follows its anchors as a block, its inner shape intact', () => {
  //  a—b—g1—g2 : a and b are alive and moved as a whole by (+500,+300), g1/g2 died
  const before = buildModel([n('a'), n('b'), n('g1'), n('g2')], [e('a', 'b'), e('b', 'g1'), e('g1', 'g2')]);
  const after = buildModel([n('a'), n('b')], [e('a', 'b')]);
  const sides = unionSides(diffModels(before, after));
  const pb: Positions = { a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, g1: { x: 20, y: 5 }, g2: { x: 30, y: 5 } };
  const pa: Positions = { a: { x: 500, y: 300 }, b: { x: 510, y: 300 } };
  const out = diffPositions(sides, pb, pa);
  assert.deepEqual(out.g1, { x: 520, y: 305 });
  assert.deepEqual(out.g2, { x: 530, y: 305 });
  // Shape unchanged: the relative position of the two ghosts is exactly as in the old version.
  assert.equal(out.g2!.x - out.g1!.x, pb.g2.x - pb.g1.x);
});

test('a box counts as an anchor too: a container\'s position is its descendant leaves\' centroid', () => {
  // The ghost hangs only on a box, and the box has no coordinates of its own (Positions only records leaves).
  const before = buildModel([n('box'), n('k1', { parent: 'box' }), n('k2', { parent: 'box' }), n('g', { parent: 'box' })], []);
  const after = buildModel([n('box'), n('k1', { parent: 'box' }), n('k2', { parent: 'box' })], []);
  const sides = unionSides(diffModels(before, after));
  const pb: Positions = { k1: { x: 0, y: 0 }, k2: { x: 10, y: 0 }, g: { x: 5, y: 20 } };
  const pa: Positions = { k1: { x: 100, y: 50 }, k2: { x: 110, y: 50 } };
  // Box centroid: old (5,6.67), new (105,50); but the ghost is in the old box too, so the old centroid includes it.
  const out = diffPositions(sides, pb, pa);
  // Without recognizing the anchor it would be flung into the parking area (x far beyond 110); recognized, it only moves a little.
  assert.ok(out.g!.x > 90 && out.g!.x < 130, `anchor not recognized: ${JSON.stringify(out.g)}`);
});

test('a block with no anchor at all: overlaid on the new graph as is, not moved aside', () => {
  // The two versions share nothing: the "old vs new almost entirely replaced" case.
  const before = buildModel([n('A1'), n('A2')], [e('A1', 'A2')]);
  const after = buildModel([n('C1'), n('C2')], [e('C1', 'C2')]);
  const sides = unionSides(diffModels(before, after));
  const pb: Positions = { A1: { x: 0, y: 0 }, A2: { x: 100, y: 40 } };
  const pa: Positions = { C1: { x: 1000, y: 500 }, C2: { x: 1100, y: 500 } };
  const out = diffPositions(sides, pb, pa);
  /* The two versions never share a frame (left draws old, right draws new), so there is no need to move aside; moving aside only stretches the union
   * to twice the width, and since both columns share one viewport each column ends up half empty. */
  const mid = (ids: string[]) => ids.reduce((sum, i) => sum + out[i]!.x, 0) / ids.length;
  assert.ok(Math.abs(mid(['A1', 'A2']) - 1050) < 60, `not overlaid: ${JSON.stringify(out.A1)}`);
  // The shape does not move a point: the whole block shares one translation.
  assert.equal(out.A2!.x - out.A1!.x, 100);
  assert.equal(out.A2!.y - out.A1!.y, 40);
  // The new side stays as is.
  assert.deepEqual(out.C1, pa.C1);
});

test('no ghosts = the identity function, not one coordinate touched', () => {
  const before = buildModel([n('a'), n('b')], [e('a', 'b')]);
  const after = buildModel([n('a'), n('b'), n('c')], [e('a', 'b'), e('b', 'c')]);
  const sides = unionSides(diffModels(before, after));
  const pa: Positions = { a: { x: 1, y: 2 }, b: { x: 3, y: 4 }, c: { x: 5, y: 6 } };
  assert.deepEqual(diffPositions(sides, { a: { x: 9, y: 9 }, b: { x: 8, y: 8 } }, pa), pa);
});

test('reproducible: the same input twice parks the same way', () => {
  const before = buildModel([n('A'), n('B'), n('C'), n('D')], []);
  const after = buildModel([n('Z')], []);
  const sides = unionSides(diffModels(before, after));
  const pb: Positions = { A: { x: 0, y: 0 }, B: { x: 5, y: 0 }, C: { x: 0, y: 5 }, D: { x: 5, y: 5 } };
  const pa: Positions = { Z: { x: 0, y: 0 } };
  assert.deepEqual(diffPositions(sides, pb, pa), diffPositions(sides, pb, pa));
});

/* ── Fusion solve ──────────────────────────────────────────────────────────────
 * Three invariants independent of the solver itself, so a fake `solve` is injected here:
 *   ① the two columns' **shared coordinates are always byte-identical**: without sharing two columns would be meaningless
 *   ② with snap on, shared coordinates do not move a step (= press compare and no surviving node moves)
 *   ③ the iteration budget halves every step, and at 0 there is no next step
 */

/** Record what each step receives and what it returns per script. */
function recorder(script: (side: 'before' | 'after', seed: Positions) => Positions) {
  const calls: { side: string; iterations: number; seed: Positions }[] = [];
  const solve = async (side: 'before' | 'after', seed: Positions, iterations: number) => {
    calls.push({ side, iterations, seed: { ...seed } });
    return script(side, seed);
  };
  return { calls, solve };
}

const fixture = () => {
  const before = buildModel([n('a'), n('b'), n('gone')], [e('a', 'b'), e('b', 'gone')]);
  const after = buildModel([n('a'), n('b'), n('fresh')], [e('a', 'b'), e('b', 'fresh')]);
  return {
    sides: unionSides(diffModels(before, after)),
    base: {
      before: { a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, gone: { x: 20, y: 0 } } as Positions,
      after: { a: { x: 100, y: 0 }, b: { x: 110, y: 0 }, fresh: { x: 120, y: 0 } } as Positions,
    },
  };
};

test('fusion solve: iterations halve every step and end at 0', async () => {
  const { sides, base } = fixture();
  const r = recorder((_s, seed) => seed);
  const out = await solveDiffLayout(sides, base, r.solve, { rounds: 99, iterations: 10 });
  assert.deepEqual(out.steps.map((s) => s.iterations), [10, 5, 2, 1]);
  assert.deepEqual(out.steps.map((s) => s.side), ['before', 'after', 'before', 'after']);
});

test('fusion solve: rounds can stop it first too', async () => {
  const { sides, base } = fixture();
  const r = recorder((_s, seed) => seed);
  const out = await solveDiffLayout(sides, base, r.solve, { rounds: 1, iterations: 10 });
  assert.deepEqual(out.steps, [{ side: 'before', iterations: 10 }]);
});

test('snap on: shared coordinates do not move a step; press compare and no surviving node moves', async () => {
  const { sides, base } = fixture();
  // This fake solver moves everything by 100; snap should push the shared part back exactly.
  const r = recorder((_s, seed) => Object.fromEntries(
    Object.entries(seed).map(([k, p]) => [k, { x: p.x + 100, y: p.y + 100 }]),
  ));
  const out = await solveDiffLayout(sides, base, r.solve, { rounds: 4, iterations: 10, snap: true });
  assert.deepEqual(out.now.a, base.after.a);
  assert.deepEqual(out.now.b, base.after.b);
  assert.deepEqual(out.past.a, base.after.a);
  // The unique parts are still moved by the solver (snap only pins the shared ones).
  assert.notDeepEqual(out.past.gone, base.before.gone);
});

test('snap off: shared coordinates follow every step', async () => {
  const { sides, base } = fixture();
  const r = recorder((_s, seed) => Object.fromEntries(
    Object.entries(seed).map(([k, p]) => [k, { x: p.x + 100, y: p.y }]),
  ));
  const out = await solveDiffLayout(sides, base, r.solve, { rounds: 1, iterations: 10, snap: false });
  assert.deepEqual(out.now.a, { x: 200, y: 0 });   // 100 → 200, the A step took it along
  assert.deepEqual(out.past.a, out.now.a);         // but both columns still agree
});

test('the two columns\' shared coordinates are always byte-identical: the only value of two columns', async () => {
  const { sides, base } = fixture();
  let k = 0;
  const r = recorder((_s, seed) => Object.fromEntries(
    // A different perturbation every step, to force out any chance of "the columns disagree"
    Object.entries(seed).map(([id, p]) => [id, { x: p.x + (++k), y: p.y - k }]),
  ));
  for (const snap of [true, false]) {
    const out = await solveDiffLayout(sides, base, r.solve, { rounds: 5, iterations: 16, snap });
    for (const id of ['a', 'b']) assert.deepEqual(out.past[id], out.now[id], `${id} · snap=${snap}`);
  }
});

test('each side\'s unique parts are independent: they are never in the same problem', async () => {
  const { sides, base } = fixture();
  const r = recorder((side, seed) => (side === 'before'
    ? { ...seed, gone: { x: -999, y: -999 } }
    : { ...seed, fresh: { x: 888, y: 888 } }));
  const out = await solveDiffLayout(sides, base, r.solve, { rounds: 2, iterations: 10 });
  // The old step\'s seed has **no** fresh, the new step\'s seed has **no** gone.
  assert.equal('fresh' in r.calls[0].seed, false);
  assert.equal('gone' in r.calls[1].seed, false);
  assert.deepEqual(out.past.gone, { x: -999, y: -999 });
  assert.deepEqual(out.now.fresh, { x: 888, y: 888 });
  // And neither sees the other's result.
  assert.equal('fresh' in out.past, false);
  assert.equal('gone' in out.now, false);
});

test('rounds=0 is the plain translation solve, not one extra step', async () => {
  const { sides, base } = fixture();
  const r = recorder((_s, seed) => seed);
  const out = await solveDiffLayout(sides, base, r.solve, { rounds: 0, iterations: 10 });
  assert.equal(r.calls.length, 0);
  assert.deepEqual({ ...out.past, ...out.now }, diffPositions(sides, base.before, base.after));
});

/* ── Local relaxation ────────────────────────────────────────────────────────────
 * This step replaced "another force run". The reasons are at the top of layout/relax.ts (measured: neither engine
 * has "go only a short way", and cose-bilkent throws asynchronously inside its own tick, hanging the canvas).
 * Pinned here are the three properties it **should** have: pinned ones stay, overlap decreases, iterations are a real knob.
 */

const box = (id: string, x: number, y: number, fixed = false) => ({ id, w: 100, h: 40, fixed });

/** How many pairs of boxes still press on each other. */
function overlaps(pos: Positions, nodes: { id: string; w: number; h: number }[]): number {
  let n = 0;
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = pos[nodes[i].id], b = pos[nodes[j].id];
    if (Math.abs(a.x - b.x) < (nodes[i].w + nodes[j].w) / 2 && Math.abs(a.y - b.y) < (nodes[i].h + nodes[j].h) / 2) n++;
  }
  return n;
}

test('relaxation: pinned ones do not move at all; that is what "shared skeleton" means', () => {
  const nodes = [box('fix1', 0, 0, true), box('fix2', 20, 0, true), box('free', 10, 0)];
  const pos: Positions = { fix1: { x: 0, y: 0 }, fix2: { x: 20, y: 0 }, free: { x: 10, y: 0 } };
  const out = relaxOverlaps(pos, nodes, 24);
  assert.deepEqual(out.fix1, { x: 0, y: 0 });
  assert.deepEqual(out.fix2, { x: 20, y: 0 });
  assert.notDeepEqual(out.free, { x: 10, y: 0 });   // the movable one was pushed away
});

test('relaxation: overlap decreases', () => {
  // Five boxes all piled near the origin.
  const nodes = [box('a', 0, 0), box('b', 5, 0), box('c', 0, 5), box('d', 5, 5), box('e', 2, 2)];
  const pos: Positions = Object.fromEntries(nodes.map((n, i) => [n.id, { x: i * 5, y: i * 2 }]));
  const before = overlaps(pos, nodes);
  const after = overlaps(relaxOverlaps(pos, nodes, 40), nodes);
  assert.ok(before > 0, 'the constructed sample should overlap to begin with');
  assert.ok(after < before, `overlap did not decrease: ${before} → ${after}`);
});

test('relaxation: iterations are a real knob; more steps less overlap, 0 steps returns as is', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const nodes = ids.map((id) => box(id, 0, 0));
  const pos: Positions = Object.fromEntries(ids.map((id, i) => [id, { x: i * 6, y: i * 3 }]));
  assert.deepEqual(relaxOverlaps(pos, nodes, 0), pos);
  // Monotonically non-increasing, and it really pushes clean (this batch reaches zero by 24 steps).
  const seq = [1, 3, 6, 12, 24].map((it) => overlaps(relaxOverlaps(pos, nodes, it), nodes));
  for (let i = 1; i < seq.length; i++) assert.ok(seq[i] <= seq[i - 1], `level ${i} got worse: ${seq}`);
  assert.ok(seq[0] < overlaps(pos, nodes), 'one step improved nothing');
  assert.equal(seq[seq.length - 1], 0, `not pushed clean: ${seq}`);
});

test('relaxation: the argument is untouched; with a shallow copy every recompute would keep pushing from the last result', () => {
  const nodes = [box('a', 0, 0), box('b', 0, 0), box('c', 0, 0)];
  const pos: Positions = { a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, c: { x: 0, y: 0 } };
  const snapshot = JSON.parse(JSON.stringify(pos));
  relaxOverlaps(pos, nodes, 30);
  assert.deepEqual(pos, snapshot);
  // So the same input run twice in a row still gives the same output.
  assert.deepEqual(relaxOverlaps(pos, nodes, 30), relaxOverlaps(pos, nodes, 30));
});

test('relaxation: deterministic; the same input twice gives the same output', () => {
  const nodes = [box('a', 0, 0), box('b', 0, 0), box('c', 0, 0)];
  const pos: Positions = { a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, c: { x: 0, y: 0 } };
  assert.deepEqual(relaxOverlaps(pos, nodes, 20), relaxOverlaps(pos, nodes, 20));
});

test('snap decides what may not move this step: exactly what the solver receives', async () => {
  const { sides, base } = fixture();
  const seen: (readonly string[])[] = [];
  const solve = async (_side: 'before' | 'after', seed: Positions, _it: number, fixed: ReadonlySet<string>) => {
    seen.push([...fixed].sort());
    return seed;
  };
  await solveDiffLayout(sides, base, solve, { rounds: 1, iterations: 4, snap: true });
  assert.deepEqual(seen[0], ['a', 'b']);            // the two shared ones are pinned
  seen.length = 0;
  await solveDiffLayout(sides, base, solve, { rounds: 1, iterations: 4, snap: false });
  assert.deepEqual(seen[0], []);                    // none pinned
});

test('change size: normalized across nodes, only nodes in both versions have it', () => {
  const big = 'x'.repeat(400);
  const before = buildModel([
    n('tiny', { data: { t: 'aaaa' } }),
    n('huge', { data: { t: big } }),
    n('gone'),
  ], []);
  const after = buildModel([
    n('tiny', { data: { t: 'aaab' } }),
    n('huge', { data: { t: 'y' } }),
    n('fresh'),
  ], []);
  const d = diffModels(before, after);
  const amt = (id: string) => d.byId.get(id)!.amount;
  // The one changed more is 1 (the graph's maximum); the one changed less is clearly smaller.
  assert.equal(amt('huge'), 1);
  assert.ok(amt('tiny')! > 0 && amt('tiny')! < 0.2, `tiny=${amt('tiny')}`);
  // Additions / removals are about existence; there is no "how much".
  assert.equal(amt('gone'), undefined);
  assert.equal(amt('fresh'), undefined);
});

test('strength only looks at changed fields: an unchanged blob, however big, does not dilute it', () => {
  const noise = 'z'.repeat(2000);
  const mk = (t: string) => [n('a', { data: { noise, t } })];
  const small = diffModels(buildModel(mk('aa'), []), buildModel(mk('ab'), []));
  assert.equal(small.byId.get('a')!.fields?.join(), 't');
  // Only `t` is compared; not one character of the 2000-character noise enters the DP, or this change would be diluted to invisible.
  assert.equal(small.byId.get('a')!.amount, 1);
});
