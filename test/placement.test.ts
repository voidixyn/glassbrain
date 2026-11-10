import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placePanel } from '../dist/internal.js';
const rect = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;

test('panels flip inside an offset stage instead of overflowing its bottom/right edges', () => {
  const p = placePanel(rect(450, 330, 30, 30), { width: 180, height: 100 },
    rect(100, 100, 400, 300), { side: 'bottom', align: 'start' });
  assert.deepEqual(p, { side: 'top', align: 'end', left: 300, top: 224 });
});

test('when no corner fits, coordinates clamp within the stage without depending on a flip', () => {
  const p = placePanel(rect(190, 180, 30, 30), { width: 200, height: 140 },
    rect(100, 100, 260, 200), { side: 'bottom', align: 'start' });
  assert.deepEqual(p, { side: 'bottom', align: 'start', left: 152, top: 152 });
});
