/* dist check: runs after build and before pack, and in CI.
 *
 * Everything checked here is the kind that **breaks somewhere else**: a wrong worker path fails only in the host's bundler; a lost
 * 'use client' errors in the host's file; an exports path that does not exist, or types that only resolve under one
 * moduleResolution, are only discovered after someone runs npm i. A green build proves none of this, so it gets a gate of its own.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const fail = [];
const ok = [];
const read = (rel) => fs.readFileSync(path.join(dist, rel), 'utf8');
const check = (cond, msg) => (cond ? ok.push(msg) : fail.push(msg));

// 1. every path declared in exports really exists (both types and default)
for (const [sub, cond] of Object.entries(pkg.exports)) {
  for (const [key, rel] of Object.entries(typeof cond === 'string' ? { default: cond } : cond)) {
    const abs = path.join(root, rel);
    check(fs.existsSync(abs), `exports["${sub}"].${key} → ${rel}`);
  }
}

// 2. client entries carry 'use client'; the pure core does not (a server component must be able to call it)
for (const rel of ['index.js', 'internal.js', 'react/GraphCanvas.js', 'react/DetailPanel.js']) {
  check(read(rel).startsWith("'use client'"), `'use client' at the top of dist/${rel}`);
}
check(!read('core.js').startsWith("'use client'"), "no 'use client' on dist/core.js");
check(!/from\s*['"]react/.test(read('core.js')), 'dist/core.js does not import react');

// 3. the worker path: worker-pool points to an existing .js, and the worker is self-contained (no relative imports)
const poolSrc = read('layout/worker-pool.js');
check(/new URL\(\s*['"]\.\/worker\.js['"]/.test(poolSrc), 'worker-pool references ./worker.js (not .ts)');
check(fs.existsSync(path.join(dist, 'layout/worker.js')), 'dist/layout/worker.js exists');
const workerSrc = read('layout/worker.js');
check(!/^\s*import\s.*['"]\.\.?\//m.test(workerSrc), 'worker.js is self-contained (no relative imports between chunks)');
check(/type:\s*['"]module['"]/.test(poolSrc), 'worker-pool starts a module worker (worker.js imports cytoscape)');
check(/cytoscape/.test(workerSrc), 'worker.js really contains the layout computation (references cytoscape)');

// 4. no .ts path references may remain in dist (the easiest thing to miss when sources move)
const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const tsRefs = walk(dist).filter((f) => f.endsWith('.js'))
  .filter((f) => /from\s*['"][^'"]+\.ts['"]|new URL\(\s*['"][^'"]+\.ts['"]/.test(fs.readFileSync(f, 'utf8')));
check(tsRefs.length === 0, `no .ts path references in dist${tsRefs.length ? ` (${tsRefs.map((f) => path.relative(dist, f)).join(', ')})` : ''}`);

// 5. peer dependencies were not bundled into the output (bundled = the host installs react/cytoscape twice)
const indexSrc = read('index.js');
check(!/createContext|__SECRET_INTERNALS/.test(indexSrc), 'react is not bundled into dist/index.js');

// 6. types resolve for a consumer under node16/nodenext and under bundler resolution (relative d.ts imports need extensions)
{
  const { execFileSync } = await import('node:child_process');
  const os = await import('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glassbrain-types-'));
  fs.mkdirSync(path.join(tmp, 'node_modules'));
  fs.symlinkSync(root, path.join(tmp, 'node_modules', 'glassbrain'), 'dir');
  fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(tmp, 'a.ts'), [
    "import { parseSources, diffModels, GraphCanvas } from 'glassbrain';",
    "import { buildModel } from 'glassbrain/core';",
    "import { adapt } from 'glassbrain/adapters';",
    "const m = parseSources([]); diffModels(m, buildModel([], [])); adapt([]); void GraphCanvas;",
  ].join('\n'));
  const tsc = path.join(root, 'node_modules/typescript/bin/tsc');
  for (const res of ['nodenext', 'bundler']) {
    const mod = res === 'nodenext' ? 'nodenext' : 'esnext';
    try {
      execFileSync(process.execPath, [tsc, '--noEmit', '--strict', '--skipLibCheck', '--jsx', 'react-jsx', '--module', mod, '--moduleResolution', res, 'a.ts'], { cwd: tmp, stdio: 'pipe' });
      ok.push(`types resolve under moduleResolution ${res}`);
    } catch (e) { fail.push(`types resolve under moduleResolution ${res}:\n${String(e.stdout).slice(0, 800)}`); }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}

for (const m of ok) console.log(`  ✓ ${m}`);
for (const m of fail) console.error(`  ✗ ${m}`);
console.log(`\n${ok.length} passed / ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
