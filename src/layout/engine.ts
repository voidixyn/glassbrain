/* glassbrain · layout orchestration: computeLayout(), the canvas's only entry point
 *
 * Flow: split into components (divide) → lay out components in parallel on the execution path → place attached layers → second pass on the coarse graph
 *       (components as super nodes, same algorithm) → translate and assemble → whole-graph coordinate table → (optional) 2.5D projection.
 *
 * Lifecycle (minimal conventions):
 *   - The coordinate cache is addressed by **structure hash** and stored in localStorage. When the structure or view parameters change, the hash changes
 *     and the cache invalidates naturally: no explicit expiry check.
 *   - Hit → return at once (a reload opens instantly). Miss → start a job; concurrent requests with the same hash share
 *     one promise. A new hash arriving → the old job is marked stale (its result no longer reaches the UI).
 *   - Unloading the page does not stop a job: it still writes the cache when done, and the next visit hits.
 *   - force=true ("Relayout" in the canvas menu) → skip and overwrite the cache.
 *
 * The execution path (worker pool / inline on the main thread) is injected by the caller; see run-job.ts and worker-pool.ts / inline-pool.ts.
 */
import { buildCoarseElements, partitionElements, placeAttached, resolveOverlaps, VIRTUAL_ROOT,
  type AttachedItem, type Box } from './divide';
import type { Plate, Positions } from './planes';
import type { LayoutJobResult, LayoutRunnerPool } from './run-job';
import type { LayoutName } from './presets';
import type { CyElement } from '../elements';

export interface LayoutRequest {
  elements: CyElement[];
  /** Measured leaf sizes (label-fitted sizes only a real renderer can measure).
   *
   *  **Only affects "how to solve", never "is this the same input"**: size is a result of rendering, not the graph's
   *  identity. See `shapeHash`. */
  dims: Record<string, { w: number; h: number }>;
  layoutName: LayoutName;
  pool: LayoutRunnerPool;
  /** divide = divide and conquer (components in parallel + a coarse graph pass, default); whole = the whole graph in one go on one path. */
  mode?: 'divide' | 'whole';
  /** Cache namespace, to keep several graphs apart. */
  namespace?: string;
  /** Who is asking (one per canvas). A new request supersedes only the same owner's run in flight, so two canvases on one page
   *  never cancel each other. Default: the namespace. Not part of the input's identity. */
  owner?: unknown;
  /**
   * Previous coordinates. **Everything that makes animation good**: a force layout's result is decided by its initial positions, so a solve
   * starting from the current coordinates naturally hugs the current ones; "relayout" and "shifted a bit" become the same thing.
   *
   * Doing without it was tried (free solve + rigid alignment to bring the orientation back) and measured worse: two free solves of the same input,
   * **after the best rigid alignment, still differ by a median of 584** (graph width about 2400). The difference between the two solves is combinatorial
   * (branches swapped places around the center), not a tilt, and no rigid transform can fix it. The median move of the merge step
   * went from 959 to 1983 as a result.
   *
   * The cost is that layout becomes **path dependent**: going step1 → step2 and step4 → step2, the same data
   * gets two different layouts. That is a real cost, but within one session layout is stable (see lastByNs),
   * and results go into the cache, so the same structure hits it the second time and never drifts; for a different one press "Relayout", which deliberately takes no seed.
   *
   * **All three places need it; miss one and the seed is wasted:**
   *   ① inside components: member coordinates as the force start
   *   ② the coarse graph pass: each component's seed centroid, keeping components' relative bearings
   *   ③ **translate and assemble**: components go back to their own seed's bounding box center. Without this, however stable a component is inside,
   *      it gets moved as a whole to the coarse graph's new spot: that is where the whole graph's translation and rotation came from.
   */
  seed?: Positions;
  onProgress?: (done: number, total: number) => void;
  force?: boolean;
  /** Cache partition: the same structure stores each solving mode separately (`layoutMode` fresh / continue).
   *  Without it, after one pass with continue, switching back to fresh would still show the continue result: "a free solve by content,
   *  the same data always looks the same" would no longer hold. */
  variant?: string;
}

/* There is **no** "override layout parameters" or "skip cache" hook here. There used to be, for diff's multi-round fusion
 * (capping iterations with a `numIter` every half step); measured not to work, and in the worst way:
 * cose-bilkent with `numIter < 400` throws **asynchronously** inside its own tick, `layoutstop` never
 * arrives, and the whole canvas hangs on "Preparing layout" without a clue. And `numIter` is not a step size anyway
 * (fcose moves the same with 1 and 1200). Details at the top of layout/relax.ts. */

