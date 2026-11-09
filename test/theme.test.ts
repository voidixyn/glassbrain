/* Dark: the palette is configured once for light and swapped automatically on dark — each color's lightness is folded by its distance from the canvas, hue unchanged; the color picker goes the other way. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildModel, GraphCanvas, DARK_THEME, LIGHT_THEME, themeColor, untheme } from '../dist/internal.js';

test('GraphCanvas supplies dark controls without host CSS, for populated and empty graphs', () => {
  for (const nodes of [[], [{ id: 'one', label: 'One' }]]) {
    const html = renderToStaticMarkup(createElement(GraphCanvas, { model: buildModel(nodes, []), theme: DARK_THEME }));
    assert.match(html, /color-scheme:dark/);
    assert.match(html, /--gb-default-panel:#0f172ae6/);
    assert.match(html, /--gb-default-panel2:#0f172a/);
    assert.match(html, /--gb-default-text:#e2e8f0/);
    assert.doesNotMatch(html, /(?:[";])--gb-panel:/, 'public variables stay available to inherited host overrides');
  }
});

test('control defaults follow custom canvas lightness and reset when switching back to light', () => {
  const model = buildModel([], []);
  const render = (theme: typeof LIGHT_THEME) => renderToStaticMarkup(createElement(GraphCanvas, { model, theme }));
  assert.match(render({ ...LIGHT_THEME, canvas: '#121212', nodeText: '#eeeeee' }), /--gb-default-panel:#121212e6/);
  assert.match(render({ ...LIGHT_THEME, canvas: '#121212', nodeText: '#eeeeee' }), /--gb-default-text:#eeeeee/);
  const light = render(LIGHT_THEME);
  assert.match(light, /color-scheme:light/);
  assert.match(light, /--gb-default-panel:initial/, 'a light canvas also resets defaults inherited from a surrounding dark canvas');
});

/** Relative luminance (WCAG), closer to "how bright it looks" than an RGB average. */
const Y = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

test('themeColor: unchanged on light; on dark black becomes white and white becomes dark', () => {
  assert.equal(themeColor(LIGHT_THEME, '#444444'), '#444444');
  assert.equal(themeColor(DARK_THEME, '#000000'), '#ffffff');
  assert.ok(Y(themeColor(DARK_THEME, '#ffffff')) < Y('#333333'));
});

test('themeColor: symmetric — the light-to-dark order on a light canvas is fully reversed on a dark one', () => {
  // Pale candy colors, vivid colors, the dark gray of hubs: darker and darker on light, so brighter and brighter on dark.
  const ramp = ['#f7b6d2', '#ed719e', '#d6336c', '#444444'];
  const ys = ramp.map((c) => Y(themeColor(DARK_THEME, c)));
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] > ys[i - 1], `${ramp[i]} should be brighter than ${ramp[i - 1]} on dark`);
});

test('untheme: in dark mode, what you pick is what you get back after saving and showing it again', () => {
  assert.equal(untheme(DARK_THEME, '#ffffff'), '#000000');
  // A light vivid color picked on dark is stored as near-black, where hex resolution is coarse, so it can come back a few units off.
  for (const [picked, tol] of [['#ffffff', 0], ['#9c9c9c', 2], ['#5a5a5a', 2], ['#ed719e', 3], ['#00a3d7', 3],
    ['#7a3b52', 3], ['#8a3600', 3], ['#ffd877', 6]] as const) {
    const shown = themeColor(DARK_THEME, untheme(DARK_THEME, picked));
    const err = Math.max(...[1, 3, 5].map((i) => Math.abs(parseInt(shown.slice(i, i + 2), 16) - parseInt(picked.slice(i, i + 2), 16))));
    assert.ok(err <= tol, `${picked} → ${shown}`);
  }
});

test('a palette configured for light survives going to dark and back', () => {
  for (const c of ['#ed719e', '#ffd877', '#00fa92', '#444444', '#0891b2', '#ff6a00', '#ffa57d', '#e63b7a']) {
    const back = untheme(DARK_THEME, themeColor(DARK_THEME, c));
    const err = Math.max(...[1, 3, 5].map((i) => Math.abs(parseInt(back.slice(i, i + 2), 16) - parseInt(c.slice(i, i + 2), 16))));
    assert.ok(err <= 3, `${c} → ${back}`);
  }
});
