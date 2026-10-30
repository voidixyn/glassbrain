/* CLI · what happens after reading: build the model, validate, compare (pure functions, run in node and the browser)
 *
 * Only imports pure modules from src (model / profile / diff); no React, no cytoscape.
 */
import { diffModels, type GraphDelta } from '../src/diff';
import type { GraphModel } from '../src/model';
import { defineProfile, parseSources, validateStructure, type GraphIssue, type GraphProfile } from '../src/profile';
import graphSchema from '../schema/graph.schema.json';
import profileSchema from '../schema/profile.schema.json';
import { checkSchema } from './schema-check';
import type { Loaded, Version } from './load';

/** `_profile.json` JSON → profile (read the same way as the demo: `edgeLabels` merge into kindLabels; `demo` is not a library field). */
export function profileFromJson(id: string, json: Record<string, unknown> | null): GraphProfile {
  if (!json) return defineProfile({ id });
  const { demo: _demo, diffIgnore: _ignore, edgeLabels = {}, ...rest } = json as Record<string, any>;
  return defineProfile({ id, ...rest, kindLabels: { ...rest.kindLabels, ...edgeLabels } });
}

export const modelOf = (v: Version, profile: GraphProfile): GraphModel => parseSources(v.sources, profile);

export interface Finding { level: 'error' | 'warn'; where: string; message: string }

/** Validation: every file against the schema (native format only; other tools' formats are the adapters' job), then structural checks on the combined graph. */
export function validate(loaded: Loaded): Finding[] {
  const out: Finding[] = [];
  const profile = profileFromJson('cli', loaded.profile);
  if (loaded.profile) {
    for (const e of checkSchema(profileSchema, loaded.profile)) out.push({ level: 'error', where: '_profile.json', message: `${e.path}: ${e.message}` });
  }
  for (const e of loaded.metaErrors) out.push({ level: 'error', where: e.file, message: e.message });
  for (const { version, files } of loaded.raw) {
    const prefix = loaded.versions.length > 1 ? `${version}/` : '';
    const notJson = new Set<string>();
    if (loaded.format === 'native') {
      for (const f of files) {
        if (!/\.json$/i.test(f.path)) continue;
        let doc: unknown;
        try { doc = JSON.parse(f.text); } catch (e) { notJson.add(f.path); out.push({ level: 'error', where: prefix + f.path, message: `not JSON: ${(e as Error).message}` }); continue; }
        // JSON that does not look like a graph is silently skipped while parsing, so on screen it is just "a piece missing"; name it here.
        if (!doc || typeof doc !== 'object' || (!('nodes' in doc) && !('edges' in doc))) {
          out.push({ level: 'warn', where: prefix + f.path, message: 'not a graph (no "nodes" or "edges"), skipped' });
          continue;
        }
        for (const e of checkSchema(graphSchema, doc)) out.push({ level: 'error', where: prefix + f.path, message: `${e.path}: ${e.message}` });
      }
    }
    const v = loaded.versions.find((x) => x.name === version)!;
    const model = modelOf(v, profile);
    for (const e of model.errors) if (!notJson.has(e.origin)) out.push({ level: 'error', where: prefix + e.origin, message: e.message });
    for (const i of [...validateStructure(model), ...structure(model)]) out.push({ level: i.level, where: prefix || loaded.title, message: i.message });
    if (!model.nodes.length) out.push({ level: 'warn', where: prefix || loaded.title, message: 'No nodes found' });
  }
  return out;
}

/** On top of the library's generic checks, the CLI checks two things tied directly to "structure comes from containment": missing parent, parent cycle. */
function structure(model: GraphModel): GraphIssue[] {
  const out: GraphIssue[] = [];
  for (const n of model.nodes) {
    if (n.parent && !model.index.has(n.parent)) {
      out.push({ kind: 'missing-parent', level: 'warn', nodeId: n.id, message: `Missing parent: ${n.id} sits inside ${n.parent}, which does not exist (drawn at top level)` });
    }
  }
  const reported = new Set<string>();
  for (const n of model.nodes) {
    const seen: string[] = [];
    for (let p: string | undefined = n.id; p && !reported.has(p); p = model.index.get(p)?.parent) {
      if (seen.includes(p)) {
        const loop = seen.slice(seen.indexOf(p));
        loop.forEach((x) => reported.add(x));
        out.push({ kind: 'parent-cycle', level: 'error', nodeId: p, message: `Parent cycle: ${[...loop, p].join(' → ')}` });
        break;
      }
      seen.push(p);
    }
  }
  return out;
}

/* ── Compare ─────────────────────────────────────────────────────────────── */

