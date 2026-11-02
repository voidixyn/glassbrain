/* npx glassbrain: open, compare and validate a knowledge graph
 *
 * For people and for agents: view opens a browser; diff / validate write human-readable text to stdout (--json for programs),
 * and the exit code tells the result. diff run in a terminal also opens the compare page; called by an agent / a pipe it only prints.
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPhysical } from '../src/profile';
import { pageHtml } from './html';
import { load, type Loaded } from './load';
import { diff, diffText, ignoreOf, modelOf, profileFromJson, validate } from './model';
import type { Payload } from './viewer';

/** Help is also the format spec: an agent told only "run `npx glassbrain` first" must be able to write a valid graph from it. */
const HELP = (schema: string) => `glassbrain: open, diff and validate knowledge graphs.
Your agent writes the graph as plain JSON; glassbrain shows it and what changed.
Not installed? Put npx in front: npx glassbrain kg

WRITE A GRAPH
  One JSON file, two arrays. \`parent\` says what sits inside what; that is the
  whole structure. Every other relation is an edge.

    { "nodes": [
        { "id": "src",          "label": "src",      "kind": "folder" },
        { "id": "src/login.ts", "label": "login.ts", "kind": "file", "parent": "src",
          "description": "Checks the password, then opens a session. Markdown." },
        { "id": "src/db.ts",    "label": "db.ts",    "kind": "file", "parent": "src" } ],
      "edges": [
        { "source": "src/login.ts", "target": "src/db.ts", "kind": "uses" } ] }

  id           any string, stable across versions: a path or a slug, never a counter
  label        what is shown (defaults to id)
  kind         any word for what sort of thing it is (folder, page, feature, decision)
  parent       the id of the node it sits inside
  description  markdown for the detail panel; [text](node:<id>) links to a node
  flags        markers, e.g. ["stub"] for a node not filled in yet
  Order in the arrays does not matter. Other fields are kept and shown in the detail panel.
  Full schema: ${schema}

BUILD IT IN PASSES
  Work in passes, each one a new folder (copy the last, edit the copy). For example:
    kg/1-skeleton/graph.json   every node, nested by parent, no descriptions
    kg/2-filled/graph.json     descriptions added, no new structure
    kg/3-linked/graph.json     edges added
  After each pass:  glassbrain validate kg --strict   fix everything it reports
                    glassbrain diff kg/1-skeleton kg/2-filled   only this pass's job?
  At the end:       glassbrain kg   opens all passes with a version bar

COMMANDS
  glassbrain <path>                    open in the browser (same as: view)
  glassbrain diff <old> <new>          what changed between two graphs
  glassbrain diff <git-ref> <path>     <path> at that commit vs. now (default ref: HEAD)
  glassbrain validate <path>           check against the schema and the structure
  glassbrain convert <path> [out-dir]  write any supported format as glassbrain JSON

  <path> is a file, a folder, or <git-ref>:<path> (HEAD~1:kg/graph.json).
  A folder of sub-folders is a list of versions. Also opens, as they are:
  Graphify graph.json, Understand-Anything knowledge-graph.json, MCP memory.jsonl,
  a markdown folder (Obsidian / LLM wiki).

OPTIONS
  --json              machine-readable output (diff, validate)
  --strict            exit 1 on warnings too (validate)
  --exit-code         exit 1 when anything changed (diff)
  --all               list every change, not the first 20 (diff)
  --ignore <a,b>      fields that do not count as a change (diff)
  --out <file.html>   write the page here instead of a temp file (view, diff)
  --open / --no-open  open the browser or not (diff opens only in a terminal)
  --format <id>       force a format: native, graphify, understand-anything, memory, obsidian
  -h, --help          this help
  -v, --version       the version

More: https://github.com/voidixyn/glassbrain
`;

interface Args { cmd: string; pos: string[]; flags: Record<string, string | boolean> }
const VALUED = new Set(['out', 'format', 'ignore']);
const SWITCHES = new Set(['open', 'json', 'all', 'exit-code', 'strict', 'help', 'version']);
const COMMANDS = ['view', 'diff', 'validate', 'convert'];

/** A typo in a flag must not pass silently (`--exit-cod` in CI would always be green): unknown flags exit 2.
 *  `--open` / `--no-open`: the last one wins. */
function parseArgs(argv: string[]): Args {
  const pos: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h') flags.help = true;
    else if (a === '-v') flags.version = true;
    else if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const k = eq < 0 ? a.slice(2) : a.slice(2, eq);
      const v = eq < 0 ? undefined : a.slice(eq + 1);
      if (k === 'no-open' && v === undefined) flags.open = false;
      else if (VALUED.has(k)) {
        if (v !== undefined) flags[k] = v;
        else { if (i + 1 >= argv.length) fail(`--${k} needs a value`); flags[k] = argv[++i]; }
      } else if (SWITCHES.has(k) && v === undefined) flags[k] = true;
      else fail(`unknown option ${a} (see glassbrain --help)`);
    } else if (a.startsWith('-') && a !== '-') fail(`unknown option ${a} (see glassbrain --help)`);
    else pos.push(a);
  }
  const cmd = COMMANDS.includes(pos[0]) ? pos.shift()! : 'view';
  // `glassbrain frobnicate kg`: a word that is neither a command nor an existing path is a mistyped command.
  if (cmd === 'view' && pos.length > 1 && !fs.existsSync(pos[0]) && /^[a-z]+$/.test(pos[0])) fail(`unknown command ${pos[0]} (commands: ${COMMANDS.join(', ')})`);
  return { cmd, pos, flags };
}

