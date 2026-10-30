/* glassbrain · UI strings
 *
 * Every word the library draws is here, nowhere else. The library ships English only; other languages come from the host via `strings` (partial
 * is fine), the same approach as AG Grid's localeText or MUI's locale; there is no language switch in the UI, that is the host's business.
 * `examples/strings-zh.ts` is a ready Chinese translation and a template for "how to write a translation".
 *
 * Only **the library's UI**. Text in the data (node names, layer names, kind names, validation messages) belongs to the data and the profile.
 * Only data text is resident on the canvas; library text appears only in tooltips, popovers and the inspector on the right.
 */
import type { ChangeKind } from './diff';
import type { EditError } from './edit';

export interface GraphStrings {
  /* canvas */
  empty: string;
  stats: (nodes: number, edges: number) => string;
  layingOut: (done: number, total: number) => string;
  preparing: string;
  parseErrors: (count: number, names: string) => string;
  past: string;
  now: string;
  diffTruncated: (n: number) => string;
  /** How to read one item of the change list (also used by hosts drawing a change legend). */
  change: Record<ChangeKind, string>;
  /* search */
  search: string;
  searchTip: string;
  clearSearch: string;
  noMatch: (q: string, elsewhere: boolean) => string;
  moreResults: (n: number) => string;
  inLayer: (layer: string, n: number) => string;
  keysBrowse: string;
  keysPick: string;
  keysClear: string;
  /* layers */
  viewLayer: (layer: string) => string;
  stackLayer: (layer: string, on: boolean) => string;
  stack: string;
  stackTip: (on: boolean) => string;
  /* ⋯ */
  more: string;
  origins: string;
  allOrigins: string;
  /* validation */
  issuesTip: (errors: number, warns: number) => string;
  issuesTitle: (errors: number, warns: number) => string;
  moreItems: (n: number) => string;
  /* camera */
  cameraTip: string;
  zoomIn: string;
  zoomOut: string;
  fit: string;
  /* legend */
  legend: string;
  /** Names of the two legend entries without a kind name, and their tooltips. */
  legendPlainName: string;
  legendPlain: string;
  legendContainsName: string;
  legendContains: string;
  /** The line under the legend when the look has not been changed: how to use it. */
  legendHint: string;
  legendShow: string;
  legendHide: string;
  legendHideTip: string;
  legendColor: string;
  legendSize: string;
  legendReset: string;
  /* details */
  node: string;
  /** A selected node with nothing to show beyond its name. */
  noDetails: string;
  close: string;
  /* editing */
  addNode: string;
  addEdge: string;
  /** The canvas ⋯ menu: lay out the same data again. */
  relayout: string;
  edit: string;
  editNode: string;
  newNode: string;
  newEdge: string;
  id: string;
  idHint: string;
  parent: string;
  noParent: string;
  source: string;
  target: string;
  kind: string;
  edgeLabel: string;
  content: string;
  contentHint: string;
  badJson: string;
  relations: string;
  removeEdge: string;
  pick: string;
  cancel: string;
  save: string;
  create: string;
  remove: string;
  confirmRemove: (edges: number) => string;
  error: Record<EditError, string>;
}

export const EN: GraphStrings = {
  empty: 'No data yet',
  stats: (n, e) => `${n} nodes · ${e} edges`,
  layingOut: (d, t) => `Laying out ${d}/${t}`,
  preparing: 'Preparing layout…',
  parseErrors: (c, names) => `⚠ ${c} source${c > 1 ? 's' : ''} could not be parsed: ${names}`,
  past: 'past',
  now: 'now',
  diffTruncated: (n) => `${n} more changes not marked (over the limit)`,
  change: { added: 'Added', removed: 'Removed', changed: 'Changed', moved: 'Moved', merged: 'Merged' },
  search: 'Search nodes',
  searchTip: 'Several words: as many as possible; /…/ is a regex',
  clearSearch: 'Clear search',
  noMatch: (q, elsewhere) => `No “${q}”${elsewhere ? ' in this layer' : ''}`,
  moreResults: (n) => `${n} more — keep typing to narrow down`,
  inLayer: (l, n) => `${n} in “${l}”`,
  keysBrowse: 'browse',
  keysPick: 'select',
  keysClear: 'clear',
  viewLayer: (l) => `View “${l}”`,
  stackLayer: (l, on) => `${on ? 'Hide' : 'Stack'} “${l}”`,
  stack: 'Stack layers',
  stackTip: (on) => (on ? 'Stacked (turn off to view one layer at a time)' : 'Stack layers (2.5D)'),
  more: 'More',
  origins: 'Source',
  allOrigins: 'All sources',
  issuesTip: (e, w) => [e && `${e} error${e > 1 ? 's' : ''}`, w && `${w} warning${w > 1 ? 's' : ''}`].filter(Boolean).join(' · '),
  issuesTitle: (e, w) => `Checks · ${[e && `${e} errors`, w && `${w} warnings`].filter(Boolean).join(' · ')}`,
  moreItems: (n) => `${n} more`,
  cameraTip: 'Scroll / two fingers to pan · ⌘ + scroll or pinch to zoom',
  zoomIn: 'Zoom in (+)',
  zoomOut: 'Zoom out (-)',
  fit: 'Fit (0)',
  legend: 'Legend',
  legendPlainName: 'Default',
  legendPlain: 'Nodes without a color of their own: containers and placeholders, shaded by how much hangs under them',
  legendContainsName: 'Contains',
  legendHint: 'Hover an item: color, hide, size',
  legendContains: 'Containment: one shade from light to dark, trunk thick, leaves thin',
  legendShow: 'Show',
  legendHide: 'Hide',
  legendHideTip: 'Hide in the overview — still shown on hover, selection and search',
  legendColor: 'Color',
  legendSize: 'Size',
  legendReset: 'Reset',
  node: 'Node',
  noDetails: 'No details yet',
  close: 'Close',
  addNode: 'Add node…',
  addEdge: 'Add edge…',
  relayout: 'Re-layout',
  edit: 'Edit',
  editNode: 'Edit node',
  newNode: 'New node',
  newEdge: 'New edge',
  id: 'id',
  idHint: 'Unique, cannot be changed later',
  parent: 'Inside',
  noParent: 'Top level',
  source: 'From',
  target: 'To',
  kind: 'Kind',
  edgeLabel: 'Label',
  content: 'Content',
  contentHint: 'JSON',
  badJson: 'Not valid JSON (an object is expected)',
  relations: 'Edges',
  removeEdge: 'Remove this edge',
  pick: 'Search a node…',
  cancel: 'Cancel',
  save: 'Save',
  create: 'Create',
  remove: 'Delete',
  confirmRemove: (n) => (n ? `Delete, with its ${n} edge${n > 1 ? 's' : ''}?` : 'Delete?'),
  error: {
    'id-empty': 'id is required',
    'id-taken': 'This id is already used',
    'no-node': 'Node not found',
    'no-parent': 'Parent not found',
    cycle: 'Cannot be placed inside itself',
    'has-children': 'Has children — delete or move them first',
    'no-endpoint': 'Pick both ends',
    'self-loop': 'Both ends are the same node',
    'edge-exists': 'This edge already exists',
    'no-edge': 'Edge not found',
  },
};
