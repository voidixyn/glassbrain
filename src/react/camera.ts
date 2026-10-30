/* glassbrain · camera
 *
 * The camera moves a **framing box** (center + half-width), not the two numbers zoom/pan:
 *   ① zoom is multiplicative; linear interpolation is visibly fast / slow midway, while the half-width interpolated geometrically is even.
 *   ② pan is coupled with zoom; interpolating each separately makes the picture slide oddly while zooming.
 * Transitions (GraphCanvas's playTransition), raising / flattening layers and search fly-to all use this same set.
 */

export interface Viewport { zoom: number; pan: { x: number; y: number } }
export interface Rect { cx: number; cy: number; hw: number }

export const toRect = (v: Viewport, W: number, H: number): Rect => ({
  cx: (W / 2 - v.pan.x) / v.zoom, cy: (H / 2 - v.pan.y) / v.zoom, hw: W / (2 * v.zoom),
});

export const toView = (r: Rect, W: number, H: number): Viewport => {
  const z = W / (2 * Math.max(1e-6, r.hw));
  return { zoom: z, pan: { x: W / 2 - r.cx * z, y: H / 2 - r.cy * z } };
};

/** Between two framing boxes: center linear, half-width geometric. `k` ∈ [0,1]. */
export const lerpRect = (a: Rect, b: Rect, k: number): Rect => ({
  cx: a.cx + (b.cx - a.cx) * k, cy: a.cy + (b.cy - a.cy) * k, hw: a.hw * Math.pow(b.hw / a.hw, k),
});

/**
 * **Fly to**: far targets pull back first, then push in (van Wijk & Nuij, "Smooth and efficient zooming and
 * panning", 2003; d3.interpolateZoom uses it too). When two points are far apart, a straight pan flashes unrecognizable things
 * past midway; rising first to a height that shows both start and end, people always know where they are going.
 * Near targets reduce to an ordinary pan and zoom.
 *
 * Returns the path function and its "length" S (in viewport widths); duration follows S, so near and far feel the same.
 */
export function zoomPath(a: Rect, b: Rect): { at: (k: number) => Rect; S: number } {
  const rho = Math.SQRT2, rho2 = 2, rho4 = 4;
  const w0 = a.hw * 2, w1 = b.hw * 2;
  const dx = b.cx - a.cx, dy = b.cy - a.cy, d2 = dx * dx + dy * dy;
  if (d2 < 1e-12) {
    const S = Math.log(w1 / w0) / rho;
    return { S: Math.abs(S), at: (k) => ({ cx: a.cx + k * dx, cy: a.cy + k * dy, hw: (w0 * Math.exp(rho * k * S)) / 2 }) };
  }
  const d1 = Math.sqrt(d2);
  const b0 = (w1 * w1 - w0 * w0 + rho4 * d2) / (2 * w0 * rho2 * d1);
  const b1 = (w1 * w1 - w0 * w0 - rho4 * d2) / (2 * w1 * rho2 * d1);
  const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
  const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
  const S = (r1 - r0) / rho;
  return {
    S,
    at: (k) => {
      const s = k * S, c0 = Math.cosh(r0);
      const u = (w0 / (rho2 * d1)) * (c0 * Math.tanh(rho * s + r0) - Math.sinh(r0));
      return { cx: a.cx + u * dx, cy: a.cy + u * dy, hw: (w0 * c0) / Math.cosh(rho * s + r0) / 2 };
    },
  };
}

export const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