/** The solve gives **flat** coordinates: in a multi-layer graph attached layers sit right above their associated centroid (`placeAttached`),
 *  and raising to 2.5D is an affine map the canvas computes with `projectPlanes(…, t)`: flat view and layering share this one solve. */
export interface LayoutResult {
  positions: Positions;
  /** Where these coordinates came from: `memo` is the one on screen; `cache` is this structure's last result in the local cache (localStorage);
   *  `solved` was solved just now. */
  source: 'memo' | 'cache' | 'solved';
}

/* ── Content hash + localStorage cache ─────────────────────────────────────── */

// v3: attached layers no longer have two placements ("outer ring / right above"); outer ring entries in old caches are void.
const CACHE_PREFIX = 'gb:pos:v3:';
// Layers / planes / folding / layout multiply into a big key space; keep too few and it thrashes.
const CACHE_KEEP = 16;

/**
 * **This graph's identity = its structure.** Three things, nothing else: which nodes exist, who each one's parent is, which edges carry force.
 *
 * It used to be `JSON.stringify(elements)`, which counted the big `data.detail` blob and **edges that carry no force**.
 * The result was not "computing once more" but **a wrong result**: when details changed, or a few hundred
 * render-only dependency edges appeared, the hash changed, the cache missed, layout ran again; and the divide-and-conquer assembly recentres by component
 * bounding boxes, so a tiny drift inside the force layout was amplified into **a translation / rotation of the whole graph**. It looked like "nothing
 * changed, yet the graph did a somersault".
 *
 * Narrowing to "structure + size" helped for a while, but **size should not be identity either**. Measured once: a step that only filled in placeholder
 * content (the `unfilled` flag dropped), with not a character of structure or labels changed, still changed the **skin** of 79 nodes
 * → measured sizes changed → the hash changed → the cache returned **another free solve** under **another key**
 * → the whole graph moved (measured median 1246, while the reading said "layout 0 ms": it did not re-solve at all, it just
 * swapped in other coordinates).
 *
 * And sizes are measured on **the union**, which is a product of the transition: the same step2 reached from step1 and from
 * step3 are two different instances. So the claim "a free solve does not depend on how you got here" was false for sizes:
 * the first switch between two versions somersaulted, later ones did not, because the union's makeup was
 * fixed from then on. **That is how path dependence crept into a solve that claims to be path independent.**
 *
 * So size only affects **how to solve** (force must avoid by real sizes, see `_w`/`_h`), never **is this
 * the same input**. The cost, stated openly: after labels get longer the old coordinates are kept and things may be a bit tight; but "the data did not change,
 * yet the graph moved a lot" is far worse than "a bit tight", and this project stands on the "do not move" side from start to finish.
 */
function shapeHash(elements: CyElement[], salt: string): string {
  const parts: string[] = [];
  for (const el of elements) {
    if (el.data.source) {
      if (el.data._force === false) continue;      // render only, no force → does not affect coordinates
      parts.push(`E ${el.data.source}>${el.data.target}`);
    } else {
      parts.push(`N ${el.data.id}|${el.data.parent ?? ''}|${el.data._struct === false ? 'a' : 's'}`);
    }
  }
  parts.sort();
  const s = parts.join('\n') + '|' + salt;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + '-' + s.length.toString(36);
}

function cacheGet(hash: string): Positions | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + hash);
    return raw ? (JSON.parse(raw).pos as Positions) : null;
  } catch { return null; }
}

function cachePut(hash: string, pos: Positions) {
  try {
    const entries: { key: string; t: number }[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      if (!key.startsWith(CACHE_PREFIX)) continue;
      try { entries.push({ key, t: JSON.parse(localStorage.getItem(key)!).t ?? 0 }); }
      catch { entries.push({ key, t: 0 }); }
    }
    entries.sort((a, b) => b.t - a.t);
    for (const e of entries.slice(CACHE_KEEP - 1)) localStorage.removeItem(e.key);
    localStorage.setItem(CACHE_PREFIX + hash, JSON.stringify({ t: Date.now(), pos }));
  } catch { /* quota full / storage blocked on file:// → no cache, nothing else affected */ }
}

/* ── Divide and conquer ─────────────────────────────────────────────────────────────── */

