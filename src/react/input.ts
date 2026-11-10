/* One input boundary for the main canvas and the diff mirror. Mouse/trackpad
 * retain Cytoscape's dragging and selection; only touch bypasses its gestures. */
import { VIRTUAL_ROOT } from '../elements';
import { touchGestures, type Point } from './touch';

interface InputActions {
  interact(): void;
  cancelFly(): void;
  select(target: any | null): void;
  selectTouch(target: any | null): void;
  hover?(target: any | null): void;
  preview(target: any | null): void;
  focus?(id: string): void;
}

export function installGraphInput(cy: any, el: HTMLElement, actions: InputActions): () => void {
  const interact = () => { actions.interact(); actions.cancelFly(); };
  let hasTouchPreview = false;
  const previewTouch = (target: any | null) => {
    hasTouchPreview = target != null;
    actions.preview(target);
  };
  const touch = touchGestures<any>({
    interact,
    hit(p) {
      const z = cy.zoom(), pan = cy.pan();
      // The painter already overrides this renderer hook, so hit testing agrees
      // with the visible dots/curves in browse mode and native shapes in diff.
      const hit = cy.renderer().findNearestElements((p.x - pan.x) / z, (p.y - pan.y) / z, true, true)[0];
      return !hit || hit.id() === VIRTUAL_ROOT ? null : { id: hit.id(), node: hit.isNode(), value: hit };
    },
    preview: previewTouch,
    select: actions.selectTouch,
    viewport: () => ({ zoom: cy.zoom(), pan: { ...cy.pan() } }),
    move: (view) => cy.viewport(view),
    limits: () => ({ min: cy.minZoom(), max: cy.maxZoom() }),
  });
  const bindings: Array<() => void> = [];
  const onCy = (events: string, handler: (e: any) => void) => {
    cy.on(events, handler); bindings.push(() => cy.off(events, handler));
  };
  let lastTap = { id: '', time: 0 };
  onCy('tap', (e) => {
    actions.interact();
    if (e.target === cy) actions.select(null);
    else if (e.target.isNode()) {
      const id = e.target.id(), time = Date.now();
      actions.select(id === VIRTUAL_ROOT ? null : e.target);
      if (id !== VIRTUAL_ROOT && lastTap.id === id && time - lastTap.time < 350) actions.focus?.(id);
      lastTap = { id, time };
    }
  });
  onCy('tapstart', actions.cancelFly);
  if (actions.hover) {
    onCy('mouseover', (e) => { if (e.target !== cy) { actions.interact(); actions.hover!(e.target); } });
    onCy('mouseout', (e) => { if (e.target !== cy) actions.hover!(null); });
  }
  const on = <K extends keyof HTMLElementEventMap>(name: K, fn: (e: HTMLElementEventMap[K]) => void, capture = false) => {
    el.addEventListener(name, fn, { capture, passive: false });
    bindings.push(() => el.removeEventListener(name, fn, capture));
  };
  on('wheel', (e) => {
    e.preventDefault(); interact();
    if (e.ctrlKey || e.metaKey) {
      const rect = el.getBoundingClientRect();
      cy.zoom({ level: cy.zoom() * Math.exp(-e.deltaY * 0.01),
        renderedPosition: { x: e.clientX - rect.left, y: e.clientY - rect.top } });
    } else cy.panBy({ x: -e.deltaX, y: -e.deltaY });
  });
  on('mouseleave', () => actions.hover?.(null));

  const captured = new Set<number>();
  const point = (e: PointerEvent): Point => {
    const rect = el.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const stop = (e: Event) => { if (e.cancelable) e.preventDefault(); e.stopImmediatePropagation(); };
  on('pointerdown', (e) => {
    if (e.pointerType !== 'touch') { if (hasTouchPreview) previewTouch(null); return; }
    stop(e); lastTap = { id: '', time: 0 };
    captured.add(e.pointerId); el.setPointerCapture(e.pointerId);
    touch.down(e.pointerId, point(e));
  }, true);
  on('pointermove', (e) => {
    if (e.pointerType !== 'touch' && hasTouchPreview) previewTouch(null);
    if (!captured.has(e.pointerId)) return;
    stop(e); touch.move(e.pointerId, point(e));
  }, true);
  on('pointerup', (e) => {
    if (!captured.delete(e.pointerId)) return;
    stop(e); touch.up(e.pointerId, point(e));
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  }, true);
  const cancel = () => {
    touch.cancel();
    const ids = [...captured]; captured.clear();
    for (const id of ids) if (el.hasPointerCapture(id)) el.releasePointerCapture(id);
  };
  on('pointercancel', (e) => { if (captured.has(e.pointerId)) { stop(e); cancel(); } }, true);
  on('lostpointercapture', (e) => { if (captured.has(e.pointerId)) cancel(); }, true);
  // Native touch events are separate from pointer events. Keep Cytoscape from
  // also dragging/selecting; preventing default also suppresses compatibility clicks.
  for (const name of ['touchstart', 'touchmove', 'touchend', 'touchcancel'] as const) on(name, stop, true);
  on('contextmenu', (e) => { if (captured.size || e.pointerType === 'touch') stop(e); }, true);
  const previousTouchAction = el.style.touchAction;
  el.style.touchAction = 'none';
  const win = el.ownerDocument.defaultView;
  win?.addEventListener('blur', cancel);
  return () => {
    touch.dispose();
    bindings.forEach((off) => off());
    win?.removeEventListener('blur', cancel);
    for (const id of captured) if (el.hasPointerCapture(id)) el.releasePointerCapture(id);
    captured.clear(); el.style.touchAction = previousTouchAction;
  };
}
