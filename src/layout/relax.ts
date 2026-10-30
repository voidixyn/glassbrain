/* glassbrain · local relaxation: push crowded boxes apart, nothing else moves
 *
 * **Why not another force run.** Measured (cose-bilkent / fcose, 124 nodes, graph width about 2200):
 *
 *   · cose-bilkent throws `RangeError: Invalid array length` for any `numIter < 400`,
 *     and it throws **asynchronously inside its own tick**: `layoutstop` never arrives and the whole canvas hangs on
 *     "Preparing layout".
 *   · fcose does not throw, but `numIter=1` and `numIter=1200` give **exactly the same** displacement (max 1461
 *     vs 1523). So `numIter` is not a "step size" at all, only a cap; neither engine has
 *     "go only a short way".
 *   · Even with a seed, one solve moves **shared nodes** by a median of 586, max 1422. And shared coordinates are
 *     snapped back, so ghosts land relative to a skeleton that teleports 586 afterwards, and wherever they land is
 *     wrong.
 *   · fcose's `fixedNodeConstraint` cannot be used in this pipeline either: after divide and conquer splits the graph into components,
 *     more than half the ids in the constraint are not in this component's job, and it throws.
 *
 * So "compute again on top of the translation" **cannot be left to force**. But the problem it was meant to solve is not
 * "rearrange" either; it is "translation does no collision checks, and lands on top of others": a **local**
 * problem, a local operator is enough, and a local operator naturally takes the "iterate a few steps" knob.
 *
 * Two terms, each applied once per round:
 *   ① separate  two overlapping boxes are pushed apart along the line between centers until they just stop overlapping (a pinned side stays)
 *   ② return    every movable box is pulled back a little toward its **starting point**, so pushing does not make it drift away
 *
 * Pure, deterministic, O(n)-ish (a uniform grid finds neighbors). No cytoscape, no DOM.
 */
import type { Positions } from './engine';

export interface RelaxNode {
  id: string;
  w: number;
  h: number;
  /** Pinned = this step may not move it (the shared skeleton is pinned when snap is on). */
  fixed: boolean;
}

/** Minimum gap between boxes (graph coordinates). */
const PAD = 12;
/** One push only goes this far: spread over several rounds, so two boxes do not bounce off each other. */
const PUSH = 0.5;
/** Return: each round pulls **the centroid of the movable batch** back toward its starting point by this much.
 *
 *  Pulling back node by node is wrong, it was tried: separation pushes a small amount each round (proportional to overlap), while per-node return
 *  pulls back an amount proportional to "how far from home", and the two balance quickly: 8 boxes of 100×40 crammed into 42 units
 *  only go from 28 overlapping pairs to 10 however long you push, and one more iteration moves nothing. **Return handles position, separation handles shape**;
 *  mixed into one term they strangle each other.
 *
 *  So only the centroid is pinned: the whole blob may not drift away from its anchor, but how it spreads inside is up to it. */
const HOME = 0.25;

const DEFAULT_SIZE = { w: 120, h: 34 };

/**
 * Push overlaps apart. `pos` is not modified; a new copy is returned.
 *
 * `iterations` is a real knob: 0 = returned as is; the larger, the further apart and the closer to "no overlap".
 */
export function relaxOverlaps(pos: Positions, nodes: RelaxNode[], iterations: number): Positions {
  /* **Deep copy per point**, not `{...pos}`. What follows pushes in place (`pa.x += …`), and a shallow copy
   * shares the same point objects with the argument: it modifies the caller's copy. The result is not "computing once more" but **every
   * recompute continues pushing from the last result**: the same input spreads wider every time, and nothing is reproducible. */
  const out: Positions = {};
  for (const id of Object.keys(pos)) out[id] = { x: pos[id].x, y: pos[id].y };
  if (iterations <= 0 || nodes.length < 2) return out;

  const live = nodes.filter((n) => out[n.id]);
  if (live.length < 2) return out;
  const home = new Map(live.map((n) => [n.id, { ...out[n.id] }]));
  // The grid cell is the largest box, so any pair of overlapping boxes falls in adjacent cells of a 3×3 block.
  let cell = 1;
  for (const n of live) cell = Math.max(cell, n.w + PAD, n.h + PAD);

  for (let it = 0; it < iterations; it++) {
    // Rebuild the grid every round: positions changed after the last round's pushes.
    const grid = new Map<string, RelaxNode[]>();
    for (const n of live) {
      const p = out[n.id];
      const k = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`;
      const arr = grid.get(k);
      arr ? arr.push(n) : grid.set(k, [n]);
    }
    for (const a of live) {
      const pa = out[a.id];
      const gx = Math.floor(pa.x / cell), gy = Math.floor(pa.y / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const b of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
          // Each pair is handled once (ordered by id), and if both are pinned there is nothing to discuss.
          if (b.id <= a.id || (a.fixed && b.fixed)) continue;
          const pb = out[b.id];
          const needX = (a.w + b.w) / 2 + PAD;
          const needY = (a.h + b.h) / 2 + PAD;
          const ox = needX - Math.abs(pa.x - pb.x);
          const oy = needY - Math.abs(pa.y - pb.y);
          if (ox <= 0 || oy <= 0) continue;         // no overlap
          /* Push apart along the **minimum translation vector**: along whichever axis overlaps less, so boxes are not pushed
           * the long way round. When fully coincident (both at one point), pick a direction by id to stay deterministic. */
          let vx = 0, vy = 0;
          if (ox < oy) vx = (pa.x === pb.x ? (a.id < b.id ? -1 : 1) : Math.sign(pa.x - pb.x)) * ox;
          else vy = (pa.y === pb.y ? (a.id < b.id ? -1 : 1) : Math.sign(pa.y - pb.y)) * oy;
          // Both movable: each yields half; one pinned: the other goes all the way.
          const share = a.fixed || b.fixed ? 1 : 0.5;
          if (!a.fixed) { pa.x += vx * share * PUSH; pa.y += vy * share * PUSH; }
          if (!b.fixed) { pb.x -= vx * share * PUSH; pb.y -= vy * share * PUSH; }
        }
      }
    }
    /* Return: only the **centroid** is pulled back. Separation is local, and a chain of pushes can make the whole blob drift,
     * while "this ghost blob stays beside its anchor" was already decided by `diffPositions` and should not be pushed away. */
    let dx = 0, dy = 0, k = 0;
    for (const n of live) {
      if (n.fixed) continue;
      const p = out[n.id], h = home.get(n.id)!;
      dx += p.x - h.x; dy += p.y - h.y; k++;
    }
    if (k) {
      dx = (dx / k) * HOME; dy = (dy / k) * HOME;
      for (const n of live) {
        if (n.fixed) continue;
        out[n.id].x -= dx; out[n.id].y -= dy;
      }
    }
  }
  return out;
}

/** Build relaxation input from the measured size table. Missing sizes get a moderate default; it only affects how far things are pushed. */
export function relaxNodes(
  ids: Iterable<string>, dims: Record<string, { w: number; h: number }>, fixed: ReadonlySet<string>,
): RelaxNode[] {
  const out: RelaxNode[] = [];
  for (const id of ids) {
    const d = dims[id] ?? DEFAULT_SIZE;
    out.push({ id, w: d.w, h: d.h, fixed: fixed.has(id) });
  }
  return out;
}
