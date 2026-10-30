/* glassbrain build: esbuild emits ESM, tsc emits .d.ts (see build in package.json).
 *
 * Two passes, not for tidiness: two places break silently and each needs a pass of its own:
 *
 * ① 'use client': esbuild drops directive prologues as ordinary strings. The three React entries must
 *    carry it into node_modules, or hosts importing them from a server component get an error, and the error
 *    points at the host's file, not here. check-dist.mjs asserts it after the build.
 * ② worker: the worker entry is a separate pass **without code splitting**. A split worker
 *    carries relative imports, and `new Worker(url)` is a classic worker that fails to load without a bundler
 *    to help. cytoscape is still external: the bundler (webpack/Vite) reparses this entry as a
 *    worker chunk, and this path requires the host to have a bundler anyway.
 */
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });

/** Peer dependencies are always external: the library does not bundle what the host already installed. */
const external = [
  'react', 'react/jsx-runtime', 'react-dom',
  'cytoscape', 'cytoscape-fcose', 'cytoscape-cose-bilkent',
];
const common = {
  bundle: true, format: 'esm', platform: 'browser', target: ['es2020'],
  jsx: 'automatic', outbase: 'src', outdir: 'dist', external, logLevel: 'info',
  absWorkingDir: root,
};

// ① main: shared code goes to chunks/, entries never duplicate each other
await esbuild.build({
  ...common,
  entryPoints: [
    'src/index.ts',
    'src/core.ts',
    'src/internal.ts',
    'src/react/GraphCanvas.tsx',
    'src/react/DetailPanel.tsx',
    'src/layout/worker-pool.ts',
    'src/layout/inline-pool.ts',
  ],
  splitting: true,
  chunkNames: 'chunks/[name]-[hash]',
  entryNames: '[dir]/[name]',
});

// ② worker: self-contained, not split
await esbuild.build({
  ...common,
  entryPoints: ['src/layout/worker.ts'],
  splitting: false,
  entryNames: '[dir]/[name]',
});

// ③ put back the 'use client' esbuild dropped (only on entries that really are client side)
const CLIENT_ENTRIES = ['index.js', 'internal.js', 'react/GraphCanvas.js', 'react/DetailPanel.js'];
for (const rel of CLIENT_ENTRIES) {
  const f = path.join(dist, rel);
  const src = fs.readFileSync(f, 'utf8');
  if (!src.startsWith("'use client'")) fs.writeFileSync(f, `'use client';\n${src}`);
}
console.log(`\n'use client' restored: ${CLIENT_ENTRIES.join(', ')}`);
