/* The README keeps relative links, so it reads right in the repository and in any local preview. npm shows the README
 * outside the repository, where relative links break, so the packed copy gets absolute ones:
 *
 *   node scripts/readme-links.mjs absolute   (prepack: README.md → absolute links, the original kept aside)
 *   node scripts/readme-links.mjs restore    (postpack: put the original back)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const readme = path.join(root, 'README.md');
const saved = path.join(root, '.README.md.orig');
const REPO = 'voidixyn/glassbrain';
const BRANCH = 'main';

if (process.argv[2] === 'restore') {
  if (fs.existsSync(saved)) fs.renameSync(saved, readme);
} else if (process.argv[2] === 'absolute') {
  const text = fs.readFileSync(readme, 'utf8');
  if (!fs.existsSync(saved)) fs.writeFileSync(saved, text);
  // ![alt](rel) → raw file; [text](rel) → GitHub page. Leaves http(s):, mailto:, #anchors and code alone.
  const out = text.split(/(```[\s\S]*?```)/).map((part, i) => i % 2 ? part : part.replace(
    /(!?)\[([^\]]*)\]\((?!https?:|mailto:|#)([^)\s]+)\)/g,
    (_, bang, label, href) => `${bang}[${label}](${bang ? `https://raw.githubusercontent.com/${REPO}/${BRANCH}` : `https://github.com/${REPO}/blob/${BRANCH}`}/${href.replace(/^\.\//, '')})`,
  )).join('');
  fs.writeFileSync(readme, out);
} else {
  console.error('usage: node scripts/readme-links.mjs absolute|restore');
  process.exit(2);
}
