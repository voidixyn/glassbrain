/* glassbrain · one layout computation (pure geometry, no profile, no DOM)
 *
 * This is **the same** implementation shared by the worker and inline main-thread paths, so "worker online,
 * main thread offline (file:// forbids workers)" give exactly the same results, with no drift.
 */
import cytoscape from 'cytoscape';
import coseBilkent from 'cytoscape-cose-bilkent';
import { LAYOUTS, type LayoutName } from './presets';

let registered = false;
function ensurePlugins() {
  if (registered) return;
  cytoscape.use(coseBilkent as any);
  registered = true;
}

// Layout only needs geometry: leaf sizes are measured on the main thread and passed in as _w/_h, compound padding matches the real
// stylesheet; colors / labels have nothing to do with coordinates and are not carried.
const GEOMETRY_STYLE: any[] = [
  { selector: 'node[_w]', style: { width: 'data(_w)', height: 'data(_h)', shape: 'rectangle' } },
  { selector: 'node', style: { padding: '8px' } },
  { selector: 'node.container', style: { padding: '14px' } },
];

export interface LayoutJob {
  jobId: number;
  /** Elements may carry `position`: the force layout uses it as the start, see seeded below. */
  elements: any[];
  layoutName: LayoutName;
  /** Override layout parameters (for the coarse graph pass). Only structured-cloneable values. */
  opts?: Record<string, unknown>;
}
export interface LayoutJobResult {
  jobId: number;
  positions: Record<string, { x: number; y: number }>;
  bbox: { x1: number; y1: number; w: number; h: number };
}

/** Fallback time limit: when a layout plugin blows up inside its own tick, `layoutstop` never arrives.
 *  Loosened by node count: it is a fuse, not a strategy. */
const watchdogMs = (n: number) => Math.max(20000, n * 60);

export function runLayoutJob(job: LayoutJob): Promise<LayoutJobResult> {
  ensurePlugins();
  return new Promise((resolve, reject) => {
    // Bad elements make the constructor throw: that is a rejection the pools pass on, never a promise left hanging.
    let cy: any;
    try { cy = cytoscape({ headless: true, styleEnabled: true, elements: job.elements, style: GEOMETRY_STYLE }); }
    catch (err) { reject(err); return; }
    /**
     * **This Promise must settle, no matter what.**
     *
     * Layout plugins throw inside their own tick (measured: cose-bilkent throws `RangeError: Invalid array length`
     * for `numIter < 400`; fcose throws for a `fixedNodeConstraint` with missing endpoints
     * too). That throw is **asynchronous**: it does not go through the try below, it just makes `layoutstop` never arrive.
     * So `computeLayout`'s await never returns, the canvas is stuck on "Preparing layout" from then on, and **no
     * error path is ever taken**: not crashed, stuck.
     *
     * So the fallback is not optional. On a blow-up, **hand the seed back as is**: "could not lay it out better" is an honest
     * answer; "the whole canvas never responds again" is not.
     */
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      const positions: LayoutJobResult['positions'] = {};
      cy.nodes().forEach((n: any) => { positions[n.id()] = { x: n.position('x'), y: n.position('y') }; });
      const bb = cy.elements().boundingBox();
      resolve({ jobId: job.jobId, positions, bbox: { x1: bb.x1, y1: bb.y1, w: bb.w, h: bb.h } });
      cy.destroy();
    };
    const guard = setTimeout(finish, watchdogMs(job.elements.length));
    // With coordinates, do not randomize again: randomize:true throws the seed away, and what the animation sees
    // is "the same nodes relaid out, darting around everywhere".
    const seeded = job.elements.some((el: any) => el.position);
    // animate/fit are renderer concepts and must be off headless.
    const opts = {
      ...LAYOUTS[job.layoutName].opts, ...job.opts,
      // Only random initialization is turned off, **no iteration budget is added**: force has no reproducible fixed point, and more iterations
      // drift further from the seed (measured: raising numIter from 1200 to 4000 changed re-solves of the same input from a median of 5
      // to 623). "Solve until converged" is a dead end; the right approach is not re-solving the same input at all,
      // see lastByNs in engine.ts.
      ...(seeded ? { randomize: false } : {}),
      animate: false, fit: false,
    };
    try {
      const layout = cy.layout(opts);
      layout.one('layoutstop', finish);
      layout.run();
    } catch { finish(); }     // thrown synchronously (unknown parameters and such): hand the seed back now, do not wait for the fallback timer
  });
}

/** An executor that runs one job once. The worker pool / inline main thread each provide one. */
export type LayoutRunner = {
  run(job: LayoutJob): Promise<LayoutJobResult>;
  dispose(): void;
};
/** Make n parallel execution paths. The inline implementation ignores n (the main thread has only one). */
export type LayoutRunnerPool = (n: number) => LayoutRunner[];
