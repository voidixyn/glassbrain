/* The glassbrain-src demo dataset: this repository's own src/ as a code graph, at two revisions.
 *
 *   node scripts/gen-demo-data.mjs     → data/demo/glassbrain-src/
 *
 * Directory ⊃ file ⊃ exported symbol, edges are import / uses, all read from the source: deep nesting, dense directed edges.
 * The other demo datasets were made by agents; each one's RUN.md says how.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'data/demo');
const write = (rel, obj) => {
  const f = path.join(out, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(obj, null, 1) + '\n');
};

/* ── glassbrain-src: this repository's own code ─────────────────────────────────────── *
 * Everything is read from the source, nothing made up:
 *   nodes  directory ⊃ file ⊃ export. Exports are classified: component (capitalized function in tsx), function, class, type, constant
 *   edges  imports (file → file), re-exports (`export … from`), uses (uses some runtime export),
 *          uses-type (only types: `import type` or `{ type X }`)
 * Directories and files are containers in skeleton color; exports are the content. */

/* The shipped versions come from two revisions that predate the public history. To regenerate from revisions
 * of your checkout: GLASSBRAIN_REVS=<old>,<new> node scripts/gen-demo-data.mjs */
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });
const [oldRev, newRev] = (process.env.GLASSBRAIN_REVS ?? '9b4244e,7b35ee4').split(',');
const REVS = [['1-early', oldRev], ['2-later', newRev]];
const haveRevs = REVS.every(([, rev]) => { try { execFileSync('git', ['cat-file', '-e', `${rev}^{commit}`], { cwd: root, stdio: 'ignore' }); return true; } catch { return false; } });

function codeGraph(ver, rev) {
  const files = git('ls-tree', '-r', '--name-only', rev, 'src').split('\n').filter((f) => /\.tsx?$/.test(f));
  const nodes = new Map();
  const edges = [];
  const seen = new Set();
  const add = (n) => { if (!nodes.has(n.id)) nodes.set(n.id, n); };
  const link = (source, target, kind) => {
    const k = `${source}>${target}>${kind}`;
    if (!seen.has(k)) { seen.add(k); edges.push({ source, target, kind }); }
  };
  const dirOf = (p) => p.slice(0, p.lastIndexOf('/'));
  const addDir = (d) => {
    if (nodes.has(d)) return;
    const up = d.includes('/') ? dirOf(d) : undefined;
    if (up) addDir(up);
    add({ id: d, label: d.split('/').pop() + '/', parent: up, path: d });
  };
  const kindOf = (f, decl, name) => {
    if (/\.tsx$/.test(f) && (decl === 'function' || decl === 'const') && /^[A-Z][a-z]/.test(name)) return 'component';
    return { function: 'function', class: 'class', interface: 'type', type: 'type', enum: 'type', const: 'value', let: 'value' }[decl];
  };
  const exportsOf = new Map();
  const text = new Map(files.map((f) => [f, git('show', `${rev}:${f}`)]));
  for (const f of files) {
    addDir(dirOf(f));
    const src = text.get(f);
    add({ id: f, label: f.split('/').pop(), kind: 'file', parent: dirOf(f), path: f, lines: src.split('\n').length });
    const kinds = new Map();
    for (const m of src.matchAll(/^export\s+(?:default\s+)?(?:async\s+)?(function|class|interface|type|enum|const|let)\s+([A-Za-z_$][\w$]*)/gm)) {
      const line = src.slice(0, m.index).split('\n').length;
      const kind = kindOf(f, m[1], m[2]);
      kinds.set(m[2], kind);
      add({ id: `${f}#${m[2]}`, label: m[2], kind, parent: f, path: f, line });
    }
    exportsOf.set(f, kinds);
  }
  const resolve = (from, spec) => {
    const base = path.posix.normalize(path.posix.join(dirOf(from), spec));
    return [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find((c) => text.has(c));
  };
  for (const f of files) {
    const src = text.get(f);
    for (const m of src.matchAll(/^(import|export)\s+(type\s+)?([\s\S]*?)\s*from\s+['"](\.[^'"]+)['"]/gm)) {
      const to = resolve(f, m[4]);
      if (!to) continue;
      link(f, to, m[1] === 'export' ? 're-exports' : 'imports');
      if (m[1] === 'export') continue;
      const named = /\{([\s\S]*)\}/.exec(m[3])?.[1] ?? '';
      for (const part of named.split(',')) {
        const raw = part.trim();
        const typeOnly = !!m[2] || raw.startsWith('type ');
        const name = raw.replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
        const k = exportsOf.get(to)?.get(name);
        if (!k) continue;
        link(f, `${to}#${name}`, typeOnly || k === 'type' ? 'uses-type' : 'uses');
      }
    }
  }
  return { name: `glassbrain src · ${ver}`, nodes: [...nodes.values()], edges };
}

if (haveRevs) for (const [ver, rev] of REVS) write(`glassbrain-src/${ver}/graph.json`, codeGraph(ver, rev));
else console.log(`glassbrain-src: revisions ${oldRev} / ${newRev} not in this checkout, kept as is (set GLASSBRAIN_REVS)`);
write('glassbrain-src/_profile.json', {
  /* Colors in three tiers by "who should be seen", so not every color competes for attention:
   *   lots of ordinary content: light candy colors (functions light magenta, constants light apricot, types mint)
   *   functional, few and important: vivid colors (classes teal)
   *   a few hubs: black (components: one or two per file, the whole graph revolves around them)
   * The whole family avoids blue: the skeleton (directories, files, "default") is itself a blue ramp. Edges take the color of the class they point to. */
  nodePalette: { component: '#444444', function: '#ed719e', class: '#0891b2', type: '#00fa92', value: '#ffd877' },
  edgePalette: { imports: '#e63b7a', 're-exports': '#4d22b3', uses: '#53d5fd', 'uses-type': '#fbbf24' },
  style: [{ selector: 'edge.uses-type', style: { 'line-style': 'dashed' } }],
  kindLabels: { file: 'File', component: 'Component', function: 'Function', class: 'Class', type: 'Type', value: 'Constant',
    imports: 'imports', 're-exports': 're-exports', uses: 'uses', 'uses-type': 'uses type' },
  demo: { order: 9, description: { en: 'This library’s own source at two pre-release snapshots', zh: '这个库自己的源码，发布前的两个快照' } },
  detail: { line: [{ key: 'path', label: 'PATH' }, { key: 'line', label: 'LINE' }, { key: 'lines', label: 'LINES' }] },
});

/* diffable: the two versions form a group. Other groups stay as they are. */
const dfile = path.join(out, 'diffable.json');
const diffable = JSON.parse(fs.readFileSync(dfile, 'utf8')).filter((g) => !g.some((v) => v.startsWith('glassbrain-src/')));
diffable.push(REVS.map(([v]) => `glassbrain-src/${v}`));
fs.writeFileSync(dfile, `[\n${diffable.map((g) => `  ${JSON.stringify(g).replace(/","/g, '", "')}`).join(',\n')}\n]\n`);
console.log('ok');
