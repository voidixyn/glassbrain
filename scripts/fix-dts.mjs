/* After tsc: give every relative import in dist/**\/*.d.ts its real file name (`./model` → `./model.js`, `./layout` → `./layout/index.js`).
 *
 * The package is `"type": "module"`, and under `moduleResolution: node16 / nodenext` TypeScript resolves declaration imports the
 * way Node resolves modules: without an extension `import { parseSources } from 'glassbrain'` finds no exports at all.
 * With `bundler` resolution both forms work, so this changes nothing for bundler users. check-dist.mjs verifies it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'dist');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
let changed = 0;
for (const file of walk(dist).filter((f) => f.endsWith('.d.ts'))) {
  const dir = path.dirname(file);
  const src = fs.readFileSync(file, 'utf8');
  const out = src.replace(/((?:from|import)\s*\(?\s*['"])(\.{1,2}\/[^'"]*?)(['"])/g, (m, a, spec, b) => {
    if (/\.(js|json|d\.ts)$/.test(spec)) return m;
    if (fs.existsSync(path.join(dir, `${spec}.d.ts`))) return `${a}${spec}.js${b}`;
    if (fs.existsSync(path.join(dir, spec, 'index.d.ts'))) return `${a}${spec}/index.js${b}`;
    return m;
  });
  if (out !== src) { fs.writeFileSync(file, out); changed++; }
}
console.log(`d.ts: relative imports given extensions in ${changed} files`);
