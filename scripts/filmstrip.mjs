/* glassbrain filmstrip: whether it janks is judged by the frames the browser actually paints, not by numbers the page reports.
 *
 *   node scripts/filmstrip.mjs <index.html> <out-dir> [project …]
 *
 * The difference from bench.mjs: bench measures rAF inside the page, and when the page hangs it hangs too; this records from
 * **outside** the page:
 *
 *   · the picture is recorded with CDP screencast (the compositor pushes one image per frame, with timestamps). When the page's main thread
 *     hangs there are no new frames: gaps in the timeline are where "the picture froze", and the screenshots are unaffected by the jank.
 *   · input is sent as real mouse events over CDP (`Input.dispatchMouseEvent`, hit-tested like a hand).
 *     The call returns only after the page has handled the event, so its duration is "how long the page took to respond to this mouse event".
 *   · the page opens via file://, the same path as a double click (main-thread layout).
 *
 * Each project plays five parts: load, hover sweep, two-finger pan, pinch zoom, next version. Each part samples the picture at fixed times
 * (which frame is **actually** on screen 0 / 100 / 300 / 700 / 1500 / 3000 ms after the action starts), plus
 * input latency and the longest freeze. Writes <out-dir>/filmstrip.json and thumbnails for a report page to assemble.
 *
 * A development tool only: before an action it reaches the cytoscape instance through the DOM to find node positions (`_cyreg`); the actions
 * themselves use only real input.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [pageArg, outArg, ...only] = process.argv.slice(2);
if (!pageArg || !outArg) { console.error('usage: node scripts/filmstrip.mjs <index.html> <out-dir> [project …]'); process.exit(1); }
const url = pathToFileURL(path.resolve(pageArg)).href;
const outDir = path.resolve(outArg);
fs.mkdirSync(outDir, { recursive: true });

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = 9334;
const W = 1440, H = 900;
const SHOTS = [0, 100, 300, 700, 1500, 3000];

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'glassbrain-film-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`,
  `--window-size=${W},${H}`, '--force-device-scale-factor=2', '--no-first-run', '--disable-extensions',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.timeOrigin + performance.now();

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
const ws = new WebSocket(await pageSocket());
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
/** Recorded frames: { t: wall-clock ms, data: base64 jpeg }. */
const frames = [];
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Page.screencastFrame') {
    frames.push({ t: m.params.metadata.timestamp * 1000, data: m.params.data });
    send('Page.screencastFrameAck', { sessionId: m.params.sessionId });
  }
});
async function evalIn(fn, ...args) {
  const m = await send('Runtime.evaluate', { expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true });
  if (m.result?.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 400));
  return m.result?.result?.value;
}
/** Send one real mouse event and return how long the page took to handle it (ms). */
async function mouse(params) {
  const s = now();
  await send('Input.dispatchMouseEvent', { button: 'none', ...params });
  return now() - s;
}
/** Send a series of events on a wall-clock beat: number i is scheduled at t0 + i*every; when the page hangs, later ones are not made up or queued. */
async function paced(n, every, mk) {
  const lat = [];
  const t0 = now();
  for (let i = 0; i < n; i++) {
    const wait = t0 + i * every - now();
    if (wait > 0) await sleep(wait);
    lat.push(await mouse(mk(i)));
  }
  return lat;
}
const idle = () => evalIn(() => !/Laying out|布局中/.test(document.body.innerText));
async function waitIdle(maxMs = 120000) {
  const s = now();
  while (now() - s < maxMs && !(await idle())) await sleep(100);
}
/** The picture has settled: no new frame for quietMs in a row. */
async function waitQuiet(quietMs = 800, maxMs = 30000) {
  const s = now();
  while (now() - s < maxMs) {
    const last = frames.at(-1)?.t ?? 0;
    if (now() - last > quietMs) return;
    await sleep(100);
  }
}

/** Which frame is actually on screen dt after the action starts = the last frame with timestamp ≤ t0+dt. */
const frameAt = (t) => { let f = null; for (const x of frames) { if (x.t <= t) f = x; else break; } return f; };

async function record(name, act, tail = 3200) {
  await waitQuiet();
  const t0 = now();
  const lat = await act();
  const tEnd = now();
  await sleep(Math.max(0, t0 + Math.max(...SHOTS) + 200 - now()));
  await waitQuiet(800, 60000);
  await sleep(200);
  const win = frames.filter((f) => f.t >= t0 && f.t <= Math.max(now(), t0 + tail));
  // Longest freeze: the largest gap between adjacent frames during the action (including the catch-up after it); the frame before the action counts as the start too.
  const ts = [frameAt(t0)?.t ?? t0, ...win.map((f) => f.t)];
  let freeze = 0;
  for (let i = 1; i < ts.length; i++) freeze = Math.max(freeze, ts[i] - Math.max(ts[i - 1], t0));
  const lastChange = win.length ? win.at(-1).t - t0 : 0;
  const shots = SHOTS.map((dt) => {
    const f = frameAt(t0 + dt);
    return { dt, age: f ? Math.round(t0 + dt - f.t) : null, data: f?.data ?? null };
  });
  const sorted = [...lat].sort((a, b) => a - b);
  return {
    name,
    inputMed: sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)]) : null,
    inputMax: sorted.length ? Math.round(sorted.at(-1)) : null,
    inputMs: Math.round(tEnd - t0),
    freeze: Math.round(freeze),
    settle: Math.round(lastChange),
    frameTimes: win.map((f) => Math.round(f.t - t0)),
    shots,
  };
}

