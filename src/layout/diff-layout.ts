/* glassbrain · diff coordinates: **the union is never solved**
 *
 * One rule holds the whole thing up:
 *
 *   > Things only in the old version use **the old version's own solve**, translated as a block to line up with surviving anchors.
 *
 * That is
 *
 *   pos[g] = posBefore[g] + ( anchor position in new − anchor position in old )
 *
 * Pure translation, no rotation, no scaling. Anchors = the neighbors of this ghost blob **in the old graph** that are still alive in the new version.
 *
 * **Why the union cannot be freely solved once.** The union is "two times", not "one bigger graph". Throw it
 * into a force layout and AB→CD lays out as four tiles, and **the surviving part is relaid out too**: CD's coordinates in the union
 * have nothing to do with what you see when browsing CD. The viewer loses their only anchor: "I know this graph".
 *
 * This rule buys four things:
 *   ① entering diff mode, **no surviving node moves** (the new side's layout input is byte-identical to
 *      browsing that version and hits the same cache).
 *   ② big changes **degrade automatically**, no threshold, no mode switch: the fewer the anchors, the more blocks fall into the
 *      "park beside it" branch; with no anchors at all the picture is "new graph + old graph parked beside it", both still
 *      looking as they always did.
 *   ③ layout cost goes from "one more solve of the union" to zero: the two single-version solves are what browsing does anyway.
 *   ④ a pure function: two coordinate sets + both models → one coordinate set. No cytoscape, no DOM.
 *
 * **These coordinates are also the starting point of the "fusion solve".** Translation is a good **initial value**, but it does no collision checks and
 * lands on top of surviving nodes; and when anchors spread out one translation cannot keep up. So `solveDiffLayout` solves a few
 * steps on top of it; see that function's own notes.
 */
import { indexModel, type GraphModel } from '../model';
import type { Positions } from './engine';

export interface DiffSides { before: GraphModel; after: GraphModel }

type P = { x: number; y: number };
interface Box { x1: number; y1: number; x2: number; y2: number; w: number; h: number }

/** Any node's **representative position**: a leaf is itself, a container takes its descendant leaves' centroid.
 *  An anchor may be a box, while `Positions` only records leaves; without this layer, a ghost "hanging beside some module"
 *  would be treated as anchorless because the anchor has no coordinates, and flung into the parking area for nothing. */
function repOf(model: GraphModel, pos: Positions): (id: string) => P | null {
  const idx = indexModel(model);
  const memo = new Map<string, P | null>();
  const walk = (id: string): P | null => {
    const hit = memo.get(id);
    if (hit !== undefined) return hit;
    memo.set(id, null);                 // cycle guard: a parent-child cycle does not blow the stack
    const own = pos[id];
    let out: P | null = own ? { x: own.x, y: own.y } : null;
    if (!out) {
      let sx = 0, sy = 0, n = 0;
      for (const c of idx.childrenOf.get(id) ?? []) {
        const p = walk(c);
        if (p) { sx += p.x; sy += p.y; n++; }
      }
      out = n ? { x: sx / n, y: sy / n } : null;
    }
    memo.set(id, out);
    return out;
  };
  return walk;
}

/** Undirected adjacency of the old graph: **edges and parentage treated alike**. "Hangs in this box" and "connects to this node"
 *  are the same kind of relation for the question "where should it stay". */
function adjacency(m: GraphModel): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    let s = adj.get(a);
    if (!s) adj.set(a, s = new Set());
    s.add(b);
  };
  for (const n of m.nodes) if (n.parent) { link(n.id, n.parent); link(n.parent, n.id); }
  for (const e of m.edges) { link(e.source, e.target); link(e.target, e.source); }
  return adj;
}

function bboxOf(ids: Iterable<string>, pos: Positions): Box | null {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity, n = 0;
  for (const id of ids) {
    const p = pos[id];
    if (!p) continue;
    n++;
    x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y);
    x2 = Math.max(x2, p.x); y2 = Math.max(y2, p.y);
  }
  return n ? { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1 } : null;
}

/**
 * Each version's solve → one union coordinate set.
 *
 * Surviving nodes take the new version's coordinates **as they are** (`posAfter` goes straight into the result); things only in the old version are translated by the
 * rule above. A block with no anchor at all is matched to the new graph's center as a **rigid body**: it keeps its
 * shape from the old layout, so "the whole block was replaced" looks like the old block as it was, not a heap of points the force layout
 * kneaded again.
 */
