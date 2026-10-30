/* glassbrain demo: what a host application looks like, with "what the host passes" in plain sight
 *
 * The canvas (legend, search, ⋯ menu and inspector included) is all library. The sidebar is the host: on top a Finder-like panel for what is
 * being looked at (dataset, versions as icons, compare or not), below one card that is **a settings page**, like VS Code's settings:
 * groups → rows, each row = field name (the <GraphCanvas> prop name) + one line of description + a value control. Controls are only
 * select, segmented, switch, slider, button, ⋯ menu and read-only reading (see "Controls" below); nothing else is drawn; descriptions are always
 * one line, longer ones go in tooltips. The card's corner switches it to the same settings as code: every prop is listed, defaults faint, changed
 * ones bright, the line that just changed flashes, and clicking a line pops up that prop's control under it.
 *
 * This page **does not make decisions for developers**: no invisible rules like "switch layout automatically while editing". The one exception is that a dataset
 * may give initial values for the look knobs in `demo.view` of its `_profile.json` (those lines show lit in the code).
 *
 * The shape of the data is in ../data/demo/README.md: one folder = one complete KG input, and the folder name
 * is the label. Adding data needs no change to the code here.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  applyEdits, toPhysical, type EditOp, DEFAULT_ANIMATE, DEFAULT_DIFF_LAYOUT, defineProfile, diffModels, GraphCanvas,
  DARK_THEME, LIGHT_THEME, parseSources, clearLayoutCache, ALL_CONTROLS, EN, defaultProfile, renderInline,
  type GraphStrings, type GraphTheme,
  type ControlId, type GraphDelta, type GraphLook, type GraphModel, type GraphProfile, type GraphView, type LayoutInfo,
  type Positions, type TransitionReport,
} from 'glassbrain';
import { ZH_CN } from '../examples/strings-zh';
import { HOST } from './host';
import { CSS } from './style';

/* Inlined by build.mjs: { "<project>/<version>/<file path>": "<json text>" } plus the diffable groups. */
declare global {
  interface Window { __GB_DATA__?: Record<string, string>; __GB_DIFFABLE__?: string[][] }
}
const FILES = window.__GB_DATA__ ?? {};

const DIFFABLE: string[][] = window.__GB_DIFFABLE__ ?? [];

/** A version id is "<project>/<version>", i.e. the folder path itself. */
type VerId = string;
const projOf = (v: VerId) => v.slice(0, v.indexOf('/'));
const nameOf = (v: VerId) => v.slice(v.indexOf('/') + 1);

/** Which projects exist and which versions each has, all derived from file paths (order = natural order of folder names). */
const VERSIONS: VerId[] = [...new Set(
  Object.keys(FILES).filter((p) => p.split('/').length > 2).map((p) => p.split('/').slice(0, 2).join('/')),
)].sort((a, b) => a.localeCompare(b));
/** Dataset order: `demo.order` in `_profile.json` first (the flagship one goes first), the rest by name. */
const orderOf = (p: string) => { try { return JSON.parse(FILES[`${p}/_profile.json`] ?? '{}').demo?.order ?? 99; } catch { return 99; } };
const PROJECTS: string[] = [...new Set(VERSIONS.map(projOf))].sort((a, b) => orderOf(a) - orderOf(b) || a.localeCompare(b));
const versionsOf = (proj: string) => VERSIONS.filter((v) => projOf(v) === proj);

/** Other versions in the same group as v (union of groups, order kept, deduplicated). */
function diffCandidates(v: VerId): VerId[] {
  const out: VerId[] = [];
  for (const group of DIFFABLE) {
    if (!group.includes(v)) continue;
    for (const other of group) {
      if (other !== v && !out.includes(other) && VERSIONS.includes(other)) out.push(other);
    }
  }
  return out;
}

/**
 * **Which profile each project uses.** A `_profile.json` in the project folder is used if present: only the declarative
 * pieces (layers, palette, kind names, detail field table); parsing uses the library's built-in `{nodes, edges}`. Data without this
 * file uses the host's profile (see host.ts), or `defineProfile({ id })`.
 *
 * `demo` in `_profile.json` belongs to this page, not to the library: the dataset's one-line description (English and Chinese),
 * and which repository relative image / link URLs in docs resolve to (`assetBase`).
 * `source` is one markdown sentence on how the data was made, shown under the versions when not comparing; relative links are
 * paths in this repository.
 */
interface DemoMeta {
  description?: { en?: string; zh?: string }; source?: { en?: string; zh?: string }; assetBase?: string; order?: number;
  /** Initial look knob values when switching to this dataset. Graphs with dense nodes and long labels (source code, say) look crowded with the defaults; give them their own here. */
  view?: Partial<Look>;
}
interface Look { nodeScale: number; labelSpacing: number; semanticOpacity: number }
const LOOK: Look = { nodeScale: 1, labelSpacing: 6, semanticOpacity: 0.8 };
const lookOf = (proj: string): Look => ({ ...LOOK, ...profileOf(proj).meta.view });

/** The raw `_profile.json` at the project root (none = the host's profile, see host.ts). */
const profileText = (proj: string) => FILES[`${proj}/_profile.json`] ?? null;
/** The profile for people to read: without the `demo` block, which is this page's own settings (description, order, knob defaults), not library fields. */
const profileShown = (proj: string) => { try { const { demo: _, ...rest } = JSON.parse(profileText(proj)!); return JSON.stringify(rest, null, 1); } catch { return profileText(proj); } };
/** Where `source` links resolve: this repository on GitHub. */
const REPO = 'https://github.com/voidixyn/glassbrain/blob/main/';
const hiddenOf = (v: GraphView) => (v.hiddenNodeKinds?.length ?? 0) + (v.hiddenEdgeKinds?.length ?? 0);
/** A project's preset layouts: version name → that version's coordinates. Each version passes only its own to `layout`. */
type Layouts = Record<string, Positions>;
/** `_layout.json` at the project root: the one shipped with the data. */
const parsedLayouts = new Map<string, Layouts | null>();
function fileLayouts(proj: string): Layouts | null {
  // Each project is parsed once: parsing on every render would make `layout` a new object each time.
  if (!parsedLayouts.has(proj)) {
    let v: Layouts | null = null;
    try { v = FILES[`${proj}/_layout.json`] ? JSON.parse(FILES[`${proj}/_layout.json`]) : null; } catch { /* a broken file counts as none */ }
    parsedLayouts.set(proj, v);
  }
  return parsedLayouts.get(proj)!;
}
/** A loaded file: version name → coordinates; a single set of coordinates (`{ id: {x, y} }`) counts as the current version's. */
const asLayouts = (v: any, ver: string): Layouts => {
  const first = v && Object.values(v)[0] as any;
  return first && typeof first.x === 'number' ? { [ver]: v } : v;
};
/** Pick a json file and read it in (loading a language pack, theme, profile or look all go through this). */
function loadJson(cb: (v: any) => void) {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
  input.onchange = async () => { const f = input.files?.[0]; if (f) { try { cb(JSON.parse(await f.text())); } catch { /* not json, never mind */ } } };
  input.click();
}
/** A language pack for people to read: functions written as their source (`(n) => \`${n} nodes\``), so developers can write their own from it. */
const packText = (pack: Partial<GraphStrings>) => JSON.stringify(pack, (_, v) => (typeof v === 'function' ? String(v) : v), 1);

/** What a model looks like: the first node with a parent and the first edge, shown as is. */
function sampleOf(m: GraphModel): string {
  const node = m.nodes.find((n) => n.parent) ?? m.nodes[0];
  const edge = m.edges[0];
  const one = (v: unknown) => JSON.stringify(v, (k, x) => (k === 'detail' || k === 'data' ? undefined : x));
  return `{\n  nodes: [\n    ${one(node)},\n    … ${m.nodes.length - 1} more\n  ],\n  edges: [${edge ? `\n    ${one(edge)},\n    … ${m.edges.length - 1} more\n  ` : ''}]\n}`;
}
const overrides = (l: GraphLook | undefined) => (l ? (l.skeleton !== undefined ? 1 : 0)
  + Object.keys(l.nodePalette ?? {}).length + Object.keys(l.edgePalette ?? {}).length
  + Object.keys(l.nodeSize ?? {}).length + Object.keys(l.edgeWidth ?? {}).length : 0);

