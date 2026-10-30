/* glassbrain · editing: one edit is one op
 *
 * The library **does not change** the host's model and does not touch files: every edit on the canvas just emits one `EditOp` (`onEdit`).
 * The host applies it with `applyEdit` to its own model and passes it back, and the transition plays the change: editing
 * reuses the "time" axis and needs no animation of its own.
 *
 * A list of ops is a patch: it is at once the undo stack (drop the last one, replay from the original), an export file
 * (independent of how many files the source data has), and something to reapply after a pipeline rerun. So ops only describe **data**:
 *
 *   UI constrained   id (given on creation, fixed after), what it hangs under, an edge's two ends: validated here
 *   free             label / kind / data, an edge's label / weight: stored as is
 *   not editable     layer (computed by the profile from fields), source (new nodes follow their parent), flags and validation (derived,
 *                    recomputed on reparse)
 */
import { buildModel, type GraphEdge, type GraphModel, type GraphNode } from './model';
import { VIRTUAL_ROOT } from './elements';
import type { GraphProfile } from './profile';

/** What can be changed on a node. `parent: null` = move to the top level. */
export interface NodeFields {
  label?: string;
  kind?: string;
  parent?: string | null;
  data?: Record<string, unknown>;
}
export interface EdgeRef { source: string; target: string; kind?: string }
export interface EdgeFields extends EdgeRef { label?: string; weight?: number }

export type EditOp =
  /** `origin` is not an editable field but creation context (e.g. while filtering by some source): omitted, it follows the parent. */
  | { op: 'addNode'; id: string; set: NodeFields; origin?: string }
  | { op: 'updateNode'; id: string; set: NodeFields }
  | { op: 'removeNode'; id: string }
  | { op: 'addEdge'; edge: EdgeFields }
  | { op: 'removeEdge'; edge: EdgeRef };

export type EditError =
  | 'id-empty' | 'id-taken' | 'no-node' | 'no-parent' | 'cycle' | 'has-children'
  | 'no-endpoint' | 'self-loop' | 'edge-exists' | 'no-edge';

/** An edge is defined by its two ends + kind (as in compare; `id` takes no part). Several with the same ends and kind are one edge written several times,
 *  deleted together; validation reports such duplicates (see `validateStructure`). */
const sameEdge = (e: GraphEdge, r: EdgeRef) =>
  e.source === r.source && e.target === r.target && (e.kind ?? '') === (r.kind ?? '');

/** Whether this op can be applied. null = yes; otherwise the reason (the UI looks it up in `strings.error`). */
export function checkEdit(model: GraphModel, op: EditOp): EditError | null {
  const has = (id: string) => model.index.has(id);
  const parentOk = (id: string, parent: string | null | undefined): EditError | null => {
    if (!parent) return null;
    if (!has(parent)) return 'no-parent';
    // Walk up from the new parent; reaching itself means a cycle. Ask the index directly; do not rebuild the whole parent table for one check.
    // If the data already has a cycle not passing through itself, `seen` stops after one lap.
    const seen = new Set<string>();
    for (let p: string | undefined = parent; p && !seen.has(p); p = model.index.get(p)?.parent) {
      if (p === id) return 'cycle';
      seen.add(p);
    }
    return null;
  };
  switch (op.op) {
    case 'addNode':
      if (!op.id.trim()) return 'id-empty';
      if (has(op.id) || op.id === VIRTUAL_ROOT) return 'id-taken';
      return parentOk(op.id, op.set.parent);
    case 'updateNode':
      if (!has(op.id)) return 'no-node';
      return parentOk(op.id, op.set.parent);
    case 'removeNode':
      if (!has(op.id)) return 'no-node';
      return model.nodes.some((n) => n.parent === op.id) ? 'has-children' : null;
    case 'addEdge': {
      const { source, target } = op.edge;
      if (!source || !target || !has(source) || !has(target)) return 'no-endpoint';
      if (source === target) return 'self-loop';
      return model.edges.some((e) => sameEdge(e, op.edge)) ? 'edge-exists' : null;
    }
    case 'removeEdge':
      return model.edges.some((e) => sameEdge(e, op.edge)) ? null : 'no-edge';
  }
}

