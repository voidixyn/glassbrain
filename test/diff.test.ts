/* diff's criteria are all pure functions, so they run directly in node, with no browser and no bundler.
 *
 * What is covered here are **the cases real datasets do not reach**: the three pairs of snapshots in the demo happen to produce only
 * additions / removals / content changes, and `moved` (another branch) and `merged` (id changed, merged into another) have not one
 * sample in that data, while those two are exactly the most important two in the design; looking only at the demo you would think they
 * work.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
// **Tests the bundled output**, not src. Two reasons: relative imports in src have no extension
// (bundler style, the way a library should be written), which node's ESM resolution does not accept; and what others actually install is
// dist, so testing that is what counts. So `npm test` needs a build first; the verify script runs them in sequence.
import {
  buildModel, changedSubset, diffModels, DIFF_FLAG, KEPT_FLAG, stepUnion, STEP_FLAG, STEP_KEPT,
  unionSides,
  type GraphNode,
} from '../dist/internal.js';

const n = (id: string, extra: Partial<GraphNode> = {}): GraphNode =>
  ({ id, label: id, ...extra });

test('unchanged is unchanged: everything marked kept, not one change reported', () => {
  const a = buildModel([n('x'), n('y', { parent: 'x' })], []);
  const b = buildModel([n('x'), n('y', { parent: 'x' })], []);
  const d = diffModels(a, b);
  assert.equal(d.changes.length, 0);
  assert.equal(d.counts.kept, 2);
  assert.ok(d.model.index.get('y')!.flags!.includes(KEPT_FLAG));
});

test('added / removed: both present in the union, each with its own mark', () => {
  const a = buildModel([n('keep'), n('gone')], []);
  const b = buildModel([n('keep'), n('fresh')], []);
  const d = diffModels(a, b);
  assert.equal(d.counts.added, 1);
  assert.equal(d.counts.removed, 1);
  // The union: the removed one is still on the graph, or "where it used to be" could not be shown.
  assert.equal(d.model.nodes.length, 3);
  assert.ok(d.model.index.get('gone')!.flags!.includes(DIFF_FLAG.removed));
  assert.ok(d.model.index.get('fresh')!.flags!.includes(DIFF_FLAG.added));
});

test('content change: reports exactly which fields changed, and only those', () => {
  const a = buildModel([n('x', { data: { a: 1, b: 2, t: 'old' } })], []);
  const b = buildModel([n('x', { data: { a: 1, b: 3, t: 'new' } })], []);
  const d = diffModels(a, b);
  assert.deepEqual(d.changes[0].fields, ['b', 't']);
  assert.equal(d.counts.changed, 1);
  // The old value is kept for the detail panel's "what it was".
  assert.deepEqual(d.prevData.get('x'), { a: 1, b: 2, t: 'old' });
});

test('ignore: fields that change every time (timestamps and such) should not count as changes', () => {
  const a = buildModel([n('x', { data: { v: 1, ts: 111 } })], []);
  const b = buildModel([n('x', { data: { v: 1, ts: 222 } })], []);
  assert.equal(diffModels(a, b).counts.changed, 1);
  assert.equal(diffModels(a, b, { ignore: ['ts'] }).counts.changed, 0);
});

test('different field order in data is not a change (comparison is order-stable)', () => {
  const a = buildModel([n('x', { data: { p: 1, q: { m: 1, n: 2 } } })], []);
  const b = buildModel([n('x', { data: { q: { n: 2, m: 1 }, p: 1 } })], []);
  assert.equal(diffModels(a, b).counts.changed, 0);
});

test('moved: a changed parent is a structural change, pairId points back to the old parent box', () => {
  const a = buildModel([n('p1'), n('p2'), n('c', { parent: 'p1' })], []);
  const b = buildModel([n('p1'), n('p2'), n('c', { parent: 'p2' })], []);
  const d = diffModels(a, b);
  assert.equal(d.counts.moved, 1);
  const c = d.byId.get('c')!;
  assert.equal(c.kind, 'moved');
  // The overlay draws "two alternating places + a trace line" from pairId. Without it only a dot blinking in place would remain.
  assert.equal(c.pairId, 'p1');
  // In the union the node uses its **new** parent box; the old one is only recorded by pairId.
  assert.equal(d.model.index.get('c')!.parent, 'p2');
});

test('moved beats changed: content changed too is still recorded as structural, but fields are still reported', () => {
  const a = buildModel([n('p1'), n('p2'), n('c', { parent: 'p1', data: { v: 1 } })], []);
  const b = buildModel([n('p1'), n('p2'), n('c', { parent: 'p2', data: { v: 9 } })], []);
  const c = diffModels(a, b).byId.get('c')!;
  assert.equal(c.kind, 'moved');
  assert.deepEqual(c.fields, ['v']);
});

test('merged: "merged into what" is recognized only with a mapping, otherwise it can only be add + remove', () => {
  const a = buildModel([n('old1'), n('old2')], []);
  const b = buildModel([n('new1')], []);

  const plain = diffModels(a, b);
  assert.equal(plain.counts.removed, 2);
  assert.equal(plain.counts.merged, 0);

  const mapped = diffModels(a, b, { mapping: { old1: 'new1', old2: 'new1' } });
  assert.equal(mapped.counts.merged, 2);
  assert.equal(mapped.counts.removed, 0);
  assert.equal(mapped.byId.get('old1')!.pairId, 'new1');
  assert.equal(mapped.byId.get('old2')!.pairId, 'new1');
});

test('a mapping to a missing new id counts as not given: a wrong upstream should not deform the graph', () => {
  const a = buildModel([n('old1')], []);
  const b = buildModel([n('new1')], []);
  const d = diffModels(a, b, { mapping: { old1: 'nope' } });
  assert.equal(d.counts.merged, 0);
  assert.equal(d.counts.removed, 1);
});

test('sources in the union are still files: version names only label columns and do not pose as sources (or filtering by source would drop every added node)', () => {
  const a = buildModel([{ ...n('both'), origin: 'x.json' }, { ...n('onlyA'), origin: 'x.json' }], []);
  const b = buildModel([{ ...n('both'), origin: 'y.json' }, { ...n('onlyB'), origin: 'y.json' }], []);
  const d = diffModels(a, b, { labels: { before: 'v1', after: 'v2' } });
  assert.deepEqual(d.model.index.get('both')!.origins, ['x.json', 'y.json']);
  assert.equal(d.model.index.get('onlyA')!.origin, 'x.json');
  assert.equal(d.model.index.get('onlyB')!.origin, 'y.json');
  assert.equal(d.model.index.get('onlyB')!.origins, undefined);
  assert.deepEqual(d.labels, { before: 'v1', after: 'v2' });
});

test('edges enter the union with marks too; same source/target/kind counts as one edge', () => {
  const a = buildModel([n('x'), n('y')], [{ source: 'x', target: 'y', kind: 'dep' }]);
  const b = buildModel([n('x'), n('y')], [{ source: 'y', target: 'x', kind: 'dep' }]);
  const d = diffModels(a, b);
  assert.equal(d.model.edges.length, 2);
  const flags = d.model.edges.map((e) => e.flags!.at(-1)).sort();
  assert.deepEqual(flags, [DIFF_FLAG.added, DIFF_FLAG.removed].sort());
});

test('changedSubset brings the parent chain along: without it compounds fall apart', () => {
  const a = buildModel([n('root'), n('mid', { parent: 'root' }), n('leaf', { parent: 'mid' })], []);
  const b = buildModel([
    n('root'), n('mid', { parent: 'root' }), n('leaf', { parent: 'mid', data: { v: 1 } }),
  ], []);
  const keep = changedSubset(diffModels(a, b));
  assert.deepEqual([...keep].sort(), ['leaf', 'mid', 'root']);
});

/* ── key matching: the batch where the two versions live in different namespaces ─────────────────────────── */