/** One line of code: `set` = differs from the library default (highlighted), `dim` = is the default (faint), `plain` = scaffolding. */
interface CodeLine { k: string; text: string; state: 'set' | 'dim' | 'plain' }
/** The sidebar's current state = this code. Every prop is listed, defaults faint; move one and that line lights up. */
function codeLines(o: {
  diff: boolean; proj: string; preset: Positions | null; layoutMode: 'fresh' | 'continue'; editable: boolean;
  controls: Partial<Record<ControlId, boolean>>; dark: boolean; lang: Lang; anim: boolean; dur: number; drift: number; bounce: number;
  nodeScale: number; labelSpacing: number; semanticOpacity: number; rounds: number; iters: number; snap: boolean; assetBase: boolean;
  prof: 'own' | 'default' | 'loaded'; themeMode: 'system' | 'light' | 'dark'; customStrings: boolean; themeExtra: boolean;
}): CodeLine[] {
  const L: CodeLine[] = [];
  const add = (k: string, text: string, set: boolean | null) => L.push({ k, text, state: set === null ? 'plain' : set ? 'set' : 'dim' });
  if (o.diff) { add('pre', 'const diff = diffModels(before, after);', true); add('pre-', '', null); }
  add('<', '<GraphCanvas', null);
  add('model', o.diff ? '  model={diff.model}' : '  model={model}', true);
  add('profile', o.prof === 'default' ? '  profile={undefined}   // defaultProfile'
    : o.prof === 'loaded' ? '  profile={defineProfile(myProfile)}'
    : profileText(o.proj) ? '  profile={defineProfile(profileJson)}' : `  profile={${OWN_PROFILE}}`, o.prof !== 'default');
  add('diff', o.diff ? '  diff={diff}' : '  diff={null}   // or diffModels(before, after)', o.diff);
  if (o.diff) {
    const d = { rounds: o.rounds, iterations: o.iters, snap: o.snap };
    const same = d.rounds === DEFAULT_DIFF_LAYOUT.rounds && d.iterations === DEFAULT_DIFF_LAYOUT.iterations && d.snap === DEFAULT_DIFF_LAYOUT.snap;
    add('diffLayout', `  diffLayout={{ rounds: ${d.rounds}, iterations: ${d.iterations}, snap: ${d.snap} }}`, !same);
  }
  add('layout', o.preset ? `  layout={layouts[version]}   // ${Object.keys(o.preset).length} points` : '  layout={null}', !!o.preset);
  add('layoutMode', `  layoutMode="${o.layoutMode}"`, o.layoutMode !== 'fresh');
  add('onLayout', '  onLayout={(positions, info) => save(positions)}', true);
  add('onEdit', o.editable ? '  onEdit={(op) => apply(op)}' : '  onEdit={undefined}   // read-only', o.editable);
  add('look', '  look={look} onLookChange={setLook}', true);
  add('view', '  view={view} onViewChange={setView}', true);
  const off = ALL_CONTROLS.filter((c) => o.controls[c] === false);
  add('controls', off.length ? `  controls={{ ${off.map((c) => `${c}: false`).join(', ')} }}` : `  controls={{ ${ALL_CONTROLS.map((c) => `${c}: true`).join(', ')} }}`, off.length > 0);
  add('strings', o.customStrings ? (o.lang === 'zh' ? '  strings={{ ...ZH_CN, ...myStrings }}' : '  strings={myStrings}')
    : o.lang === 'zh' ? '  strings={ZH_CN}' : '  strings={undefined}   // built-in English', o.customStrings || o.lang === 'zh');
  const th = o.dark ? 'DARK_THEME' : 'LIGHT_THEME';
  const thBase = o.themeMode === 'system' ? '(prefersDark ? DARK_THEME : LIGHT_THEME)' : th;
  add('theme', o.themeExtra ? `  theme={{ ...${thBase}, ...myTheme }}`
    : o.themeMode === 'system' ? '  theme={prefersDark ? DARK_THEME : LIGHT_THEME}' : `  theme={${th}}`, o.themeMode !== 'light' || o.themeExtra);
  if (!o.anim) add('animate', '  animate={false}', true);
  else {
    const same = o.dur === DEFAULT_ANIMATE.duration && o.drift === DEFAULT_ANIMATE.drift && o.bounce === DEFAULT_ANIMATE.bounce;
    add('animate', `  animate={{ duration: ${o.dur}, drift: ${o.drift}, bounce: ${o.bounce} }}`, !same);
  }
  add('nodeScale', `  nodeScale={${o.nodeScale}}`, o.nodeScale !== 1);
  add('labelSpacing', `  labelSpacing={${o.labelSpacing}}`, o.labelSpacing !== 6);
  add('semanticOpacity', `  semanticOpacity={${o.semanticOpacity}}`, o.semanticOpacity !== 0.8);
  if (o.assetBase) add('resolveUrl', '  resolveUrl={(u) => new URL(u, assetBase).href}', true);
  add('/>', '/>', null);
  return L;
}

interface DemoProfile { profile: GraphProfile; meta: DemoMeta }
const profiles = new Map<string, DemoProfile>();
function profileOf(proj: string): DemoProfile {
  let hit = profiles.get(proj);
  if (!hit) {
    const text = FILES[`${proj}/_profile.json`];
    if (!text) hit = { profile: (!IMPORTED.has(proj) && HOST.profile) || defineProfile({ id: proj }), meta: {} };
    else {
      const { demo = {}, edgeLabels = {}, ...rest } = JSON.parse(text);
      hit = { profile: defineProfile({ id: proj, ...rest, kindLabels: { ...rest.kindLabels, ...edgeLabels } }), meta: demo };
    }
    profiles.set(proj, hit);
  }
  return hit;
}

const modelCache = new Map<VerId, GraphModel>();
function load(v: VerId): GraphModel {
  const hit = modelCache.get(v);
  if (hit) return hit;
  const sources = Object.entries(FILES)
    .filter(([p]) => p.startsWith(v + '/'))
    // origin keeps only the path relative to the version: matching "the same file" between versions never works with the version folder in it.
    .map(([p, text]) => ({ origin: p.slice(v.length + 1), text }));
  const m = parseSources(sources, profileOf(projOf(v)).profile);
  modelCache.set(v, m);
  return m;
}

/* ── Editing and import / export (all this page's business: the library only hands out ops and never touches files) ─────────────
 *
 * Edits on a version are a list of ops (a patch). It is at once: the undo stack (drop the last one, replay from the original),
 * a draft (kept in this browser, survives reloads; open a folder with the same name again and the edits apply), and an export file
 * (always one patch.json, however many files the source data has). */
const DRAFT = (v: VerId) => `glassbrain-demo-edits:${v}`;
const drafts = new Map<VerId, EditOp[]>();
function draftOf(v: VerId): EditOp[] {
  let hit = drafts.get(v);
  if (!hit) {
    try { hit = JSON.parse(localStorage.getItem(DRAFT(v)) ?? '[]') as EditOp[]; } catch { hit = []; }
    if (!Array.isArray(hit)) hit = [];
    drafts.set(v, hit);
  }
  return hit;
}
function saveDraft(v: VerId, ops: EditOp[]) {
  drafts.set(v, ops);
  try { if (ops.length) localStorage.setItem(DRAFT(v), JSON.stringify(ops)); else localStorage.removeItem(DRAFT(v)); } catch { /* private mode and such: the draft just is not kept */ }
}
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const isPatch = (v: any): v is { glassbrain: 'patch'; ops: EditOp[] } => v && v.glassbrain === 'patch' && Array.isArray(v.ops);

/** A folder opened / dropped in: becomes a new project with one version. The folder name is the name; a `_profile.json` at the root
 *  is recognized as usual; without one the library's generic profile is used (reads `{nodes, edges}`). Any patch inside is applied to this version. */
const IMPORTED = new Set<string>();
function addImported(list: { path: string; text: string }[]): { ver: VerId; patch: EditOp[] | null } | null {
  const json = list.filter((f) => f.path.toLowerCase().endsWith('.json'));
  let patch: EditOp[] | null = null;
  const data = json.filter((f) => {
    try { const v = JSON.parse(f.text); if (isPatch(v)) { patch = v.ops; return false; } } catch { /* broken files are kept anyway and reported when parsed */ }
    return true;
  });
  if (!data.length) return null;
  const top = data[0].path.includes('/') ? data[0].path.split('/')[0] : '';
  const rooted = !!top && data.every((f) => f.path.startsWith(top + '/'));
  const name = rooted ? top : 'files';
  let proj = `↥ ${name}`;
  for (let i = 2; PROJECTS.includes(proj); i++) proj = `↥ ${name} (${i})`;
  const ver = `${proj}/${name}`;
  for (const f of data) {
    const rel = rooted ? f.path.slice(top.length + 1) : f.path;
    if (rel === '_profile.json') FILES[`${proj}/_profile.json`] = f.text;
    else FILES[`${ver}/${rel}`] = f.text;
  }
  IMPORTED.add(proj);
  PROJECTS.push(proj);
  VERSIONS.push(ver);
  return { ver, patch };
}
const readAll = (files: File[]) => Promise.all(files.map(async (f) => ({
  path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, text: await f.text(),
})));
/** What is dropped in may contain folders: walk down level by level. */
async function droppedFiles(dt: DataTransfer): Promise<File[]> {
  const out: File[] = [];
  const walk = async (e: any, dir: string): Promise<void> => {
    if (e.isFile) {
      const f: File = await new Promise((ok, bad) => e.file(ok, bad));
      out.push(Object.defineProperty(f, 'webkitRelativePath', { value: dir + f.name }));
    } else if (e.isDirectory) {
      const reader = e.createReader();
      for (;;) {
        const batch: any[] = await new Promise((ok, bad) => reader.readEntries(ok, bad));
        if (!batch.length) break;
        for (const c of batch) await walk(c, `${dir}${e.name}/`);
      }
    }
  };
  const entries = [...dt.items].map((it) => it.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...dt.files];
  for (const e of entries) await walk(e, '');
  return out;
}

