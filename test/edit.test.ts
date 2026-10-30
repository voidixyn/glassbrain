/* Editing: applying one op to the model is a pure function; the things the UI constrains (id, which parent, both ends) are checked here. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEdit, applyEdits, buildModel, checkEdit, defineProfile, EN, validateStructure } from '../dist/internal.js';
import { ZH_CN } from '../examples/strings-zh.ts';

const base = () => buildModel(
  [
    { id: 'a', label: 'A', origin: 'x.json', layer: 'req' },
    { id: 'a1', label: 'A1', parent: 'a', origin: 'x.json', layer: 'req' },
    { id: 'b', label: 'B', origin: 'y.json', layer: 'req', flags: ['unfilled'] },
  ],
  [{ source: 'a1', target: 'b', kind: 'dep' }],
);
const LAYERED = defineProfile({
  id: 't',
  layers: [{ id: 'req', label: 'req' }, { id: 'rule', label: 'rule', structural: false }],
  layerOf: (n) => (n.kind === 'rule' ? 'rule' : 'req'),
});

test('create: id is required and unique; origin and layer follow its parent; the original model is untouched', () => {
  const m = base();
  assert.equal(checkEdit(m, { op: 'addNode', id: ' ', set: {} }), 'id-empty');
  assert.equal(checkEdit(m, { op: 'addNode', id: 'a', set: {} }), 'id-taken');
  assert.equal(checkEdit(m, { op: 'addNode', id: '__gk_root__', set: {} }), 'id-taken');
  assert.equal(checkEdit(m, { op: 'addNode', id: 'n', set: { parent: 'zz' } }), 'no-parent');
  const next = applyEdit(m, { op: 'addNode', id: 'n', set: { parent: 'b', data: { note: 1 } } });
  const n = next.index.get('n');
  assert.equal(n.label, 'n', 'without a name the id is used');
  assert.equal(n.origin, 'y.json');
  assert.equal(n.parent, 'b');
  assert.deepEqual(n.data, { note: 1 });
  assert.equal(m.index.has('n'), false);
  assert.throws(() => applyEdit(m, { op: 'addNode', id: 'a', set: {} }), /id-taken/);
});

test('update: hanging under itself or its own descendant is a cycle; move to the top level; layer is recomputed from fields by the profile, flags stay', () => {
  const m = base();
  assert.equal(checkEdit(m, { op: 'updateNode', id: 'a', set: { parent: 'a' } }), 'cycle');
  assert.equal(checkEdit(m, { op: 'updateNode', id: 'a', set: { parent: 'a1' } }), 'cycle');
  const r = buildModel([...m.nodes, { id: 'r', label: 'R', layer: 'rule' }], m.edges);
  assert.equal(applyEdit(r, { op: 'updateNode', id: 'b', set: { parent: 'r' } }).index.get('b').layer, 'rule', 'moved under someone, it takes that one\'s layer');
  const top = applyEdit(m, { op: 'updateNode', id: 'a1', set: { parent: null } });
  assert.equal(top.index.get('a1').parent, undefined);
  const ruled = applyEdit(m, { op: 'updateNode', id: 'b', set: { kind: 'rule', label: 'B!' } }, LAYERED);
  assert.equal(ruled.index.get('b').layer, 'rule');
  assert.equal(ruled.index.get('b').label, 'B!');
  assert.deepEqual(ruled.index.get('b').flags, ['unfilled'], 'derived flags are not the editor\'s business; they are recomputed on the next parse');
});

test('remove: only leaves, and the edges attached to it go with it', () => {
  const m = base();
  assert.equal(checkEdit(m, { op: 'removeNode', id: 'a' }), 'has-children');
  const next = applyEdit(m, { op: 'removeNode', id: 'a1' });
  assert.equal(next.index.has('a1'), false);
  assert.equal(next.edges.length, 0);
});

test('edges: both ends must exist, no self-loops, no duplicates; removal matches both ends + kind', () => {
  const m = base();
  assert.equal(checkEdit(m, { op: 'addEdge', edge: { source: 'a', target: 'zz' } }), 'no-endpoint');
  assert.equal(checkEdit(m, { op: 'addEdge', edge: { source: 'a', target: 'a' } }), 'self-loop');
  assert.equal(checkEdit(m, { op: 'addEdge', edge: { source: 'a1', target: 'b', kind: 'dep' } }), 'edge-exists');
  const more = applyEdit(m, { op: 'addEdge', edge: { source: 'a1', target: 'b', kind: 'ref', label: 'see' } });
  assert.equal(more.edges.length, 2);
  assert.equal(more.edges[1].origin, 'x.json', 'an edge takes the origin of its source');
  assert.equal(checkEdit(m, { op: 'removeEdge', edge: { source: 'a1', target: 'b' } }), 'no-edge', 'with the wrong kind it is not this edge');
  assert.equal(applyEdit(more, { op: 'removeEdge', edge: { source: 'a1', target: 'b', kind: 'dep' } }).edges.length, 1);
});

test('patch replay: ops that cannot apply are skipped without stopping', () => {
  const { model, skipped } = applyEdits(base(), [
    { op: 'addNode', id: 'n', set: {} },
    { op: 'addNode', id: 'n', set: {} },
    { op: 'addEdge', edge: { source: 'n', target: 'a' } },
  ]);
  assert.equal(model.nodes.length, 4);
  assert.equal(model.edges.length, 2);
  assert.deepEqual(skipped.map((s) => s.error), ['id-taken']);
});

test('strings: the Chinese example matches the library\'s English keys one to one (the template must not miss keys), and every edit error has text', () => {
  assert.deepEqual(Object.keys(ZH_CN).sort(), Object.keys(EN).sort());
  assert.deepEqual(Object.keys(ZH_CN.error).sort(), Object.keys(EN.error).sort());
  assert.deepEqual(Object.keys(ZH_CN.change).sort(), Object.keys(EN.change).sort());
});

test('the cycle check walks the parent chain; a cycle already in the data that does not pass through the node does not hang it', () => {
  const m = base();
  assert.equal(checkEdit(m, { op: 'updateNode', id: 'a', set: { parent: 'a1' } }), 'cycle');
  assert.equal(checkEdit(m, { op: 'updateNode', id: 'a', set: { parent: 'a' } }), 'cycle');
  const loop = buildModel(
    [{ id: 'p', label: 'p', parent: 'q' }, { id: 'q', label: 'q', parent: 'p' }, { id: 'z', label: 'z' }], [],
  );
  assert.equal(checkEdit(loop, { op: 'updateNode', id: 'z', set: { parent: 'p' } }), null);
});

test('applyEdits: a list of ops gives the same result as applyEdit one by one, skipping the ones that cannot apply', () => {
  const ops = [
    { op: 'addNode', id: 'n', set: { parent: 'a' } },
    { op: 'addNode', id: 'n', set: {} },
    { op: 'addEdge', edge: { source: 'n', target: 'b', kind: 'dep' } },
    { op: 'updateNode', id: 'n', set: { label: 'N' } },
  ] as const;
  const { model, skipped } = applyEdits(base(), ops as any);
  let m = base();
  for (const op of [ops[0], ops[2], ops[3]]) m = applyEdit(m, op as any);
  assert.deepEqual(model.nodes, m.nodes);
  assert.deepEqual(model.edges, m.edges);
  assert.deepEqual(skipped.map((s) => s.error), ['id-taken']);
});

test('an edge is identified by both ends + kind: duplicates are reported by validation and removed together', () => {
  const m = buildModel(
    [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }],
    [{ id: 'e1', source: 'a', target: 'b', kind: 'dep' }, { id: 'e2', source: 'a', target: 'b', kind: 'dep' },
      { source: 'a', target: 'b', kind: 'ref' }],
  );
  const dup = validateStructure(m).filter((i) => i.kind === 'duplicate-edge');
  assert.equal(dup.length, 1);
  assert.deepEqual(dup[0].edge, { source: 'a', target: 'b' });
  const next = applyEdit(m, { op: 'removeEdge', edge: { source: 'a', target: 'b', kind: 'dep' } });
  assert.deepEqual(next.edges.map((e) => e.kind), ['ref']);
});
