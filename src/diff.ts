/* glassbrain · diff: two model versions → one union graph + a change list
 *
 * One principle holds up the whole design: **a diff is not two graphs, it is one graph.**
 *
 * Old and new are merged into one **union model** (nodes of both versions present, each with its change mark); layout runs
 * once and both versions share one set of coordinates, so "how do the two layouts line up" never arises, because there is
 * only one layout. Removed nodes stay at their original structural position, added ones grow where they belong, and "moved"
 * nodes sit at their new position while the overlay draws a line back to the old parent box.
 *
 * Change categories are decided by **structure** alone, never guessed:
 *
 *   added    only in new
 *   removed  only in old
 *   changed  in both, data differs (changed in place, position unchanged)
 *   moved    in both, parent differs (structural change, another branch)
 *   merged   an old id merged into a new id
 *
 * **Matching uses `key`, not id.** An id is the host's naming artifact, not the definition of "the same thing":
 * when the two versions live in different namespaces (each enumeration source-prefixed before a merge, renumbered after), comparing ids verbatim
 * gives "everything added, everything removed". A normalizing function is enough; and **two old nodes mapping to one key while the new version has
 * one** is exactly a "merge", so merged falls out of the key strategy naturally, without waiting for an upstream mapping
 * (one is better if given; mapping wins).
 *
 * Similarity matching is deliberately **not done**: a wrong guess makes the picture confidently act out a false correspondence, worse than
 * "not recognized". Not recognized degrades to add + remove, which is honest.
 *
 * This module is pure: no React, no cytoscape, no DOM; directly testable in node.
 */
import { buildModel, originsOfNode, type GraphEdge, type GraphModel, type GraphNode } from './model';

export type ChangeKind = 'added' | 'removed' | 'changed' | 'moved' | 'merged';

/** Change mark -> node flag (and so a cytoscape class). The `gb-` prefix is reserved by the core. */
export const DIFF_FLAG: Record<ChangeKind, string> = {
  added: 'gb-added',
  removed: 'gb-removed',
  changed: 'gb-changed',
  moved: 'gb-moved',
  merged: 'gb-merged',
};
/** Nodes in the union model present in both versions with no change at all. */
export const KEPT_FLAG = 'gb-kept';

export interface DiffOptions {
  /**
   * **Matching rule.** Defaults to `n => n.id`, but an id is the host's naming artifact, not the definition of "the same
   * thing": once the two versions live in different namespaces (typically each enumeration has a source prefix before a merge and
   * a unified number only after), comparing ids verbatim gives "everything added, everything removed" though they are clearly the same things.
   *
   * A normalizing function is enough, e.g. stripping the source prefix: `n => n.id.replace(/^[^~]+~/, '')`.
   *
   * **Two old nodes normalizing to one key while the new version has one** is not a conflict, it is a "merge":
   * the first is the body and the rest are recorded as `merged`, pointing to it. So the key strategy produces merged naturally,
   * without waiting for an upstream mapping.
   *
   * Similarity matching is deliberately **not done**: a wrong guess makes the picture confidently act out a false correspondence,
   * worse than "not recognized". Not recognized degrades to add + remove, which is honest.
   */
  key?: (node: GraphNode) => string;
  /** Old id -> new id. Takes precedence over key, for correspondences only upstream knows, like merges and renames. */
  mapping?: Record<string, string>;
  /** Fields ignored when comparing data (timestamps, file names, things that change every run). */
  ignore?: string[];
  /** Names of the two versions (for the column labels). **Not added to `origins`**: a source is "which file it came from". Version names used to be
   *  stuffed in as an "old only / new only" filter axis, so nodes in the union lost their real file names, and filtering by source filtered out
   *  every added node. The two columns already are "old / new"; that axis is not needed. */
  labels?: { before: string; after: string };
}

export interface NodeChange {
  kind: ChangeKind;
  /** Node id in the union model. For removed / merged it is the **old** node's id. */
  id: string;
  /** Counterpart node: merged = the new id merged into; moved = the old parent box id. The overlay draws a line between the two. */
  pairId?: string;
  /** For changed, which fields changed (for the detail panel). */
  fields?: string[];
  /**
   * **How big this change is**, 0–1, normalized over the whole graph. **Only nodes present in both versions have it** (changed / moved).
   *
   * This is not a gap, it is the definition: additions and removals are about **existence**; a node is there or not, there is no
   * "30% present"; only when both versions have it is there a "how different". So additions / removals are always full strength.
   *
   * Algorithm in `changeAmount`. **Normalized across nodes** (divided by the graph's maximum), not "a fraction of its own field
   * count": the latter would rate "only dependencies changed, out of 22 fields" as 4.5%, while that may well be
   * the most important step of the whole pipeline (measured: in one step all 41 changes touched only that field).
   */
  amount?: number;
}

