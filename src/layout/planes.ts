/* glassbrain · 2.5D layer plane projection
 *
 * cytoscape is strictly 2D, but **coordinates are computed by us and poured in** (preset layout),
 * so "multiple layers" need no other renderer: one affine map per layer's coordinates (shear + squash + per-layer offset),
 * and edges between layers naturally become nearly vertical links that read as "floors".
 *
 *     x' = x + y·shear + z·dx
 *     y' = y·squash    − z·gap
 *
 * One layout solves the whole graph, so each layer usually sits in its own part of the plane (the layers are siblings in
 * the tree). Raised, each layer is first shifted so its center is the center of all layers: every floor is then full,
 * not one corner of a shared plate.
 *
 * Pure function, no cytoscape. Layer plates are returned in graph coordinates; the host draws them as SVG.
 *
 * `t` is how far this affine map has gone: 0 = as is (all layers on one plane, coordinates exactly as the layout solved them),
 * 1 = full 2.5D. Values in between interpolate linearly: the map is linear in t, so "raising / flattening layers" is just
 * moving t from one end to the other, with no second set of coordinates.
 */
import type { LayerSpec } from '../profile';
import { PLANE_HUES } from '../style';

export interface PlaneOptions {
  /** Shear factor: larger is more "slanted". 0 = no slant (pure vertical stacking). */
  shear: number;
  /** Vertical squash: simulates looking down. */
  squash: number;
  /** Vertical spacing per z level (how far apart layers are). */
  gap: number;
  /** Horizontal offset per z level. */
  dx: number;
  /** Plate padding. */
  pad: number;
}

export const DEFAULT_PLANES: PlaneOptions = { shear: 0.55, squash: 0.5, gap: 460, dx: 0, pad: 90 };

export interface Plate {
  layer: string;
  label: string;
  color: string;
  /** Projected corners (graph coordinates), clockwise. */
  points: [number, number][];
  /** Opacity 0..1. The projection only gives the shape; the host fills it: unselected layers have no plate, and a plate fades with its layer. */
  alpha?: number;
  /** Layer label anchor. Placed at the plate's **inner** top-left corner: plates extend beyond the nodes, and a label outside
   *  is easily cut off by fit (fit only sees nodes). */
  anchor: [number, number];
}

export type Positions = Record<string, { x: number; y: number }>;

/** A layer's z: LayerSpec.z if given, else declaration order. */
export function layerZ(layers: LayerSpec[]): Map<string, number> {
  return new Map(layers.map((l, i) => [l.id, l.z ?? i]));
}

