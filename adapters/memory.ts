/* The MCP reference memory server (`@modelcontextprotocol/server-memory`) → glassbrain
 *
 * On disk it is JSONL (`memory.jsonl`, called `memory.json` in old versions, same content, one record per line):
 *   {"type":"entity","name":"…","entityType":"…","observations":["…"]}
 *   {"type":"relation","from":"…","to":"…","relationType":"…"}
 * The `read_graph` tool returns `{entities: [...], relations: [...]}`; both are recognized.
 *
 * memory has no "containment": entities are flat. The most natural structure is grouping by entityType: one box per type,
 * entities inside; relations become edges as is, observations become the body text in details (one per line).
 */
import { autoPalette, clean, isObj, tryJson, type Adapter, type InputFile, type PhysicalEdge, type PhysicalNode } from './common';

function readRecords(text: string): any[] | null {
  const whole = tryJson(text);
  if (isObj(whole) && (Array.isArray(whole.entities) || Array.isArray(whole.relations))) {
    return [
      ...(whole.entities ?? []).map((e: any) => ({ type: 'entity', ...e })),
      ...(whole.relations ?? []).map((r: any) => ({ type: 'relation', ...r })),
    ];
  }
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const recs = lines.map(tryJson);
  if (!recs.every((r) => isObj(r) && (r.type === 'entity' || r.type === 'relation'))) return null;
  return recs;
}

export function convertMemory(recs: any[]) {
  const groups = new Map<string, PhysicalNode>();
  const nodes: PhysicalNode[] = [];
  const edges: PhysicalEdge[] = [];
  const seen = new Set<string>();
  for (const r of recs) {
    if (r.type !== 'entity' || typeof r.name !== 'string' || seen.has(r.name)) continue;
    seen.add(r.name);
    const t = String(r.entityType ?? 'entity');
    const g = `type:${t}`;
    if (!groups.has(g)) groups.set(g, { id: g, label: t, kind: 'type' });
    const obs: string[] = Array.isArray(r.observations) ? r.observations.map(String) : [];
    nodes.push(clean({
      id: r.name, label: r.name, kind: t, parent: g,
      description: obs.length ? obs.map((o) => `- ${o}`).join('\n') : undefined,
      observations: obs.length ? obs : undefined,
    }));
  }
  for (const r of recs) {
    if (r.type !== 'relation' || typeof r.from !== 'string' || typeof r.to !== 'string') continue;
    edges.push({ source: r.from, target: r.to, kind: String(r.relationType ?? 'related') });
  }
  return { name: 'Memory', nodes: [...groups.values(), ...nodes], edges };
}

export const memory: Adapter = {
  id: 'memory',
  label: 'MCP memory (memory.jsonl)',
  detect: (files) => files.some((f) => /\.jsonl?$/.test(f.path) && readRecords(f.text) !== null),
  convert(files: InputFile[]) {
    const sources = files.flatMap((f) => {
      const recs = /\.jsonl?$/.test(f.path) ? readRecords(f.text) : null;
      return recs ? [{ origin: f.path, graph: convertMemory(recs) }] : [];
    });
    const kinds = sources.flatMap((s) => s.graph.nodes.filter((n) => n.kind !== 'type').map((n) => n.kind!));
    const rels = sources.flatMap((s) => s.graph.edges.map((e) => e.kind!));
    return {
      sources,
      profile: {
        nodePalette: autoPalette(kinds), edgePalette: autoPalette(rels),
        kindLabels: { type: 'Entity type' }, detail: { skip: ['observations'] }, rootLabel: 'Memory',
      },
    };
  },
};