export interface DiffSummary {
  before: string;
  after: string;
  nodes: { added: number; removed: number; changed: number; moved: number; merged: number; kept: number };
  edges: { added: number; removed: number; kept: number };
  changes: { kind: string; id: string; label: string; detail?: string }[];
  edgeChanges: { kind: 'added' | 'removed'; source: string; target: string; relation?: string }[];
}

/** Fields that do not count as "changed" when comparing: `--ignore` plus the profile's `diffIgnore` (given by adapters, e.g. Graphify's community, renumbered
 *  on every rerun, and line numbers that move with the code; without ignoring them thousands of nodes report "changed" and the real changes drown). */
export const ignoreOf = (profile: Record<string, unknown> | null, extra: string[] = []): string[] =>
  [...new Set([...(Array.isArray(profile?.diffIgnore) ? (profile!.diffIgnore as string[]) : []), ...extra])];

export function diff(before: GraphModel, after: GraphModel, labels: { before: string; after: string }, ignore: string[] = []): { delta: GraphDelta; summary: DiffSummary } {
  const delta = diffModels(before, after, { labels, ignore });
  const labelOf = (id: string) => after.index.get(id)?.label ?? before.index.get(id)?.label ?? id;
  const changes = delta.changes.map((c) => ({
    kind: c.kind, id: c.id, label: labelOf(c.id),
    detail: c.kind === 'changed' ? c.fields?.join(', ')
      : c.kind === 'moved' ? `${c.pairId ? labelOf(c.pairId) : '(top)'} → ${after.index.get(c.id)?.parent ? labelOf(after.index.get(c.id)!.parent!) : '(top)'}`
      : c.kind === 'merged' ? `into ${c.pairId ? labelOf(c.pairId) : '?'}` : undefined,
  }));
  const edgeChanges: DiffSummary['edgeChanges'] = [];
  let kept = 0;
  for (const e of delta.model.edges) {
    const f = e.flags ?? [];
    const kind = f.includes('gb-added') ? 'added' : f.includes('gb-removed') ? 'removed' : null;
    if (!kind) { kept++; continue; }
    edgeChanges.push({ kind, source: e.source, target: e.target, ...(e.kind ? { relation: e.kind } : {}) });
  }
  const c = delta.counts;
  return {
    delta,
    summary: {
      ...labels,
      nodes: { added: c.added, removed: c.removed, changed: c.changed, moved: c.moved, merged: c.merged, kept: c.kept },
      edges: { added: edgeChanges.filter((e) => e.kind === 'added').length, removed: edgeChanges.filter((e) => e.kind === 'removed').length, kept },
      changes,
      edgeChanges,
    },
  };
}

/** Text for people (and agents): one line of totals, then the first `limit` items per category. */
export function diffText(s: DiffSummary, labelOf: (id: string) => string, limit = 20): string {
  const L: string[] = [];
  const n = s.nodes;
  const total = n.added + n.removed + n.changed + n.moved + n.merged + s.edges.added + s.edges.removed;
  L.push(`${s.before} → ${s.after}`);
  if (!total) { L.push('No changes.'); return L.join('\n'); }
  L.push(`nodes: +${n.added} −${n.removed} ~${n.changed} changed, ${n.moved} moved${n.merged ? `, ${n.merged} merged` : ''} (${n.kept} unchanged)`);
  L.push(`edges: +${s.edges.added} −${s.edges.removed} (${s.edges.kept} unchanged)`);
  const SIGN: Record<string, string> = { added: '+', removed: '−', changed: '~', moved: '↷', merged: '⇉' };
  for (const kind of ['added', 'removed', 'changed', 'moved', 'merged']) {
    const list = s.changes.filter((c) => c.kind === kind);
    if (!list.length) continue;
    L.push('', `${kind} (${list.length})`);
    for (const c of list.slice(0, limit)) L.push(`  ${SIGN[kind]} ${c.label}${c.label !== c.id ? `  [${c.id}]` : ''}${c.detail ? `  — ${c.detail}` : ''}`);
    if (list.length > limit) L.push(`  … ${list.length - limit} more (--all)`);
  }
  for (const kind of ['added', 'removed'] as const) {
    const list = s.edgeChanges.filter((e) => e.kind === kind);
    if (!list.length) continue;
    L.push('', `edges ${kind} (${list.length})`);
    for (const e of list.slice(0, limit)) L.push(`  ${kind === 'added' ? '+' : '−'} ${labelOf(e.source)} → ${labelOf(e.target)}${e.relation ? `  (${e.relation})` : ''}`);
    if (list.length > limit) L.push(`  … ${list.length - limit} more (--all)`);
  }
  return L.join('\n');
}