/** How the code view names the profile of data without a `_profile.json`. */
const OWN_PROFILE = HOST.profileName ?? 'defineProfile({ id })';


/* ── This page's own text ─────────────────────────────────────────────────────
 * The demo is a "host": its text is its own business, separate from the library's `strings`. The `strings` row switches both: the library side
 * uses the public `strings` hook. Text in the data does not switch. Descriptions are always one line, longer ones go in tooltips. */
type Lang = 'en' | 'zh';
const TEXT = {
  en: {
    tagline: 'Every row below is a prop of <GraphCanvas>.', codeToggle: 'Show the code for these settings', dataset: 'Dataset',
    menu: 'Menu', close: 'Close', more: 'More',
    langIcon: 'Language (strings)', themeIcon: 'Light / dark (theme)', compareIcon: 'Compare with an earlier version (diff)',
    dropHint: 'or drop one anywhere', version: 'Version', lightName: 'Light', darkName: 'Dark', systemName: 'System', followSystem: 'Follow system', customTheme: 'Custom overrides', customStrings: 'Custom pack', before: 'before', loadedName: 'loaded', builtIn: 'built-in',
    viewIs: 'What is shown: hidden kinds, layers, search', hidden: (n: number) => `${n} hidden`,
    nodes: (n: number) => `${n} nodes`, changes: (n: number) => `${n} changes`,
    gData: 'Data', gLayout: 'Layout', gInteract: 'Interaction', gLook: 'Appearance', gAdvanced: 'Advanced',
    openFolder: 'Open folder…',
    modelIs: 'One version = one model · containment is node.parent', modelMeta: (n: number) => `${n} nodes`,
    kinds: (n: number) => `${n} kinds`, points: (n: number) => `${n} points`, savedName: 'saved',
    diffIs: 'Compare with an earlier version',
    profileIs: 'Optional · kinds, layers, colours, detail fields', profileCode: 'code', pageOnly: 'this page',
    layoutIs: 'This version’s positions · else cache · else layoutMode', noEntry: 'not this version',
    load: 'Load…', saveCur: 'Save this version', exportIt: 'Export',
    modeIs: 'fresh: solve anew · continue: start from current positions',
    lastIs: 'Where the latest layout came from · ⋯ clears the cache',
    src: { preset: 'layout', cache: 'local cache', fresh: 'fresh', continue: 'continue', relayout: 'Re-layout' } as Record<LayoutInfo['source'], string>,
    editIs: 'Inspector edits arrive as ops · off = read-only',
    edits: (n: number) => `${n} edit${n > 1 ? 's' : ''}`,
    undo: 'Undo', exportPatch: 'Export patch', exportGraph: 'Export graph', discard: 'Discard',
    lookIs: 'Legend overrides: colour and size per kind', changed: (n: number) => `${n} changed`, reset: 'Reset',
    controlsIs: 'Built-in canvas controls',
    ctl: { search: 'Search box', origins: 'Filter by source file', layers: 'Layer chips, 2.5D', relayout: 'Re-layout in the ⋯ menu', zoom: 'Zoom and fit' } as Record<ControlId, string>,
    stringsIs: 'UI text · load a partial pack; missing keys stay built-in', themeIs: 'Graph colours · chrome uses --gb-* CSS vars', animateIs: 'Animate data changes',
    nodeScaleIs: 'Node size', labelSpacingIs: 'Min gap between labels, px', semanticOpacityIs: 'Ink of non-containment edges',
    durationIs: 'Transition length, ms', driftIs: 'Scatter in transitions', bounceIs: 'Overshoot when settling',
    roundsIs: 'Fusion rounds', itersIs: 'First push', snapIs: 'Pin the new version',
    code: 'Code', copy: 'Copy', copied: 'Copied', props: 'Props',
    refClick: '⇧-click: compare against this one', refHint: '⇧-click a version to compare against it',
  },
  zh: {
    tagline: '下面每一行都是 <GraphCanvas> 的一个 prop。', codeToggle: '显示这些设置对应的代码', dataset: '数据集',
    menu: '菜单', close: '关闭', more: '更多',
    langIcon: '语言（strings）', themeIcon: '浅色 / 深色（theme）', compareIcon: '跟更早的一版对比（diff）',
    dropHint: '或者拖到页面上', version: '版本', lightName: '浅色', darkName: '深色', systemName: '系统', followSystem: '跟随系统', customTheme: '自定义覆盖', customStrings: '自定义语言包', before: '对比的那一版', loadedName: '载入的', builtIn: '内置',
    viewIs: '显示什么：隐藏的种类、层、搜索', hidden: (n: number) => `${n} 类隐藏`,
    nodes: (n: number) => `${n} 节点`, changes: (n: number) => `${n} 处变更`,
    gData: '数据', gLayout: '布局', gInteract: '交互', gLook: '外观', gAdvanced: '高级',
    openFolder: '打开文件夹…',
    modelIs: '一个版本 = 一份 model · 包含关系是 node.parent', modelMeta: (n: number) => `${n} 节点`,
    kinds: (n: number) => `${n} 种`, points: (n: number) => `${n} 个点`, savedName: '存下的',
    diffIs: '跟更早的一版对比',
    profileIs: '可选 · 种类、层、颜色、详情字段', profileCode: '代码', pageOnly: '页面自己的',
    layoutIs: '这一版存下的坐标 · 没有就用缓存 · 再没有按 layoutMode', noEntry: '没有这一版',
    load: '载入…', saveCur: '存下这一版', exportIt: '导出',
    modeIs: 'fresh 从头算 · continue 从当前坐标出发重算',
    lastIs: '最近一次布局从哪来 · ⋯ 里清缓存',
    src: { preset: 'layout', cache: '本机缓存', fresh: 'fresh', continue: 'continue', relayout: '重新布局' } as Record<LayoutInfo['source'], string>,
    editIs: '检查器里的改动作为 op 交来 · 关掉 = 只读',
    edits: (n: number) => `${n} 处修改`,
    undo: '撤销', exportPatch: '导出修改', exportGraph: '导出整图', discard: '全部放弃',
    lookIs: '图例上的覆盖：每一类的颜色、大小', changed: (n: number) => `${n} 处改动`, reset: '复原',
    controlsIs: '画布自带的控件',
    ctl: { search: '搜索框', origins: '按来源文件筛', layers: '层切换、2.5D', relayout: '⋯ 菜单里的「重新布局」', zoom: '缩放、适应窗口' } as Record<ControlId, string>,
    stringsIs: '界面文字 · 可载入部分语言包，没给的键用内置', themeIs: '图的颜色 · 工具条等外壳走 --gb-* CSS 变量', animateIs: '数据变化时演过渡',
    nodeScaleIs: '点大小', labelSpacingIs: '标签之间至少的缝，px', semanticOpacityIs: '包含以外的边的浓度',
    durationIs: '过渡时长，ms', driftIs: '过渡中的飘散', bounceIs: '落位时的回弹',
    roundsIs: '融合回合', itersIs: '首步推挤', snapIs: '钉住新版',
    code: '代码', copy: '复制', copied: '已复制', props: '属性',
    refClick: '⇧ 点击：拿它来对比', refHint: '⇧ 点击版本设为对比的那一版',
  },
};
type Text = typeof TEXT.en;

/** Diagnostic readings and the like only appear when the URL has `?dev`. */
const DEV = new URLSearchParams(location.search).has('dev');
/** The number before a version folder name (`1-skeleton`) only sorts; it is shown split off as a small number. */
const verLabel = (v: VerId) => {
  const m = /^(\d+)[-_ ](.*)$/.exec(nameOf(v));
  return m ? { n: m[1], name: m[2] } : { n: '', name: nameOf(v) };
};

/* ── Controls ───────────────────────────────────────────────────────────────── */

/** Segmented control: a sliding solid backing points at the current item. */
function Segmented<T extends string>(p: {
  items: { value: T; label: ReactNode; disabled?: boolean }[];
  value: T; onChange: (v: T) => void;
}) {
  const i = Math.max(0, p.items.findIndex((x) => x.value === p.value));
  return (
    <div className="sg" style={{ '--n': p.items.length, '--i': i } as React.CSSProperties}>
      <span className="sg-thumb" />
      {p.items.map((it) => (
        <button key={it.value} type="button" disabled={it.disabled} className={`sg-btn${it.value === p.value ? ' on' : ''}`}
          onClick={() => !it.disabled && p.onChange(it.value)}>{it.label}</button>
      ))}
    </div>
  );
}

/** Switch: a slider knob. */
function Switch(p: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" className={`sw${p.on ? ' on' : ''}`} onClick={() => p.onChange(!p.on)} aria-pressed={p.on}>
      <i /><span>{p.label}</span>
    </button>
  );
}

/* ── Controls: only these. Everything in the sidebar is one of them; nothing else is drawn. ───────────── */

