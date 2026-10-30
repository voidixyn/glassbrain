/* The stylesheet contract: the four layers are assembled in one place (graphStyle); nodes are equal — color only says "what it is", size only says
 * "how much hangs off it"; the structural hierarchy is told by the color ramp of containment edges. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTENT_SCALE, DARK_THEME, defaultNodeColor, graphStyle, PLANE_HUES, plateColors, LIGHT_THEME, NODE_BASE, nodeDiameter, nodeWeight, skeletonColor,
} from '../dist/internal.js';

const look = { nodePalette: { feature: '#00fa92' }, edgePalette: {}, style: [{ selector: 'node.x', style: {} }] };
const fakeNode = (data: Record<string, unknown>) => ({ data: (k: string) => data[k] });

test('graphStyle: base → palette → profile.style → diff, later wins', () => {
  const sheet = graphStyle(LIGHT_THEME, look, { diff: true });
  const at = (sel: string) => sheet.findIndex((r: any) => r.selector === sel);
  assert.equal(at('node'), 0);
  assert.ok(at('node.feature') > at('node'));
  assert.ok(at('node.x') > at('node.feature'));
  assert.equal(sheet[sheet.length - 1].selector, 'node.gb-hit', 'the diff layer comes last');
  assert.equal(graphStyle(LIGHT_THEME, look).at(-1).selector, 'node.x', 'outside diff mode that layer is absent');
});

test('graphStyle: dot size follows nodeScale, and only in the stylesheet', () => {
  const size = (scale?: number) => graphStyle(LIGHT_THEME, look, { nodeScale: scale })[0].style.width(fakeNode({ leaves: 5 }));
  assert.equal(size(), nodeDiameter(5));
  assert.equal(size(2), nodeDiameter(5) * 2);
});

test('dot size: the same minimum for all, slightly larger the more hangs off it, capped at 1.8× — visible, not distracting', () => {
  assert.equal(nodeDiameter(0), NODE_BASE);
  assert.ok(nodeDiameter(3) > nodeDiameter(0));
  assert.ok(nodeDiameter(30) > nodeDiameter(3));
  assert.equal(nodeDiameter(10_000), NODE_BASE * 1.8);
  assert.equal(nodeWeight(0), 0);
  assert.equal(nodeWeight(10_000), 1);
});

test('nodes with content get one size up; placeholders fall back to the default size', () => {
  const sheet = graphStyle(LIGHT_THEME, { ...look, placeholderFlags: ['unfilled'] }, { nodeScale: 2 });
  const rule = (sel: string) => sheet.find((r: any) => r.selector === sel).style;
  const leaf = fakeNode({ leaves: 0 });
  assert.equal(rule('node.feature').width(leaf), NODE_BASE * CONTENT_SCALE * 2);
  assert.equal(rule('node.unfilled').width(leaf), NODE_BASE * 2);
  assert.equal(rule('node').width(leaf), NODE_BASE * 2);
});

test('the base declares no transition-*: cytoscape does not tween values written per element', () => {
  const node = graphStyle(LIGHT_THEME, look)[0].style;
  assert.ok(!Object.keys(node).some((k) => k.startsWith('transition-')));
});

test('default nodes use the skeleton ramp: brighter the more hangs off them, starting above containment edges; placeholders fall back to it', () => {
  const sheet = graphStyle(LIGHT_THEME, { ...look, placeholderFlags: ['unfilled'] });
  const at = (sel: string) => sheet.findIndex((r: any) => r.selector === sel);
  const fill = sheet[0].style['background-color'];
  assert.equal(fill(fakeNode({ share: 0.3 })), defaultNodeColor(LIGHT_THEME, 0.3));
  assert.ok(at('node.unfilled') > at('node.feature'), 'the placeholder rule comes after the semantic colors');
  assert.equal(sheet[at('node.unfilled')].style['background-color'](fakeNode({ share: 0 })), defaultNodeColor(LIGHT_THEME, 0));
  const t = { ...LIGHT_THEME, skeleton: '#000000', canvas: '#ffffff' };
  const lum = (h: string) => parseInt(h.slice(1, 3), 16);
  assert.ok(lum(defaultNodeColor(t, 1)) < lum(defaultNodeColor(t, 0.05)), 'the more hangs off it, the closer to the skeleton color');
  assert.ok(lum(defaultNodeColor(t, 0.2)) < lum(skeletonColor(t, 0.2)), 'at the same share, dots are closer to the skeleton color than lines');
});

test('one skeleton color: the containment trunk is the skeleton color itself, leaves are lighter, the light end is mixed from the canvas color', () => {
  const t = { ...LIGHT_THEME, skeleton: '#000000', canvas: '#ffffff' };
  const lum = (h: string) => parseInt(h.slice(1, 3), 16);
  assert.equal(skeletonColor(t, 1), '#000000');
  assert.ok(lum(skeletonColor(t, 0)) > lum(skeletonColor(t, 0.3)));
  assert.ok(lum(skeletonColor(t, 0)) < 200, 'the leaf level still stands apart from the canvas');
  const dark = { ...t, canvas: '#000000', skeleton: '#ffffff' };
  assert.ok(lum(skeletonColor(dark, 0)) < lum(skeletonColor(dark, 1)), 'on a dark canvas the leaf level is darker than the trunk');
});

test('overlayLabels: the cytoscape label layer is hidden (kept only to measure sizes); diff is unaffected', () => {
  const hidden = graphStyle(LIGHT_THEME, look, { overlayLabels: true }).at(-1);
  assert.equal(hidden.selector, 'node');
  assert.equal(hidden.style['text-opacity'], 0);
  assert.ok(!graphStyle(LIGHT_THEME, look).some((r: any) => r.style['text-opacity'] === 0));
});

test('edge weight → width and line opacity; edges without weight are unaffected', () => {
  const edge = graphStyle(LIGHT_THEME, look).find((r: any) => r.selector === 'edge').style;
  const e = (w: unknown) => fakeNode({ weight: w });
  assert.equal(edge.width(e(null)), 4.2);
  assert.equal(edge['line-opacity'](e(null)), 1);
  assert.ok(edge.width(e(1)) > edge.width(e(0.4)));
  assert.ok(edge['line-opacity'](e(1)) > edge['line-opacity'](e(0.4)));
  assert.ok(!('opacity' in edge), 'opacity is the channel for transitioning "existence"; the stylesheet leaves it alone');
});

test('semantic edges draw above containment edges: structure is the base, annotations go on top', () => {
  const sheet = graphStyle(LIGHT_THEME, look);
  const z = (sel: string) => sheet.find((r: any) => r.selector === sel).style['z-index'];
  assert.ok(z('edge') > z('edge.contains'));
});

test('hover is not in the stylesheet (opacity is multiplied at paint time); the whole sheet declares no transition-*', () => {
  const sheet = graphStyle(LIGHT_THEME, look);
  assert.ok(!sheet.some((r: any) => /gb-(dim|near|core|lift)/.test(r.selector)));
  assert.ok(!sheet.some((r: any) => Object.keys(r.style).some((k) => k.startsWith('transition-'))));
});

test('in the cytoscape layer, selection keeps only an accent-color outline — the prominent ring is in the label layer, not dimmed by hover', () => {
  const sel = graphStyle(LIGHT_THEME, look).find((r: any) => r.selector === 'node:selected').style;
  assert.equal(sel['border-color'], LIGHT_THEME.selected);
  assert.ok(!('underlay-opacity' in sel));
});

test('layer plates: the layer color only gives the hue, the plate is mixed from the canvas color, right for both light and dark themes', () => {
  const lum = (h: string) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);
  const light = plateColors(LIGHT_THEME, '#f59e0b');
  const dark = plateColors(DARK_THEME, '#f59e0b');
  assert.ok(lum(light.fill) > 600, 'a very faint tint on a light canvas');
  assert.ok(lum(dark.fill) < 200, 'a very dark tint on a dark canvas');
  assert.ok(PLANE_HUES.length > 0);
});

test('dark theme: swaps the canvas; default nodes and the light end of containment edges follow, without faking it with opacity', () => {
  const lum = (h: string) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);
  assert.ok(lum(defaultNodeColor(DARK_THEME)) < lum(defaultNodeColor(LIGHT_THEME)));
  assert.ok(lum(skeletonColor(DARK_THEME, 0)) < lum(skeletonColor(LIGHT_THEME, 0)));
  assert.ok(lum(DARK_THEME.nodeText) > lum(DARK_THEME.canvas), 'light text on a dark canvas');
});
