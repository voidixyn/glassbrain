/* The contract of the layout layer is one sentence: **the same input always gives the same coordinates.**
 *
 * Force-directed layout has no reproducible fixed point — solving the same input twice gives two noticeably different
 * arrangements (measured: re-solving the same 191 nodes moved them a median 512). If every switch re-solved, "the data didn't change
 * but the graph moved a lot" would be guaranteed. So layouts are addressed by their **layout input**, solved once and reused from then on.
 *
 * Continuity is not handled in this layer — the presentation layer handles it with rigid alignment. This layer only guarantees
 * that the same data always looks the same, **no matter how you got there**.
 *
 * And "the same input" is defined by structure alone: which nodes exist, who their parents are, which edges carry force. **Size is not part of it** —
 * size is a rendering result that changes with the skin; counting it in the identity would put "the path" into a solution that claims to be path-independent.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildElements, buildModel, computeLayout, defaultProfile, defineProfile, type GraphNode } from '../dist/internal.js';
import { inlinePool } from '../dist/layout/inline-pool.js';

const n = (id: string, extra: Partial<GraphNode> = {}): GraphNode => ({ id, label: id, ...extra });

function twoTrees() {
  const nodes: GraphNode[] = [];
  const edges = [];
  for (const root of ['A', 'B']) {
    nodes.push(n(root));
    for (let i = 0; i < 4; i++) {
      nodes.push(n(`${root}${i}`, { parent: root }));
      edges.push({ source: root, target: `${root}${i}`, kind: 'contains' });
    }
  }
  return buildModel(nodes, edges);
}

const reqOf = (ns: string) => {
  const model = twoTrees();
  return {
    elements: buildElements(model, defaultProfile).elements,
    dims: Object.fromEntries(model.nodes.map((x) => [x.id, { w: 90, h: 30 }])),
    layoutName: 'cose-bilkent' as const, pool: inlinePool, namespace: ns,
  };
};

test('solving the same input twice = the same coordinates (otherwise the graph moves although the data did not)', async () => {
  const req = reqOf('layout-test-1');
  const a = (await computeLayout(req)).positions;
  const b = (await computeLayout(req)).positions;
  assert.deepEqual(b, a, 'the second call should reuse the result as is, not solve a new one');
});

test('reordered elements are still the same input — the hash looks at content, not order', async () => {
  const req = reqOf('layout-test-2');
  const a = (await computeLayout(req)).positions;
  const shuffled = { ...req, elements: [...req.elements].reverse() };
  const b = (await computeLayout(shuffled)).positions;
  assert.deepEqual(b, a);
});

test('force = recompute: the one path that means "I really want a new one"', async () => {
  const req = reqOf('layout-test-3');
  const a = (await computeLayout(req)).positions;
  const b = (await computeLayout({ ...req, force: true })).positions;
  // Does not assert the result differs (force-directed may land close by chance), only that this path still produces full coordinates.
  for (const id of Object.keys(a)) assert.ok(b[id], `${id} should have coordinates`);
});

test('edges without force stay out of the hash — a few hundred extra render-only edges must not trigger a relayout', async () => {
  const req = reqOf('layout-test-4');
  const a = (await computeLayout(req)).positions;
  const withOverlay = {
    ...req,
    elements: [...req.elements, { data: { id: 'dep1', source: 'A0', target: 'B0', _force: false }, classes: 'dep' }],
  };
  const b = (await computeLayout(withOverlay)).positions;
  assert.deepEqual(b, a, 'render-only edges do not affect coordinates, so they must not miss the cache');
});

/* ── Two algorithms, exactly two ────────────────────────────────────────── */

test('free solve: depends only on the input, so the same data always looks the same (path-independent)', async () => {
  // Two different namespaces = two unrelated "paths", but with the same input the result must be the same.
  const a = (await computeLayout(reqOf('free-1'))).positions;
  const b = (await computeLayout(reqOf('free-2'))).positions;
  // Across namespaces this relies on the localStorage cache; node has no localStorage, so this only asserts
  // stability along one path; the cross-session half is guaranteed by how the hash is defined (see shapeHash).
  const a2 = (await computeLayout(reqOf('free-1'))).positions;
  assert.deepEqual(a2, a);
  for (const id of Object.keys(a)) assert.ok(b[id], `${id} should have coordinates`);
});

