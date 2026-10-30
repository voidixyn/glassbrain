/* glassbrain · layout worker: one message in, one message out. The computation is in run-job.ts. */
import { runLayoutJob, type LayoutJob } from './run-job';

self.onmessage = (ev: MessageEvent<LayoutJob>) => {
  runLayoutJob(ev.data).then(
    (r) => (self as any).postMessage(r),
    (err) => (self as any).postMessage({ jobId: ev.data.jobId, error: String(err?.message ?? err) }),
  );
};