function fail(msg: string, code = 2): never {
  process.stderr.write(`glassbrain: ${msg}\n`);
  process.exit(code);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const viewerJs = () => {
  const p = path.join(here, 'viewer.js');
  if (!fs.existsSync(p)) fail(`viewer bundle missing at ${p} (run npm run build)`, 3);
  return fs.readFileSync(p, 'utf8');
};

function writePage(payload: Payload, out: string | undefined): string {
  const html = pageHtml(payload, viewerJs());
  const file = out
    ? path.resolve(out)
    : path.join(os.tmpdir(), `glassbrain-${slug(payload.title)}-${crypto.createHash('sha1').update(html).digest('hex').slice(0, 8)}.html`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // The page carries the whole graph: in the shared temp folder only this user may read it.
  fs.writeFileSync(file, html, out ? undefined : { mode: 0o600 });
  return file;
}
/** `1 edge`, `2 edges`. */
const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'graph';

function openFile(file: string) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [file]]
    // Not `cmd /c start`: cmd re-parses the path, and a folder named "Tom & Jerry" would run part of it as a command.
    : process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', file]]
    : ['xdg-open', [file]];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* cannot open; fine, the path is already printed */ }
}

const nodesOf = (l: Loaded) => {
  const profile = profileFromJson('cli', l.profile);
  return l.versions.map((v) => modelOf(v, profile));
};

/** What was found but not used, on stderr: it never mixes into output a program reads. */
function notes(l: Loaded, models: ReturnType<typeof nodesOf>) {
  for (const e of l.metaErrors) process.stderr.write(`note: ${e.file} ignored: ${e.message}\n`);
  if (l.ignored.length) process.stderr.write(`note: not read: ${l.ignored.slice(0, 5).join(', ')}${l.ignored.length > 5 ? ` and ${l.ignored.length - 5} more` : ''}\n`);
  models.forEach((m, i) => {
    for (const e of m.errors) process.stderr.write(`error: ${l.versions.length > 1 ? `${l.versions[i].name}/` : ''}${e.origin}: ${e.message}\n`);
  });
}
/** `kg: 2 versions, latest 3 nodes, 1 edge`. */
const summaryOf = (l: Loaded, m: ReturnType<typeof nodesOf>[number]) =>
  `${l.title}: ${l.versions.length > 1 ? `${l.versions.length} versions, latest ` : ''}${count(m.nodes.length, 'node')}, ${count(m.edges.length, 'edge')}${l.format !== 'native' ? ` (read as ${l.format})` : ''}`;

function view(a: Args) {
  if (a.pos.length !== 1) fail('view needs exactly one <path>');
  const l = load(a.pos[0], { format: a.flags.format as string | undefined });
  const models = nodesOf(l);
  notes(l, models);
  // Opens on the latest version (what the numbers below describe); ‹ steps back through the history.
  const file = writePage({ title: l.title, profile: l.profile, versions: l.versions, layouts: l.layouts, start: { at: l.versions.length - 1, compare: false } }, a.flags.out as string | undefined);
  console.log(summaryOf(l, models[models.length - 1]));
  console.log(file);
  if (a.flags.open !== false) openFile(file);
}

/** The two sides of diff: `<old> <new>`, `<ref> <path>`, `<path>` (= HEAD). */
function sides(pos: string[]): [string, string] {
  if (pos.length === 1) return [`HEAD:${pos[0]}`, pos[0]];
  if (pos.length !== 2) fail('diff needs <old> <new>, <git-ref> <path>, or <path>');
  const [x, y] = pos;
  if (!fs.existsSync(x) && !x.includes(':') && fs.existsSync(y)) return [`${x}:${y}`, y];
  return [x, y];
}

