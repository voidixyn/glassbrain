/* adapters · shared pieces
 *
 * An adapter = another tool's output → glassbrain's own `{nodes, edges}` (what parsePhysical reads) + a profile
 * as JSON (the same shape as `_profile.json`). Pure functions, no file system: input is {path, text},
 * so files dropped in a browser, a folder the CLI reads and a version taken from git all go through the same code.
 *
 * The fixed rule: **structure comes from containment**. Other tools' "containment" looks different in each (contains edges, file paths, grouping fields);
 * the adapter's main job is recognizing it and turning it into `parent`; every other relation becomes an edge as is.
 */

export interface InputFile { path: string; text: string }

export interface PhysicalNode { id: string; label: string; kind?: string; parent?: string; [k: string]: unknown }
export interface PhysicalEdge { source: string; target: string; kind?: string; label?: string; weight?: number; [k: string]: unknown }
export interface PhysicalGraph { name?: string; nodes: PhysicalNode[]; edges: PhysicalEdge[] }

/** Conversion result: one or several glassbrain graphs (origin is the source file's relative path), plus a profile. */
export interface Adapted {
  sources: { origin: string; graph: PhysicalGraph }[];
  profile: Record<string, unknown>;
}

export interface Adapter {
  id: string;
  /** A name for people (the CLI prints "read as X"). */
  label: string;
  /** Whether these files are its format. Looks only at the shape of the content, never the file name: people rename files. */
  detect(files: InputFile[]): boolean;
  convert(files: InputFile[]): Adapted;
}

export const tryJson = (text: string): any => { try { return JSON.parse(text); } catch { return undefined; } };
export const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A set of hues, handed out in order of appearance to kinds whose names are not known in advance (memory's entityType, Obsidian's type). */
export const HUES = ['#6366f1', '#0891b2', '#e63b7a', '#f59e0b', '#16a34a', '#be38f3', '#ff6a00', '#64748b', '#0ea5e9', '#a16207'];
export const autoPalette = (kinds: Iterable<string>): Record<string, string> =>
  Object.fromEntries([...new Set(kinds)].map((k, i) => [k, HUES[i % HUES.length]]));

/** Path → a chain of folder nodes (`dir:a`, `dir:a/b`); returns the innermost id; top-level files return undefined. */
export function folderOf(file: string, out: Map<string, PhysicalNode>): string | undefined {
  const parts = file.split('/').filter(Boolean);
  parts.pop();
  let parent: string | undefined;
  for (let i = 0; i < parts.length; i++) {
    const id = `dir:${parts.slice(0, i + 1).join('/')}`;
    if (!out.has(id)) out.set(id, { id, label: parts[i], kind: 'folder', ...(parent ? { parent } : {}) });
    parent = id;
  }
  return parent;
}

/** Cycle guard when assigning parents: walk up the parent chain, and if it comes back to itself, reject this one. */
export function wouldCycle(parentOf: Map<string, string>, child: string, parent: string): boolean {
  for (let p: string | undefined = parent, n = 0; p && n < 10_000; p = parentOf.get(p), n++) if (p === child) return true;
  return false;
}

/** Remove undefined / empty strings so the output JSON is clean (and diff does not report "changed" over null vs missing). */
export const clean = <T extends Record<string, unknown>>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '' && v !== null)) as T;