export interface GraphDelta {
  /** The union model. Nodes carry diff flags; layout and rendering only ever see this one. */
  model: GraphModel;
  changes: NodeChange[];
  byId: Map<string, NodeChange>;
  counts: Record<ChangeKind | 'kept', number>;
  /**
   * **Old id → its identity in the union.** A matched old node does not enter the union on its own; it became the new version's
   * node. Previous frame coordinates are recorded by old id and cannot be reattached without this table: matched, but the position
   * starts from zero, and on screen "clearly the same things were all relaid out".
   */
  resolved: Map<string, string>;
  /** The old version's data, for the detail panel's "what it was". Only for changed / moved nodes. */
  prevData: Map<string, unknown>;
  labels: { before: string; after: string };
  /**
   * **Both versions as they were.**
   *
   * In the union, nodes "in both versions" always **take the new version** (label / kind / data all new); the old version's
   * copy survives only as data in `prevData`. So whenever **the whole old version must be drawn** (the left column),
   * the union cannot do it: it would draw "new content on the old structure", and both columns would look like
   * the same version. That is why `unionSides` goes back to these two originals for content.
   */
  before: GraphModel;
  after: GraphModel;
}

const stable = (v: unknown, ignore: Set<string>): string => {
  const walk = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(o).sort()) if (!ignore.has(k)) out[k] = walk(o[k]);
      return out;
    }
    return x;
  };
  return JSON.stringify(walk(v) ?? null);
};

/** Which top-level fields changed between two data objects. Names only; values are left for the detail panel to show. */
function changedFields(a: unknown, b: unknown, ignore: Set<string>): string[] {
  const oa = (a ?? {}) as Record<string, unknown>;
  const ob = (b ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(oa), ...Object.keys(ob)].filter((k) => !ignore.has(k)));
  const out: string[] = [];
  for (const k of keys) if (stable(oa[k], ignore) !== stable(ob[k], ignore)) out.push(k);
  return out.sort();
}

/** **The part that really differs** is compared character by character up to this length; beyond that it is not compared, the whole part counts as different.
 *  So one comparison is always O(CAP²), however big the data is. */
const EDIT_CAP = 512;

/**
 * Edit distance between two strings (two-row DP, no dependencies).
 *
 * **Trim the common head and tail first.** Those never changed, comparing them is wasted; more importantly, **without trimming,
 * length is counted as change**: a five-thousand-character field with one character changed, truncated as is with "the rest counts as different",
 * scores over four thousand, while another node whose four hundred characters were rewritten scores four hundred. Strength is normalized across nodes, so the one-character
 * change takes the top level and the real rewrite drops to the bottom: the ordering flips completely. After trimming the former is 1 and
 * the latter 400, and the ratio is honest. It is also much faster: in most comparisons the middle is only a few characters.
 */
function editDistance(a: string, b: string): number {
  const lim = Math.min(a.length, b.length);
  let head = 0;
  while (head < lim && a.charCodeAt(head) === b.charCodeAt(head)) head++;
  let tail = 0;
  while (tail < lim - head && a.charCodeAt(a.length - 1 - tail) === b.charCodeAt(b.length - 1 - tail)) tail++;
  const mid = (x: string) => x.slice(head, x.length - tail);
  const [ma, mb] = [mid(a), mid(b)];
  const over = Math.max(0, Math.max(ma.length, mb.length) - EDIT_CAP);
  const s = ma.slice(0, EDIT_CAP);
  const t = mb.slice(0, EDIT_CAP);
  if (s === t) return over;
  const n = s.length, m = t.length;
  if (!n || !m) return Math.max(n, m) + over;
  let prev = new Array<number>(m + 1);
  let cur = new Array<number>(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    const ci = s.charCodeAt(i - 1);
    for (let j = 1; j <= m; j++) {
      const sub = prev[j - 1] + (ci === t.charCodeAt(j - 1) ? 0 : 1);
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, sub);
    }
    const tmp = prev; prev = cur; cur = tmp;
  }
  return prev[m] + over;
}

