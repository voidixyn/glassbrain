/* glassbrain scale benchmark: how big can a graph get and still be usable?
 *
 *   npm run build && node scripts/scale.mjs                 1k / 3k / 5k / 10k synthetic graphs
 *   node scripts/scale.mjs 2000 20000                       given node counts
 *   node scripts/scale.mjs --file <graph.json or folder>    add one real dataset (same path as the CLI)
 *
 * It measures the page `npx glassbrain view` hands to users (dist/cli, main-thread layout, headless Chrome at dpr 2):
 *
 *   ready   from opening the page until layout appears (parsing, building, layout; the moment of onLayout)
 *   layout  the time layout itself took (the ms onLayout reports)
 *   pan     pan frame by frame for 1 s after zooming in 4×: frame interval median / p90
 *   zoom    zoom frame by frame for 1 s: frame interval median / p90
 *   heap    the JS heap after layout and one forced garbage collection (a new tab per dataset, so nothing accumulates)
 *
 * Synthetic graphs follow the shape of real ones: three levels of containment (group → subgroup → leaf), about 1.4 × node count semantic edges, 70% within the same group.
 * Random numbers are seeded, so the same graph every time.
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLI = path.join(root, 'dist/cli/glassbrain.js');
if (!fs.existsSync(CLI)) { console.error('run npm run build first'); process.exit(1); }
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = 9334;
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'glassbrain-scale-'));

const argv = process.argv.slice(2);
const files = [];
const sizes = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--file') files.push(path.resolve(argv[++i]));
  else sizes.push(Number(argv[i]));
}
if (!sizes.length && !files.length) sizes.push(1000, 3000, 5000, 10000);

/* ── Synthetic graphs ─────────────────────────────────────────────────────────── */
function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function synth(n) {
  const r = rng(n);
  const groups = Math.max(4, Math.round(n / 300));
  const subs = 8;
  const nodes = [];
  const leavesOf = [];
  for (let g = 0; g < groups; g++) {
    nodes.push({ id: `g${g}`, label: `Group ${g}`, kind: 'group' });
    leavesOf.push([]);
    for (let s = 0; s < subs; s++) nodes.push({ id: `g${g}s${s}`, label: `Area ${g}.${s}`, kind: 'area', parent: `g${g}` });
  }
  const KINDS = ['feature', 'entity', 'action'];
  for (let i = 0; nodes.length < n; i++) {
    const g = Math.floor(r() * groups);
    const id = `n${i}`;
    nodes.push({ id, label: `Item ${i}`, kind: KINDS[i % 3], parent: `g${g}s${Math.floor(r() * subs)}` });
    leavesOf[g].push(id);
  }
  const all = leavesOf.flat();
  const edges = [];
  const seen = new Set();
  const REL = ['uses', 'calls', 'refers'];
  while (edges.length < Math.round(n * 1.4)) {
    const g = Math.floor(r() * groups);
    const pool = leavesOf[g];
    if (!pool.length) continue;
    const s = pool[Math.floor(r() * pool.length)];
    const t = r() < 0.7 ? pool[Math.floor(r() * pool.length)] : all[Math.floor(r() * all.length)];
    const kind = REL[edges.length % 3];
    const k = `${s}>${t}>${kind}`;
    if (s === t || seen.has(k)) continue;
    seen.add(k);
    edges.push({ source: s, target: t, kind });
  }
  return { name: `synthetic ${n}`, nodes, edges };
}
const PROFILE = {
  nodePalette: { feature: '#e63b7a', entity: '#0891b2', action: '#f59e0b' },
  edgePalette: { uses: '#6366f1', calls: '#16a34a', refers: '#94a3b8' },
};

/* ── Each dataset → one html page (through the CLI, the same as users get) ─────────────────────── */
const pages = [];
for (const n of sizes) {
  const dir = path.join(work, `synthetic-${n}`);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'graph.json'), JSON.stringify(synth(n)));
  fs.writeFileSync(path.join(dir, '_profile.json'), JSON.stringify(PROFILE));
  pages.push({ name: `synthetic ${n}`, src: dir });
}
for (const f of files) pages.push({ name: path.basename(f), src: f });
for (const p of pages) {
  p.html = path.join(work, `${pages.indexOf(p)}.html`);
  p.info = execFileSync('node', [CLI, 'view', p.src, '--no-open', '--out', p.html], { encoding: 'utf8' }).split('\n')[0];
}

