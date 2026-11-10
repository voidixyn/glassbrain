import { test } from 'node:test';
import assert from 'node:assert/strict';
import { touchGestures } from '../dist/internal.js';

function setup(t: any) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const previews: (string | null)[] = [], selections: (string | null)[] = [];
  let view = { zoom: 1, pan: { x: 0, y: 0 } };
  const gesture = touchGestures({
    hit: (p) => p.x < 0 ? null : { id: p.x < 100 ? 'a' : 'b', node: p.y >= 0, value: p.x < 100 ? 'a' : 'b' },
    preview: (v) => previews.push(v), select: (v) => selections.push(v),
    viewport: () => structuredClone(view), move: (v) => { view = v; },
    limits: () => ({ min: 0.5, max: 4 }), interact() {},
  });
  t.after(() => gesture.dispose());
  const tap = (x = 20, y = 20) => { gesture.down(1, { x, y }); gesture.up(1, { x, y }); };
  return { gesture, previews, selections, tap, view: () => view };
}

test('tap previews immediately, persists after lift; double tap selects without moving the camera', (t) => {
  const { gesture, previews, selections, view } = setup(t);
  gesture.down(1, { x: 20, y: 20 });
  assert.deepEqual(previews, ['a']); assert.deepEqual(selections, []);
  gesture.up(1, { x: 20, y: 20 });
  t.mock.timers.tick(100);
  gesture.down(1, { x: 21, y: 20 }); gesture.up(1, { x: 21, y: 20 });
  assert.deepEqual(selections, ['a']); assert.equal(previews.at(-1), 'a');
  assert.deepEqual(view(), { zoom: 1, pan: { x: 0, y: 0 } });
});

test('a one-finger sweep previews hits and never becomes a tap', (t) => {
  const { gesture, previews, selections, view } = setup(t);
  gesture.down(1, { x: 20, y: 20 }); gesture.move(1, { x: 120, y: 20 });
  t.mock.timers.tick(600);
  gesture.move(1, { x: 20, y: 20 }); gesture.up(1, { x: 20, y: 20 });
  assert.deepEqual(previews, ['a', 'b', 'a']); assert.deepEqual(selections, []);
  assert.equal(view().zoom, 1); assert.equal(view().pan.x, 0);
});

test('a hold no longer selects; selection is still the double tap', (t) => {
  const { gesture, selections, tap } = setup(t);
  gesture.down(1, { x: 20, y: 20 }); gesture.move(1, { x: 23, y: 21 });
  t.mock.timers.tick(600); assert.deepEqual(selections, []);
  gesture.up(1, { x: 23, y: 21 }); assert.deepEqual(selections, []);
  tap(); assert.deepEqual(selections, [], 'a hold cannot be the first tap');
  tap(); assert.deepEqual(selections, ['a']);
});

test('two fingers pan and zoom about their moving midpoint, including at the zoom limit', (t) => {
  const { gesture, view, selections, previews } = setup(t);
  gesture.down(1, { x: 20, y: 20 }); gesture.down(2, { x: 120, y: 20 });
  gesture.move(1, { x: 10, y: 30 }); gesture.move(2, { x: 210, y: 30 });
  assert.deepEqual(view(), { zoom: 2, pan: { x: -30, y: -10 } });
  gesture.move(2, { x: 1010, y: 30 });
  assert.deepEqual(view(), { zoom: 4, pan: { x: 230, y: -50 } });
  const count = previews.length;
  gesture.up(2, { x: 1010, y: 30 }); gesture.move(1, { x: 130, y: 30 });
  t.mock.timers.tick(600); gesture.up(1, { x: 130, y: 30 });
  assert.equal(previews.length, count); assert.deepEqual(selections, []);
});

test('navigation cancels a tap, and reanchors when fingers change', (t) => {
  const { gesture, selections, tap, view } = setup(t);
  tap(); gesture.down(1, { x: 20, y: 20 }); t.mock.timers.tick(200);
  gesture.down(2, { x: 120, y: 20 }); t.mock.timers.tick(600);
  gesture.move(2, { x: 220, y: 20 });
  gesture.down(3, { x: 320, y: 20 }); gesture.up(1, { x: 20, y: 20 });
  const before = structuredClone(view());
  gesture.move(3, { x: 320, y: 20 }); assert.deepEqual(view(), before);
  gesture.up(2, { x: 220, y: 20 }); gesture.up(3, { x: 320, y: 20 }); tap();
  assert.deepEqual(selections, []);
});

test('cancel clears preview; next gesture starts clean', (t) => {
  const { gesture, previews, selections, tap } = setup(t);
  gesture.down(1, { x: 20, y: 20 }); gesture.cancel(); t.mock.timers.tick(600);
  assert.equal(previews.at(-1), null); assert.deepEqual(selections, []);
  tap(); assert.deepEqual(selections, []);
  gesture.down(1, { x: 20, y: 20 }); gesture.dispose(); t.mock.timers.tick(600);
  assert.deepEqual(selections, []);
});

test('blank tap clears selection; edges only preview; taps must match time, target and distance', (t) => {
  const { tap, selections } = setup(t);
  tap(); tap(120); tap(120, -10); tap(120, -10);
  tap(20); t.mock.timers.tick(351); tap(20); tap(70);
  assert.deepEqual(selections, []);
  tap(-10); assert.deepEqual(selections, [null]);
});


test('a hold cannot be the second tap or seed the next double tap', (t) => {
  const { gesture, selections, tap } = setup(t);
  tap();
  gesture.down(1, { x: 20, y: 20 });
  t.mock.timers.tick(350);
  gesture.up(1, { x: 20, y: 20 });
  assert.deepEqual(selections, []);
  tap(); assert.deepEqual(selections, []);
  tap(); assert.deepEqual(selections, ['a']);
});
