/* glassbrain · main-thread execution path
 *
 * **Offline exports must use it**: under file:// browsers reject `new Worker()` as cross-origin outright, so the worker
 * path is unusable in an offline single page. It runs the same runLayoutJob, with results identical to the worker's.
 */
import { runLayoutJob, type LayoutRunnerPool } from './run-job';

export const inlinePool: LayoutRunnerPool = () => [{
  // Yield a frame between jobs, so the page does not freeze completely while a long graph is laid out.
  run: (job) => new Promise((resolve, reject) => { setTimeout(() => { runLayoutJob(job).then(resolve, reject); }, 0); }),
  dispose: () => {},
}];