/** How many edges hang on a node (the ones that go with it when it is deleted). */
export const edgesOf = (model: GraphModel, id: string) =>
  model.edges.filter((e) => e.source === id || e.target === id);

/**
 * Apply one op to a model and return a new model (the original is untouched). If it cannot be applied it throws, with the error message being
 * an `EditError`. `profile` recomputes layers: layers are computed by the profile from fields, and changing kind may change the layer.
 */
export function applyEdit(model: GraphModel, op: EditOp, profile?: GraphProfile): GraphModel {
  const err = checkEdit(model, op);
  if (err) throw new Error(err);
  return apply(model, op, profile);
}

/** Apply one **already checked** op. */
function apply(model: GraphModel, op: EditOp, profile?: GraphProfile): GraphModel {
  const layerOf = (n: GraphNode) => (profile ? profile.layerOf(n) : n.layer);
  const fields = (n: GraphNode, set: NodeFields): GraphNode => {
    const { parent, ...rest } = set;
    const next: GraphNode = { ...n, ...rest };
    if (parent !== undefined) {
      // Moved under someone, it takes their layer (as on creation); if the profile computes layers from fields, the next line changes it back.
      if (parent) { next.parent = parent; next.layer = model.index.get(parent)?.layer ?? next.layer; } else delete next.parent;
    }
    next.layer = layerOf(next);
    return next;
  };
  switch (op.op) {
    case 'addNode': {
      // Source and layer follow the parent: without a parent it goes to the first source (or none).
      const dad = op.set.parent ? model.index.get(op.set.parent) : undefined;
      const origin = op.origin ?? dad?.origin ?? model.nodes[0]?.origin;
      const seed: GraphNode = {
        id: op.id, label: op.id, layer: dad?.layer,
        ...(origin ? { origin, origins: [origin] } : {}),
      };
      return buildModel([...model.nodes, fields(seed, op.set)], model.edges, model.errors);
    }
    case 'updateNode':
      return buildModel(
        model.nodes.map((n) => (n.id === op.id ? fields(n, op.set) : n)), model.edges, model.errors,
      );
    case 'removeNode':
      return buildModel(
        model.nodes.filter((n) => n.id !== op.id),
        model.edges.filter((e) => e.source !== op.id && e.target !== op.id),
        model.errors,
      );
    case 'addEdge': {
      const { kind, label, weight, source, target } = op.edge;
      const origin = model.index.get(source)?.origin;
      const edge: GraphEdge = {
        source, target,
        ...(kind ? { kind } : {}), ...(label ? { label } : {}), ...(weight != null ? { weight } : {}),
        ...(origin ? { origin } : {}),
      };
      return buildModel(model.nodes, [...model.edges, edge], model.errors);
    }
    case 'removeEdge':
      return buildModel(model.nodes, model.edges.filter((e) => !sameEdge(e, op.edge)), model.errors);
  }
}

/** Apply a list of ops in order (replay a patch). Ones that cannot be applied are skipped without stopping: after a pipeline rerun
 *  some edits may already have been done upstream, or their objects are gone, and the rest should still apply. Returns which were skipped. */
export function applyEdits(
  model: GraphModel, ops: EditOp[], profile?: GraphProfile,
): { model: GraphModel; skipped: { op: EditOp; error: EditError }[] } {
  const skipped: { op: EditOp; error: EditError }[] = [];
  let m = model;
  for (const op of ops) {
    const err = checkEdit(m, op);
    if (err) skipped.push({ op, error: err });
    else m = apply(m, op, profile);
  }
  return { model: m, skipped };
}
