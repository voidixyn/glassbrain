/* These two cytoscape layout plugins ship no types, and they are only registered once with `cytoscape.use()`,
 * so there is no interface to describe. Living outside src is deliberate: once an ambient `declare module` is in
 * the published .d.ts, it pollutes every consumer's global type space. */
declare module 'cytoscape-fcose';
declare module 'cytoscape-cose-bilkent';