export function diffPositions(sides: DiffSides, posBefore: Positions, posAfter: Positions): Positions {
  const out: Positions = { ...posAfter };
  const alive = sides.after.index;
  const ghostSet = new Set<string>();
  for (const n of sides.before.nodes) if (!alive.has(n.id)) ghostSet.add(n.id);
  if (!ghostSet.size) return out;

  const adj = adjacency(sides.before);
  const repB = repOf(sides.before, posBefore);
  const repA = repOf(sides.after, posAfter);

  const seen = new Set<string>();
  const parked: string[][] = [];
  // Order follows the model's node order, not Set iteration order: so the parking arrangement is reproducible.
  for (const n of sides.before.nodes) {
    const start = n.id;
    if (!ghostSet.has(start) || seen.has(start)) continue;
    /* A ghost blob = a connected block of ghosts. **Walk only along edges between ghosts**: stop on reaching the living and
     * record it as an anchor. So the boundary of "a block" is exactly where it touches the present. */
    const comp: string[] = [];
    const anchors = new Set<string>();
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const id = stack.pop()!;
      comp.push(id);
      for (const nb of adj.get(id) ?? []) {
        if (ghostSet.has(nb)) {
          if (!seen.has(nb)) { seen.add(nb); stack.push(nb); }
        } else if (alive.has(nb)) anchors.add(nb);
      }
    }
    let dx = 0, dy = 0, k = 0;
    for (const a of anchors) {
      const b = repB(a), f = repA(a);
      if (b && f) { dx += f.x - b.x; dy += f.y - b.y; k++; }
    }
    if (!k) { parked.push(comp); continue; }
    dx /= k; dy /= k;
    for (const g of comp) {
      const p = posBefore[g];
      if (p) out[g] = { x: p.x + dx, y: p.y + dy };
    }
  }

  if (parked.length) {
    /* A block with no anchor at all: **it does not move aside**; it is overlaid on the new graph as is.
     *
     * The two versions never share a frame (the left column draws old, the right new), so there is no "competing for space" between them;
     * moving aside actually hurts: it doubles the union's bounding box width, and since both columns share one viewport, **each
     * column ends up half empty**. Measured with two versions sharing nothing (107 added / 141 removed / 0 shared): moving aside widened
     * the union from 1945 to 3898.
     *
     * All parked blocks share **one translation**, so the old layout's shape does not move a point; it is just centered on the new graph
     * as a whole. */
    const main = bboxOf(Object.keys(posAfter), posAfter);
    const ids = parked.flat();
    const block = bboxOf(ids, posBefore);
    const dx = block && main ? (main.x1 + main.x2) / 2 - (block.x1 + block.x2) / 2 : 0;
    const dy = block && main ? (main.y1 + main.y2) / 2 - (block.y1 + block.y2) / 2 : 0;
    for (const id of ids) {
      const p = posBefore[id];
      if (p) out[id] = { x: p.x + dx, y: p.y + dy };
    }
  }
  return out;
}


/* ── Fusion solve: one shared skeleton, each side solves its own part ──────────────────────────────── */

/** Default fusion settings: A follows B once, 12 iterations, shared coordinates must not move.
 *  That is the setting where "press compare and no surviving node moves". */
export const DEFAULT_DIFF_LAYOUT = { rounds: 1, iterations: 12, snap: true } as const;

export interface DiffLayoutSpec {
  /**
   * **Number of turns** (half steps), default 1.
   *
   *   1  A follows B once: B does not move at all, A pays the whole cost (default)
   *   2  then B follows A once
   *   3  A again… and so on
   */
  rounds?: number;
  /** Iteration budget of the first step. **Halved every step** (rounded down); at 0 there is no next step. */
  iterations?: number;
  /**
   * **Whether this step may change the shared coordinates.**
   *
   *   true  (default) after each step, shared coordinates snap back to the previous step's: so `x` is always B's
   *               free solve and "press compare and no surviving node moves" holds. The cost is that rounds mostly
   *               idle: `x` stays, and later steps only relax each side's own part a bit more.
   *   false       `x` follows every step. Only then do rounds have real work, but `x` changes owner every half step
   *               (this step's energy is A's, the next B's); the less alike the versions, the more it swings,
   *               and there is no fixed point; capping iterations only damps it.
   *
   * Both columns **always share the same `x`**, regardless of the switch: without sharing, two columns would be meaningless.
   */
  snap?: boolean;
}

