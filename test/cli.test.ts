/* CLI and adapters — tests the bundled dist/cli/glassbrain.js and dist/adapters.js (like the other tests, it tests the build output).
 *
 * The fixtures for other formats are minimal shapes cut down from their source code and from real output committed in their public repos:
 *   Graphify            to_json in graphify/export.py (NetworkX node-link, links + relation)
 *   Understand-Anything KnowledgeGraph in packages/core/src/types.ts (nodes / edges / layers)
 *   MCP memory          the JSONL of servers/src/memory (type: entity / relation)
 * The real outputs themselves stay out of the repo (they are analyses of other people's code); they were only checked locally.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { adapt, convertGraphify, convertUnderstand } from '../dist/adapters.js';

const CLI = path.resolve('dist/cli/glassbrain.js');
const FX = path.resolve('test/fixtures');
const run = (...args: string[]) => spawnSync('node', [CLI, ...args], { encoding: 'utf8' });
const json = (...args: string[]) => JSON.parse(execFileSync('node', [CLI, ...args, '--json'], { encoding: 'utf8' }));

test('Graphify: contains / method become containment, files go into folders, other relations become edges', () => {
  const g = convertGraphify({
    directed: true, multigraph: false,
    nodes: [
      { id: 'src_a_ts', label: 'a.ts', file_type: 'code', source_file: 'src/a.ts' },
      { id: 'a_cls', label: 'Cls', file_type: 'code', source_file: 'src/a.ts' },
      { id: 'a_cls_run', label: '.run()', file_type: 'code', source_file: 'src/a.ts' },
      { id: 'a_free', label: 'free()', file_type: 'code', source_file: 'src/a.ts' },
      { id: 'why', label: 'Why run exists', file_type: 'rationale', source_file: 'src/a.ts' },
      { id: 'idea', label: 'Idea', file_type: 'concept', source_file: 'README.md' },
      { id: 'floating', label: 'Floating', file_type: 'concept', source_file: '' },
    ],
    links: [
      { source: 'src_a_ts', target: 'a_cls', relation: 'contains', confidence: 'EXTRACTED', confidence_score: 1 },
      { source: 'src_a_ts', target: 'a_cls_run', relation: 'contains', confidence: 'EXTRACTED', confidence_score: 1 },
      { source: 'a_cls', target: 'a_cls_run', relation: 'method', confidence: 'EXTRACTED', confidence_score: 1 },
      { source: 'why', target: 'a_cls_run', relation: 'rationale_for', confidence: 'EXTRACTED', confidence_score: 1 },
      { source: 'a_free', target: 'a_cls_run', relation: 'calls', confidence: 'INFERRED', confidence_score: 0.6 },
    ],
  });
  const parent = Object.fromEntries(g.nodes.map((n) => [n.id, n.parent]));
  assert.equal(parent.src_a_ts, 'dir:src');
  assert.equal(parent.a_cls, 'src_a_ts');
  assert.equal(parent.a_cls_run, 'a_cls', 'method is more precise than contains: the method lives in the class');
  assert.equal(parent.a_free, 'src_a_ts', 'a symbol without contains goes into its source_file');
  assert.equal(parent.why, 'a_cls_run', 'a rationale sits on the thing it explains');
  assert.equal(parent.idea, 'file:README.md', 'a file box is added when the file itself is not a node');
  assert.equal(parent.floating, 'group:concept');
  const calls = g.edges.find((e) => e.kind === 'calls')!;
  assert.equal(calls.weight, 0.6, 'confidence_score becomes the edge width');
  assert.ok(g.edges.some((e) => e.kind === 'contains' && e.target === 'a_cls_run'), 'a second parent is not lost; it stays as an edge');
});

test('Understand-Anything: architecture layers become boxes, contains is read as containment, backward edges flip', () => {
  const g = convertUnderstand({
    version: '1.0.0', project: { name: 'demo' },
    nodes: [
      { id: 'file:src/x.ts', type: 'file', name: 'x.ts', filePath: 'src/x.ts', summary: 'X', tags: ['a'], complexity: 'simple' },
      { id: 'function:src/x.ts:f', type: 'function', name: 'f', filePath: 'src/x.ts', lineRange: [3, 9], summary: 'F', tags: [], complexity: 'simple' },
      { id: 'file:lib/y.ts', type: 'file', name: 'y.ts', filePath: 'lib/y.ts', summary: 'Y', tags: [], complexity: 'simple' },
    ],
    edges: [
      { source: 'file:src/x.ts', target: 'function:src/x.ts:f', type: 'contains', direction: 'forward', weight: 1 },
      { source: 'file:lib/y.ts', target: 'file:src/x.ts', type: 'imports', direction: 'backward', weight: 0.7 },
    ],
    layers: [{ id: 'layer:core', name: 'Core', description: 'core', nodeIds: ['file:src/x.ts'] }],
    tour: [],
  });
  const by = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
  assert.equal(g.name, 'demo');
  assert.equal(by['file:src/x.ts'].parent, 'ua-layer:layer:core');
  assert.equal(by['function:src/x.ts:f'].parent, 'file:src/x.ts');
  assert.equal(by['function:src/x.ts:f'].lines, '3–9');
  assert.equal(by['file:lib/y.ts'].parent, 'dir:lib', 'files outside any layer go into their folder by path');
  assert.equal(by['file:src/x.ts'].description, 'X');
  const imp = g.edges.find((e) => e.kind === 'imports')!;
  assert.deepEqual([imp.source, imp.target], ['file:src/x.ts', 'file:lib/y.ts']);
});

test('the format is detected from content, not file name; anything unrecognized is native {nodes, edges}', () => {
  const graphify = JSON.stringify({ nodes: [{ id: 'a', label: 'a', file_type: 'code', source_file: 'a.py' }], links: [] });
  const ua = JSON.stringify({ project: { name: 'p' }, layers: [], nodes: [{ id: 'a', type: 'file', name: 'a' }], edges: [] });
  const native = JSON.stringify({ nodes: [{ id: 'a', label: 'a' }], edges: [] });
  assert.equal(adapt([{ path: 'whatever.json', text: graphify }]).adapter?.id, 'graphify');
  assert.equal(adapt([{ path: 'x.json', text: ua }]).adapter?.id, 'understand-anything');
  assert.equal(adapt([{ path: 'm.json', text: fs.readFileSync(path.join(FX, 'memory.jsonl'), 'utf8') }]).adapter?.id, 'memory');
  assert.equal(adapt([{ path: 'g.json', text: native }]).adapter, null);
  assert.equal(adapt([{ path: 'n.md', text: '# hi' }, { path: 'g.json', text: native }]).adapter, null, 'a folder with a native graph is not read as notes');
  assert.throws(() => adapt([], 'nope'), /Unknown format/);
});

test('Obsidian: folders are containment, [[wikilinks]] resolve by path or file name and are rewritten as node: links in the body', () => {
  const g = json('validate', path.join(FX, 'vault'));
  assert.equal(g.format, 'obsidian');
  assert.equal(g.errors, 0);
  const out = JSON.parse(execFileSync('node', [CLI, 'convert', path.join(FX, 'vault')], { encoding: 'utf8' }));
  const by = Object.fromEntries(out.nodes.map((n: any) => [n.id, n]));
  assert.ok(!('.obsidian/app' in by), 'dot directories are skipped');
  assert.equal(by['Projects/Alpha/Plan'].parent, 'dir:Projects/Alpha');
  assert.equal(by['Projects/Alpha/Plan'].kind, 'plan', 'frontmatter type becomes kind');
  assert.deepEqual(by['Projects/Alpha/Plan'].tags, ['project', 'q4']);
  assert.equal(by.Home.label, 'Home');
  assert.ok(!('layer' in by.Home), 'no layer is written unless one is declared');
  const edges = out.edges.map((e: any) => `${e.source}>${e.target}`).sort();
  assert.deepEqual(edges, [
    'Home>People/Ada', 'Home>Projects/Alpha/Plan', 'People/Ada>Projects/Alpha/Plan',
    'Projects/Alpha/Notes>Home', 'Projects/Alpha/Plan>People/Ada', 'Projects/Alpha/Plan>Projects/Alpha/Notes',
  ], '[[ada]] is case-insensitive, [[Plan#Goals]] drops the heading, relative .md links count; embeds and unresolved links are not connected');
  assert.match(by['People/Ada'].description, /\[Plan\]\(node:Projects\/Alpha\/Plan\)/);
});

test('memory: grouped by entityType, observations go into the detail', () => {
  const out = JSON.parse(execFileSync('node', [CLI, 'convert', path.join(FX, 'memory.jsonl')], { encoding: 'utf8' }));
  const ada = out.nodes.find((n: any) => n.id === 'Ada');
  assert.equal(ada.parent, 'type:person');
  assert.equal(ada.description, '- Leads Alpha\n- Prefers short reviews');
  assert.deepEqual(out.edges.map((e: any) => e.kind), ['leads', 'uses']);
});

test('validate: reports schema errors, dangling edges, missing parents and parent cycles; exits 1 on any error', () => {
  const r = run('validate', path.join(FX, 'broken.json'));
  assert.equal(r.status, 1);
  for (const s of ['missing "id"', 'needs "source" + "target"', 'must be ≤ 1', 'Dangling edge', 'Missing parent', 'Parent cycle']) {
    assert.ok(r.stdout.includes(s), `reported ${s}`);
  }
  const ok = run('validate', path.join(FX, 'versions'));
  assert.equal(ok.status, 0);
  assert.match(ok.stdout, /2 versions/);
});

test('diff: counts added, removed, moved and edge changes; --exit-code exits 1 when anything changed', () => {
  const s = json('diff', path.join(FX, 'versions/1-first'), path.join(FX, 'versions/2-second'));
  assert.equal(s.nodes.added, 1);
  assert.equal(s.nodes.moved, 1);
  assert.deepEqual(s.edges, { added: 1, removed: 1, kept: 0 });
  const moved = s.changes.find((c: any) => c.kind === 'moved');
  assert.equal(moved.detail, 'A → D');
  const same = run('diff', path.join(FX, 'versions/1-first'), path.join(FX, 'versions/1-first'), '--exit-code', '--no-open');
  assert.equal(same.status, 0);
  assert.match(same.stdout, /No changes/);
  const diffr = run('diff', path.join(FX, 'versions/1-first'), path.join(FX, 'versions/2-second'), '--exit-code', '--no-open');
  assert.equal(diffr.status, 1);
});

test('diff with git: <ref>:<path> reads from history, a single path = compare with HEAD', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glassbrain-git-'));
  const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  fs.mkdirSync(path.join(dir, 'kg'));
  fs.copyFileSync(path.join(FX, 'versions/1-first/graph.json'), path.join(dir, 'kg/graph.json'));
  git('add', '.'); git('commit', '-qm', 'one');
  fs.copyFileSync(path.join(FX, 'versions/2-second/graph.json'), path.join(dir, 'kg/graph.json'));
  const inDir = (...a: string[]) => JSON.parse(execFileSync('node', [CLI, ...a, '--json'], { cwd: dir, encoding: 'utf8' }));
  assert.equal(inDir('diff', 'kg/graph.json').nodes.added, 1, 'working tree vs HEAD');
  assert.equal(inDir('diff', 'HEAD', 'kg').nodes.moved, 1, '<ref> <path> (a folder)');
  assert.equal(inDir('diff', 'HEAD:kg', 'kg').nodes.moved, 1, '<ref>:<path>');
  const sub = JSON.parse(execFileSync('node', [CLI, 'validate', 'HEAD:graph.json', '--json'], { cwd: path.join(dir, 'kg'), encoding: 'utf8' }));
  assert.equal(sub.versions[0].nodes, 3, 'paths are relative to the current directory, like ./ in git');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('view: writes a self-contained html (data inlined, </script> escaped) without opening a browser', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glassbrain-view-'));
  const out = path.join(dir, 'page.html');
  const r = run('view', path.join(FX, 'versions'), '--no-open', '--out', out);
  assert.equal(r.status, 0, r.stderr);
  const html = fs.readFileSync(out, 'utf8');
  assert.match(html, /window\.__GLASSBRAIN__ = \{/);
  assert.equal((html.match(/^<script>/gm) ?? []).length, 2);
  assert.equal((html.match(/<\/script>/g) ?? []).length, 2, 'neither the data nor the bundle contains an early </script>');
  assert.ok(!/src=["']https?:/.test(html), 'no network');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('anything unreadable gets a plain-language message and exit code 2', () => {
  const r = run('validate', 'no/such/thing.json');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /No such file, folder or git path/);
});

test('flags: a typo is an error (exit 2), not silently ignored; values may contain "="', () => {
  const r = run('validate', path.join(FX, 'versions'), '--strcit');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown option --strcit/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glassbrain-flags-'));
  const out = path.join(dir, 'a=b.html');
  assert.equal(run('view', path.join(FX, 'versions'), '--no-open', `--out=${out}`).status, 0);
  assert.ok(fs.existsSync(out));
});

test('versions: a README next to or inside the version folders is not read and does not turn them into one graph', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glassbrain-readme-'));
  fs.cpSync(path.join(FX, 'versions'), dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'README.md'), '# notes');
  const r = run('validate', dir);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /2 versions/);
  assert.match(r.stderr, /not read: README\.md/);
});