/* ── Finding things in the page (only before an action) ─────────────────────────────────── */
const cyInfo = () => evalIn(() => {
  const cy = [...document.querySelectorAll('div')].find((d) => d._cyreg && !d._cyreg.cy.destroyed())?._cyreg.cy;
  if (!cy) return null;
  const r = cy.container().getBoundingClientRect();
  const W = cy.width(), H = cy.height();
  const pts = cy.nodes(':childless:visible').map((n) => n.renderedPosition())
    .filter((p) => p.x > 40 && p.x < W - 40 && p.y > 40 && p.y < H - 40)
    .map((p) => ({ x: Math.round(r.left + p.x), y: Math.round(r.top + p.y) }));
  return { left: r.left, top: r.top, w: W, h: H, pts, zoom: cy.zoom(), n: cy.elements(':visible').length };
});
const clickText = (sel, text) => evalIn((sel, text) => {
  const b = [...document.querySelectorAll(sel)].find((x) => x.textContent.trim() === text || x.title === text);
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, sel, text);
async function click(pt) {
  const lat = [];
  lat.push(await mouse({ type: 'mouseMoved', x: pt.x, y: pt.y }));
  lat.push(await mouse({ type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 }));
  lat.push(await mouse({ type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 }));
  return lat;
}

async function runProject(project) {
  const out = { project, actions: [] };
  // Load: from clicking the project button until layout lands and the picture settles.
  const btn = await clickText('.sg-btn', project);
  out.actions.push(await record('load', async () => {
    const lat = btn ? await click(btn) : [];
    await sleep(300);
    await waitIdle();
    return lat;
  }));
  await waitQuiet(1500);
  const info = await cyInfo();
  out.elements = info.n;
  const cx = info.left + info.w / 2, cy = info.top + info.h / 2;

  // Hover sweep: walk along the nodes on screen, one step every 40 ms, ending on a node.
  const pts = info.pts.sort((a, b) => a.x - b.x);
  const path_ = Array.from({ length: 24 }, (_, i) => pts[Math.floor(i * (pts.length - 1) / 23)] ?? { x: cx, y: cy });
  out.actions.push(await record('hover', () => paced(path_.length, 40, (i) => ({ type: 'mouseMoved', x: path_[i].x, y: path_[i].y }))));
  await mouse({ type: 'mouseMoved', x: info.left + 5, y: info.top + 5 });

  // Two-finger pan (plain wheel): 60 events, one every 16 ms.
  out.actions.push(await record('pan', () => paced(60, 16, (i) => ({
    type: 'mouseWheel', x: cx, y: cy, deltaX: i < 30 ? -12 : 12, deltaY: i < 30 ? -6 : 6,
  }))));
  // Pinch zoom (Ctrl+wheel): zoom in, then back out.
  out.actions.push(await record('zoom', () => paced(60, 16, (i) => ({
    type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: i < 30 ? -6 : 6, modifiers: 2,
  }))));

  // Next version.
  const vers = await evalIn(() => [...document.querySelectorAll('.ver')].filter((b) => !b.closest('.past'))
    .map((b) => { const r = b.getBoundingClientRect(); return { on: b.classList.contains('on'), x: r.left + r.width / 2, y: r.top + r.height / 2 }; }));
  const next = vers.findIndex((v) => v.on) + 1;
  if (vers.length > 1 && next > 0 && next < vers.length) {
    out.actions.push(await record('step', async () => {
      const lat = await click(vers[next]);
      await sleep(300);
      await waitIdle();
      return lat;
    }));
  }
  return out;
}

try {
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.startScreencast', { format: 'jpeg', quality: 55, maxWidth: 960, maxHeight: 600, everyNthFrame: 1 });
  await send('Page.navigate', { url });
  for (let i = 0; i < 300; i++) { if (await evalIn(() => document.querySelectorAll('.sg-btn').length > 0).catch(() => false)) break; await sleep(200); }
  await waitIdle();
  const projects = only.length ? only : await evalIn(() => [...document.querySelectorAll('.sg-btn')].map((b) => b.textContent.trim()));
  const results = [];
  for (const p of projects) {
    process.stderr.write(`· ${p} …\n`);
    const r = await runProject(p);
    results.push(r);
    for (const a of r.actions) {
      process.stderr.write(`  ${a.name.padEnd(5)} input median ${a.inputMed}ms longest ${a.inputMax}ms · longest freeze ${a.freeze}ms · settled at ${a.settle}ms\n`);
    }
  }
  // Thumbnails go to disk; the json keeps only file names.
  for (const r of results) for (const a of r.actions) for (const s of a.shots) {
    if (!s.data) continue;
    const f = `${r.project}-${a.name}-${s.dt}.jpg`.replace(/[\/\s]/g, '_');
    fs.writeFileSync(path.join(outDir, f), Buffer.from(s.data, 'base64'));
    s.file = f; delete s.data;
  }
  fs.writeFileSync(path.join(outDir, 'filmstrip.json'), JSON.stringify(results, null, 2));
  console.log(path.join(outDir, 'filmstrip.json'));
} finally {
  await send('Page.stopScreencast').catch(() => {});
  ws.close(); chrome.kill();
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 }); } catch { /* does not matter */ }
}