/** A group: a title row in small caps, collapsible; a description line below when needed. */
function Group(p: { title: string; props?: string; count?: number; desc?: ReactNode; open?: boolean; children: ReactNode }) {
  return (
    <details className="grp" open={p.open ?? true}>
      <summary title={p.props}>{p.title}{p.count != null && <span className="grp-p">· {p.count}</span>}</summary>
      {p.desc && <div className="grp-d">{p.desc}</div>}
      <div className="grp-b">{p.children}</div>
    </details>
  );
}

/** A row: field name (the prop name) + one line of description + a value control; wide things take a full row below. */
function Row(p: { name: string; k?: string; tag?: string; desc?: string; children?: ReactNode; below?: ReactNode }) {
  return (
    <div className="row" data-k={p.k}>
      <span className="row-n">{p.name}{p.tag && <i className="tag">{p.tag}</i>}</span>
      {p.children && <span className="row-c">{p.children}</span>}
      {p.desc && <span className="row-d" title={p.desc}>{p.desc}</span>}
      {p.below && <div className="row-b">{p.below}</div>}
    </div>
  );
}


function Range(p: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; show: string; disabled?: boolean }) {
  return (
    <span className="rng">
      <input type="range" aria-label={p.label} min={p.min} max={p.max} step={p.step} value={p.value} disabled={p.disabled}
        onChange={(e) => p.onChange(+e.target.value)} />
      <em>{p.show}</em>
    </span>
  );
}

/** ⋯: rarely used actions live here. Closes on an outside click. */
interface MenuItem { label: string; onClick: () => void; disabled?: boolean; checked?: boolean; sep?: boolean }
function Menu(p: { label: string; items: MenuItem[]; icon?: ReactNode; className?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const off = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) ref.current.open = false; };
    document.addEventListener('click', off);
    return () => document.removeEventListener('click', off);
  }, []);
  return (
    <details className={`menu${p.className ? ` ${p.className}` : ''}`} ref={ref}>
      <summary aria-label={p.label} title={p.label}>{p.icon ?? '⋮'}</summary>
      <div>
        {p.items.map((it) => (
          <button key={it.label} type="button" disabled={it.disabled} className={`${it.sep ? 'sep' : ''}${it.checked ? ' on' : ''}`}
            onClick={() => { ref.current!.open = false; it.onClick(); }}>{it.label}</button>
        ))}
      </div>
    </details>
  );
}

/** Syntax highlighting: only the kinds that appear on this page: comments, strings (JSON keys get their own color), JSX tags, attribute names,
 *  keywords, numbers. Shared by the generated code and file previews. */
const TOK = /(\/\/.*$)|("(?:[^"\\]|\\.)*")(\s*:)?|(<\/?[A-Z]\w*|\/>)|\b([a-zA-Z_][\w.]*)(?==)|\b(null|undefined|true|false|const)\b|(-?\b\d+(?:\.\d+)?\b)/g;
function hl(line: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of line.matchAll(TOK)) {
    out.push(line.slice(last, m.index));
    const [all, com, str, colon, tag, attr, kw, num] = m;
    const c = com ? 'c-com' : str ? (colon ? 'c-key' : 'c-str') : tag ? 'c-tag' : attr ? 'c-attr' : kw ? 'c-kw' : num ? 'c-num' : '';
    out.push(<i key={m.index} className={c}>{str && colon ? str : all}</i>);
    if (str && colon) out.push(colon);
    last = m.index! + all.length;
  }
  out.push(line.slice(last));
  return out;
}

/** Files (model / profile / layout all are): like email attachments, first a file (icon · name · key facts), click for the preview.
 *  With no file it is a dashed empty slot showing the prop's current value (null). */
function FileChip(p: { name: string | null; meta?: string; text?: string; empty?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  if (!p.name) return <span className="file empty">{p.empty ?? 'null'}</span>;
  return (
    <>
      <button type="button" className="file" title={p.name} onClick={() => ref.current?.showModal()}>
        <svg viewBox="0 0 16 16" width={14} height={14}><path d="M4 1.5h5l3.5 3.5v9.5h-8.5z M9 1.5v3.5h3.5" /></svg>
        <b>{p.name}</b>{p.meta && <em>{p.meta}</em>}
      </button>
      <dialog className="peek" ref={ref} onClick={(e) => { if (e.target === ref.current) ref.current.close(); }}>
        <header>{p.name}<button type="button" className="btn" onClick={() => ref.current?.close()}>×</button></header>
        <pre>{(p.text ?? '').split('\n').map((l, i) => <span key={i} className="pl">{hl(l)}{'\n'}</span>)}</pre>
      </dialog>
    </>
  );
}


/** The header switcher: ‹ name ▾ ›. Arrows go straight to the previous / next; the middle opens a card list (each with one line). */
interface StepItem<V> { value: V; label: string; num?: string; side?: string; desc?: string }
function Stepper<V extends string>(p: { label: string; items: StepItem<V>[]; value: V | null; onChange: (v: V) => void;
  disabled?: boolean; wrap?: boolean; foot?: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const off = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) ref.current.open = false; };
    document.addEventListener('click', off);
    return () => document.removeEventListener('click', off);
  }, []);
  const i = p.items.findIndex((it) => it.value === p.value);
  const at = p.items[i];
  const go = (d: number) => {
    const n = p.items.length;
    const j = p.wrap ? (i + d + n) % n : i + d;
    if (j >= 0 && j < n && j !== i) p.onChange(p.items[j].value);
  };
  return (
    <div className="stepper" role="group" aria-label={p.label}>
      <button type="button" className="st-arrow" aria-label="previous" disabled={p.disabled || (!p.wrap && i <= 0)} onClick={() => go(-1)}>‹</button>
      <details className="st-pick" ref={ref}>
        <summary aria-label={p.label}>{at?.num && <i>{at.num}</i>}<span>{at?.label ?? '—'}</span><b className="kebab">⋮</b></summary>
        <div className="st-pop">
          {p.items.map((it) => (
            <button key={it.value} type="button" disabled={p.disabled} className={`st-it${it.value === p.value ? ' on' : ''}`}
              onClick={() => { ref.current!.open = false; p.onChange(it.value); }}>
              <span className="st-t">{it.num && <i>{it.num}</i>}<b>{it.label}</b>{it.side && <em>{it.side}</em>}</span>
              {it.desc && <span className="st-d">{it.desc}</span>}
            </button>
          ))}
          {p.foot && <div className="st-foot">{p.foot}</div>}
        </div>
      </details>
      <button type="button" className="st-arrow" aria-label="next" disabled={p.disabled || (!p.wrap && i >= p.items.length - 1)} onClick={() => go(1)}>›</button>
    </div>
  );
}

/** The version icon: every version is the same kind of file, so every tile shows the same brain (no thumbnails), like a folder of documents in Finder. */
const Brain = () => (
  <svg viewBox="0 0 24 24" width={36} height={36} aria-hidden>
    <path className="b-fill" d="M12 5.2c-1-1.4-3.4-1.5-4.6-.2-2 .1-3.3 1.9-2.8 3.7-1.5 1-1.6 3.3-.3 4.4-.6 1.8.6 3.7 2.5 3.8.6 1.6 2.9 2.4 4.1 1.1.4.4 1.1.5 1.1.5s.7-.1 1.1-.5c1.2 1.3 3.5.5 4.1-1.1 1.9-.1 3.1-2 2.5-3.8 1.3-1.1 1.2-3.4-.3-4.4.5-1.8-.8-3.6-2.8-3.7-1.2-1.3-3.6-1.2-4.6.2z" />
    <path d="M12 5.2v13.3M7.6 9.4c1.1-.1 2 .6 2.2 1.7M16.4 9.4c-1.1-.1-2 .6-2.2 1.7M7.9 14.4c.9-.6 2-.5 2.6.2M16.1 14.4c-.9-.6-2-.5-2.6.2" />
  </svg>
);

/** Versions as icons in a row, Finder style: the current one has its name in an accent pill; when comparing, the one compared against has a grey pill.
 *  The row scrolls sideways, the mouse wheel included. */
