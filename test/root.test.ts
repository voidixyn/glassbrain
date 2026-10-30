/* The virtual root ("Overview") belongs to a version, not to the canvas: a side has it only if that side has more than one top-level node;
 * a graph with no containment at all does not get one (every case below includes a1 ⊂ a so the graph has a tree);
 * in the union it carries the "only old / only new / both" mark like any node. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildElements, buildModel, defineProfile, diffModels, stepUnion, VIRTUAL_ROOT } from '../dist/internal.js';

const P = defineProfile({ id: 'root-test' });
const root = (els: any[]) => els.find((e) => e.data.id === VIRTUAL_ROOT);
const parentEdge = (els: any[], child: string) =>
  els.find((e) => e.data.kind === 'contains' && e.data.target === child)?.data.source;

test('plain model: an overview only with more than one top-level node, none with one', () => {
  const two = buildModel([{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }, { id: 'a1', label: 'a1', parent: 'a' }], []);
  const one = buildModel([{ id: 'a', label: 'a' }, { id: 'x', label: 'x', parent: 'a' }], []);
  assert.ok(root(buildElements(two, P).elements));
  assert.equal(root(buildElements(one, P).elements), undefined);
});

test('no tree, no overview: in a graph without containment (a citation network) every point is top-level, and a synthetic root would be one big star', () => {
  const flat = buildModel([{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }, { id: 'c', label: 'c' }],
    [{ source: 'a', target: 'b' }]);
  assert.equal(root(buildElements(flat, P).elements), undefined);
});

test('no tree is judged per side: switching from a graph with a tree to one without, the new side gets no overview', () => {
  const tree = buildModel([{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }, { id: 'a1', label: 'a1', parent: 'a' }], []);
  const flat = buildModel([{ id: 'p', label: 'p' }, { id: 'q', label: 'q' }], []);
  const r = root(buildElements(stepUnion(tree, flat).model, P).elements);
  assert.ok(r, 'the old side has a tree, so the overview is there, marked leaving');
  assert.match(r.classes, /gb-step-removed/);
});

test('two spines merged into one tree: the overview is only on the old side — in the union it is marked leaving, and the new tree does not hang under it', () => {
  const before = buildModel([{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }, { id: 'a1', label: 'a1', parent: 'a' }], []);
  const after = buildModel([{ id: 'c', label: 'c' }, { id: 'c1', label: 'c1', parent: 'c' }], []);
  const els = buildElements(diffModels(before, after).model, P).elements;
  const r = root(els);
  assert.ok(r, 'the old side has two top-level nodes, so the overview must be there to fade out in place');
  assert.match(r.classes, /gb-removed/);
  assert.equal(parentEdge(els, 'a'), VIRTUAL_ROOT);
  assert.equal(parentEdge(els, 'c'), undefined, 'the new version has one tree, which must not hang under a root that is leaving');
});

test('one tree swapped for another: each side has one top-level node, so no overview (the union used to make one up)', () => {
  const before = buildModel([{ id: 'a', label: 'a' }], []);
  const after = buildModel([{ id: 'c', label: 'c' }], []);
  assert.equal(root(buildElements(diffModels(before, after).model, P).elements), undefined);
});

test('one tree split into two: the overview is only on the new side, marked entering; the transition union uses the transition vocabulary', () => {
  const before = buildModel([{ id: 'a', label: 'a' }, { id: 'a1', label: 'a1', parent: 'a' }], []);
  const after = buildModel([{ id: 'a', label: 'a' }, { id: 'a1', label: 'a1', parent: 'a' }, { id: 'd', label: 'd' }], []);
  assert.match(root(buildElements(diffModels(before, after).model, P).elements).classes, /gb-added/);
  assert.match(root(buildElements(stepUnion(before, after).model, P).elements).classes, /gb-step-added/);
});

test('both sides have an overview: it is kept, with no exit animation', () => {
  const before = buildModel([{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }, { id: 'a1', label: 'a1', parent: 'a' }], []);
  const after = buildModel([{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }, { id: 'a1', label: 'a1', parent: 'a' }, { id: 'e', label: 'e' }], []);
  const cls = root(buildElements(diffModels(before, after).model, P).elements).classes;
  assert.doesNotMatch(cls, /gb-(added|removed)/);
});

test('entering and leaving have one source: when the data has no virtual root and the paint mark says it leaves, planning treats it as leaving (no motion planned, not framed)', async () => {
  const { planTransition } = await import('../dist/internal.js');
  const before = buildModel([{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }], []);
  const after = buildModel([{ id: 'a', label: 'a' }, { id: 'b', label: 'b', parent: 'a' }], []);
  const delta = diffModels(before, after);
  const P0 = (x: number, y: number) => ({ x, y });
  const union = { [VIRTUAL_ROOT]: P0(0, 500), a: P0(0, 0), b: P0(10, 0) };
  const from = { [VIRTUAL_ROOT]: P0(0, 100), a: P0(0, 0), b: P0(10, 0) };
  const without = planTransition(delta, from, union);
  assert.ok(!without.leaving.has(VIRTUAL_ROOT), 'going by delta alone, the root would count as "staying"');
  const t = planTransition(delta, from, union, { presence: new Map([[VIRTUAL_ROOT, 'gone' as const]]) });
  assert.ok(t.leaving.has(VIRTUAL_ROOT));
  assert.equal(t.report.leaving, 1);
});

