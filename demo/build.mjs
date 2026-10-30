/* demo bundle: one self-contained index.html, double-click to open, no server needed.
 *
 * Data is inlined in the page (`window.__GB_DATA__`), because under `file://` fetching files from the same folder
 * is rejected as cross-origin; likewise **main-thread layout must work**, so the page picks its own pool.
 * When the demo runs over http it uses workerPool (multiple cores, main thread stays free); see index.tsx.
 *
 *   node demo/build.mjs            → demo/dist/index.html      to look at locally: everything under data/demo/
 *   node demo/build.mjs --public   → demo/dist/public.html     to publish: the allowlist only
 *
 * **The public build only trusts the allowlist, not .gitignore.** Whatever you keep in data/demo/ locally (your own data, never
 * committed) a full build inlines into the page word for word. So the published one takes only the datasets named below:
 * a new publishable dataset must be named here.
 */
const PUBLIC = ['boards', 'agent-stack', 'flask', 'agent-plan', 'how-agents-work', 'citations', 'graphify-flask', 'mcp-wiki', 'glassbrain-src'];
const isPublic = process.argv.includes('--public');
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'demo/dist');
fs.mkdirSync(out, { recursive: true });

/* Data = <project>/<version>/**.json under data/demo/ (a project root may have a _profile.json), plus diffable.json.
 * Adding data only takes another folder (registered in diffable.json if needed); this script does not change.
 * A local diffable.local.json (groups for local data) and demo/host.local.ts (see host.ts) join the full build only. */
const root_demo = path.join(root, 'data/demo');
const data = {};
const walk = (dir, rel = '') => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(abs, r);
    // .jsonl / .md only inside a version folder (another tool's format, see below), never a project's RUN.md
    else if (e.name.endsWith('.json') || (/\.(jsonl|md)$/.test(e.name) && r.split('/').length > 2)) data[r] = fs.readFileSync(abs, 'utf8');
  }
};
walk(root_demo);

/* A project whose `_profile.json` says `"demo": { "convert": true }` ships in another tool's format (Graphify's graph.json, an MCP
 * memory.jsonl, a folder of markdown notes), as that tool wrote it, and is converted here by the same adapters the CLI uses. The
 * adapter's profile goes under the project's own `_profile.json` (which then only needs its `demo` block). Opt-in, so data that a
 * host profile parses is never second-guessed. */
const { adapt } = await import('data:text/javascript;base64,' + Buffer.from((await esbuild.build({
  entryPoints: [path.join(root, 'adapters/index.ts')], bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent',
})).outputFiles[0].text).toString('base64'));
for (const v of new Set(Object.keys(data).filter((p) => p.split('/').length > 2).map((p) => p.split('/').slice(0, 2).join('/')))) {
  const keys = Object.keys(data).filter((p) => p.startsWith(v + '/'));
  const convert = (() => { try { return JSON.parse(data[`${v.split('/')[0]}/_profile.json`] ?? '{}').demo?.convert === true; } catch { return false; } })();
  const res = convert ? adapt(keys.map((k) => ({ path: k.slice(v.length + 1), text: data[k] }))) : { adapter: null };
  if (!res.adapter) { for (const k of keys) if (!k.endsWith('.json')) delete data[k]; continue; }
  for (const k of keys) delete data[k];
  for (const s of res.sources) data[`${v}/${s.origin.replace(/\.(jsonl|md)$/, '.json')}`] = s.text;
  const proj = v.split('/')[0];
  const own = JSON.parse(data[`${proj}/_profile.json`] ?? '{}');
  data[`${proj}/_profile.json`] = JSON.stringify({ ...res.profile, ...own, demo: { ...own.demo, convert: undefined } });
  console.log(`${v}: read as ${res.adapter.label}`);
}
let diffable = [...JSON.parse(data['diffable.json'] ?? '[]'), ...(isPublic ? [] : JSON.parse(data['diffable.local.json'] ?? '[]'))];
delete data['diffable.json'];
delete data['diffable.local.json'];
if (isPublic) {
  for (const k of Object.keys(data)) if (!PUBLIC.includes(k.split('/')[0])) delete data[k];
  diffable = diffable.filter((g) => g.every((v) => PUBLIC.includes(v.split('/')[0])));
}

// `_profile.json` at a project root is not a version (see profileOf in index.tsx).
const versions = [...new Set(Object.keys(data).filter((p) => p.split('/').length > 2).map((p) => p.split('/').slice(0, 2).join('/')))];
if (!versions.length) throw new Error('no data at all under data/demo/');
// A diffable entry pointing at a missing folder is the easiest thing to miss: forgetting to sync after a rename only drops a few
// candidates in the UI, without an error. Stop it at build time.
for (const g of diffable) for (const v of g) {
  if (!versions.includes(v)) throw new Error(`diffable.json points to a missing version: ${v}`);
}

const dataBytes = Buffer.byteLength(JSON.stringify(data));

/* The library comes from src (demo and library live in one repository; change a line of the library and a reload shows it, no build first). */
const localHost = path.join(root, 'demo/host.local.ts');
const useLocalHost = !isPublic && fs.existsSync(localHost);
const hostPlugin = {
  name: 'local-host',
  setup(b) { b.onResolve({ filter: /^\.\/host$/ }, (a) => (useLocalHost && a.importer.endsWith('index.tsx') ? { path: localHost } : undefined)); },
};
const bundle = await esbuild.build({
  entryPoints: [path.join(root, 'demo/index.tsx')],
  bundle: true, write: false, format: 'iife', jsx: 'automatic',
  minify: true, target: ['es2020'], logLevel: 'info', legalComments: 'eof',
  define: { 'process.env.NODE_ENV': '"production"' },
  alias: { glassbrain: path.join(root, 'src') },
  absWorkingDir: root,
  plugins: [hostPlugin],
});
const js = bundle.outputFiles[0].text;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>glassbrain</title>
</head><body><div id="root"></div>
<script>
window.__GB_DATA__=${JSON.stringify(data).replace(/</g, '\\u003c')};
window.__GB_DIFFABLE__=${JSON.stringify(diffable).replace(/</g, '\\u003c')};
</script>
<script>${js.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--')}</script>
</body></html>`;

const file = isPublic ? 'public.html' : 'index.html';
fs.writeFileSync(path.join(out, file), html);
const mb = (n) => (n / 1024 / 1024).toFixed(2) + ' MB';
console.log(`\ndemo/dist/${file}  ${mb(Buffer.byteLength(html))}  (data ${mb(dataBytes)} · code ${mb(Buffer.byteLength(js))})`);
console.log(`${versions.length} versions · ${Object.keys(data).length} json files · ${diffable.length} diffable groups`);
for (const v of versions) console.log(`  ${v}`);
