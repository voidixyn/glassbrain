/* glassbrain · worker execution path (browser + bundler: Next/webpack, Vite)
 * A separate file so that **the main bundle does not statically import cytoscape**: it lives only in the worker chunk. */
import type { LayoutJob, LayoutRunner, LayoutRunnerPool } from './run-job';

export const workerPool: LayoutRunnerPool = (n) =>
  Array.from({ length: n }, () => {
    // An ES module worker: worker.js imports cytoscape, and bundlers (Vite, webpack 5) only resolve that for `type: 'module'`.
    const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    return {
      run: (job: LayoutJob) => new Promise<any>((resolve, reject) => {
        w.onmessage = (ev) => (ev.data?.error ? reject(new Error(ev.data.error)) : resolve(ev.data));
        w.onerror = (e) => reject(new Error(e.message || 'glassbrain layout worker error'));
        w.postMessage(job);
      }),
      dispose: () => w.terminate(),
    } satisfies LayoutRunner;
  });