function runDiff(a: Args) {
  const [oldSpec, newSpec] = sides(a.pos);
  const format = a.flags.format as string | undefined;
  const before = load(oldSpec, { format });
  const after = load(newSpec, { format });
  const profileJson = after.profile ?? before.profile;
  const profile = profileFromJson('cli', profileJson);
  const pick = (l: Loaded) => l.versions[l.versions.length - 1];
  const vb = pick(before); const va = pick(after);
  const labels = { before: before.versions.length > 1 ? `${before.title}/${vb.name}` : before.title, after: after.versions.length > 1 ? `${after.title}/${va.name}` : after.title };
  if (labels.before === labels.after) { labels.before += ' (old)'; labels.after += ' (new)'; }
  const mb = modelOf(vb, profile); const ma = modelOf(va, profile);
  notes(before, []); notes(after, []);
  const ignore = ignoreOf(profileJson, typeof a.flags.ignore === 'string' ? a.flags.ignore.split(',').map((s) => s.trim()).filter(Boolean) : []);
  const { summary } = diff(mb, ma, labels, ignore);
  const labelOf = (id: string) => ma.index.get(id)?.label ?? mb.index.get(id)?.label ?? id;
  const changed = summary.changes.length + summary.edgeChanges.length > 0;

  const wantOpen = a.flags.open === true || (a.flags.open === undefined && !a.flags.json && process.stdout.isTTY);
  let file: string | null = null;
  if (wantOpen || a.flags.out) {
    file = writePage({
      title: `${labels.before} → ${labels.after}`, profile: profileJson || ignore.length ? { ...profileJson, diffIgnore: ignore } : null,
      versions: [{ name: labels.before, sources: vb.sources }, { name: labels.after, sources: va.sources }],
      layouts: null, start: { at: 1, compare: true },
    }, a.flags.out as string | undefined);
  }
  if (a.flags.json) console.log(JSON.stringify({ ...summary, ...(file ? { page: file } : {}) }, null, 1));
  else {
    console.log(diffText(summary, labelOf, a.flags.all ? Infinity : 20));
    if (file) console.log(`\n${file}`);
  }
  if (file && wantOpen) openFile(file);
  if (a.flags['exit-code'] && changed) process.exitCode = 1;
}

function runValidate(a: Args) {
  if (a.pos.length !== 1) fail('validate needs exactly one <path>');
  const l = load(a.pos[0], { format: a.flags.format as string | undefined });
  const found = validate(l);
  const errors = found.filter((f) => f.level === 'error').length;
  const warns = found.length - errors;
  const models = nodesOf(l);
  if (a.flags.json) {
    console.log(JSON.stringify({ format: l.format, ignored: l.ignored, versions: l.versions.map((v, i) => ({ name: v.name, nodes: models[i].nodes.length, edges: models[i].edges.length })), errors, warnings: warns, issues: found }, null, 1));
  } else {
    for (const f of found.slice(0, 200)) console.log(`${f.level === 'error' ? 'error' : 'warn '}  ${f.where}  ${f.message}`);
    if (found.length > 200) console.log(`… ${found.length - 200} more`);
    if (l.ignored.length) process.stderr.write(`note: not read: ${l.ignored.slice(0, 5).join(', ')}${l.ignored.length > 5 ? ` and ${l.ignored.length - 5} more` : ''}\n`);
    console.log(`${found.length ? '\n' : ''}${summaryOf(l, models[models.length - 1])} — ${count(errors, 'error')}, ${count(warns, 'warning')}`);
  }
  if (errors || (a.flags.strict && warns)) process.exitCode = 1;
}

function runConvert(a: Args) {
  if (a.pos.length < 1 || a.pos.length > 2) fail('convert needs <path> [out-dir]');
  const l = load(a.pos[0], { format: a.flags.format as string | undefined });
  const models = nodesOf(l);
  // The default layer is added during parsing, it is not data: a graph with no declared layers should not gain layer: "default" when written out.
  const declared = Array.isArray(l.profile?.layers) && (l.profile!.layers as unknown[]).length > 0;
  const strip = (g: ReturnType<typeof toPhysical>) => (declared ? g : { ...g, nodes: g.nodes.map(({ layer: _l, ...n }) => n) });
  const graphs = l.versions.map((v, i) => ({ name: v.name, graph: { name: v.name, ...strip(toPhysical(models[i])) } }));
  const outDir = a.pos[1];
  if (!outDir) {
    if (graphs.length > 1) fail('several versions: give an out-dir');
    console.log(JSON.stringify(graphs[0].graph, null, 1));
    return;
  }
  fs.mkdirSync(outDir, { recursive: true });
  for (const g of graphs) {
    const dir = graphs.length > 1 ? path.join(outDir, g.name) : outDir;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'graph.json'), `${JSON.stringify(g.graph, null, 1)}\n`);
  }
  if (l.profile) fs.writeFileSync(path.join(outDir, '_profile.json'), `${JSON.stringify(l.profile, null, 1)}\n`);
  if (l.layouts) fs.writeFileSync(path.join(outDir, '_layout.json'), `${JSON.stringify(l.layouts)}\n`);
  console.log(`${outDir}: ${graphs.length > 1 ? `${graphs.length} versions, ` : ''}${count(models[models.length - 1].nodes.length, 'node')}${l.format !== 'native' ? ` (from ${l.format})` : ''}`);
}

const a = parseArgs(process.argv.slice(2));
if (a.flags.version) {
  const pkg = JSON.parse(fs.readFileSync(path.join(here, '../../package.json'), 'utf8'));
  console.log(pkg.version);
} else if (a.flags.help || (a.cmd === 'view' && !a.pos.length)) {
  process.stdout.write(HELP(path.join(here, '../../schema/graph.schema.json')));
} else {
  try {
    ({ view, diff: runDiff, validate: runValidate, convert: runConvert } as Record<string, (a: Args) => void>)[a.cmd](a);
  } catch (e) {
    fail((e as Error).message, 2);
  }
}