// In these cases labels are deliberately the same: normalization only normalizes ids, and with different labels it would be (correctly)
// judged a "content change", which would not test whether matching itself is right.
test('key: after normalization they match, no longer "everything added, everything removed"', () => {
  const a = buildModel([n('fc~X', { label: 'X' }), n('fc~Y', { label: 'Y' })], []);
  const b = buildModel([n('X'), n('Y')], []);
  const strip = (x: GraphNode) => x.id.replace(/^[^~]+~/, '');

  assert.equal(diffModels(a, b).counts.added, 2);              // verbatim ids: everything added, everything removed
  const d = diffModels(a, b, { key: strip });
  assert.equal(d.counts.added, 0);
  assert.equal(d.counts.removed, 0);
  assert.equal(d.counts.kept, 2);
  assert.equal(d.model.nodes.length, 2);                       // no doubles left in the union
});

test('key: two old nodes mapping to one key is not a conflict, it is a "merge"', () => {
  const a = buildModel([n('fc~X', { label: 'X' }), n('kg~X', { label: 'X' })], []);
  const b = buildModel([n('X')], []);
  const d = diffModels(a, b, { key: (x) => x.id.replace(/^[^~]+~/, '') });
  assert.equal(d.counts.kept, 1);                              // the first is the body
  assert.equal(d.counts.merged, 1);                            // the other merges in
  assert.equal(d.byId.get('kg~X')!.pairId, 'X');               // the convergence target
});