/**
 * The **absolute size** of this change (on the order of characters, not normalized).
 *
 * Only **the fields that changed** are compared, each side joined into one string and compared **once**, not once per field. The reason is
 * cost: per field, a 22-field node is 22 × O(CAP²), and a hundred nodes reach the billions.
 * Joined into one string and compared once, the whole graph costs "node count × one DP".
 */
function changeAmount(a: GraphNode, b: GraphNode, fields: string[], ignore: Set<string>): number {
  const pick = (n: GraphNode) => fields.map((k) => stable((n.data ?? {})[k], ignore)).join('\u0000');
  return editDistance(pick(a), pick(b)) + editDistance(a.label ?? '', b.label ?? '');
}

const edgeKey = (e: GraphEdge) => `${e.source} ${e.target} ${e.kind ?? ''}`;
const withFlag = <T extends { flags?: string[] }>(x: T, flag: string): T =>
  ({ ...x, flags: [...(x.flags ?? []), flag] });

/**
 * Two model versions -> union model + change list.
 *
 * Values of nodes in the union: those in both versions **take the new version** (the content is new); those only in the old one are kept
 * as they are (they stay on the graph marked "removed"). So the union is a graph of "the new version + ghosts of the old".
 */
export function diffModels(before: GraphModel, after: GraphModel, opts: DiffOptions = {}): GraphDelta {
  const ignore = new Set(opts.ignore ?? []);
  const mapping = opts.mapping ?? {};
  const labels = opts.labels ?? { before: 'before', after: 'after' };
  const keyOf = opts.key ?? ((n: GraphNode) => n.id);

  /* ── Matching ────────────────────────────────────────────────────────────
   * Pair the two sides by key. One key may correspond to **several** nodes in the old version (enumerations before a merge)
   * and to one in the new: the first is the body (it is what "this thing" looks like in the new version), the rest are merges. */
  const beforeByKey = new Map<string, GraphNode[]>();
  for (const a of before.nodes) {
    const k = keyOf(a);
    const arr = beforeByKey.get(k);
    arr ? arr.push(a) : beforeByKey.set(k, [a]);
  }
  const afterByKey = new Map<string, GraphNode>();
  for (const b of after.nodes) if (!afterByKey.has(keyOf(b))) afterByKey.set(keyOf(b), b);

  /** Old id -> its identity in the union. A matched old node does not enter the union on its own; its references (parent pointers,
   *  edge endpoints) must be repointed to the new node, or the union would contain parent pointers to missing nodes. */
  const resolve = new Map<string, string>();
  for (const [k, list] of beforeByKey) {
    const b = afterByKey.get(k);
    if (b) resolve.set(list[0].id, b.id);
  }
  const ref = (id: string | undefined) => (id === undefined ? undefined : resolve.get(id) ?? id);
  const consumed = new Set(resolve.keys());

  const changes: NodeChange[] = [];
  const prevData = new Map<string, unknown>();
  const moved = new Map<string, string | null>();
  const nodes: GraphNode[] = [];

  // New version nodes: kept / changed / moved / added
  for (const b of after.nodes) {
    const a = beforeByKey.get(keyOf(b))?.[0];
    let flag = KEPT_FLAG;
    if (!a) {
      flag = DIFF_FLAG.added;
      changes.push({ kind: 'added', id: b.id });
    } else {
      const fields = changedFields(a.data, b.data, ignore);
      // Parent pointers must be compared in one namespace, or across namespaces every node would "move to another branch".
      const aParent = ref(a.parent) ?? null;
      if (aParent !== (b.parent ?? null)) {
        flag = DIFF_FLAG.moved;
        changes.push({
          kind: 'moved', id: b.id, pairId: aParent ?? undefined,
          fields: fields.length ? fields : undefined, amount: changeAmount(a, b, fields, ignore),
        });
        prevData.set(b.id, a.data);
        // The old parent is recorded on the node: **another branch = one containment edge gone + one containment edge come**, and containment edges are
        // generated from parent at render time; without recording it only the new one exists and the old one has nothing to leave with.
        moved.set(b.id, aParent);
      } else if (fields.length || (a.label ?? '') !== (b.label ?? '')) {
        flag = DIFF_FLAG.changed;
        changes.push({
          kind: 'changed', id: b.id, fields: fields.length ? fields : ['label'],
          amount: changeAmount(a, b, fields, ignore),
        });
        prevData.set(b.id, a.data);
      }
    }
    nodes.push({
      ...withFlag(b, flag),
      ...(moved.has(b.id) ? { prevParent: moved.get(b.id) } : {}),
      // Sources are still files: for nodes in both versions, both sides' files count (it may have changed files).
      ...(a ? { origins: [...new Set([...originsOfNode(a), ...originsOfNode(b)])] } : {}),
    });
  }

  // Unmatched old nodes: removed, or merged (when they point to some new node)
  const unionIds = new Set(nodes.map((n) => n.id));
  for (const a of before.nodes) {
    if (consumed.has(a.id)) continue;
    // mapping first; otherwise the new node with the same key is where it merged.
    const to = mapping[a.id] ?? afterByKey.get(keyOf(a))?.id;
    const merged = !!to && after.index.has(to);
    const kind: ChangeKind = merged ? 'merged' : 'removed';
    changes.push({ kind, id: a.id, pairId: merged ? to : undefined });
    // Repoint the parent: its parent may have been absorbed by matching, and keeping it would point to a node missing from the union.
    const parent = ref(a.parent);
    nodes.push({
      ...withFlag(a, DIFF_FLAG[kind]),
      parent: parent && (unionIds.has(parent) || !consumed.has(a.parent!)) ? parent : undefined,
    });
    unionIds.add(a.id);
  }

  // Edges: union + marks. Old endpoints are repointed too; afterwards those coinciding with the new version are "unchanged".
  const afterEdges = new Map(after.edges.map((e) => [edgeKey(e), e]));
  const beforeEdges = new Map(
    before.edges.map((e) => {
      const r = { ...e, source: ref(e.source)!, target: ref(e.target)! };
      return [edgeKey(r), r] as const;
    }),
  );
  const edges: GraphEdge[] = [];
  for (const [k, e] of afterEdges) {
    edges.push(withFlag(e, beforeEdges.has(k) ? KEPT_FLAG : DIFF_FLAG.added));
  }
  for (const [k, e] of beforeEdges) {
    if (afterEdges.has(k)) continue;
    // Drop an edge whose endpoint is missing from the union: keeping it makes a dangling edge, a line flying off the graph.
    if (!unionIds.has(e.source) || !unionIds.has(e.target)) continue;
    edges.push(withFlag(e, DIFF_FLAG.removed));
  }

  /* **Normalized across nodes: divide by the graph's maximum, no boosting.**
   *
   * A square root was tried (compressing the long tail so more nodes land in the mid-high levels), but that lies to the viewer: a node with only
   * `dependencies` changed **should be faint**, and lifting it to the middle erases the statement "this one does not matter".
   * The strength channel is for **ranking**, and ranking needs honest ratios. */
  let peak = 0;
  for (const c of changes) if (c.amount) peak = Math.max(peak, c.amount);
  for (const c of changes) if (c.amount !== undefined) c.amount = peak > 0 ? c.amount / peak : 0;

  const model = buildModel(nodes, edges, [...before.errors, ...after.errors]);
  const counts = { added: 0, removed: 0, changed: 0, moved: 0, merged: 0, kept: 0 };
  for (const c of changes) counts[c.kind]++;
  counts.kept = nodes.length - changes.length;

  return {
    model, changes, byId: new Map(changes.map((c) => [c.id, c])), counts,
    resolved: resolve, prevData, labels, before, after,
  };
}

