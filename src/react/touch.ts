/* Touch reads the graph with one finger and moves the camera with two.
 * This state machine knows no DOM, renderer or React state. A gesture that ever
 * had two fingers stays navigation until every finger lifts.
 *
 * **Long press is deliberately not bound.** One-finger exploration (tap = preview,
 * sweep = preview along a path) is the touch counterpart of hover, and the product
 * design depends on it. A hold timer used to select on 450ms, but that read as a
 * hidden click and fought the "tap is a glance" grammar; until the gesture model is
 * revisited, selection is the explicit double tap and a hold does nothing. */
import type { Viewport } from './camera';

export interface Point { x: number; y: number }
export interface TouchTarget<T> { id: string; node: boolean; value: T }
export interface TouchActions<T> {
  hit(p: Point): TouchTarget<T> | null;
  preview(target: T | null): void;
  select(target: T | null): void;
  viewport(): Viewport;
  move(view: Viewport): void;
  limits(): { min: number; max: number };
  interact(): void;
}
const DOUBLE_MS = 350, SLOP = 8;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const middle = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export function touchGestures<T>(actions: TouchActions<T>) {
  const fingers = new Map<number, Point>();
  let navigation = false, moved = false;
  let start: Point | null = null;
  let target: TouchTarget<T> | null = null;
  let previewId: string | null = null;
  let lastTap: { id: string; point: Point; time: number } | null = null;
  let pinch: { ids: number[]; center: Point; distance: number; view: Viewport } | null = null;
  const anchor = () => {
    const entries = [...fingers];
    pinch = entries.length < 2 ? null : {
      ids: entries.slice(0, 2).map(([id]) => id),
      center: middle(entries[0][1], entries[1][1]),
      distance: distance(entries[0][1], entries[1][1]), view: actions.viewport(),
    };
  };
  const reset = () => {
    fingers.clear(); pinch = null; start = null; target = null;
    navigation = moved = false;
  };
  return {
    down(id: number, point: Point) {
      actions.interact();
      fingers.set(id, point);
      if (fingers.size > 1 || navigation) {
        navigation = true; lastTap = null;
        actions.preview(null); anchor(); return;
      }
      start = point; moved = false;
      target = actions.hit(point);
      previewId = target?.id ?? null;
      actions.preview(target?.value ?? null);
    },
    move(id: number, point: Point) {
      if (!fingers.has(id)) return;
      actions.interact(); fingers.set(id, point);
      if (navigation) {
        if (!pinch) return;
        const a = fingers.get(pinch.ids[0]), b = fingers.get(pinch.ids[1]);
        if (!a || !b) return;
        const center = middle(a, b), limits = actions.limits();
        const zoom = Math.max(limits.min, Math.min(limits.max,
          pinch.view.zoom * distance(a, b) / Math.max(1, pinch.distance)));
        const ratio = zoom / pinch.view.zoom;
        actions.move({ zoom, pan: {
          x: center.x - (pinch.center.x - pinch.view.pan.x) * ratio,
          y: center.y - (pinch.center.y - pinch.view.pan.y) * ratio,
        } });
        return;
      }
      if (start && distance(start, point) > SLOP) {
        moved = true; lastTap = null;
      }
      // A sweep previews every hit; it never turns into a hold or a tap.
      if (moved) {
        const next = actions.hit(point);
        if ((next?.id ?? null) !== previewId) {
          previewId = next?.id ?? null;
          actions.preview(next?.value ?? null);
        }
      }
    },
    up(id: number, point: Point) {
      if (!fingers.has(id)) return;
      fingers.delete(id);
      if (!navigation && !moved && start && distance(start, point) <= SLOP) {
        const hit = actions.hit(point);
        if ((hit?.id ?? null) === (target?.id ?? null)) {
          actions.preview(hit?.value ?? null);
          if (!hit) { actions.select(null); lastTap = null; }
          else if (hit.node) {
            const now = Date.now();
            if (lastTap?.id === hit.id && now - lastTap.time < DOUBLE_MS && distance(lastTap.point, point) <= SLOP * 3) {
              actions.select(hit.value); lastTap = null;
            } else lastTap = { id: hit.id, point, time: now };
          } else lastTap = null;
        } else lastTap = null;
      } else lastTap = null;
      if (fingers.size === 0) reset();
      else anchor();
    },
    cancel() { reset(); lastTap = null; actions.preview(null); },
    dispose() { reset(); lastTap = null; },
  };
}
