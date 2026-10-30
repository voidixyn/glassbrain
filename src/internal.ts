/* glassbrain/internal: the machinery under the canvas (transition planning, label placement, paint rules, tuning constants).
 *
 * **Unstable.** It exists for tests, benchmarks and tools that need to look inside; anything here may change in any release.
 * Everything public is re-exported too, so one import is enough.
 */
export * from './index';
export {
  planTransition, planSkins, sampleTransition, leavingOf, resolveSpec, anchorOf, edgeFade, edgeTraffic,
  makeScore, trackAt, trackLin, fadeAt, TRACK_NAMES, diffSkinStyle, sampleSkinStyle,
  easeOutCubic, easeInOutCubic, easeOutBack, easeDrift, ENVELOPES, FADE_NAMES, FADE_BASE, SNAP_DIM,
  type Transition, type TransitionItem,
  type SkinChange, type StyleMap, type StyleTween,
  type Score, type Track, type TrackName, type Leg, type Envelope, type FadeName, type EndState,
} from './animate';
export { default as DiffOverlay, type DiffOverlayProps, type DiffGeometry, type NodeBox, type GlowEdge }
  from './react/DiffOverlay';
export {
  diffPositions, solveDiffLayout,
  type DiffSides, type DiffSolve,
} from './layout/diff-layout';
export { relaxOverlaps, relaxNodes, type RelaxNode } from './layout/relax';
export {
  planLabels, labelBox, idPhase,
  type LabelInput, type LabelPlan, type LabelSide, type ReadabilityOptions,
} from './layout/readability';
export {
  shapeOf, arrowOf, type Shape as PaintShape, type Arrow as PaintArrow,
  dotOf, gapOf, skeletonLineOf, semanticAlphaOf, clippedLength, hazeOf, detailed, reachOf, hittable, focusAlphaOf,
  MIN_DOT, MIN_LINE, SKEL_FLOOR, SEM_W, SEM_INK, SEM_BOOST, DETAIL_LEAF, GAP, HOVER_DIM, HOLD_LEAF, NODE_SLACK, EDGE_REACH, FOCUS_INK,
} from './paint';