/**
 * **One delta → each version's own model, both in the union's namespace.**
 *
 * Two uses, both essential:
 *   ① diff coordinates do not solve the union; they solve each version once (see layout/diff-layout.ts)
 *   ② the left column must **draw the whole old version**
 *
 * The two sides come from different places; that is the one thing to remember about this function:
 *
 *   new side  **cut from the union**: the union is "new + ghosts of the old", minus the ghosts it is the new version,
 *             and its layout input is **byte-identical** to the host's new model (`shapeHash` only reads structure),
 *             so "entering diff mode moves no surviving node" follows from equal hashes.
 *   old side  **taken from the old original**: in the union nodes in both versions take the new version, so cutting from the union
 *             gives "new content on the old structure", and the two columns become the same version.
 *
 * `prevParent` is dropped on both sides: it is for transitions (one containment edge gone, one come); in a single version it
 * would only conjure up an extra edge, and the old side's parent is the old version's own parent anyway.
 */
export function unionSides(d: GraphDelta): { before: GraphModel; after: GraphModel } {
  const has = (x: { flags?: string[] }, f: string) => !!x.flags?.includes(f);

  /* New side: cut from the union. The union already is "new + ghosts of the old"; removing the ghosts gives the new version,
   * and **its layout input is byte-identical to the host's own new model** (`shapeHash` only reads structure). */
  const afterNodes: GraphNode[] = [];
  for (const n of d.model.nodes) {
    if (has(n, DIFF_FLAG.removed) || has(n, DIFF_FLAG.merged)) continue;
    const { prevParent, ...bare } = n;      // eslint-disable-line @typescript-eslint/no-unused-vars
    afterNodes.push(bare);
  }
  const aIds = new Set(afterNodes.map((n) => n.id));
  const afterEdges = d.model.edges.filter(
    (e) => !has(e, DIFF_FLAG.removed) && aIds.has(e.source) && aIds.has(e.target),
  );

  /* Old side: **take content from the old original**, only moving ids into the union's namespace.
   *
   * It cannot be cut from the union: nodes in both versions take the new version there, so the cut is "new content on the
   * old structure". Side by side, both columns would be the same version, and that is exactly the question the two columns answer.
   *
   * Renaming ids is required: matching is by `key`, and when the versions live in different namespaces one thing has different ids
   * (`draft~X` vs `X`). Without renaming, "the same node" in both columns would not match and coordinates could not reattach.
   * Marks are copied from the union (only the union knows what changed); edge marks are recomputed in place: still present in the new version means
   * unchanged, absent means gone after this version. */
  const ref = (id: string | undefined) => (id === undefined ? undefined : d.resolved.get(id) ?? id);
  const beforeNodes: GraphNode[] = d.before.nodes.map((n) => {
    const id = ref(n.id)!;
    const now = d.model.index.get(id);
    /* `prevParent` on this side means "**in the new version**, who it hangs under": that is the semantics `buildElements`'s
     * `past` switch reads (the field is always "the other version's parent"). With it, the left column can mark
     * "the containment edge about to go"; without it, moved is **mute** on the left: the node shows "changed",
     * but nothing says "this branch is about to break". */
    const relinked = now && (now.parent ?? null) !== (ref(n.parent) ?? null);
    return {
      ...n, id, parent: ref(n.parent),
      flags: now?.flags ?? n.flags,
      ...(relinked ? { prevParent: now!.parent ?? null } : {}),
    };
  });
  const bIds = new Set(beforeNodes.map((n) => n.id));
  const afterKeys = new Set(afterEdges.map(edgeKey));
  const beforeEdges: GraphEdge[] = d.before.edges
    .map((e) => ({ ...e, source: ref(e.source)!, target: ref(e.target)! }))
    .filter((e) => bIds.has(e.source) && bIds.has(e.target))
    .map((e) => withFlag(e, afterKeys.has(edgeKey(e)) ? KEPT_FLAG : DIFF_FLAG.removed));

  return { before: buildModel(beforeNodes, beforeEdges), after: buildModel(afterNodes, afterEdges) };
}

