/* glassbrain interaction benchmark: measure in a real browser "what each frame of continuous interaction costs".
 *
 *   npm run bench                   (= npm run demo && node scripts/bench.mjs)
 *   node scripts/bench.mjs project …   only these projects
 *
 * Why a real browser: jank is about frames. Synchronous timing can measure "how expensive one hover is" but not "what each frame of
 * the 200 ms tween after the hover costs"; and in a hidden browser pane rAF is throttled, so frame rates cannot be measured at all. So this
 * starts headless Chrome (dpr 2, the same pixel count as a retina screen) and runs one script in the page over CDP,
 * reporting four things per project:
 *
 *   hover   synchronous cost of one hover (median), and the frames in the time after hovering / leaving (p90 / longest)
 *   pan     frame cost of panning frame by frame for 60 frames after zooming in 4×
 *   zoom    frame cost of zooming frame by frame for 60 frames
 *   step    switch to each version in turn: from the click to the end of the scene, frame p90 / longest / frames over 50 ms
 *
 * Data is what is inlined in demo/dist (build with `npm run demo` first); all projects run by default.
 * A development tool only: it reaches the cytoscape instance through the DOM (`_cyreg`), which is not a public interface of the library.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const page = path.join(root, 'demo/dist/index.html');
if (!fs.existsSync(page)) { console.error('run npm run demo first'); process.exit(1); }

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = 9333;

const server = http.createServer((_, res) => { res.setHeader('content-type', 'text/html'); fs.createReadStream(page).pipe(res); });
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'glassbrain-bench-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`,
  '--window-size=1440,900', '--force-device-scale-factor=2', '--no-first-run', '--disable-extensions', url,
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function pageSocket() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      const p = list.find((t) => t.type === 'page' && t.url.startsWith(url));
      if (p) return p.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('Chrome did not start');
}
const ws = new WebSocket(await pageSocket());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
async function run(fn, ...args) {
  const m = await send('Runtime.evaluate', {
    expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true,
  });
  if (m.result?.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 500));
  return m.result?.result?.value;
}

/* ── The part that runs in the page (serialized as a whole; it cannot reference anything outside) ─────────────────── */
async function inPage(project) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const cyOf = () => [...document.querySelectorAll('div')].find((d) => d._cyreg && !d._cyreg.cy.destroyed())?._cyreg.cy;
  const busy = () => /Laying out|布局中/.test(document.body.innerText);
  const settle = async () => { for (let i = 0; i < 300 && (busy() || !cyOf()); i++) await sleep(100); await sleep(2600); };
  const stats = (a) => {
    const s = [...a].sort((x, y) => x - y);
    const q = (p) => +(s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0).toFixed(1);
    return { n: s.length, med: q(0.5), p90: q(0.9), max: q(1), over50: s.filter((x) => x > 50).length };
  };
  /** Record the interval of every frame during ms milliseconds, calling step once per frame. */
  const frames = (ms, step) => new Promise((resolve) => {
    const out = []; let last = performance.now(); const t0 = last; let i = 0;
    const f = (now) => {
      out.push(now - last); last = now;
      if (now - t0 >= ms) { resolve(out); return; }
      step?.(i++); requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });

  [...document.querySelectorAll('button')].find((b) => b.textContent === project)?.click();
  await settle();
  const versions = [...document.querySelectorAll('.ver')];
  if (versions.length) { versions[0].click(); await settle(); }
  let cy = cyOf();
  const out = { project, elements: cy.elements(':visible').length, inInstance: cy.elements().length };

  // Hover: nodes on screen that have neighbors, hovered and left one by one.
  const W = cy.width(), H = cy.height();
  const cands = cy.nodes(':childless').filter((n) => {
    if (!n.visible() || n.degree() === 0) return false;
    const p = n.renderedPosition(); return p.x > 0 && p.x < W && p.y > 0 && p.y < H;
  });
  const sync = [], hoverFrames = [];
  for (let i = 0; i < 8 && cands.length; i++) {
    const n = cands[(i * 37) % cands.length];
    const s = performance.now(); n.emit('mouseover'); sync.push(performance.now() - s);
    hoverFrames.push(...await frames(300));
    const s2 = performance.now(); n.emit('mouseout'); sync.push(performance.now() - s2);
    hoverFrames.push(...await frames(450));
  }
  out.hover = { syncMed: stats(sync).med, syncMax: stats(sync).max, frames: stats(hoverFrames) };

  // Pan / zoom: zoom in 4×, send one real wheel event per frame (that is how a trackpad comes in), going through the canvas's
  // own wheel handling, where large graph snapshots also live.
  const z0 = cy.zoom(), p0 = { ...cy.pan() };
  cy.zoom({ level: z0 * 4, renderedPosition: { x: W / 2, y: H / 2 } });
  await sleep(400);
  const el = cy.container();
  const r = el.getBoundingClientRect();
  const wheel = (init) => el.dispatchEvent(new WheelEvent('wheel', {
    bubbles: true, cancelable: true, clientX: r.left + W / 2, clientY: r.top + H / 2, ...init,
  }));
  out.pan = stats(await frames(1000, (i) => wheel({ deltaX: i % 40 < 20 ? -8 : 8, deltaY: 0 })));
  await sleep(400);
  out.zoom = stats(await frames(1000, (i) => wheel({ ctrlKey: true, deltaY: i % 40 < 20 ? -2 : 2 })));
  cy.viewport({ zoom: z0, pan: p0 });
  await sleep(400);

  // Switching versions: from the click to the end of the scene.
  if (versions.length > 1) {
    const all = [], perStep = [];
    for (let i = 1; i < versions.length; i++) {
      const rec = frames(4200);
      versions[i].click();
      const f = await rec;
      all.push(...f); perStep.push(stats(f).max);
      await settle();
    }
    out.step = { ...stats(all), maxPerStep: perStep };
    cy = cyOf();
  }
  return out;
}

try {
  await send('Runtime.enable');
  for (let i = 0; i < 100; i++) { if (await run(() => !!window.__GB_DATA__ && document.querySelectorAll('.sg-btn').length > 0)) break; await sleep(200); }
  const projects = process.argv.slice(2).length ? process.argv.slice(2)
    : await run(() => [...new Set(Object.keys(window.__GB_DATA__).map((p) => p.split('/')[0]))]);
  const results = [];
  for (const p of projects) {
    process.stderr.write(`· ${p} …\n`);
    results.push(await run(inPage, p));
  }
  for (const r of results) {
    console.log(`\n${r.project}  visible ${r.elements} / in instance ${r.inInstance}`);
    console.log(`  hover  sync median ${r.hover.syncMed}ms longest ${r.hover.syncMax}ms · frames p90 ${r.hover.frames.p90} longest ${r.hover.frames.max} >50ms ${r.hover.frames.over50}`);
    console.log(`  pan    frames median ${r.pan.med} p90 ${r.pan.p90} longest ${r.pan.max}`);
    console.log(`  zoom   frames median ${r.zoom.med} p90 ${r.zoom.p90} longest ${r.zoom.max}`);
    if (r.step) console.log(`  step   frames p90 ${r.step.p90} longest ${r.step.max} >50ms ${r.step.over50} · longest per step ${r.step.maxPerStep.join(' / ')}`);
  }
  if (process.env.BENCH_JSON) fs.writeFileSync(process.env.BENCH_JSON, JSON.stringify(results, null, 2));
} finally {
  ws.close(); chrome.kill(); server.close();
  // Chrome is still writing into it while quitting; whatever cannot be deleted is left for the system temp cleanup.
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 }); } catch { /* does not matter */ }
}