function Tiles(p: { items: { value: VerId; label: string; title: string }[]; cur: VerId; refV: VerId | null; diff: boolean;
  cands: VerId[]; disabled?: boolean; onPick: (v: VerId, asRef: boolean) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current!;
    const wheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);
  // Keep the current version in sight (switching from the code or the form moves it too).
  useEffect(() => {
    const el = box.current!, t = el.querySelector<HTMLElement>('.tile.on');
    if (!t) return;
    const l = t.offsetLeft - 6, r = t.offsetLeft + t.offsetWidth + 6 - el.clientWidth;
    if (l < el.scrollLeft) el.scrollTo({ left: l, behavior: 'smooth' });
    else if (r > el.scrollLeft) el.scrollTo({ left: r, behavior: 'smooth' });
  }, [p.cur]);
  return (
    <div className="tiles" ref={box} role="listbox" aria-orientation="horizontal">
      {p.items.map((it) => {
        const on = it.value === p.cur, isRef = p.diff && it.value === p.refV;
        return (
          <button key={it.value} type="button" role="option" aria-selected={on} title={it.title} disabled={p.disabled}
            className={`tile${on ? ' on' : ''}${isRef ? ' ref' : ''}${p.diff && !on && !p.cands.includes(it.value) ? ' off' : ''}`}
            onClick={(e) => p.onPick(it.value, p.diff && (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey))}>
            <span className="tile-i"><Brain /></span>
            <span className="tile-n">{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The code view: every prop as a line, defaults faint, changed ones bright, the line that just changed flashes.
 *  Click a line and that prop's control pops up under it; lines with no control (scaffolding) do nothing. */
function CodeView(p: { lines: CodeLine[]; head: (extra: ReactNode) => ReactNode; copy: string; copied: string; control: (k: string) => ReactNode }) {
  const prev = useRef(new Map<string, string>());
  const gen = useRef(new Map<string, number>());
  for (const l of p.lines) {
    const was = prev.current.get(l.k);
    if (was !== undefined && was !== l.text) gen.current.set(l.k, (gen.current.get(l.k) ?? 0) + 1);
  }
  useEffect(() => { prev.current = new Map(p.lines.map((l) => [l.k, l.text])); });
  const [done, setDone] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [top, setTop] = useState(0);
  /** Room kept under the code so a popover on the last lines can still be scrolled fully into view. */
  const [room, setRoom] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const base = (k: string) => k.split(/[^a-zA-Z]/)[0];
  // The popover hangs under its line; the line can rewrap when its value changes, so measure after every render.
  useLayoutEffect(() => {
    if (!open) return;
    const el = wrap.current?.querySelector<HTMLElement>(`.ln[data-k="${open}"]`);
    if (!el) { setOpen(null); return; }
    setTop(el.offsetTop + el.offsetHeight);
    const w = wrap.current!, h = pop.current?.offsetHeight ?? 0;
    setRoom(Math.max(0, el.offsetTop + el.offsetHeight + h + 32 - (w.offsetHeight - room)));
  });
  useEffect(() => { if (open) pop.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [open, room]);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => {
      const t = e.target as Element;
      if (!pop.current?.contains(t) && !t.closest?.('.ln') && !t.closest?.('dialog')) setOpen(null);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    document.addEventListener('pointerdown', off);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', off); document.removeEventListener('keydown', esc); };
  }, [open]);
  const body = open ? p.control(base(open)) : null;
  return (
    <div className="code" ref={wrap} style={open && room ? { paddingBottom: 16 + room } : undefined}>
      {p.head(
        <button type="button" className="link" onClick={() => {
          navigator.clipboard?.writeText(p.lines.map((l) => l.text).join('\n'));
          setDone(true); setTimeout(() => setDone(false), 1200);
        }}>{done ? p.copied : p.copy}</button>,
      )}
      <pre>{p.lines.map((l) => {
        const g = gen.current.get(l.k) ?? 0;
        const has = !!p.control(base(l.k));
        return (
          <span key={`${l.k}:${g}`} data-k={l.k}
            className={`ln ${l.state}${g ? ' flash' : ''}${has ? ' has' : ''}${open === l.k ? ' open' : ''}`}
            onClick={has ? () => setOpen((o) => (o === l.k ? null : l.k)) : undefined}>{l.text ? hl(l.text) : ' '}</span>
        );
      })}</pre>
      {body && <div className="pop" ref={pop} style={{ top }}>{body}</div>}
    </div>
  );
}

/* ── Page ───────────────────────────────────────────────────────────────── */

function App() {
  const [lang, setLang] = useState<Lang>('en');
  const T: Text = TEXT[lang];
  useEffect(() => { document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'; }, [lang]);
  const [proj, setProj] = useState(PROJECTS[0]);
  const [mode, setMode] = useState<'browse' | 'diff'>('browse');
  const [rounds, setRounds] = useState<number>(DEFAULT_DIFF_LAYOUT.rounds);
  const [iters, setIters] = useState<number>(DEFAULT_DIFF_LAYOUT.iterations);
  const [snap, setSnap] = useState<boolean>(DEFAULT_DIFF_LAYOUT.snap);
  const [fuse, setFuse] = useState<{ steps: { side: string; iterations: number }[]; layoutMs: number } | null>(null);
  const [cur, setCur] = useState<VerId>(versionsOf(PROJECTS[0])[0]);
  const [ref_, setRef] = useState<VerId | null>(null);
  /** Whether the reference was clicked by the user or picked automatically. An automatic one follows the current version; one the user clicked stays put. */
  const refPinned = useRef(false);
  const [view, setView] = useState<GraphView>({});
  /** The account of the last transition (only shown with `?dev`). */
  const [log, setLog] = useState<(TransitionReport & { layoutMs: number; animated: boolean }) | null>(null);
  const [anim, setAnim] = useState(true);
  /** Playing: the data switch controls grey out (the library queues too; this only makes it visible). */
  const [busy, setBusy] = useState(false);
  const [dur, setDur] = useState(DEFAULT_ANIMATE.duration);
  const [drift, setDrift] = useState(DEFAULT_ANIMATE.drift);
  const [bounce, setBounce] = useState(DEFAULT_ANIMATE.bounce);
  const [nodeScale, setNodeScale] = useState(() => lookOf(PROJECTS[0]).nodeScale);
  const [labelSpacing, setLabelSpacing] = useState(() => lookOf(PROJECTS[0]).labelSpacing);
  const [semanticOpacity, setSemanticOpacity] = useState(() => lookOf(PROJECTS[0]).semanticOpacity);
  /* Layout: which preset to use (none / _layout.json in the data folder / the stored one, per project), how to solve,
   * and what onLayout last reported. */
  const [picks, setPicks] = useState<Record<string, 'none' | 'file' | 'saved'>>({});
  const [saved, setSaved] = useState<Record<string, Layouts>>({});
  const [layoutMode, setLayoutMode] = useState<'fresh' | 'continue'>('fresh');
  const [lastLayout, setLastLayout] = useState<{ pos: Positions; info: LayoutInfo } | null>(null);
  const layoutInput = useRef<HTMLInputElement>(null);
  /* The canvas's built-in control toggles (controls), and whether it is editable (whether onEdit is passed). */
  const [controls, setControls] = useState<Partial<Record<ControlId, boolean>>>({});
  const [editable, setEditable] = useState(true);
  /** The lower card shows the settings (props) or the same settings as code. */
  const [pane, setPane] = useState<'props' | 'code'>('props');
  /* Object props can also load your own, besides the built-in options. */
  const [profPicks, setProfPicks] = useState<Record<string, 'own' | 'default' | 'loaded'>>({});
  const [profLoaded, setProfLoaded] = useState<Record<string, GraphProfile>>({});
  /* Custom: a language pack (partial override, missing keys fall back to built-in), a theme override (on top of light / dark). */
  const [customStrings, setCustomStrings] = useState<Partial<GraphStrings> | null>(null);
  const [themeExtra, setThemeExtra] = useState<Partial<GraphTheme> | null>(null);
  /** Look changes from the legend, one per project: every project has different kinds, so after switching away and back the picked colors are still there. */
  const [looks, setLooks] = useState<Record<string, GraphLook>>({});
  /** On narrow screens the sidebar is a drawer pulled out from the left. */
  const [railOpen, setRailOpen] = useState(false);
  const dp = profileOf(projOf(cur));
  /* Theme: follow the system (default) / light / dark. The library has no "follow the system" value: the host picks LIGHT_THEME or
   * DARK_THEME by the system preference, so this page listens for system changes itself. */
  const [themeMode, setThemeMode] = useState<'system' | 'light' | 'dark'>('system');
  const [sysDark, setSysDark] = useState(() => {
    const d = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    // The first frame is drawn with this theme; setting it in an effect would flash one light frame on a dark system.
    document.documentElement.dataset.theme = d ? 'dark' : 'light';
    return d;
  });
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const on = () => setSysDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const dark = themeMode === 'system' ? sysDark : themeMode === 'dark';
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }, [dark]);

  const cands = useMemo(() => diffCandidates(cur), [cur]);
  /** The default reference is **the version right before it in the same project**: only adjacent versions answer "what did this step do". */
  const defaultRef = useMemo(() => {
    const mine = versionsOf(projOf(cur));
    const i = mine.indexOf(cur);
    for (let k = i - 1; k >= 0; k--) if (cands.includes(mine[k])) return mine[k];
    return cands[0] ?? null;
  }, [cands, cur]);
  useEffect(() => {
    if (!ref_ || !cands.includes(ref_) || !refPinned.current) setRef(defaultRef);
  }, [cands, defaultRef]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (projOf(cur) !== proj) setCur(versionsOf(proj)[0]);
    const l = lookOf(proj);
    setNodeScale(l.nodeScale); setLabelSpacing(l.labelSpacing); setSemanticOpacity(l.semanticOpacity);
    // After switching datasets, the previous one's file names mean nothing (the library ignores them too; this just keeps them out of state).
    setView((v) => (v.origins ? { ...v, origins: null } : v));
  }, [proj]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!cands.length && mode === 'diff') setMode('browse'); }, [cands, mode]);

  /* Edits on this version. An edit is a different set of data: the transition plays it as usual. */
  const [, bump] = useState(0);
  const ops = draftOf(cur);
  const setOps = useCallback((v: VerId, next: EditOp[]) => { saveDraft(v, next); bump((x) => x + 1); }, []);
  const baseModel = load(cur);
  const edited = useMemo(
    () => (ops.length ? applyEdits(baseModel, ops, dp.profile) : { model: baseModel, skipped: [] }),
    [baseModel, ops, dp], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const curModel = edited.model;
  const onEdit = useCallback((op: EditOp) => setOps(cur, [...draftOf(cur), op]), [cur, setOps]);

  /* Open / drop in a folder. */
  const [dragging, setDragging] = useState(false);
  const folderInput = useRef<HTMLInputElement>(null);
  const take = useCallback(async (files: File[]) => {
    const list = await readAll(files);
    const got = addImported(list);
    if (got) {
      if (got.patch) setOps(got.ver, got.patch);
      setMode('browse');
      setProj(projOf(got.ver));
      setCur(got.ver);
      return;
    }
    // Only a patch was dropped in: apply it to the current version.
    for (const f of list) {
      try { const v = JSON.parse(f.text); if (isPatch(v)) { setOps(cur, v.ops); return; } } catch { /* not json, never mind */ }
    }
  }, [cur, setOps]);

  const refModel = mode === 'diff' && ref_ ? load(ref_) : null;
  const delta: GraphDelta | null = useMemo(
    () => (refModel && ref_
      ? diffModels(refModel, curModel, {
        key: HOST.matchKey, ignore: HOST.ignore,
        labels: { before: verLabel(ref_).name, after: verLabel(cur).name },
      })
      : null),
    [refModel, curModel, ref_, cur],
  );
  const model = delta ? delta.model : curModel;
  const base: GraphTheme = { ...(dark ? DARK_THEME : LIGHT_THEME), ...themeExtra };
  /** The strings the canvas actually gets. */
  const canvasStrings = customStrings ? { ...(lang === 'zh' ? ZH_CN : {}), ...customStrings } : lang === 'zh' ? ZH_CN : undefined;
  const profPick = profPicks[proj] ?? 'own';
  const setProf = (v: 'own' | 'default' | 'loaded') => setProfPicks((m) => ({ ...m, [proj]: v }));
  /** The profile the canvas uses: the dataset's own / the library default / a loaded one. Affects only drawing, not parsing. */
  const canvasProfile = profPick === 'default' ? defaultProfile : profPick === 'loaded' && profLoaded[proj] ? profLoaded[proj] : dp.profile;
  /* The header and the form change the same state: the header gives the common choices (custom loaded ones show there too and can be cancelled),
   * the form gives everything (plus loading). */
  const themeMenu = (names: [string, string, string], withLoad: boolean): MenuItem[] => [
    { label: names[0], checked: themeMode === 'system', onClick: () => setThemeMode('system') },
    { label: names[1], checked: themeMode === 'light', onClick: () => setThemeMode('light') },
    { label: names[2], checked: themeMode === 'dark', onClick: () => setThemeMode('dark') },
    ...(withLoad ? [{ label: T.load, sep: true, onClick: () => loadJson((v) => setThemeExtra(v)) }] : []),
    ...(themeExtra ? [{ label: T.customTheme, checked: true, sep: !withLoad, onClick: () => setThemeExtra(null) }] : []),
  ];
  const themePick = themeMenu([T.followSystem, T.lightName, T.darkName], false);
  const themeItems = themeMenu([T.followSystem, 'LIGHT_THEME', 'DARK_THEME'], true);
  const stringsMenu = (names: [string, string], withLoad: boolean): MenuItem[] => [
    { label: names[0], checked: !customStrings && lang === 'en', onClick: () => { setCustomStrings(null); setLang('en'); } },
    { label: names[1], checked: !customStrings && lang === 'zh', onClick: () => { setCustomStrings(null); setLang('zh'); } },
    ...(withLoad ? [{ label: T.load, sep: true, onClick: () => loadJson((v) => setCustomStrings(v)) }] : []),
    ...(customStrings ? [{ label: T.customStrings, checked: true, sep: !withLoad, onClick: () => setCustomStrings(null) }] : []),
  ];
  const stringsPick = stringsMenu(['EN', '中文'], false);
  const stringsItems = stringsMenu(['EN', 'ZH_CN'], true);
  const resolveUrl = useMemo(() => {
    const at = dp.meta.assetBase;
    return at ? (u: string) => new URL(u.replace(/^\//, ''), at.endsWith('/') ? at : `${at}/`).href : undefined;
  }, [dp]);
  /** Compare on / off. Comparing reads "earlier → this"; on the first version there is nothing earlier, so step to the next one first. */
  const toggleDiff = (on: boolean) => {
    if (busy || !cands.length) return;
    if (on && !refPinned.current && defaultRef && projOf(defaultRef) === projOf(cur)) {
      const mine = versionsOf(projOf(cur));
      if (mine.indexOf(defaultRef) > mine.indexOf(cur)) setCur(defaultRef);
    }
    setMode(on ? 'diff' : 'browse');
  };
  const pickProj = (p: string) => { setProj(p); setRailOpen(false); };
  const desc = (p: string) => profileOf(p).meta.description?.[lang] ?? profileOf(p).meta.description?.en ?? '';
  const src = profileOf(proj).meta.source, srcText = src?.[lang] ?? src?.en;
  const curLabel = verLabel(cur);
  const pick = picks[proj] ?? (fileLayouts(proj) ? 'file' : 'none');
  const setPick = (v: 'none' | 'file' | 'saved') => setPicks((m) => ({ ...m, [proj]: v }));
  /** Which set is used (from the file / stored / none), and this version's entry in it. */
  const source = pick === 'file' ? fileLayouts(proj) : pick === 'saved' ? saved[proj] ?? null : null;
  const preset = source?.[nameOf(cur)] ?? null;
  /** Store one (loaded / "store current") and use it. */
  const keep = (l: Layouts) => { setSaved((m) => ({ ...m, [proj]: l })); setPick('saved'); };
  const code = codeLines({
    diff: mode === 'diff', proj, preset, layoutMode, editable, controls, dark, lang, anim, dur, drift, bounce,
    nodeScale, labelSpacing, semanticOpacity, rounds, iters, snap, assetBase: !!dp.meta.assetBase,
    prof: profPick, themeMode, customStrings: !!customStrings, themeExtra: !!themeExtra,
  });

  /* Every setting as a row, by prop. The props view lists them in groups; the code view pops the same row up under its line. */
  const R = {
    model: (
      <Row name="model" k="model" desc={T.modelIs}>
        <FileChip name={`${nameOf(cur)}/`} meta={T.modelMeta(curModel.nodes.length)} text={sampleOf(curModel)} />
        <Menu label={T.more} items={[
          ...versionsOf(proj).map((v) => ({ label: nameOf(v), checked: v === cur, onClick: () => setCur(v) })),
          { label: T.openFolder, sep: true, onClick: () => folderInput.current?.click() },
        ]} />
      </Row>
    ),
    diff: (
      <Row name="diff" k="diff" desc={T.diffIs}>
        {mode === 'diff' && ref_ && <>
          <FileChip name={`${nameOf(ref_)}/`} meta={T.before} text={sampleOf(load(ref_))} />
          <Menu label={T.more} items={cands.map((v) => ({ label: projOf(v) === proj ? nameOf(v) : v, checked: v === ref_, onClick: () => { refPinned.current = true; setRef(v); } }))} />
        </>}
        <Switch on={mode === 'diff'} label="" onChange={toggleDiff} />
      </Row>
    ),
    profile: (
      <Row name="profile" k="profile" desc={T.profileIs}>
        <FileChip name={profPick === 'default' ? 'defaultProfile' : profPick === 'loaded' ? T.loadedName : profileText(projOf(cur)) ? '_profile.json' : OWN_PROFILE}
          meta={T.kinds(Object.keys(canvasProfile.kindLabels).length)}
          text={profPick === 'own' ? profileShown(projOf(cur)) ?? '' : JSON.stringify(canvasProfile, (k, v) => (typeof v === 'function' ? undefined : v), 1)} />
        <Menu label={T.more} items={[
          { label: profileText(projOf(cur)) ? '_profile.json' : OWN_PROFILE, checked: profPick === 'own', onClick: () => setProf('own') },
          { label: 'defaultProfile', checked: profPick === 'default', onClick: () => setProf('default') },
          ...(profLoaded[proj] ? [{ label: T.loadedName, checked: profPick === 'loaded', onClick: () => setProf('loaded') }] : []),
          { label: T.load, sep: true, onClick: () => loadJson((v) => { setProfLoaded((m) => ({ ...m, [proj]: defineProfile({ id: proj, ...v }) })); setProf('loaded'); }) },
        ]} />
      </Row>
    ),
    layout: (
      <Row name="layout" k="layout" desc={T.layoutIs}>
        <FileChip name={source ? (pick === 'file' ? '_layout.json' : T.savedName) : null}
          meta={preset ? T.points(Object.keys(preset).length) : T.noEntry}
          text={preset ? `// ${nameOf(cur)}\n${JSON.stringify(preset, null, 1)}` : ''} />
        <Menu label={T.more} items={[
          ...(fileLayouts(proj) ? [{ label: '_layout.json', checked: pick === 'file', onClick: () => setPick('file') }] : []),
          ...(saved[proj] ? [{ label: T.savedName, checked: pick === 'saved', onClick: () => setPick('saved') }] : []),
          { label: 'null', checked: pick === 'none', onClick: () => setPick('none') },
          { label: T.load, sep: true, onClick: () => layoutInput.current?.click() },
          { label: T.saveCur, disabled: !lastLayout, onClick: () => lastLayout && keep({ ...source, [nameOf(cur)]: lastLayout.pos }) },
          { label: T.exportIt, disabled: !source, onClick: () => source && download('_layout.json', JSON.stringify(source)) },
        ]} />
      </Row>
    ),
    layoutMode: (
      <Row name="layoutMode" k="layoutMode" desc={T.modeIs}>
        <Segmented items={[{ value: 'fresh' as const, label: 'fresh' }, { value: 'continue' as const, label: 'continue' }]}
          value={layoutMode} onChange={setLayoutMode} />
      </Row>
    ),
    onLayout: (
      <Row name="onLayout" k="onLayout" desc={T.lastIs}>
        <span className={`pill${lastLayout ? ` src-${lastLayout.info.source}` : ''}`}>{lastLayout ? T.src[lastLayout.info.source] : '—'}</span>
        <Menu label={T.more} items={[{ label: 'clearLayoutCache()', onClick: clearLayoutCache }]} />
      </Row>
    ),
    onEdit: (
      <Row name="onEdit" k="onEdit" desc={T.editIs}>
        {ops.length > 0 && <>
          <span className="pill">{T.edits(ops.length)}</span>
          <Menu label={T.more} items={[
            { label: T.undo, disabled: busy, onClick: () => setOps(cur, ops.slice(0, -1)) },
            { label: T.exportPatch, onClick: () => download(`${nameOf(cur)}.patch.json`, JSON.stringify({ glassbrain: 'patch', base: cur, ops }, null, 2)) },
            { label: T.exportGraph, onClick: () => download(`${nameOf(cur)}.json`, JSON.stringify(toPhysical(curModel), null, 1)) },
            { label: T.discard, disabled: busy, onClick: () => setOps(cur, []) },
          ]} />
        </>}
        <Switch on={editable} label="" onChange={setEditable} />
      </Row>
    ),
    look: (
      <Row name="look" k="look" desc={T.lookIs}>
        <FileChip name="look" meta={T.changed(overrides(looks[proj]))} text={JSON.stringify(looks[proj] ?? {}, null, 1)} />
        <Menu label={T.more} items={[
          { label: T.reset, disabled: !overrides(looks[proj]), onClick: () => setLooks((m) => { const { [proj]: _, ...rest } = m; return rest; }) },
          { label: T.exportIt, onClick: () => download('look.json', JSON.stringify(looks[proj] ?? {}, null, 2)) },
          { label: T.load, onClick: () => loadJson((v) => setLooks((m) => ({ ...m, [proj]: v }))) },
        ]} />
      </Row>
    ),
    view: (
      <Row name="view" k="view" desc={T.viewIs}>
        <FileChip name="view" meta={T.hidden(hiddenOf(view))} text={JSON.stringify(view, null, 1)} />
        <Menu label={T.more} items={[
          { label: T.reset, disabled: !Object.keys(view).length, onClick: () => setView({}) },
        ]} />
      </Row>
    ),
    controls: (
      <Row name="controls" k="controls" desc={T.controlsIs} below={
        <div className="chips">
          {ALL_CONTROLS.map((c) => (
            <button key={c} type="button" className={`chip${controls[c] !== false ? ' on' : ''}`} aria-pressed={controls[c] !== false}
              title={T.ctl[c]} onClick={() => setControls((m) => ({ ...m, [c]: m[c] === false }))}>{c}</button>
          ))}
        </div>
      } />
    ),
    strings: (
      <Row name="strings" k="strings" desc={T.stringsIs}>
        <FileChip name={`${lang === 'zh' ? 'ZH_CN' : 'EN'}${customStrings ? ' +' : ''}`} meta={customStrings ? T.loadedName : lang === 'zh' ? 'strings-zh.ts' : T.builtIn}
          text={packText({ ...(lang === 'zh' ? ZH_CN : EN), ...customStrings })} />
        <Menu label={T.more} items={stringsItems} />
      </Row>
    ),
    theme: (
      <Row name="theme" k="theme" desc={T.themeIs}>
        <FileChip name={`${dark ? 'DARK_THEME' : 'LIGHT_THEME'}${themeExtra ? ' +' : ''}`}
          meta={themeExtra ? T.loadedName : themeMode === 'system' ? T.systemName : T.builtIn} text={JSON.stringify(base, null, 1)} />
        <Menu label={T.more} items={themeItems} />
      </Row>
    ),
    animate: <Row name="animate" k="animate" desc={T.animateIs}><Switch on={anim} label="" onChange={setAnim} /></Row>,
    nodeScale: (
      <Row name="nodeScale" k="nodeScale" desc={T.nodeScaleIs}>
        <Range label="nodeScale" min={0.4} max={3} step={0.1} value={nodeScale} onChange={setNodeScale} show={nodeScale.toFixed(1)} />
      </Row>
    ),
    labelSpacing: (
      <Row name="labelSpacing" k="labelSpacing" desc={T.labelSpacingIs}>
        <Range label="labelSpacing" min={0} max={24} step={1} value={labelSpacing} onChange={setLabelSpacing} show={`${labelSpacing}`} />
      </Row>
    ),
    semanticOpacity: (
      <Row name="semanticOpacity" k="semanticOpacity" desc={T.semanticOpacityIs}>
        <Range label="semanticOpacity" min={0.1} max={1} step={0.05} value={semanticOpacity} onChange={setSemanticOpacity} show={semanticOpacity.toFixed(2)} />
      </Row>
    ),
    duration: (
      <Row name="animate.duration" desc={T.durationIs}>
        <Range label="duration" min={120} max={5000} step={20} value={dur} onChange={setDur} show={`${dur}`} disabled={!anim} />
      </Row>
    ),
    drift: (
      <Row name="animate.drift" desc={T.driftIs}>
        <Range label="drift" min={0} max={0.1} step={0.0025} value={drift} onChange={setDrift} show={drift.toFixed(3)} disabled={!anim} />
      </Row>
    ),
    bounce: (
      <Row name="animate.bounce" desc={T.bounceIs}>
        <Range label="bounce" min={0} max={3} step={0.05} value={bounce} onChange={setBounce} show={bounce.toFixed(2)} disabled={!anim} />
      </Row>
    ),
    rounds: (
      <Row name="diffLayout.rounds" k="diffLayout" desc={T.roundsIs}>
        <Range label="rounds" min={0} max={8} step={1} value={rounds} onChange={setRounds} show={`${rounds}`} />
      </Row>
    ),
    iters: (
      <Row name="diffLayout.iterations" desc={T.itersIs}>
        <Range label="iterations" min={0} max={24} step={1} value={iters} onChange={setIters} show={`${iters}`} />
      </Row>
    ),
    snap: <Row name="diffLayout.snap" desc={T.snapIs}><Switch on={snap} label="" onChange={setSnap} /></Row>,
  };
  /** Which rows a line of code pops up (by the line's key); a key not listed here has no control. */
  const control = (k: string): ReactNode => {
    switch (k) {
      case 'pre': case 'diff': return R.diff;
      case 'animate': return <>{R.animate}{R.duration}{R.drift}{R.bounce}</>;
      case 'diffLayout': return <>{R.rounds}{R.iters}{R.snap}</>;
      default: return k in R ? R[k as keyof typeof R] : null;
    }
  };
  const fileInputs = (
    <input ref={layoutInput} type="file" hidden accept=".json,application/json"
      onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { try { keep(asLayouts(JSON.parse(await f.text()), nameOf(cur))); } catch { /* not json, never mind */ } } }} />
  );

  return (
    <div
      className={`app${dragging ? ' is-drop' : ''}${railOpen ? ' rail-open' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target || !e.relatedTarget) setDragging(false); }}
      onDrop={(e) => { e.preventDefault(); setDragging(false); droppedFiles(e.dataTransfer).then(take); }}
    >
      {/* Narrow screens: a bar at the top with the menu and what is being looked at. */}
      <div className="topbar">
        <button type="button" className="icon" aria-label={T.menu} onClick={() => setRailOpen(true)}>
          <svg viewBox="0 0 24 24" width={18} height={18}><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>
        <span className="tb-ds">{proj}</span>
        <span className="tb-ver">{curLabel.name}</span>
      </div>
      <div className="scrim" onClick={() => setRailOpen(false)} />

      <aside className="rail">
        {/* Top: a Finder-like panel for what is being looked at: which dataset, which version, compare or not; language and theme in the corner.
            It changes the same state as the card below: the common choices here, everything below. */}
        <header className="finder">
          <div className="f-top">
            <i className="dot" />
            <h1><a href="https://github.com/voidixyn/glassbrain" target="_blank" rel="noreferrer">glassbrain</a></h1>
            <Menu label={T.langIcon} className="pm" items={stringsPick}
              icon={<><svg viewBox="0 0 24 24" width={14} height={14}><path d="M4 5h9M8.5 3v2M11 5c-1 4-3.5 7-6.5 8.5M6.5 8.5c1.5 2.3 3.5 3.8 5.5 4.5M13 21l4.5-10 4.5 10M14.5 18h6" /></svg>
                <span>{lang === 'zh' ? '中文' : 'EN'}{customStrings ? ' +' : ''}</span><b>⋮</b></>} />
            <Menu label={T.themeIcon} className="pm" items={themePick}
              icon={<>{themeMode === 'system'
                ? <svg viewBox="0 0 24 24" width={14} height={14}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>
                : dark
                ? <svg viewBox="0 0 24 24" width={14} height={14}><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></svg>
                : <svg viewBox="0 0 24 24" width={14} height={14}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>}
                <span>{themeMode === 'system' ? T.systemName : dark ? T.darkName : T.lightName}{themeExtra ? ' +' : ''}</span><b>⋮</b></>} />
            <button type="button" className="icon close" aria-label={T.close} onClick={() => setRailOpen(false)}>
              <svg viewBox="0 0 24 24" width={16} height={16}><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>
          <div className="f-ds">
            <div className="f-bar">
              <span className="lead" title={T.dataset}><svg viewBox="0 0 24 24" width={15} height={15}><ellipse cx="12" cy="5.5" rx="7.5" ry="2.8" /><path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8" /></svg></span>
              <Stepper label={T.dataset} value={proj} disabled={busy} wrap onChange={pickProj}
                items={PROJECTS.map((p) => ({ value: p, label: p, side: `${versionsOf(p).length}`, desc: desc(p) }))}
                foot={<button type="button" className="link" disabled={busy} onClick={() => folderInput.current?.click()}>{T.openFolder} <span>{T.dropHint}</span></button>} />
            </div>
            {/* Compare is a mode of the version row below, so its switch sits right above it. */}
            <button type="button" className={`f-cmp${mode === 'diff' ? ' on' : ''}`} aria-pressed={mode === 'diff'} disabled={busy || !cands.length}
              aria-label={T.compareIcon} title={T.compareIcon} onClick={() => toggleDiff(mode !== 'diff')}>
              <svg viewBox="0 0 24 24" width={17} height={17}><rect x="3.5" y="3.5" width="17" height="17" rx="5" /><path d="M12 7.5v5.5M9.25 10.25h5.5M9.25 16.5h5.5" /></svg>
            </button>
          </div>
          {fileInputs}
          <input ref={folderInput} type="file" hidden multiple {...{ webkitdirectory: '', directory: '' } as Record<string, string>}
            onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; if (fs.length) take(fs); }} />
          <Tiles cur={cur} refV={ref_} diff={mode === 'diff'} cands={cands} disabled={busy}
            items={versionsOf(proj).map((v) => ({ value: v, label: verLabel(v).name, title: mode === 'diff' ? `${nameOf(v)} · ${T.refClick}` : nameOf(v) }))}
            onPick={(v, asRef) => {
              if (!asRef) setCur(v);
              else if (v !== cur && cands.includes(v)) { refPinned.current = true; setRef(v); }
            }} />
          {mode !== 'diff' && srcText && <p className="f-src">{renderInline(srcText, { resolveUrl: (u) => new URL(u, REPO).href })}</p>}
          {mode === 'diff' && ref_ && (
            <div className="f-diff">
              <Menu label={T.before} className="pm" items={cands.map((v) => ({ label: projOf(v) === proj ? verLabel(v).name : v, checked: v === ref_, onClick: () => { refPinned.current = true; setRef(v); } }))}
                icon={<><i className="sw-ref" /><span>{projOf(ref_) === proj ? verLabel(ref_).name : ref_}</span><b>⋮</b></>} />
              <span className="f-arrow">→</span>
              <span className="f-after"><i className="sw-cur" />{curLabel.name}</span>
              <em>{T.refHint}</em>
            </div>
          )}
        </header>

        {/* Bottom: one card, props or code. The switch stays in the card's corner; the title scrolls away with the content. */}
        <section className="card">
          <div className="card-tog" role="group">
            <button type="button" className={pane === 'code' ? 'on' : ''} aria-pressed={pane === 'code'} aria-label={T.code} title={T.codeToggle} onClick={() => setPane('code')}>
              <svg viewBox="0 0 24 24" width={16} height={16}><path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" /></svg>
            </button>
            <button type="button" className={pane === 'props' ? 'on' : ''} aria-pressed={pane === 'props'} aria-label={T.props} title={T.props} onClick={() => setPane('props')}>
              <svg viewBox="0 0 24 24" width={16} height={16}><rect x="3.5" y="4.5" width="17" height="15" rx="3" /><path d="M7.5 9.5h1M11 9.5h5.5M7.5 14.5h1M11 14.5h5.5" /></svg>
            </button>
          </div>
          <div className="card-body">
            {pane === 'props' ? (
              <div className="settings">
                <div className="card-h"><h2>{T.props}</h2></div>
                <p className="thesis">{T.tagline}</p>
                <Group title={T.gData}>{R.model}{R.diff}{R.profile}</Group>
                <Group title={T.gLayout}>{R.layout}{R.layoutMode}{R.onLayout}</Group>
                <Group title={T.gInteract} props="onEdit · look · view · controls" count={4} open={false}>{R.onEdit}{R.look}{R.view}{R.controls}</Group>
                <Group title={T.gLook} props="strings · theme · animate · nodeScale · labelSpacing · semanticOpacity" count={6} open={false}>
                  {R.strings}{R.theme}{R.animate}{R.nodeScale}{R.labelSpacing}{R.semanticOpacity}
                </Group>
                <Group title={T.gAdvanced} props="animate.duration · animate.drift · animate.bounce · diffLayout.*" count={mode === 'diff' ? 6 : 3} open={false}>
                  {R.duration}{R.drift}{R.bounce}
                  {mode === 'diff' && <>{R.rounds}{R.iters}{R.snap}</>}
                </Group>
                {DEV && (
                  <div className="log">
                    {log && <span>{log.animated ? 'played' : 'placed'} · union {log.total} · moved {log.moved}{log.moved > 0 && ` (median ${log.movedMedian})`} · in {log.entering} · out {log.leaving}
                      {log.relocated > 0 && ` · relinked ${log.relocated}`} · edges +{log.edgesIn}/−{log.edgesOut} · layout {log.layoutMs}ms</span>}
                    {mode === 'diff' && fuse && <span>fusion {fuse.steps.map((st) => `${st.side === 'before' ? 'B' : 'A'}${st.iterations}`).join(' → ') || '—'} · {fuse.layoutMs}ms</span>}
                  </div>
                )}
              </div>
            ) : (
              <CodeView lines={code} copy={T.copy} copied={T.copied} control={control}
                head={(extra) => <div className="card-h"><h2>{T.code}</h2>{extra}</div>} />
            )}
          </div>
        </section>
      </aside>

      <main className="stage">
        <GraphCanvas
          model={model}
          profile={canvasProfile}
          theme={base}
          // No pool = the main-thread path: this page is a single file opened by double click, and browsers disable Worker under file://.
          view={view}
          onViewChange={setView}
          look={looks[proj] ?? {}}
          onLookChange={(l) => setLooks((m) => ({ ...m, [proj]: l }))}
          diff={delta}
          strings={canvasStrings}
          onEdit={editable ? onEdit : undefined}
          resolveUrl={resolveUrl}
          diffLayout={{ rounds, iterations: iters, snap }}
          onDiffLayout={setFuse}
          matchKey={HOST.matchKey}
          animate={anim ? { duration: dur, drift, bounce } : false}
          nodeScale={nodeScale}
          labelSpacing={labelSpacing}
          semanticOpacity={semanticOpacity}
          layout={preset}
          layoutMode={layoutMode}
          onLayout={(pos, info) => setLastLayout({ pos, info })}
          controls={controls}
          onTransition={(r) => { setLog(r); if (DEV) console.log('[glassbrain transition]', r); }}
          onBusy={setBusy}
          onReady={(cy) => { Object.assign(window as any, { __kg_cy: cy }); }}
          note={delta && ref_
            ? <span><b>{verLabel(ref_).name}</b> → <b>{curLabel.name}</b> · {T.changes(delta.changes.length)}</span>
            : <span><b>{curLabel.name}</b> · {T.nodes(curModel.nodes.length)}</span>}
        />
      </main>
    </div>
  );
}

document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS }));
createRoot(document.getElementById('root')!).render(<App />);