/* ── The union of one switch ─────────────────────────────────────────────────────── */

/**
 * Marks used for "this switch". They **must be a separate set** from `DIFF_FLAG`, because both can hold at once:
 *
 *   `gb-removed`      diff says: this is a change (the host's union, what the user is looking at)
 *   `gb-step-removed` the transition says: it leaves in this switch
 *
 * One node can perfectly well be a "removal" in the diff sense (a ghost, meant to be seen in both columns)
 * and "kept" in the transition sense (in the previous version and still in this one). With one shared set of classes,
 * `presenceGroups` would treat ghosts as things to fade this time: random fading everywhere.
 */
export const STEP_FLAG = { added: 'gb-step-added', removed: 'gb-step-removed' } as const;
/** Present in both versions. */
export const STEP_KEPT = 'gb-step-kept';

/**
 * Two models → a union that **only tracks presence**, the draft for one switch's transition.
 *
 * It answers one question only: **was this thing in the previous version, is it in this one.** It does not judge content changes or
 * branch moves: in diff mode the host's delta already said those, and saying them again would be two sets of marks
 * fighting. And once "another branch" holds, `prevParent` is written, and `buildElements` synthesizes two containment edges with
 * `gb-added`/`gb-removed` from it: that is diff vocabulary, and mixed into the transition it is bound to be misread.
 *
 * A reparented node still plays fine: in the new union it hangs under its new parent, the old containment edge is not in the new union at all,
 * so **additions and removals fall out of the edge sets** with no special case. Positionally it walks from the old place to the new, and "it moved
 * to another branch" is told by that motion itself.
 *
 * **Matching cannot be by id.** Both sides look like unions computed by the same host, as if one namespace;
 * they are not. `unionSides` renames old-side ids to the new side's per `resolved`: the same reference version
 * has 107 matched (renamed) nodes "against A" and none matched (not renamed) "against B", so
 * **the same node has two names in the two runs**. Verbatim id comparison would judge the left column "107 in + 107 out": the reference
 * did not move at all, yet the whole column fades out and in.
 *
 * So compare with the host's `matchKey` (matching is defined in one place, shared by animation and diff). A matched
 * old node does not enter the union on its own: it **is** the new node, and `resolved` records the rename; previous frame coordinates
 * are recorded under old names and cannot reattach without this table.
 */