export function projectPlanes(
  positions: Positions,
  layerOf: Map<string, string>,
  layers: LayerSpec[],
  o: Partial<PlaneOptions> = {},
  t = 1,
  /** When only part is shown (filtered by source): plates only enclose these nodes and only layers containing them get plates. Layer spacing is measured on the whole graph,
   *  and not one coordinate moves: filtering should move nothing; the plates just close in. */
  frame?: Set<string> | null,
): { positions: Positions; plates: Plate[] } {
  const z = layerZ(layers);
  const lidOf = (id: string) => layerOf.get(id) ?? layers[0]?.id ?? 'default';

  // First measure each layer's bounding box **before projection**: layer spacing must follow the graph's real scale. A hard-coded constant fits
  // small graphs, and on graphs with thousands of nodes two layers overlap.
  const box = new Map<string, { x1: number; y1: number; x2: number; y2: number }>();
  for (const [id, p] of Object.entries(positions)) {
    const lid = lidOf(id);
    const b = box.get(lid);
    if (!b) box.set(lid, { x1: p.x, y1: p.y, x2: p.x, y2: p.y });
    else { b.x1 = Math.min(b.x1, p.x); b.y1 = Math.min(b.y1, p.y); b.x2 = Math.max(b.x2, p.x); b.y2 = Math.max(b.y2, p.y); }
  }
  const tallest = Math.max(1, ...[...box.values()].map((b) => (b.y2 - b.y1) * DEFAULT_PLANES.squash));
  const opt: PlaneOptions = {
    ...DEFAULT_PLANES,
    // If not given explicitly, derive from the tallest layer: leave "a whole layer and a bit more" of clearance, so layers separate.
    gap: o.gap ?? Math.max(DEFAULT_PLANES.gap, tallest * 1.35),
    pad: o.pad ?? Math.max(DEFAULT_PLANES.pad, tallest * 0.06),
    shear: o.shear ?? DEFAULT_PLANES.shear,
    squash: o.squash ?? DEFAULT_PLANES.squash,
    dx: o.dx ?? DEFAULT_PLANES.dx,
  };
  // Centering shifts, measured on the whole graph like the spacing: filtering by source moves nothing.
  const center = (bs: { x1: number; y1: number; x2: number; y2: number }[]) => bs.length
    ? [(Math.min(...bs.map((b) => b.x1)) + Math.max(...bs.map((b) => b.x2))) / 2,
      (Math.min(...bs.map((b) => b.y1)) + Math.max(...bs.map((b) => b.y2))) / 2]
    : [0, 0];
  const [cx, cy] = center([...box.values()]);
  const shift = new Map([...box].map(([lid, b]) => [lid, [cx - (b.x1 + b.x2) / 2, cy - (b.y1 + b.y2) / 2]]));
  const project = (x0: number, y0: number, zz: number, lid?: string): [number, number] => {
    const [sx, sy] = (lid && shift.get(lid)) || [0, 0];
    const x = x0 + sx, y = y0 + sy;
    // Full 2.5D, then linear in t from the flat coordinates (see `t` above).
    const [fx, fy] = [x + y * opt.shear + zz * opt.dx, y * opt.squash - zz * opt.gap];
    return [x0 + t * (fx - x0), y0 + t * (fy - y0)];
  };

  const out: Positions = {};
  for (const [id, p] of Object.entries(positions)) {
    const lid = lidOf(id);
    const [x, y] = project(p.x, p.y, z.get(lid) ?? 0, lid);
    out[id] = { x, y };
  }

  /* Plates are always as big as **the union of all layers** (after centering), not measured separately: equal plates aligned
   * vertically read as one plane lifted several floors. Measured separately, a sparse layer's plate would be smaller and offset. */
  let frameBox = box;
  if (frame) {
    frameBox = new Map();
    for (const id of frame) {
      const p = positions[id];
      if (!p) continue;
      const lid = lidOf(id);
      const b = frameBox.get(lid);
      if (!b) frameBox.set(lid, { x1: p.x, y1: p.y, x2: p.x, y2: p.y });
      else { b.x1 = Math.min(b.x1, p.x); b.y1 = Math.min(b.y1, p.y); b.x2 = Math.max(b.x2, p.x); b.y2 = Math.max(b.y2, p.y); }
    }
  }
  const all = [...frameBox].map(([lid, b]) => {
    const [sx, sy] = shift.get(lid) ?? [0, 0];
    return { x1: b.x1 + sx, y1: b.y1 + sy, x2: b.x2 + sx, y2: b.y2 + sy };
  });
  const [x1, y1, x2, y2] = all.length
    ? [Math.min(...all.map((b) => b.x1)) - opt.pad, Math.min(...all.map((b) => b.y1)) - opt.pad,
      Math.max(...all.map((b) => b.x2)) + opt.pad, Math.max(...all.map((b) => b.y2)) + opt.pad]
    : [0, 0, 0, 0];
  const plates: Plate[] = [];
  layers.forEach((l, i) => {
    if (!frameBox.has(l.id)) return;
    const zz = z.get(l.id) ?? i;
    const corners: [number, number][] = [
      project(x1, y1, zz), project(x2, y1, zz), project(x2, y2, zz), project(x1, y2, zz),
    ];
    const [c0, c1, , c3] = corners;
    const inset = (t: number, u: number): [number, number] => [
      c0[0] + t * (c1[0] - c0[0]) + u * (c3[0] - c0[0]),
      c0[1] + t * (c1[1] - c0[1]) + u * (c3[1] - c0[1]),
    ];
    plates.push({
      layer: l.id,
      label: l.label,
      color: l.color ?? PLANE_HUES[i % PLANE_HUES.length],
      points: corners,
      anchor: inset(0.03, 0.14),
    });
  });
  // Bottom layer first (later ones cover earlier ones).
  plates.sort((a, b) => (z.get(a.layer) ?? 0) - (z.get(b.layer) ?? 0));
  return { positions: out, plates };
}
