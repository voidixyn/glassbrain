/* glassbrain: a general-purpose graph viewer
 *
 * Three layers, dependencies always point down, never up:
 *
 *   react/      canvas · toolbar · detail panel        (what the host can see)
 *   core        model · profile · view · elements · style · layout
 *   —           no domain knowledge anywhere here; it all lives in the profile the caller gives
 *
 * Minimal use:
 *
 *   import { parseSources, GraphCanvas } from 'glassbrain';
 *   const model = parseSources([{ origin: 'a.json', text }]);   // reads {nodes,edges}
 *   <GraphCanvas model={model} />
 *
 * To read your own JSON dialect / layers / colors, write a profile (see docs/guide.md).
 *
 * The tuning constants and the transition / label / paint machinery are in `glassbrain/internal`: unstable, for tests and tools.
 *
 * Two axes: **space** is the view algebra (layers / sources / focus / search, visibility only), **time** is
 * diff + transitions (two model versions → one union graph + one interpolation). See diff.ts / animate.ts.
 */
export * from './core';
export { computeLayout, clearLayoutCache, type LayoutRequest, type LayoutResult, type Plate, type Positions } from './layout/engine';
export type { LayoutJob, LayoutJobResult, LayoutRunner, LayoutRunnerPool } from './layout/run-job';
export { DEFAULT_PLANES, projectPlanes, type PlaneOptions } from './layout/planes';
export { default as GraphCanvas, type GraphCanvasProps, type LayoutInfo, type SelectedNode } from './react/GraphCanvas';
export { default as DetailPanel, type DetailPanelProps } from './react/DetailPanel';
export type { RenderEditor, EditTarget } from './react/EditPanel';
export { applyLook, type GraphLook } from './react/Legend';
export { renderMarkdown, renderInline, type MarkdownOptions } from './react/markdown';
export { ALL_CONTROLS, type ControlId } from './react/Toolbar';