export function stepUnion(
  before: GraphModel, after: GraphModel, key: (node: GraphNode) => string = (n) => n.id,
): GraphDelta {
  const afterByKey = new Map<string, GraphNode>();
  for (const b of after.nodes) if (!afterByKey.has(key(b))) afterByKey.set(key(b), b);
  /** Old id → its identity in the union. A matched old node does not enter the union on its own: it is the new node. */
  const resolved = new Map<string, string>();
  for (const a of before.nodes) {
    const b = afterByKey.get(key(a));
    if (b) resolved.set(a.id, b.id);
  }
  const ref = (id: string | undefined) => (id === undefined ? undefined : resolved.get(id) ?? id);
  const paired = new Set(resolved.values());

  const changes: NodeChange[] = [];
  const nodes: GraphNode[] = [];
  for (const b of after.nodes) {
    const kept = paired.has(b.id);
    if (!kept) changes.push({ kind: 'added', id: b.id });
    nodes.push(withFlag(b, kept ? STEP_KEPT : STEP_FLAG.added));
  }
  for (const a of before.nodes) {
    if (resolved.has(a.id)) continue;
    changes.push({ kind: 'removed', id: a.id });
    // Repoint the parent too: it may have been absorbed by matching, and keeping it points to a node missing from the union.
    nodes.push(withFlag({ ...a, parent: ref(a.parent) }, STEP_FLAG.removed));
  }
  const ids = new Set(nodes.map((n) => n.id));
  const afterEdges = new Map(after.edges.map((e) => [edgeKey(e), e] as const));
  const beforeEdges = new Map(before.edges.map((e) => {
    const r = { ...e, source: ref(e.source)!, target: ref(e.target)! };
    return [edgeKey(r), r] as const;
  }));
  const edges: GraphEdge[] = [];
  for (const [k, e] of afterEdges) edges.push(withFlag(e, beforeEdges.has(k) ? STEP_KEPT : STEP_FLAG.added));
  for (const [k, e] of beforeEdges) {
    if (afterEdges.has(k)) continue;
    // Drop it if an endpoint is missing from the union: keeping it only makes a dangling edge flying off the graph.
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    edges.push(withFlag(e, STEP_FLAG.removed));
  }
  const counts = { added: 0, removed: 0, changed: 0, moved: 0, merged: 0, kept: 0 };
  for (const c of changes) counts[c.kind]++;
  counts.kept = nodes.length - changes.length;
  return {
    model: buildModel(nodes, edges, [...before.errors, ...after.errors]),
    changes, byId: new Map(changes.map((c) => [c.id, c])), counts,
    resolved, prevData: new Map(), labels: { before: '', after: '' }, before, after,
  };
}

/** Whether this delta changes anything at all. If not, do not enter diff mode (an all-grey graph means nothing). */
export function hasChanges(d: GraphDelta): boolean {
  return d.changes.length > 0;
}

/** The changed part of the union model, with its parent box chains (without the parent chain compounds fall apart).
 *  For "changes only"; coordinates untouched, since they come from the union layout anyway. */
export function changedSubset(d: GraphDelta): Set<string> {
  const keep = new Set<string>();
  for (const c of d.changes) {
    keep.add(c.id);
    if (c.pairId) keep.add(c.pairId);
    let p = d.model.index.get(c.id)?.parent;
    while (p && !keep.has(p)) { keep.add(p); p = d.model.index.get(p)?.parent; }
  }
  return keep;
}