test('reference solve: the result follows the reference — a small data change must not rearrange the whole graph', async () => {
  const base = (await computeLayout(reqOf('ref-base'))).positions;
  // Push branch B far away and feed that back as the reference: the solve must keep it far away, not pull it back.
  const FAR = 8000;
  const seed = Object.fromEntries(Object.entries(base).map(([id, p]) => (
    id.startsWith('B') ? [id, { x: p.x + FAR, y: p.y + FAR }] : [id, p]
  )));
  const seeded = (await computeLayout({ ...reqOf('ref-seeded'), seed, force: true })).positions;
  const cen = (pos: Record<string, { x: number; y: number }>, pre: string) => {
    const ps = Object.entries(pos).filter(([id]) => id.startsWith(pre)).map(([, p]) => p);
    const xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
    return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  };
  const got = cen(seeded, 'B');
  const want = { x: cen(base, 'B').x + FAR, y: cen(base, 'B').y + FAR };
  const d = Math.hypot(got.x - want.x, got.y - want.y);
  assert.ok(d < FAR / 4, `should stay near the reference position, but was off by ${Math.round(d)}`);
});

test('size is not identity — a step that only changed the skin moves no coordinate', async () => {
  // The case that was measured: one step only filled in placeholder content (`unfilled` went away); not a word of structure or label
  // changed, but 79 nodes changed skin → measured sizes changed → the hash changed → the cache returned **another free solve**
  // under another key → the whole graph moved (median 1246, while the readout said "layout 0ms": it had not re-solved at all).
  const req = reqOf('layout-test-skin');
  const a = (await computeLayout(req)).positions;
  const dims: typeof req.dims = {};
  for (const [id, d] of Object.entries(req.dims)) dims[id] = { w: d.w + 7, h: d.h + 3 };
  const b = (await computeLayout({ ...req, dims })).positions;
  assert.deepEqual(b, a, 'unchanged structure is the same input, even when sizes change');
});

test('relayout only when the structure really changed — size gives way, structure does not', async () => {
  const req = reqOf('layout-test-shape');
  const a = (await computeLayout(req)).positions;
  const more = {
    ...req,
    elements: [...req.elements, { data: { id: 'Z', label: 'Z', parent: undefined, _struct: true }, classes: 'gb-node' }],
    dims: { ...req.dims, Z: { w: 90, h: 30 } },
  };
  const b = (await computeLayout(more)).positions;
  assert.ok(b.Z, 'one more node is a different input and should get a new solve');
});

test('a graph without containment but with declared force edges: edges pull the points into shape instead of a grid', async () => {
  // Two clusters of 8 points each, fully connected inside, no edges between them. All loose nodes — they used to be tiled into a grid,
  // and declared force edges had no effect. (Without the declaration edges carry no force by default; with no structure to lay out, that is the honest result.)
  const nodes: GraphNode[] = [];
  const edges = [];
  for (const g of ['a', 'b']) {
    for (let i = 0; i < 8; i++) nodes.push(n(`${g}${i}`));
    for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) edges.push({ source: `${g}${i}`, target: `${g}${j}` });
  }
  const pulls = defineProfile({ id: 'pulls', layoutEdge: () => true });
  const { elements } = buildElements(buildModel(nodes, edges), pulls);
  const dims = Object.fromEntries(nodes.map((x) => [x.id, { w: 20, h: 20 }]));
  const { positions: p } = await computeLayout({ elements, dims, layoutName: 'cose-bilkent', pool: inlinePool, namespace: 'flat' });
  const d = (u: string, v: string) => Math.hypot(p[u].x - p[v].x, p[u].y - p[v].y);
  let inside = 0, across = 0, ni = 0, na = 0;
  for (const u of nodes) for (const v of nodes) {
    if (u.id >= v.id) continue;
    if (u.id[0] === v.id[0]) { inside += d(u.id, v.id); ni++; } else { across += d(u.id, v.id); na++; }
  }
  assert.ok(inside / ni < (across / na) * 0.6, `mean within a cluster ${Math.round(inside / ni)}, across clusters ${Math.round(across / na)}`);
});

test('semantic edges carry no force by default: containment is the structure', () => {
  const m = buildModel([n('a'), n('b', { parent: 'a' }), n('c', { parent: 'a' })], [{ source: 'b', target: 'c', kind: 'uses' }]);
  const els = buildElements(m, defaultProfile).elements;
  const uses = els.find((e) => e.data.kind === 'uses')!;
  const contains = els.filter((e) => e.data.kind === 'contains');
  assert.equal(uses.data._force, false);
  assert.ok(contains.length === 2 && contains.every((e) => e.data._force !== false));
});
