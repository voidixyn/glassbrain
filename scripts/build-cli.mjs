/* Build for the CLI and adapters: runs after scripts/build.mjs (which clears dist first).
 *
 *   dist/cli/glassbrain.js   node entry (bin), bundling the pure modules it uses from src, zero runtime dependencies
 *   dist/cli/viewer.js   the browser page bundle: react and cytoscape bundled in (people running `npx glassbrain`
 *                        have not installed them), IIFE, minified, inlined by the CLI into the generated html
 *   dist/adapters.js     `glassbrain/adapters`: pure functions, usable directly in a host's own pages too
 */
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const common = { bundle: true, absWorkingDir: root, logLevel: 'warning', target: ['es2020'] };

await esbuild.build({
  ...common,
  entryPoints: ['cli/glassbrain.ts'],
  outfile: 'dist/cli/glassbrain.js',
  platform: 'node', format: 'esm', target: ['node18'],
  banner: { js: '#!/usr/bin/env node' },
});
fs.chmodSync(path.join(root, 'dist/cli/glassbrain.js'), 0o755);

await esbuild.build({
  ...common,
  entryPoints: ['cli/viewer.tsx'],
  outfile: 'dist/cli/viewer.js',
  platform: 'browser', format: 'iife', jsx: 'automatic', minify: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  // react, cytoscape and the layout plugins are bundled in: their license headers travel with them (and into every page).
  legalComments: 'eof',
});

await esbuild.build({
  ...common,
  entryPoints: ['adapters/index.ts'],
  outfile: 'dist/adapters.js',
  platform: 'neutral', format: 'esm',
});

const size = (rel) => `${(fs.statSync(path.join(root, rel)).size / 1024).toFixed(0)} KB`;
console.log(`cli: dist/cli/glassbrain.js ${size('dist/cli/glassbrain.js')} · dist/cli/viewer.js ${size('dist/cli/viewer.js')} · dist/adapters.js ${size('dist/adapters.js')}`);