test('key: an old node absorbed by matching gets its parent pointer repointed, never left dangling', () => {
  const a = buildModel([n('fc~P', { label: 'P' }), n('fc~C', { parent: 'fc~P', label: 'C' }), n('kg~C', { parent: 'fc~P', label: 'C' })], []);
  const b = buildModel([n('P'), n('C', { parent: 'P' })], []);
  const d = diffModels(a, b, { key: (x) => x.id.replace(/^[^~]+~/, '') });
  // kg~C was not matched (C's body is already fc~C), it stays in the union, and its parent must point to P, which exists in the union
  assert.equal(d.model.index.get('kg~C')!.parent, 'P');
  for (const node of d.model.nodes) {
    if (node.parent) assert.ok(d.model.index.has(node.parent), `dangling parent pointer: ${node.id} -> ${node.parent}`);
  }
});

test('key: edge endpoints are repointed too; those coinciding with the new version afterwards are "unchanged"', () => {
  const a = buildModel([n('fc~X', { label: 'X' }), n('fc~Y', { label: 'Y' })], [{ source: 'fc~X', target: 'fc~Y', kind: 'dep' }]);
  const b = buildModel([n('X'), n('Y')], [{ source: 'X', target: 'Y', kind: 'dep' }]);
  const d = diffModels(a, b, { key: (x) => x.id.replace(/^[^~]+~/, '') });
  assert.equal(d.model.edges.length, 1);
  assert.ok(d.model.edges[0].flags!.includes(KEPT_FLAG));
});

/* ── The union of one switch (stepUnion) ─────────────────────────────────────────
 * It answers **a different question** from `diffModels`: diff asks "is this a change", it only asks
 * "was it in the previous version, is it in this one". Both can hold at once, so the marks must be two sets; these
 * pin that "the two sets do not fight".
 */

const e2 = (source: string, target: string) => ({ source, target });

test('presence only: in both = kept, only in new = added, only in old = removed', () => {
  const before = buildModel([n('a'), n('b')], [e2('a', 'b')]);
  const after = buildModel([n('a'), n('c')], [e2('a', 'c')]);
  const d = stepUnion(before, after);
  assert.deepEqual(d.counts, { added: 1, removed: 1, changed: 0, moved: 0, merged: 0, kept: 1 });
  const flags = (id: string) => d.model.index.get(id)!.flags ?? [];
  assert.ok(flags('a').includes(STEP_KEPT));
  assert.ok(flags('c').includes(STEP_FLAG.added));
  assert.ok(flags('b').includes(STEP_FLAG.removed));
  // Edges follow the sets; nobody needs a special case.
  const edge = (src: string) => d.model.edges.find((x) => x.source === src)!.flags ?? [];
  assert.ok(edge('a').includes(STEP_FLAG.added) || edge('a').includes(STEP_KEPT));
  assert.equal(d.model.edges.length, 2);
});

test('content changed but present in both: no changed reported, it only tracks presence', () => {
  const before = buildModel([n('x', { data: { v: 1 }, label: 'old' })], []);
  const after = buildModel([n('x', { data: { v: 2 }, label: 'new' })], []);
  const d = stepUnion(before, after);
  assert.equal(d.changes.length, 0);
  assert.deepEqual(d.model.index.get('x')!.flags, [STEP_KEPT]);
  // Those in both versions must go into resolved: planSkins uses it to ask "what did it look like in the previous version".
  assert.equal(d.resolved.get('x'), 'x');
});

test('changed parent: no moved reported, and **no prevParent written**', () => {
  const before = buildModel([n('p'), n('q'), n('m', { parent: 'p' })], []);
  const after = buildModel([n('p'), n('q'), n('m', { parent: 'q' })], []);
  const d = stepUnion(before, after);
  assert.equal(d.counts.moved, 0);
  /* This is a hard constraint, not laziness: once `prevParent` is written, `buildElements` synthesizes two containment edges with
   * `gb-added` / `gb-removed`, which is **diff** vocabulary, bound to be misread in a transition.
   * The parent change is told by "it walks from the old place to the new" itself. */
  assert.equal(d.model.index.get('m')!.prevParent, undefined);
  assert.equal(d.model.index.get('m')!.parent, 'q');
});

test('the two mark sets do not fight: a diff ghost is "in both versions" in a step', () => {
  // First build a real diff union (with gb-removed ghosts in it), then compare it with itself as one switch.
  const v1 = buildModel([n('keep'), n('gone')], []);
  const v2 = buildModel([n('keep'), n('fresh')], []);
  const union = diffModels(v1, v2).model;
  const ghost = union.index.get('gone')!;
  assert.ok(ghost.flags?.includes(DIFF_FLAG.removed), 'premise: it is a ghost in the diff');

  const d = stepUnion(union, union);
  const after = d.model.index.get('gone')!;
  // The diff marks stay as they are (what the user looks at), while in this switch it is "in both versions".
  assert.ok(after.flags?.includes(DIFF_FLAG.removed));
  assert.ok(after.flags?.includes(STEP_KEPT));
  assert.ok(!after.flags?.includes(STEP_FLAG.removed), 'a ghost must not be treated as leaving this time');
  assert.equal(d.changes.length, 0);
});