/**
 * Solve one side. Injected by the canvas, so this layer knows nothing of cytoscape and does not care whether the step is force or anything
 * else: it only requires "give a seed, get coordinates back".
 *
 * `fixed` is **the ids this step may not move** (the shared skeleton when snap is on). Telling the solver is much better than
 * letting it solve freely and pushing the shared ones back: pushed back, the unique ones would have landed relative to a skeleton that
 * teleports afterwards, and wherever they land would be wrong.
 */
export type DiffSolve = (
  side: 'before' | 'after', seed: Positions, iterations: number, fixed: ReadonlySet<string>,
) => Promise<Positions>;

export interface DiffLayoutResult {
  /** Coordinates for the left column (past). */
  past: Positions;
  /** Coordinates for the right column (now). The **shared part of both is byte-identical**. */
  now: Positions;
  /** Which steps actually ran (iterations reaching 0 end early). For readings. */
  steps: { side: 'before' | 'after'; iterations: number }[];
}

const EMPTY: ReadonlySet<string> = new Set();

/** Split a coordinate set in two by "who is shared". */
function split(pos: Positions, shared: Set<string>): { shared: Positions; own: Positions } {
  const a: Positions = {}, b: Positions = {};
  for (const [id, p] of Object.entries(pos)) (shared.has(id) ? a : b)[id] = p;
  return { shared: a, own: b };
}

/**
 * **One shared frozen skeleton + two solves that only solve each side's own part.**
 *
 * The start is B's free solve (what you see when browsing the new version); A's unique nodes are first translated into place by
 * `diffPositions` as the initial value, then the sides take turns:
 *
 *   x     shared node coordinates, **one set shared by both columns**
 *   ownA  the ones only in the old version
 *   ownB  the ones only in the new version
 *
 *   for k in 0..rounds-1:
 *     iter = ⌊iterations / 2^k⌋      the iteration budget halves every step, ending at 0
 *     side = k even ? old : new
 *     solve this side (seed = x ∪ its own), update its own part
 *     with snap off, x is updated by this step too
 *
 * **The key is that ownA and ownB are never in the same problem**, so there is no repulsion between them and each fills
 * the same open space. The old branch on the left and the new branch on the right grow at the same spot, and one glance across the columns
 * shows "this was replaced here". And "they take no space from each other" is not a constraint written into the force field but a consequence of "not in the same problem":
 * the hurdle of "adding pairwise masks to the force layout" is sidestepped like that.
 */
export async function solveDiffLayout(
  sides: DiffSides,
  base: { before: Positions; after: Positions },
  solve: DiffSolve,
  spec: DiffLayoutSpec = {},
): Promise<DiffLayoutResult> {
  const rounds = Math.max(0, Math.floor(spec.rounds ?? DEFAULT_DIFF_LAYOUT.rounds));
  const snap = spec.snap !== false;
  const shared = new Set<string>();
  for (const n of sides.before.nodes) if (sides.after.index.has(n.id)) shared.add(n.id);

  // Start: shared ones take B's free solve, A's unique ones are translated by anchors as the initial value.
  const seeded = diffPositions(sides, base.before, base.after);
  let x = split(seeded, shared).shared;
  let ownA = split(seeded, shared).own;
  let ownB = split(base.after, shared).own;
  // B's unique ones can only be in after; A's unique ones only in seeded. Each drops the other's.
  for (const id of Object.keys(ownA)) if (sides.after.index.has(id)) delete ownA[id];
  for (const id of Object.keys(ownB)) if (sides.before.index.has(id)) delete ownB[id];

  const steps: DiffLayoutResult['steps'] = [];
  let iter = Math.max(0, Math.floor(spec.iterations ?? DEFAULT_DIFF_LAYOUT.iterations));
  for (let k = 0; k < rounds && iter > 0; k++) {
    const side = k % 2 === 0 ? 'before' : 'after';
    const seed = { ...x, ...(side === 'before' ? ownA : ownB) };
    const got = await solve(side, seed, iter, snap ? shared : EMPTY);
    const parts = split(got, shared);
    if (side === 'before') ownA = parts.own; else ownB = parts.own;
    if (!snap) x = parts.shared;
    steps.push({ side, iterations: iter });
    iter = Math.floor(iter / 2);
  }
  return { past: { ...x, ...ownA }, now: { ...x, ...ownB }, steps };
}
