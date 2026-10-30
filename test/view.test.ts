/* Views: unstacked shows one layer, stacked shows any chosen layers; search only marks hits, ranked by how close they match; standing a layer up or laying it flat is one affine map along t. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildElements, buildModel, defineProfile, originView, planeView, projectPlanes, queryMarker, resolveView, searchNodes } from '../dist/internal.js';

const LAYERS = [
  { id: 'req', label: 'Requirements', structural: true },
  { id: 'rule', label: 'Rules', structural: false },
];

test('planeView: stacked with all selected by default; unstacked shows one layer (by default the first structural one); stacked picks any layers, all selected = null', () => {
  const home = planeView({}, LAYERS);
  assert.equal(home.planes, true);
  assert.ok(home.layers == null);
  assert.deepEqual(planeView({ planes: false }, LAYERS).layers, ['req']);
  assert.deepEqual(planeView({ planes: false, layers: ['rule'] }, LAYERS).layers, ['rule']);
  assert.ok(planeView({ planes: true }, LAYERS).layers == null);
  assert.deepEqual(planeView({ planes: true, layers: ['rule'] }, LAYERS).layers, ['rule']);
  // All selected, out of order, with an unknown layer: normalized to declaration order; all selected is null.
  assert.equal(planeView({ planes: true, layers: ['rule', 'req'] }, LAYERS).layers, null);
  assert.deepEqual(planeView({ planes: true, layers: ['nope', 'rule'] }, LAYERS).layers, ['rule']);
  // Multi-select does not apply when unstacked: keep the first layer; if none is known, fall back to the default.
  assert.deepEqual(planeView({ planes: false, layers: ['rule', 'req'] }, LAYERS).layers, ['req']);
  assert.deepEqual(planeView({ planes: false, layers: ['nope'] }, LAYERS).layers, ['req']);
  // Already normalized input comes back as is (same reference, so downstream does no extra work).
  const v = { planes: true, layers: ['rule'] };
  assert.equal(planeView(v, LAYERS), v);
});

test('planeView: a single-layer graph has no layers to choose, planes is ignored', () => {
  const v = planeView({ planes: true, layers: ['req'] }, [LAYERS[0]]);
  assert.equal(v.planes, false);
  assert.equal(v.layers, null);
});

test('searchNodes: exact → prefix → contains → id → content, shorter first within a tier', () => {
  const m = buildModel([
    { id: 'n1', label: 'Delete board' },
    { id: 'n2', label: 'Board' },
    { id: 'n3', label: 'Board view' },
    { id: 'kanban', label: 'other' },
    { id: 'n5', label: 'x', data: { note: 'about the board' } },
  ], []);
  assert.deepEqual(searchNodes(m, 'board'), ['n2', 'n3', 'n1', 'n5']);
  assert.deepEqual(searchNodes(m, 'KANBAN'), ['kanban']);
  assert.deepEqual(searchNodes(m, '  '), []);
});

test('searchNodes: several words — if some match all, only those; otherwise fall back to the most matched', () => {
  const m = buildModel([
    { id: 'a', label: 'User login' },
    { id: 'b', label: 'Login for user' },
    { id: 'c', label: 'User profile' },
    { id: 'd', label: 'Audit', data: { note: 'user login audit' } },
    { id: 'e', label: 'New order' },
    { id: 'f', label: 'Add stock' },
  ], []);
  // Whole-phrase hits rank before word hits; matching all words only in content ranks after matching all in the name.
  assert.deepEqual(searchNodes(m, 'user login'), ['a', 'd', 'b']);
  // Nobody matches both: it naturally becomes "or".
  assert.deepEqual(searchNodes(m, 'new add'), ['e', 'f']);
  assert.deepEqual(searchNodes(m, 'user  profile'), ['c']);
});

test('searchNodes: /…/ is a regex; a broken one is treated as text', () => {
  const m = buildModel([
    { id: 'n1', label: 'DOC-BASIC-05' },
    { id: 'n2', label: 'DOC-BASIC-5x' },
    { id: 'n3', label: 'see /(x/' },
  ], []);
  assert.deepEqual(searchNodes(m, '/basic-\\d+$/'), ['n1']);
  assert.deepEqual(searchNodes(m, '/(x/'), ['n3']);
  const mk = queryMarker('user login');
  assert.deepEqual('Login for user'.match(mk), ['Login', 'user']);
});

test('resolveView: search does not change visibility, it only reports hits', () => {
  const m = buildModel([{ id: 'a', label: 'Login' }, { id: 'b', label: 'Register', parent: 'a' }], []);
  const els = buildElements(m, defineProfile({ id: 'v' })).elements;
  const all = resolveView(m, els, {});
  const q = resolveView(m, els, { query: 'register' });
  assert.deepEqual([...q.visible].sort(), [...all.visible].sort());
  assert.deepEqual([...q.hits], ['b']);
});

test('projectPlanes: t=0 is unchanged, t=1 is full 2.5D, in between is a linear interpolation of the two', () => {
  const pos = { a: { x: 10, y: 20 }, r: { x: 30, y: 40 } };
  const layerOf = new Map([['a', 'req'], ['r', 'rule']]);
  const flat = projectPlanes(pos, layerOf, LAYERS, {}, 0).positions;
  const full = projectPlanes(pos, layerOf, LAYERS, {}, 1).positions;
  const half = projectPlanes(pos, layerOf, LAYERS, {}, 0.5).positions;
  assert.deepEqual(flat, pos);
  for (const id of ['a', 'r']) {
    assert.ok(Math.abs(half[id].x - (flat[id].x + full[id].x) / 2) < 1e-9);
    assert.ok(Math.abs(half[id].y - (flat[id].y + full[id].y) / 2) < 1e-9);
  }
  assert.ok(full.r.y < full.a.y, 'the upper layer is on top');
});

test('projectPlanes: layers laid out side by side are each centered on the shared plate when raised', () => {
  const pos = { a1: { x: 0, y: 0 }, a2: { x: 200, y: 100 }, r1: { x: 1000, y: 0 }, r2: { x: 1200, y: 100 } };
  const layerOf = new Map([['a1', 'req'], ['a2', 'req'], ['r1', 'rule'], ['r2', 'rule']]);
  const { positions: p, plates } = projectPlanes(pos, layerOf, LAYERS, { shear: 0 }, 1);
  assert.ok(Math.abs(p.a1.x - p.r1.x) < 1e-9 && Math.abs(p.a2.x - p.r2.x) < 1e-9, 'one above the other, not apart');
  const span = (q) => Math.max(...q.points.map((c) => c[0])) - Math.min(...q.points.map((c) => c[0]));
  assert.ok(span(plates[0]) < 600, 'the plate fits one layer, not both side by side');
});

test('originView: a view pointing at sources this data does not have is treated as not given — switching data never filters to a blank screen', () => {
  const v = { origins: ['a.json'] };
  assert.equal(originView(v, ['a.json', 'b.json']), v, 'all present: unchanged (same reference)');
  assert.deepEqual(originView({ origins: ['a.json', 'x.json'] }, ['a.json']).origins, ['a.json']);
  assert.equal(originView({ origins: ['x.json'] }, ['a.json']).origins, null, 'none present: no filtering');
  const m = buildModel([{ id: 'a', label: 'a', origin: 'a.json' }, { id: 'b', label: 'b', origin: 'b.json' }], []);
  const els = buildElements(m, defineProfile({ id: 'o' })).elements;
  const stale = resolveView(m, els, originView({ origins: ['gone.json'] }, ['a.json', 'b.json']));
  assert.deepEqual([...stale.visible].sort(), ['a', 'b']);
});

test('frame in projectPlanes: plates only surround the visible nodes, only for layers that have them, and no coordinate moves', () => {
  const pos = { a: { x: 0, y: 0 }, b: { x: 1000, y: 800 }, r: { x: 500, y: 400 } };
  const layerOf = new Map([['a', 'req'], ['b', 'req'], ['r', 'rule']]);
  const whole = projectPlanes(pos, layerOf, LAYERS, {}, 1);
  const part = projectPlanes(pos, layerOf, LAYERS, {}, 1, new Set(['a']));
  assert.deepEqual(part.positions, whole.positions);
  assert.deepEqual(part.plates.map((p) => p.layer), ['req'], 'the rules layer is filtered empty, so no empty plate is drawn');
  const span = (p) => Math.max(...p.points.map((q) => q[0])) - Math.min(...p.points.map((q) => q[0]));
  assert.ok(span(part.plates[0]) < span(whole.plates[0]), 'the plate shrinks to the visible part');
});