const server = http.createServer((req, res) => {
  const p = pages[Number(req.url.slice(1))];
  if (!p) { res.statusCode = 404; res.end(); return; }
  res.setHeader('content-type', 'text/html');
  fs.createReadStream(p.html).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glassbrain-scale-chrome-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profileDir}`,
  '--window-size=1440,900', '--force-device-scale-factor=2', '--no-first-run', '--disable-extensions',
  '--enable-precise-memory-info', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pageSocket() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      const p = list.find((t) => t.type === 'page');
      if (p) return p.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('Chrome did not start');
}
await pageSocket();
let ws;
let seq = 0;
const pending = new Map();
/** A new tab per dataset: navigating back and forth in one page counts the previous dataset's garbage in the next one's heap. */
async function freshTab(url) {
  ws?.close();
  const t = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  return t.id;
}
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
async function run(fn, ...args) {
  const m = await send('Runtime.evaluate', { expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true });
  if (m.result?.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 500));
  return m.result?.result?.value;
}

/* ── The part that runs in the page ────────────────────────────────────────────────────── */
async function inPage() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 3000 && !window.__glassbrain; i++) await sleep(100);
  if (!window.__glassbrain) return { error: 'layout did not finish in 300 s' };
  const ready = performance.now();
  await sleep(2500);
  const cy = [...document.querySelectorAll('div')].find((d) => d._cyreg && !d._cyreg.cy.destroyed())?._cyreg.cy;
  const stats = (a) => {
    const s = [...a].sort((x, y) => x - y);
    const q = (p) => +(s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0).toFixed(1);
    return { med: q(0.5), p90: q(0.9), max: q(1) };
  };
  const frames = (ms, step) => new Promise((resolve) => {
    const out = []; let last = performance.now(); const start = last; let i = 0;
    const f = (now) => { out.push(now - last); last = now; if (now - start >= ms) { resolve(out); return; } step?.(i++); requestAnimationFrame(f); };
    requestAnimationFrame(f);
  });
  const W = cy.width(), H = cy.height();
  const z0 = cy.zoom();
  cy.zoom({ level: z0 * 4, renderedPosition: { x: W / 2, y: H / 2 } });
  await sleep(400);
  const el = cy.container();
  const r = el.getBoundingClientRect();
  const wheel = (init) => el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: r.left + W / 2, clientY: r.top + H / 2, ...init }));
  const pan = stats(await frames(1000, (i) => wheel({ deltaX: i % 40 < 20 ? -8 : 8, deltaY: 0 })));
  await sleep(400);
  const zoom = stats(await frames(1000, (i) => wheel({ ctrlKey: true, deltaY: i % 40 < 20 ? -2 : 2 })));
  return {
    ready: Math.round(ready), layout: Math.round(window.__glassbrain.layoutMs ?? 0), pan, zoom,
  };
}

const results = [];
try {
  for (const [i, p] of pages.entries()) {
    process.stderr.write(`· ${p.name} (${p.info}) …\n`);
    const id = await freshTab(base + i);
    await sleep(500);
    const r = await run(inPage);
    await send('HeapProfiler.collectGarbage');
    const heap = await run(() => performance.memory?.usedJSHeapSize ?? 0);
    results.push({ name: p.name, data: p.info.split(': ')[1], ...r, heap: Math.round(heap / 1048576) });
    await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${id}`);
  }
} finally {
  ws.close(); chrome.kill(); server.close();
  await sleep(300);
  for (const d of [profileDir, work]) { try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 }); } catch { /* does not matter */ } }
}

const s = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);
console.log('\n| graph | size | ready | of which layout | pan frame (med / p90) | zoom frame (med / p90) | heap |');
console.log('|---|---|---|---|---|---|---|');
for (const r of results) {
  if (r.error) { console.log(`| ${r.name} | ${r.data} | ${r.error} | | | | |`); continue; }
  console.log(`| ${r.name} | ${r.data} | ${s(r.ready)} | ${s(r.layout)} | ${r.pan.med} / ${r.pan.p90} ms | ${r.zoom.med} / ${r.zoom.p90} ms | ${r.heap} MB |`);
}
if (process.env.SCALE_JSON) fs.writeFileSync(process.env.SCALE_JSON, JSON.stringify(results, null, 2));
