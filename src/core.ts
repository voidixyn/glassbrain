/* glassbrain/core: the pure half, without React and without 'use client'.
 *
 * Parse, merge, validate, diff, edit, views: safe on a server (a React Server Component, an API route, a CLI).
 * `glassbrain` re-exports all of it next to the canvas.
 */
export * from './model';
export * from './profile';
export * from './view';
export * from './elements';
export * from './style';
export * from './diff';
export * from './edit';
export * from './strings';
export { DEFAULT_ANIMATE, type AnimateSpec, type TransitionReport } from './animate';
export { DEFAULT_DIFF_LAYOUT, type DiffLayoutSpec, type DiffLayoutResult } from './layout/diff-layout';