/** Strip the detail payload (layout does not use it, it can be big), restore the virtual root parent, attach measured sizes and seed coordinates. */
function toJobNode(n: CyElement, dims: LayoutRequest['dims'], seed?: Positions) {
  const id = n.data.id as string;
  const d = dims[id];
  const p = seed?.[id];
  return {
    data: {
      ...n.data, detail: undefined,
      parent: n.data.parent === VIRTUAL_ROOT ? undefined : n.data.parent,
      ...(d ? { _w: d.w, _h: d.h } : {}),
    },
    classes: n.classes,
    ...(p ? { position: { x: p.x, y: p.y } } : {}),
  };
}

async function runDivide(req: LayoutRequest, aborted: () => boolean): Promise<Positions> {
  const { components: comps, compOf, attached } = partitionElements(req.elements);
  if (comps.length === 0) return {};
  const total = comps.length + 1; // +1 = the coarse graph pass
  let done = 0;
  req.onProgress?.(0, total);

  const touchesAttached = (e: CyElement) =>
    attached.has(e.data.source as string) || attached.has(e.data.target as string);

  // In mixed components (structure + attached), take the attached nodes and their edges out first and place them after layout; purely attached components
  // are still tiled as a batch.
  const jobs = comps.map((c, i) => {
    const mixed = c.nodes.some((n) => attached.has(n.data.id as string))
      && c.nodes.some((n) => !attached.has(n.data.id as string));
    return {
      jobId: i,
      elements: [
        ...c.nodes.filter((n) => !(mixed && attached.has(n.data.id as string))).map((n) => toJobNode(n, req.dims, req.seed)),
        ...c.edges.filter((e) => !(mixed && touchesAttached(e))).map((e) => ({ data: e.data, classes: e.classes })),
      ],
      layoutName: req.layoutName,
    };
  });

  const nWorkers = Math.max(1, Math.min(4, (globalThis.navigator?.hardwareConcurrency || 4) - 1, jobs.length));
  const runners = req.pool(nWorkers);
  const byKey = new Map<string, LayoutJobResult>();

  try {
    // Stage 1: lay out components in parallel.
    let next = 0;
    await Promise.all(runners.map(async (w) => {
      while (next < jobs.length) {
        if (aborted()) throw new Error('superseded');
        const i = next++;
        byKey.set(comps[i].key, await w.run(jobs[i]));
        req.onProgress?.(++done, total);
      }
    }));

    // Stage 1.5: place attached layers. Anchor = the centroid of the structure nodes it connects to, placed right on that centroid (raised to 2.5D the
    // links between layers are nearly vertical; flattened it is never present together with the structure layer, so overlapping does no harm). The bounding box grows accordingly.
    const nbr = new Map<string, string[]>();
    for (const el of req.elements) {
      if (!el.data.source || !touchesAttached(el)) continue;
      const s = el.data.source as string, t = el.data.target as string;
      for (const [a, b] of [[s, t], [t, s]] as const) {
        const arr = nbr.get(a); arr ? arr.push(b) : nbr.set(a, [b]);
      }
    }
    for (const c of comps) {
      const items0 = c.nodes.filter((n) => attached.has(n.data.id as string));
      if (!items0.length || items0.length === c.nodes.length) continue;
      const r = byKey.get(c.key)!;
      const items: AttachedItem[] = items0.map((n) => {
        const id = n.data.id as string;
        const pts = (nbr.get(id) ?? []).map((x) => r.positions[x]).filter(Boolean);
        const anchor = pts.length
          ? { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length }
          : null;
        const d = req.dims[id] ?? { w: 90, h: 30 };
        return { id, w: d.w, h: d.h, anchor };
      });
      const placed = placeAttached(items, r.bbox);
      Object.assign(r.positions, placed);
      let { x1, y1 } = r.bbox;
      let x2 = r.bbox.x1 + r.bbox.w, y2 = r.bbox.y1 + r.bbox.h;
      for (const it of items) {
        const p = placed[it.id];
        x1 = Math.min(x1, p.x - it.w / 2); y1 = Math.min(y1, p.y - it.h / 2);
        x2 = Math.max(x2, p.x + it.w / 2); y2 = Math.max(y2, p.y + it.h / 2);
      }
      r.bbox = { x1, y1, w: x2 - x1, h: y2 - y1 };
    }

    // Stage 2: second pass on the coarse graph. Super node size = component bounding box; edge length scaled by average box size:
    // share-driven forces are node-scale and too short for giant boxes, which would all pile up.
    const rootDims = req.elements.some((e) => e.data.id === VIRTUAL_ROOT && !e.data.source) && req.dims[VIRTUAL_ROOT]
      ? req.dims[VIRTUAL_ROOT] : undefined;
    const coarseEls = buildCoarseElements(comps, compOf, req.elements, (k) => byKey.get(k)!.bbox, rootDims);
    const avgSize = comps.reduce((s, c) => { const b = byKey.get(c.key)!.bbox; return s + (b.w + b.h) / 2; }, 0) / comps.length;
    const coarse = await runners[0].run({
      jobId: -1, elements: coarseEls, layoutName: req.layoutName,
      opts: { idealEdgeLength: Math.round(avgSize * 0.9) + 100, nodeRepulsion: 60000, nodeSep: 80, rankSep: Math.round(avgSize) },
    });
    req.onProgress?.(++done, total);

    /* Stage 3: translate and assemble. **The seed must survive this step**, or everything before was wasted: this step normalizes each component by its own
     * bounding box and translates it to the center the coarse graph gives, so however stable a component is inside it gets moved as a whole.
     * Components whose members mostly have seeds go back to **their own seed's bounding box center** (box center rather than centroid,
     * because normalization uses the box, and only when both are aligned is the result exactly the seed). */
    const seed = req.seed;
    const anchor = new Map<string, { x: number; y: number }>();
    if (seed) {
      for (const c of comps) {
        let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity, k = 0;
        for (const el of c.nodes) {
          const p = seed[el.data.id as string];
          if (!p) continue;
          k++; x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y);
          x2 = Math.max(x2, p.x); y2 = Math.max(y2, p.y);
        }
        if (k > 0 && k * 2 >= c.nodes.length) anchor.set(c.key, { x: (x1 + x2) / 2, y: (y1 + y2) / 2 });
      }
    }
    // Components without seeds (new this time) are still placed by the coarse graph, but must be translated into the same coordinate system.
    let ddx = 0, ddy = 0, nSeeded = 0;
    for (const [key, sc] of anchor) {
      const p = coarse.positions[key];
      if (!p) continue;
      ddx += sc.x - p.x; ddy += sc.y - p.y; nSeeded++;
    }
    if (nSeeded) { ddx /= nSeeded; ddy /= nSeeded; }
    const placeOf = (key: string) => {
      const sc = anchor.get(key);
      if (sc) return sc;
      const p = coarse.positions[key];
      return { x: p.x + ddx, y: p.y + ddy };
    };

    const boxes: Box[] = comps.map((c) => {
      const b = byKey.get(c.key)!.bbox;
      const p = placeOf(c.key);
      return { key: c.key, w: Math.max(b.w, 1), h: Math.max(b.h, 1), x: p.x, y: p.y };
    });
    if (rootDims) {
      const p = placeOf(VIRTUAL_ROOT);
      boxes.push({ key: VIRTUAL_ROOT, w: rootDims.w, h: rootDims.h, x: p.x, y: p.y });
    }
    /* With seeds, components go back to their seed centers, while in this step a component may have grown, or gathered members scattered before into
     * one new component (centered at their average, often the middle of the graph), overlapping a neighbor. A free solve has no such problem:
     * the coarse graph's force keeps them apart. So push apart only with seeds. */
    resolveOverlaps(boxes, { gap: 60, enabled: anchor.size > 0 });
    const centreOf = new Map(boxes.map((b) => [b.key, b]));
    const out: Positions = {};
    for (const c of comps) {
      const { positions, bbox } = byKey.get(c.key)!;
      const cb = centreOf.get(c.key)!;
      for (const [id, p] of Object.entries(positions)) {
        out[id] = { x: p.x - bbox.x1 + cb.x - bbox.w / 2, y: p.y - bbox.y1 + cb.y - bbox.h / 2 };
      }
    }
    if (rootDims) {
      // The virtual root sits at **its children's centroid**. Same reasoning as "a compound parent box's position is derived from its children":
      // synthesized things should have no opinion of their own. So it naturally follows the structure: two trees merge into one,
      // and the root moves to the new center by itself.
      const kids: { x: number; y: number }[] = [];
      for (const el of req.elements) {
        if (el.data.source !== VIRTUAL_ROOT) continue;
        const p = out[el.data.target as string];
        if (p) kids.push(p);
      }
      out[VIRTUAL_ROOT] = kids.length
        ? { x: kids.reduce((a, p) => a + p.x, 0) / kids.length, y: kids.reduce((a, p) => a + p.y, 0) / kids.length }
        : centreOf.get(VIRTUAL_ROOT)!;
    }
    return out;
  } finally {
    for (const w of runners) w.dispose();
  }
}

