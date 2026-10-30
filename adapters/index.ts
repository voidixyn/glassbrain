/* glassbrain/adapters: open other tools' graph output directly
 *
 *   import { adapt } from 'glassbrain/adapters';
 *   const { sources, profile, adapter } = adapt(files);      // files: {path, text}[]
 *   const model = parseSources(sources, defineProfile({ id: 'x', ...profile }));
 *
 * `adapt` detects the format by content (never the file name); if nothing matches it hands over glassbrain's own `{nodes, edges}` as is.
 * The detection order is the table below: more specific first (UA and Graphify are both nodes + edges; UA also has layers/project).
 */
import type { Adapter, InputFile } from './common';
import { graphify } from './graphify';
import { memory } from './memory';
import { obsidian } from './obsidian';
import { understand } from './understand';

export type { Adapted, Adapter, InputFile, PhysicalEdge, PhysicalGraph, PhysicalNode } from './common';
export { convertGraphify } from './graphify';
export { convertUnderstand } from './understand';
export { convertMemory } from './memory';
export { convertObsidian } from './obsidian';

export const ADAPTERS: Adapter[] = [understand, graphify, memory];
/** Markdown folders are their own tier: read as notes only when there is **no** json graph in them. */
export const MARKDOWN = obsidian;

export interface AdaptResult {
  /** What goes to `parseSources`: origin + text (glassbrain's own `{nodes, edges}`). */
  sources: { origin: string; text: string }[];
  /** The profile the adapter suggests (same shape as `_profile.json`); null for native data. */
  profile: Record<string, unknown> | null;
  /** Which adapter was used; null for native data. */
  adapter: Adapter | null;
  /** Data files the chosen format does not read (one format decides the folder; say so instead of dropping them silently). */
  skipped: string[];
}

/** A batch of files → sources glassbrain can parse directly. `only` names an adapter id ('native' = no conversion). */
export function adapt(files: InputFile[], only?: string): AdaptResult {
  const pick = only === 'native' ? null
    : only ? [...ADAPTERS, MARKDOWN].find((a) => a.id === only) ?? null
    : ADAPTERS.find((a) => a.detect(files))
      ?? (MARKDOWN.detect(files) && !files.some(isNativeGraph) ? MARKDOWN : null);
  if (only && only !== 'native' && !pick) throw new Error(`Unknown format: ${only} (known: native, ${[...ADAPTERS, MARKDOWN].map((a) => a.id).join(', ')})`);
  if (!pick) {
    const json = files.filter((f) => /\.json$/i.test(f.path));
    return {
      sources: json.map((f) => ({ origin: f.path, text: f.text })), profile: null, adapter: null,
      skipped: files.filter((f) => /\.jsonl$/i.test(f.path)).map((f) => f.path),
    };
  }
  const out = pick.convert(files);
  // A json-format adapter reads only the files it recognizes; a markdown folder reads all its notes.
  const skipped = pick === MARKDOWN ? [] : files.filter((f) => /\.jsonl?$/i.test(f.path) && !pick.detect([f])).map((f) => f.path);
  return {
    sources: out.sources.map((s) => ({ origin: s.origin, text: JSON.stringify(s.graph) })),
    profile: out.profile,
    adapter: pick,
    skipped,
  };
}

const isNativeGraph = (f: InputFile) => {
  if (!/\.json$/i.test(f.path)) return false;
  try { const d = JSON.parse(f.text); return !!d && typeof d === 'object' && ('nodes' in d || 'edges' in d); } catch { return false; }
};
