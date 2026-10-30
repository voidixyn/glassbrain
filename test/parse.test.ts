/* Reading untrusted input: whatever an agent or another tool wrote, parsing never crashes, never invents nodes, and loses no fields. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel, indexModel, parseSources, toPhysical, validateStructure } from '../dist/internal.js';
import { adapt } from '../dist/adapters.js';

const parse = (doc: unknown) => parseSources([{ origin: 'g.json', text: JSON.stringify(doc) }]);

test('entries that are not objects or have no id are skipped, not merged into one "undefined" node', () => {
  const m = parse({ nodes: [null, 3, { label: 'no id' }, { label: 'also none' }, { id: 'a' }], edges: [null, { source: 'a', target: 'a' }] });
  assert.deepEqual(m.nodes.map((n) => n.id), ['a']);
  assert.equal(m.edges.length, 1);
});

test('a numeric parent is a parent, the same way a numeric id is an id', () => {
  const m = parse({ nodes: [{ id: 1 }, { id: 2, parent: 1 }] });
  assert.equal(m.index.get('2')!.parent, '1');
});

test('duplicate ids are kept once and reported, within one file and when two files disagree', () => {
  const one = parse({ nodes: [{ id: 'a', label: 'x' }, { id: 'a', label: 'y' }] });
  assert.equal(one.nodes.length, 1);
  assert.equal(one.index.get('a')!.label, 'x', 'first one wins');
  assert.ok(validateStructure(one).some((i) => i.kind === 'duplicate' && i.nodeId === 'a'));
  const two = parseSources([{ origin: '1.json', text: '{"nodes":[{"id":"a","label":"x"}]}' }, { origin: '2.json', text: '{"nodes":[{"id":"a","label":"y"}]}' }]);
  assert.ok(validateStructure(two).some((i) => i.kind === 'duplicate'));
  // the same node repeated across files (a folder every note of a vault carries) merges silently
  const same = parseSources([{ origin: '1.json', text: '{"nodes":[{"id":"d","label":"d"}]}' }, { origin: '2.json', text: '{"nodes":[{"id":"d","label":"d"}]}' }]);
  assert.ok(!validateStructure(same).some((i) => i.kind === 'duplicate'));
});

test('edge fields the library does not know survive a round trip (convert, toPhysical)', () => {
  const m = parse({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ source: 'a', target: 'b', relation: 'calls', confidence: 0.4 }] });
  const out = toPhysical(m).edges[0];
  assert.equal(out.relation, 'calls');
  assert.equal(out.confidence, 0.4);
});

test('depth under a parent cycle does not overflow the stack', () => {
  const m = buildModel([{ id: 'a', label: 'a', parent: 'b' }, { id: 'b', label: 'b', parent: 'a' }], []);
  const ix = indexModel(m);
  assert.ok(Number.isFinite(ix.depthOf('a')));
});

test('obsidian: a % in a wikilink is a name, not a broken escape', () => {
  const r = adapt([{ path: '50% done.md', text: '# 50% done' }, { path: 'a.md', text: 'see [[50% done]]' }]);
  assert.equal(r.adapter?.id, 'obsidian');
  const edges = r.sources.flatMap((s) => JSON.parse(s.text).edges);
  assert.deepEqual(edges.map((e: any) => e.target), ['50% done']);
});

test('a folder decided by one format names the files it does not read', () => {
  const r = adapt([
    { path: 'memory.jsonl', text: '{"type":"entity","name":"A","entityType":"x","observations":[]}' },
    { path: 'graph.json', text: '{"nodes":[{"id":"n"}]}' },
  ]);
  assert.equal(r.adapter?.id, 'memory');
  assert.deepEqual(r.skipped, ['graph.json']);
});