/* ── Whole mode: the whole graph to one path at once (for comparison / evaluation) ───────────────────── */

async function runWhole(req: LayoutRequest, aborted: () => boolean): Promise<Positions> {
  req.onProgress?.(0, 1);
  if (aborted()) throw new Error('superseded');
  const nodes: unknown[] = [], edges: unknown[] = [];
  for (const el of req.elements) {
    if (el.data.source) { if (el.data._force !== false) edges.push({ data: el.data, classes: el.classes }); }
    else {
      const d = req.dims[el.data.id as string];
      nodes.push({
        data: { ...el.data, detail: undefined, ...(d ? { _w: d.w, _h: d.h } : {}) },
        classes: el.classes,
      });
    }
  }
  const [runner] = req.pool(1);
  try {
    const r = await runner.run({ jobId: 0, elements: [...nodes, ...edges], layoutName: req.layoutName });
    req.onProgress?.(1, 1);
    return r.positions;
  } finally {
    runner.dispose();
  }
}

/* ── Single-flight jobs + new supersedes old ─────────────────────────────────────────────── */

/**
 * **The same layout input is solved once.**
 *
 * Force layouts have no reproducible fixed point: the same input solved twice gives two different arrangements, and quite different
 * (measured: the same 191 nodes, same parents and force edges, one re-solve moved a median of 512). So
 * "the data did not change, yet the graph moved a lot again" was inevitable, and a bigger iteration budget only makes it worse, drifting further.
 *
 * So the criterion is not "has it converged enough" but **do not re-solve at all**: remember which input produced the result
 * last actually delivered, and if the input is unchanged hand that back as is.
 *
 * The difference from the localStorage cache matters: that one is cross-session and context-free, and its entry
 * may have been solved in a completely different context; using it in place of what is on screen is a teleport. This one
 * **is what is on screen**, so reusing it is continuous by nature.
 */
