/* glassbrain · layout presets
 *
 * **There is only one layout: flexible (cose-bilkent).** It handles compounds and converges fast, and the painter, ink conservation and readability field
 * are all tuned for it. There used to be tree (dagre) and clustered (fcose) options, and none was tuned once switched to: views and
 * layouts are tied together, and a new way of looking comes with its own layout, not with another dropdown.
 *
 * **Layout is a core capability, not customized by profiles**: layout parameters can include functions (per-element forces), and the worker
 * boundary only carries structured-cloneable values; functions cannot cross. To change the algorithm, open a PR; do not inject it from outside.
 */
export type LayoutName = 'cose-bilkent';

export const LAYOUTS: Record<LayoutName, { label: string; opts: any }> = {
  // cose-bilkent does not support force properties as functions.
  'cose-bilkent': { label: 'Flexible', opts: {
    name: 'cose-bilkent', animate: true, fit: true, padding: 30, nodeDimensionsIncludeLabels: true,
    idealEdgeLength: 60, nodeRepulsion: 60000, numIter: 1200, tile: true, randomize: true,
  } },
};
