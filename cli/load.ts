/* CLI · reading input
 *
 * An argument can be:
 *   a file           graph.json / memory.jsonl / knowledge-graph.json …
 *   a folder         its json files merge into one graph; all markdown means a notes vault;
 *                    no data at the root, only a few subfolders holding json = several versions (sorted by name)
 *   <git ref>:<path> HEAD~1:graph.json, main:data/kg: take that version from git without checking it out
 *
 * Once read, everything goes to the adapters to detect the format, and comes out as glassbrain's own sources.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { adapt } from '../adapters/index';
import type { InputFile } from '../adapters/common';

export interface Version { name: string; sources: { origin: string; text: string }[] }
export interface Loaded {
  title: string;
  versions: Version[];
  /** `_profile.json`, else the one the adapter suggests, else null (the library default). */
  profile: Record<string, unknown> | null;
  /** `_layout.json`: version name → coordinates. */
  layouts: Record<string, Record<string, { x: number; y: number }>> | null;
  /** Which format it was recognized as ('native' = glassbrain's own `{nodes, edges}`). */
  format: string;
  /** `_profile.json` / `_layout.json` that could not be read: reported by validate, otherwise ignored (the library defaults apply). */
  metaErrors: { file: string; message: string }[];
  /** Files that were found but not read (e.g. a README next to the versions, or files another format's folder does not use). */
  ignored: string[];
  /** The raw files (validate checks each against the schema). */
  raw: { version: string; files: InputFile[] }[];
}

const DATA = /\.(json|jsonl|md)$/i;
const MAX_FILES = 20_000;
/** Directories starting with a dot are always skipped (.git, .obsidian config…), except these two that hold other tools' graphs. */
const DOT_OK = new Set(['.ua', '.understand-anything']);
const SKIP_DIR = new Set(['node_modules', '.git']);

interface Tree { files: InputFile[]; title: string; isDir: boolean }

export function readSpec(spec: string, cwd = process.cwd()): Tree {
  const abs = path.resolve(cwd, spec);
  if (fs.existsSync(abs)) {
    const title = path.basename(abs);
    if (fs.statSync(abs).isFile()) return { files: [{ path: path.basename(abs), text: fs.readFileSync(abs, 'utf8') }], title, isDir: false };
    return { files: walk(abs), title, isDir: true };
  }
  const git = gitSpec(spec, cwd);
  if (git) return git;
  let inRepo = true;
  try { execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd, stdio: 'ignore' }); } catch { inRepo = false; }
  throw new Error(`No such file, folder or git path: ${spec}${inRepo ? '' : ` (and ${cwd} is not inside a git repository)`}`);
}

function walk(root: string): InputFile[] {
  const out: InputFile[] = [];
  const go = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= MAX_FILES) throw new Error(`More than ${MAX_FILES} data files under ${root} — point at a smaller folder`);
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIR.has(e.name) || (e.name.startsWith('.') && !DOT_OK.has(e.name))) continue;
        go(p);
      } else if (DATA.test(e.name)) {
        out.push({ path: path.relative(root, p).split(path.sep).join('/'), text: fs.readFileSync(p, 'utf8') });
      }
    }
  };
  go(root);
  return out;
}

/** `<ref>:<path>`. The path is relative to the current directory as git does it (internally with a `./` prefix). */
function gitSpec(spec: string, cwd: string): Tree | null {
  const m = /^([^:]+):(.*)$/.exec(spec);
  if (!m || /^[a-zA-Z]$/.test(m[1])) return null;            // C:\… is a Windows drive letter, not a ref
  const [, ref, rel0] = m;
  const git = (...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'pipe'] });
  try { git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`); } catch { return null; }
  const rel = rel0.replace(/^\.?\/*/, '').replace(/\/+$/, '');
  const title = `${path.basename(rel || cwd)} @ ${ref}`;
  let type: string;
  try { type = git('cat-file', '-t', `${ref}:./${rel}`).trim(); } catch {
    throw new Error(`${rel || '.'} does not exist at ${ref}`);
  }
  if (type === 'blob') return { files: [{ path: path.basename(rel), text: git('show', `${ref}:./${rel}`) }], title, isDir: false };
  const names = git('ls-tree', '-r', '--name-only', ref, '--', rel || '.').split('\n').filter(Boolean);
  // ls-tree lists paths relative to the current directory; add ./ when fetching content too.
  const prefix = rel ? `${rel}/` : '';
  const files = names
    .map((n) => n.split(path.sep).join('/'))
    .filter((n) => DATA.test(n) && !n.split('/').some((s) => (s.startsWith('.') && !DOT_OK.has(s)) || SKIP_DIR.has(s)))
    .slice(0, MAX_FILES)
    .map((n) => ({ path: n.startsWith(prefix) ? n.slice(prefix.length) : n, text: git('show', `${ref}:./${n}`) }));
  return { files, title, isDir: true };
}

const META = new Set(['_profile.json', '_layout.json']);
const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** Read one argument: detect versions and format. `format` forces an adapter ('native' = no conversion). */
export function load(spec: string, opts: { format?: string; cwd?: string } = {}): Loaded {
  const tree = readSpec(spec, opts.cwd);
  const metaErrors: Loaded['metaErrors'] = [];
  const meta = (name: string) => {
    const f = tree.files.find((x) => x.path === name);
    if (!f) return null;
    try { return JSON.parse(f.text); } catch (e) { metaErrors.push({ file: name, message: `not JSON: ${(e as Error).message}` }); return null; }
  };
  const data = tree.files.filter((f) => !META.has(f.path));
  const isJson = (f: InputFile) => /\.json$/i.test(f.path);
  const dirs = [...new Set(data.filter((f) => f.path.includes('/')).map((f) => f.path.split('/')[0]))].sort(natural);
  /* Versions: no json at the root, and two or more subfolders that **each** hold json. Other files (a README next to the
   * versions or inside one) do not decide anything; they are listed as ignored. A markdown vault's subfolders hold notes,
   * not json, so they are categories, not versions. */
  const versioned = tree.isDir && !opts.format && dirs.length >= 2 && !dirs.some((d) => DOT_OK.has(d))
    && !data.some((f) => !f.path.includes('/') && isJson(f))
    && dirs.every((d) => data.some((f) => f.path.startsWith(`${d}/`) && isJson(f)));
  const ignored: string[] = versioned ? data.filter((f) => !isJson(f)).map((f) => f.path) : [];
  const groups = versioned
    ? dirs.map((d) => ({ name: d, files: data.filter((f) => f.path.startsWith(`${d}/`) && isJson(f)).map((f) => ({ ...f, path: f.path.slice(d.length + 1) })) }))
    : [{ name: tree.title, files: data }];

  let suggested: Record<string, unknown> | null = null;
  let format = 'native';
  const versions = groups.map((g) => {
    const r = adapt(g.files, opts.format);
    if (r.adapter) { format = r.adapter.id; suggested ??= r.profile; }
    ignored.push(...r.skipped.map((p) => (versioned ? `${g.name}/${p}` : p)));
    return { name: g.name, sources: r.sources };
  });
  return {
    title: tree.title,
    versions,
    profile: meta('_profile.json') ?? suggested,
    layouts: meta('_layout.json'),
    format,
    metaErrors,
    ignored,
    raw: groups.map((g) => ({ version: g.name, files: g.files })),
  };
}