const lastByNs = new Map<string, { hash: string; pos: Positions }>();

/** Runs in flight, one per owner. `stale`: a run that finished after the cache was cleared; its result goes to whoever waits for it
 *  as usual but is not written back to the cache. */
type Run = { hash: string; promise: Promise<Positions>; superseded: boolean; stale?: boolean };
const inflight = new Map<unknown, Run>();

export function computeLayout(req: LayoutRequest): Promise<LayoutResult> {
  const mode = req.mode ?? 'divide';
  const salt = `${req.layoutName}|${mode}|${req.namespace ?? ''}|${req.variant ?? ''}`;
  const hash = shapeHash(req.elements, salt);
  const finish = (source: LayoutResult['source']) => (pos: Positions): LayoutResult => ({ positions: pos, source });

  // Same input = what is on screen: hand it back, not one coordinate moves.
  const ns = req.namespace ?? '';
  const memo = lastByNs.get(ns);
  if (!req.force && memo && memo.hash === hash) return Promise.resolve(finish('memo')(memo.pos));

  /* **Cache before seed.** The cache holds "the latest result for this structure and solving mode (variant) on this machine",
   * including relayouts the user pressed. So the same structure coming a second time is the same graph whichever version it came from: the seed only decides
   * **the first time**, it does not drift a bit with every pass. For a different one, `force`. */
  if (!req.force) {
    const hit = cacheGet(hash);
    if (hit) { lastByNs.set(ns, { hash, pos: hit }); return Promise.resolve(finish('cache')(hit)); }
    for (const r of inflight.values()) if (r.hash === hash) return r.promise.then(finish('solved'));
  }
  const owner = req.owner ?? ns;
  const current = inflight.get(owner);
  if (current) current.superseded = true;

  const run: Run = { hash, superseded: false, promise: null as unknown as Promise<Positions> };
  const runner = mode === 'whole' ? runWhole : runDivide;
  run.promise = runner(req, () => run.superseded)
    .then((pos) => {
      if (!run.stale) { cachePut(hash, pos); lastByNs.set(ns, { hash, pos }); }
      return pos;
    })
    .finally(() => { if (inflight.get(owner) === run) inflight.delete(owner); });
  inflight.set(owner, run);
  return run.promise.then(finish('solved'));
}

/** Clear the local layout cache (every glassbrain layout in localStorage, plus the in-memory record of "what is on screen").
 *  After that, layouts come from: the host's `layout` → solving. */
export function clearLayoutCache() {
  lastByNs.clear();
  // A run in progress is not interrupted (the canvas waits for it); it just must not write back when it finishes.
  for (const r of inflight.values()) r.stale = true;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(CACHE_PREFIX)) localStorage.removeItem(key);
    }
  } catch { /* storage blocked → there was none anyway */ }
}

export type { LayoutName, Plate, Positions };
