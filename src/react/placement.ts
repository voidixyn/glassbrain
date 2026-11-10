/* Popover placement: keep floating panels inside the canvas (or the viewport when the
 * caller has no stage), preferring the caller's side and flipping when the preferred
 * side has no room. One geometry function for the toolbar menus and the legend panel,
 * so a menu near the right edge never opens half outside the graph. */
import { useLayoutEffect, useState, type RefObject } from 'react';

export type Side = 'top' | 'bottom';
export type Align = 'start' | 'end';
export interface Prefer { side: Side; align: Align }
export interface Placement extends Prefer { left: number; top: number }

const GAP = 6;
const MARGIN = 8;

export function placePanel(
  anchor: DOMRect, panel: { width: number; height: number }, boundary: DOMRect, prefer: Prefer,
): Placement {
  const combos: Prefer[] = [
    prefer,
    { side: prefer.side, align: prefer.align === 'start' ? 'end' : 'start' },
    { side: prefer.side === 'bottom' ? 'top' : 'bottom', align: prefer.align },
    { side: prefer.side === 'bottom' ? 'top' : 'bottom', align: prefer.align === 'start' ? 'end' : 'start' },
  ];
  const at = (c: Prefer) => ({
    left: c.align === 'start' ? anchor.left : anchor.right - panel.width,
    top: c.side === 'bottom' ? anchor.bottom + GAP : anchor.top - GAP - panel.height,
  });
  const fits = (c: Prefer) => {
    const p = at(c);
    return p.left >= boundary.left + MARGIN && p.left + panel.width <= boundary.right - MARGIN
      && p.top >= boundary.top + MARGIN && p.top + panel.height <= boundary.bottom - MARGIN;
  };
  const chosen = combos.find(fits) ?? prefer;
  const p = at(chosen);
  const minLeft = boundary.left + MARGIN;
  const maxLeft = Math.max(minLeft, boundary.right - MARGIN - panel.width);
  const minTop = boundary.top + MARGIN;
  const maxTop = Math.max(minTop, boundary.bottom - MARGIN - panel.height);
  return {
    ...chosen,
    left: Math.min(Math.max(p.left, minLeft), maxLeft),
    top: Math.min(Math.max(p.top, minTop), maxTop),
  };
}

/** Measure after the panel is in the DOM; until then the caller can keep it hidden. */
export function usePanelPlacement(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
  prefer: Prefer,
  boundaryRef?: RefObject<HTMLElement | null>,
) {
  const [placement, setPlacement] = useState<Placement | null>(null);
  useLayoutEffect(() => {
    if (!open) { setPlacement(null); return; }
    const anchor = anchorRef.current?.getBoundingClientRect();
    const panel = panelRef.current?.getBoundingClientRect();
    if (!anchor || !panel) return;
    const boundary = (boundaryRef?.current
      ?? anchorRef.current?.closest('.gb-stage')
      ?? document.documentElement).getBoundingClientRect();
    setPlacement(placePanel(anchor, { width: panel.width, height: panel.height }, boundary, prefer));
    // prefer is a stable literal at each call site; its fields are the real dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, anchorRef, panelRef, boundaryRef, prefer.side, prefer.align]);
  return placement;
}