test('old edges with an endpoint not present are dropped: kept, they would be dangling edges flying off', () => {
  const before = buildModel([n('a'), n('b')], [e2('a', 'b')]);
  const after = buildModel([n('a')], []);
  const d = stepUnion(before, after);
  // b is still there (it is removed and plays its exit), so this edge can stay.
  assert.equal(d.model.edges.length, 1);
  assert.ok((d.model.edges[0].flags ?? []).includes(STEP_FLAG.removed));
  assert.ok(d.model.index.has('b'));
});

test('the same reference version compared against another: the left column should not move at all (verbatim ids would say all in, all out)', () => {
  /* This is the best hidden trap in the whole chain. `unionSides` **renames** old-side ids per `resolved` to the
   * new side's: the same reference matched (renamed) "against A" and matched nothing (not renamed) "against B".
   * So the same node has two names in the two runs; comparing ids verbatim, an untouched column is judged all in, all out,
   * and the whole column fades out and in. Measured on real data: 107 in + 107 out. */
  const key = (node: GraphNode) => node.id.replace(/^[^~]+~/, '');
  const ref = buildModel([n('r~1'), n('r~2')], []);
  const a1 = buildModel([n('1'), n('2')], []);      // matches the reference (after stripping the prefix)
  const b1 = buildModel([n('x'), n('y')], []);      // matches nothing in the reference
  const p1 = unionSides(diffModels(ref, a1, { key })).before;
  const p2 = unionSides(diffModels(ref, b1, { key })).before;

  // Premise: both runs' old sides are the same data, with different ids.
  assert.deepEqual(p1.nodes.map((x) => key(x)).sort(), p2.nodes.map((x) => key(x)).sort());
  assert.notDeepEqual(p1.nodes.map((x) => x.id).sort(), p2.nodes.map((x) => x.id).sort());

  assert.equal(stepUnion(p1, p2).counts.kept, 0, 'verbatim ids: all in, all out (that is the bug)');
  const fixed = stepUnion(p1, p2, key);
  assert.equal(fixed.counts.kept, 2);
  assert.equal(fixed.changes.length, 0, 'the reference did not move, so this column should not play a frame');
  /* Renames are recorded in `resolved` (**old → new**). Previous frame coordinates are recorded under old names and cannot reattach
   * without this table: exactly the whole-graph relayout of "matched, but position starts from zero". */
  assert.equal(fixed.resolved.get('1'), 'r~1');
});

test('KEPT_FLAG and STEP_KEPT are two different strings', () => {
  assert.notEqual(KEPT_FLAG, STEP_KEPT);
  assert.notEqual(DIFF_FLAG.removed, STEP_FLAG.removed);
  assert.notEqual(DIFF_FLAG.added, STEP_FLAG.added);
});

/* ── Change strength: length is not the amount of change ─────────────────────────────────────────── */

test('changing one character in a long field should not outweigh rewriting a short field entirely', () => {
  // P: a five-thousand-character field, one character changed.
  const long = 'x'.repeat(5000);
  // Q: a four-hundred-character field, replaced entirely.
  const a = buildModel([
    n('P', { data: { blob: long } }),
    n('Q', { data: { blob: 'a'.repeat(400) } }),
  ], []);
  const b = buildModel([
    n('P', { data: { blob: long.slice(0, 2500) + 'y' + long.slice(2501) } }),
    n('Q', { data: { blob: 'b'.repeat(400) } }),
  ], []);
  const d = diffModels(a, b);
  const amount = (id: string) => d.byId.get(id)!.amount!;
  /* Strength is **normalized across nodes**, so the relative size of the two is the whole point. Before trimming common heads and tails,
   * P would get the big "5000 − CAP" lump and push Q down to the lowest level: the ranking reversed entirely. */
  assert.ok(amount('P') < amount('Q'), `one character changed ${amount('P')} should not exceed a full rewrite ${amount('Q')}`);
  assert.equal(amount('Q'), 1, 'the largest change in the graph normalizes to 1');
});

test('very long but identical fields are not a change', () => {
  const long = 'z'.repeat(5000);
  const a = buildModel([n('P', { data: { same: long, tweak: 'a' } })], []);
  const b = buildModel([n('P', { data: { same: long, tweak: 'b' } })], []);
  const d = diffModels(a, b);
  // Only tweak enters the comparison (changedFields filtered first); same, with the same name and value, should not count one character.
  assert.deepEqual(d.byId.get('P')!.fields, ['tweak']);
  assert.equal(d.byId.get('P')!.amount, 1);
});
