# glassbrain guide

The reference for using glassbrain as a library. For the command line see [cli.md](cli.md); for
why it behaves the way it does (transitions, diff layout, measurements) see [design.md](design.md).

- [Install](#install) · [30 seconds](#30-seconds) · [Versions and diff](#versions-and-diff)
- [Views and search](#one-graph-many-views) · [Positions](#where-positions-come-from) · [2.5D layers](#25d-layers)
- [Profiles](#domain-knowledge-lives-in-a-profile) · [Color](#color-hue-is-configured-everything-else-is-computed) ·
  [Nodes and edges at scale](#nodes-and-edges-at-scale) · [Labels](#labels-at-scale)
- [Hover, selection, dark mode](#hover-selection-dark-mode) · [Theming & embedding](#theming--embedding) ·
  [Interaction](#interaction) · [Editing](#editing)

## Install

```bash
npm i glassbrain cytoscape cytoscape-fcose cytoscape-cose-bilkent
```

`react >= 18` (with `react-dom`) and the three cytoscape packages are peer dependencies;
glassbrain does not bundle them. Entry points: `glassbrain` (everything, `'use client'`),
`glassbrain/core` (parse, diff, validate, edit: no React, safe on a server),
`glassbrain/adapters` (other tools' formats), `glassbrain/layout/worker-pool` and
`glassbrain/layout/inline-pool`.

## 30 seconds

```tsx
import { parseSources, GraphCanvas } from 'glassbrain';

const model = parseSources([{ origin: 'graph.json', text }]);
<GraphCanvas model={model} />
```

The physical contract is two arrays:

```json
{
  "nodes": [{ "id": "a", "label": "Alpha", "kind": "box", "parent": "root", "layer": "L1" }],
  "edges": [{ "source": "a", "target": "b", "kind": "dep", "label": "depends on", "weight": 0.8 }]
}
```

Only `id` is required for a node, `source` / `target` for an edge; `label` falls back to `name`,
then to the id. Unknown fields are kept (in `data`) and shown in the detail panel. The full
description is [`schema/graph.schema.json`](../schema/graph.schema.json).

## Versions and diff

```tsx
import { diffModels, GraphCanvas } from 'glassbrain';

<GraphCanvas model={next} />                                   // a new model plays a transition from the old one
<GraphCanvas model={after} diff={diffModels(before, after)} /> // two panes, changes marked
```

- Swapping `model` plays one short scene (what leaves, what moves, what arrives); `animate={false}`
  switches instantly, `animate={{ duration, drift, bounce }}` tunes it, `onTransition` reports
  what played. New data that arrives mid-scene waits for the scene to end; `onBusy` says when.
- `diffModels(before, after, { key, ignore, labels })` pairs nodes by id, or by `key(node)` when
  the two versions name things differently; `ignore` lists fields that change without the node
  changing. Pass the same function to the canvas as `matchKey` so the animation and the diff agree.
- A node whose `parent` changed is **moved**, not removed + added. Edges are identified by their
  two ends plus `kind`.
- `diffLayout={{ rounds, iterations, snap }}` tunes how the old-only parts are placed next to the
  new version; the defaults are `DEFAULT_DIFF_LAYOUT`.

How each of these works, and why, is in [design.md](design.md).

---


## One graph, many views

There is exactly **one** graph. A view only decides who is visible. Two filter
axes compose, then an ancestor closure runs (a visible node's parent chain is
always present):

```ts
{
  layers:  ['req'],          // which layer (with planes: true, any subset, stacked)
  origins: ['card.json'],    // subgraph: one source file only
  query:   'login',          // search — marks hits, hides nothing
  hiddenNodeKinds: ['author'],      // kinds kept out of the overview (see below)
  hiddenEdgeKinds: ['authored-by'],
}
```

These **only toggle `display`**: no instance rebuild, no re-layout, no flash.

**Hiding a kind is for the overview only.** `hiddenNodeKinds` / `hiddenEdgeKinds` keep a
kind out of the picture — not drawn, not clickable, its place kept, so the shape doesn't
move — but whatever the reader reaches for still shows: the one hop around a hovered node
(fading in with the hover), search hits, and the selected node with its one hop. Edges on
hidden nodes go with them. Hiding means "don't clutter the overview", not "this doesn't
exist": a hover that silently left out a paper's authors would be lying. It is done in the
painter, not with `display`, so the reveal is instant; the toggle itself is a short fade.

**Emphasizing a kind** is a transient hook for the host: `<GraphCanvas emphasis={{ nodeKinds:
['author'] }}>` lights that kind and dims the rest (the same dimming as search hits, taking
precedence over them), revealing it even while hidden; an edge kind brings its endpoints.

**The legend** (bottom-left, built in; `legend={false}` turns it off) lists the kinds in the
data with their counts. Hovering an item (or clicking, tapping, pressing Enter) opens its
one-row panel — visibility, color, size multiplier (½ / 1 / 2) — and lights that kind on the
canvas. An action that changes the result (toggling, settling on a color) closes the panel
and drops the highlight, so what you see is the outcome. The marks (shape, dash, ends) are
read off the canvas, so whatever the profile's `style` says, the legend draws. A hidden item
gets its name struck through and a hollow swatch; the count stays. Names come from
`profile.kindLabels` (node and edge kinds share it); the items with no name of their own —
uncolored nodes, containment, the change kinds in compare mode — are a mark and a count,
with the name in the tooltip. On a narrow canvas it starts collapsed.

Hiding goes to the view (`hiddenNodeKinds` / `hiddenEdgeKinds`). Colors and sizes are the
reader's **look** — `GraphLook`, layered on top of the profile and theme, never written into
them; controlled or not, like `view`:

```tsx
<GraphCanvas look={look} onLookChange={setLook} />   // persist it per dataset if you like
```
**Search does not filter.** It dims everything but the hits and ranks their labels
first; Enter (or a click in the result list) selects the node and flies the camera
there. Filtering would re-tighten the layout and wipe out the shape you had just
learned to read — search is navigation, not a view.

What counts as a hit (`searchNodes`; the bold in the result list uses the same
`queryMarker`):

- Case-insensitive, over label, id and the strings inside `data`.
- The whole query ranks first, strictest to loosest: label equals → label starts with →
  label contains → id contains → data contains; shorter labels first within a tier.
- **Several words: as many as possible.** If some nodes match every word, only those
  are hits (an AND); if none does, the ones matching the most words are (so synonyms
  like `create add` behave as an OR). Only the best batch is kept, so one common word
  never lights up half the graph.
- **`/…/` is a regular expression** (e.g. `/^DOC-\d+$/`). An invalid one is searched as
  plain text, silently.
- No toggles, no typo tolerance: every result should be explainable.

Nothing in the view changes the element set: only a new `model` (or `profile`) rebuilds
and re-lays out. Everything in `GraphView` is visibility only.


## Where positions come from

Layout and animation are separate concerns. The transition takes *where things are*
and *where they should be* and eases between them — it never asks how the target was
computed. The target is taken from the first of these that has it:

| | |
|---|---|
| ① **`layout`** (yours) | This version's `{ [nodeId]: {x, y} }`. Used as-is when it covers every node. With several versions, store one per version and pass the current one. |
| ② **local cache** | `localStorage`, addressed by structure: the last layout this browser produced for this structure, whatever produced it. Survives a reload; `clearLayoutCache()` empties it. |
| ③ **solve**, per `layoutMode` | `'fresh'` (default) solves from the structure alone. `'continue'` also re-solves every node, but starts from the positions already known (on screen, else in `layout`) instead of a random start — survivors move only a little. The two are cached separately. |

Every layout produced is reported through `onLayout(positions, info)` — `info.source` is
`preset`, `cache` (reused rather than computed: the local cache, or exactly what is already on
screen), `fresh`, `continue` or `relayout`. Persist it if you want it back: pass it as `layout`
next time. `layout` itself is never written to, and passing back what `onLayout` just reported
does not trigger anything.

End users get **Re-layout** in the canvas ⋯ menu: the same data, a fresh random
arrangement, animated, written to the local cache and reported to `onLayout`. Hide it with
`controls={{ relayout: false }}`.

Sequential steps that should not jump: walk them once with `layoutMode="continue"`, save
what `onLayout` reports for each version, ship those, and pass each version its own — survivors
move only a little between neighbouring steps, and every visit looks the same. A dataset's
`_layout.json` in the demo (version name → positions) is made exactly so. Changing `layout` or
`layoutMode` makes the canvas look the positions up again on the spot — compared by content,
so a new object with the same positions is not a change. While a transition is playing, any change
that needs a re-layout (`layout`, `layoutMode`, Re-layout, the diff fusion knobs) waits and is
applied once when it ends. In diff mode `layout` is the newer version's: that side is placed
exactly as when browsing it, so toggling diff moves none of its nodes.

```tsx
<GraphCanvas model={step} layout={saved} layoutMode="continue" onLayout={(pos) => save(pos)} />
```

**A layout input is solved once.** Force layouts have no reproducible fixed point:
solving the same input twice gives two noticeably different arrangements (measured:
median 512 apart on a graph 2400 wide), and raising the iteration budget makes it
worse, not better — it wanders rather than converges. So the answer is not to solve
harder, it is not to solve again: the coordinates are addressed by the **structure**, and
an unchanged input returns the coordinates already on screen. A step that only adds
render-only edges moves nothing at all.

**A graph's identity is its structure.** Three things, no more: which nodes exist, whose
parent is whose, which edges bear force. Not the payload, not the edges you marked
non-structural, and **not the sizes**.

That last one was learned the hard way. Sizes are a rendering result and they follow the
skin. One step did nothing but fill in placeholder content (an `unfilled` flag dropped):
identical structure, identical labels — but 79 nodes changed skin, so their measured sizes
changed, so the hash changed, so the cache handed back **a different free solve under a
different key** and the whole graph shifted once (median 1246 measured, while the readout
said "layout 0ms" — it never re-solved, it just swapped coordinate sets).

Worse, sizes are measured on the **union**, and the union is a product of the transition:
the same step2 reached from step1 and reached from step3 are two different instances. So
"a free solve is independent of how you got here" was false in the size term — the first
switch between two versions somersaulted and later ones did not, because from then on the
union's composition stopped changing. **That is how path dependence sneaks into a solve
that claims to be path-independent.**

So sizes take part in *how it is solved* (force layout needs real sizes to avoid overlap),
never in *whether it is the same input*. The cost, stated openly: after a label grows, the
old coordinates may crowd a little — but "the data didn't change and the graph moved a
mile" is far worse than a little crowding.


## 2.5D layers

`profile.layers` declares the layers. A layer with `structural: false` is an
*attached* layer: it takes no part in structural forces and is placed by the
centroid of its links (axioms, references, annotations).

On a multi-layer graph, *which layers* and *how they are arranged* are two separate
questions:

- **Stacked** (the default; `planes` omitted or `true`): any subset of layers (at least
  one; all of them is `layers: null`), stacked as planes — the first thing to see on
  layered data is how many layers there are and how they connect. Their order comes from
  the data (declaration order / `z`) and is not reorderable in the UI.
- **Flat** (`planes: false`): exactly one layer (`layers: ['req']`). Turning stacking off
  keeps the first selected layer, or the first structural layer.

There is no "several layers squashed onto one plane": an attached layer sits right on
top of the nodes it links to, so flattening both would just pile one onto the other.
The toolbar mirrors this: a row of layer names plus a "stack" toggle — single-select
when off, multi-select when on.

```
x' = x + t·(y·shear + z·dx)
y' = y + t·(y·squash − z·gap − y)
```

cytoscape is strictly 2D, but glassbrain computes coordinates *outside* the renderer
and feeds them in as a preset layout — so layering is one affine transform, not a
different renderer. And because the transform is linear in `t`, switching between
"one layer" and "all layers" never re-solves anything: there is **one** layout, and
the switch plays `t` from 0 to 1 (or back) while incoming layers and their plates fade
in and outgoing ones fade out. Each layer keeps its height, so hiding a middle layer
leaves a gap rather than shifting the others. All plates are the same size — the union
of every layer's extent — so a node on one floor reads as hovering over a particular
region of the floor below. Plane spacing is derived from the graph's real extent rather
than a hard-coded constant, which is the difference between "looks right on the
demo" and "two planes overlap at 3000 nodes".

---


## Domain knowledge lives in a profile

The library knows nothing about your domain. Everything domain-specific goes into
one `profile` object, in three escalating levels — supply what you need, the rest
falls back to neutral defaults.

**① Nothing** — eats `{nodes, edges}`, one layer. The whole graph renders as its
skeleton (see [Color](#color-hue-is-configured-everything-else-is-computed)).

**② An object** — your layers and palette:

```ts
const profile = defineProfile({
  id: 'flow',
  layers: [
    { id: 'ui',   label: 'Interface', z: 0 },
    { id: 'data', label: 'Storage', z: 1, structural: false, color: '#14b8a6' },
  ],
  layerOf: (n) => (n.kind === 'table' ? 'data' : 'ui'),
  nodePalette: { table: '#10b981' },
  kindLabels: { table: 'Table' },
  detail: { list: [{ key: 'columns', label: 'Columns' }] },
});
```

**③ A parser** — so the library eats your JSON dialect directly:

```ts
defineProfile({
  id: 'x',
  parse(origin, text) {
    const raw = JSON.parse(text);
    if (!raw.steps) return parsePhysical(origin, text);  // not mine — hand it back
    return { origin, title: raw.name, nodes: /* … */, edges: /* … */ };
  },
  merge(slices) { /* only when you need to compose a skeleton across files */ },
});
```

The demo datasets show the declarative level in practice: each one is plain `{nodes, edges}`
plus a `_profile.json` (see [`data/demo/`](../data/demo/)), and none of them needed a line of
library code.

### Profile fields

| Field | Default | Notes |
|---|---|---|
| `parse(origin, text)` | `parsePhysical` | return `null` = "not my data" (skipped silently, not an error) |
| `merge(slices)` | first-seen wins per id | only needed to compose across files |
| `layers` | one layer | `{ id, label, z?, color?, structural? }` |
| `layerOf(node)` | `node.layer` | |
| `nodePalette` / `edgePalette` | `{}` | semantic `kind → color`; kinds not listed are skeleton |
| `nodeSize` / `edgeWidth` | `{}` | `kind → multiplier` on the data-driven diameter / width; unlisted = 1. Visual only — layout doesn't make room |
| `placeholderFlags` | `[]` | nodes carrying these flags are placeholders and render as skeleton |
| `style` | `[]` | escape hatch for what color can't say (shape, dashes); appended after the palette |
| `nodeClass` / `edgeClass` | `kind` | extra cytoscape classes |
| `kindLabels` | `{}` | detail-panel titles |
| `detail` | `{}` | `line` / `list` field tables, `skip`, `flagNotes`, `linkify` |
| `validate(model)` | none | domain checks (dangling edges, duplicate ids and duplicate edges are built in — don't re-implement; an edge is identified by its two ends + kind). Each `GraphIssue` may carry a `group` (what this kind of issue is called); the issues panel groups by it |
| `layoutEdge(edge)` | none participate | `true` = this semantic edge **also pulls on the layout**. Containment (`parent`) is always structure and never goes through here |
| `singleRoot` / `rootLabel` | `true` / `Overview` | synthesize a virtual root when there are several top-level nodes. It lives in the first structural layer and gathers only that layer's top nodes; a graph with no containment at all gets none |

`layoutEdge` is the one to understand. Structure comes from containment; semantic
edges are drawn on top and, by default, take no part in layout — that is what keeps the
skeleton intact when you drop hundreds of them onto it. Let an edge kind pull only when
it genuinely should help place things (say, `implements` edges that should pull a rule next
to the feature it belongs to). A graph that declares no containment and no pulling edges has no structure to
show, and is laid out as such.

### Data, structure, derived, presentation

The library only reads the **model** in the middle. Who owns each layer, and what may
ever be saved:

| Layer | What | Produced by | Saved? |
|---|---|---|---|
| Source | your JSON dialect, possibly many files | your pipeline, people | your business |
| Model | nodes `id / label / kind / parent / layer / data`, edges `source / target / kind / weight` | `profile.parse` + `merge` | **the only layer that is edited and saved** |
| Derived | flags (e.g. `unfilled`), validation issues, `origin` stamps, default layer, the virtual root | the profile and the library, on the fly | **never** — recomputed whenever the model changes |
| Presentation | palette, kind names, `flagNotes` | the profile | unrelated to data |

Example: in the demo's `boards` dataset, the first version marks every feature `stub` (named,
no story yet). `placeholderFlags: ["stub"]` in its `_profile.json` renders those nodes as
skeleton, and `detail.flagNotes` supplies the sentence "Named in the enumeration; no story
written yet." Write the story and the flag is gone. A different
structure swaps these out; the library doesn't change.

**Where each setting lives.** Every knob answers three questions — who sets it, how long it
lives, where it is kept — and that puts it in exactly one place:

| Kind | Answers | Set by | Lives | Where |
|---|---|---|---|---|
| Data | what the graph is | host / pipeline; readers via editing | forever, saved by the host | `model` in, `onEdit` out |
| Profile | how to read this dialect | a developer, once | code | `profile`, no UI |
| View | where am I looking | the reader | this session | on the canvas: search, layers, source filter, legend toggles (`view` / `onViewChange`) |
| Look | how I like it drawn | the reader | across sessions, saved by the host | per kind on the legend (`look` / `onLookChange`); global ones as props (`theme`, `nodeScale`, …) the host shows in its own settings |
| Integration | how it plugs in | a developer | code | props, no UI (`pool`, `matchKey`, `layout`, callbacks, `controls`) |

Nothing appears in two places, and derived things appear in none: they are recomputed.

### Reserved words

Avoid these classes in `kind`: `container` `crosslayer` `contains` `root`
`gb-node` `gb-hit`, and the diff flags `gb-added` `gb-removed` `gb-changed`
`gb-moved` `gb-merged` `gb-kept`. The virtual root's id is `__gk_root__`.

---

## Color: hue is configured, everything else is computed

All nodes are equal: a container and a feature differ only in *what they are* and
*how much hangs below them*, and each of those gets exactly one channel.

- **Color = kind.** One flat color per kind (`profile.nodePalette`), never varying with
  size. Kinds not in the palette — containers, the virtual root, placeholders — are
  **default nodes**: they *are* the skeleton, so they follow the `theme.skeleton` ramp —
  the more hangs below, the brighter, in the same family as their containment edges.
- **Size = a common base + log(leaves below)**, capped at 1.8×. Visible, never loud. Nodes
  with content (a kind in the palette) get a 1.5× larger base: content is the figure,
  default nodes the ground. The
  same number also sets the label's font size (12–15px) and its placement priority.
- **Structure is carried by edges.** Containment edges use the whole `theme.skeleton`
  ramp: trunk deep and thick, leaves pale and thin (in box mode, nesting says it).
  Semantic edges get one color per kind (`edgePalette`); width and line opacity follow
  their `weight`. A whole kind can be scaled (`nodeSize` / `edgeWidth`, multipliers on top of
  the data-driven size). Shape, dash and arrowheads say what a kind *is*; they live in `style`.

So there is one structural color to configure, an unconfigured graph is complete, and
only the kinds you list grow a color. A placeholder — declared in the structure, not
yet filled — is a default node, not a pale shade of its kind: list its flag in
`placeholderFlags`. When it gets filled, the data switch animates default → kind color.
The pale end is mixed from `theme.canvas`, so a dark theme stays coherent.

Changing `theme`, the palettes or `placeholderFlags` only swaps the stylesheet — no
rebuild, no relayout. Hosts should never write inline styles on elements: those belong
to the canvas's transition channels. `skeletonColor(theme, share)` and
`defaultNodeColor(theme, share)` give a legend exactly what the graph uses.

## Nodes and edges at scale

In browse mode the dots and lines on screen are not drawn by cytoscape but by
`src/paint.ts`: cytoscape still owns data, stylesheet, layout, events and transitions;
the painter reads the computed values and draws them batched by color, and hit-testing
becomes plain point-to-point / point-to-line distance. On a 3000-node graph a mouse event
drops from hundreds of milliseconds to around fifteen. Diff mode, and `readable={false}`,
are drawn by cytoscape exactly as before.

Four rules for drawing across zoom levels:

- **The skeleton follows geometry.** Dot diameters and containment-edge widths scale with
  zoom. Below what a pixel can show they stop shrinking and fade instead — the ink on screen
  stays proportional to the real weight, so dense regions read dense and nothing disappears.
  Containment edges also get a share-based floor: the trunk keeps a few pixels from afar,
  the leaf level fades to hairlines. Dots likewise: once a leaf would be drawn below 4px
  (only large graphs zoom out that far), heavier dots shrink less by weight, and a fully
  loaded one holds its size — hierarchy survives from afar; small graphs barely change.
- **Semantic edges are hairlines.** 1px by default and constant across zoom (`weight` and the
  `edgeWidth` multiplier thicken them proportionally); their strength is `semanticOpacity`
  (default 0.5), fading further as you zoom out. Dashes and arrowheads only when zoomed in.
- **Draw order is hierarchy**: boxes → haze → edges (by stylesheet z-index, semantic above
  containment) → dots.
- **A dot's look depends only on its size on screen**: when tiny, a faint same-color haze
  gives clusters volume; over the same range that the haze fades out, each dot grows a
  canvas-colored gap ring so neighbours separate instead of merging; larger still, a solid dot.

Widths in the stylesheet stay in model units; the numbers and their reasons live at the top
of `paint.ts`.

## Labels at scale

In browse mode node labels are drawn on a canvas layered **above** cytoscape, so text is
always on top of every node (cytoscape draws each element dot-then-text, so a later dot
would cover an earlier label no matter how the stylesheet is ordered). Which labels show
is a greedy placement by score (`share` + distance to the viewport focus), so the big
hubs pick first: a label is shown only if it overlaps no other label and **covers no
named dot** (a dot whose own label is shown); if there's no room below the dot it tries
above, right, left. Unnamed dots may be covered, so even far zoomed out there is enough
text; a covered dot doesn't get a name of its own. Zoom out and you read the trunk; zoom
in and the leaves appear. Each label sits on a faint tint of its node's color, so text and
dot pair up at a glance. `labelSpacing` (default 6px) sets the minimum gap between labels
— lower is denser. In diff mode each pane plans its own labels with the same rules, changed nodes first (the two panes may occasionally disagree on an unchanged node). Labels carry track-changes marks: strikethrough = removed (left pane), underline = added; lines use the diff colors. Font size is a screen constant,
so each label (with its halo) is rasterized once and blitted every frame.

A name wider than 16 font-sizes (about 28 Latin letters) is cut with "…" rather than
wrapped: a long sentence on the canvas reads as a paragraph, two lines as a text block.
The full name is in the detail panel and the search list. Layout measures the same
truncated box (`text-max-width` in the stylesheet), so what is judged, laid out and drawn
is one box.

## Hover, selection, dark mode

Hover and selection are two orthogonal channels, so they stack:

- **Hover = attention, transient.** A node, its one-hop neighbours and the connecting edges
  get their labels forced on at full opacity and their semantic edges thickened; everything
  else dims — including a selected node. Hover an edge: it and its two endpoints. Fades
  in/out (~160ms); moving between nodes doesn't flicker. Hover changes no element's style:
  the painter multiplies the whole graph by one alpha and redraws the focused hop on top.
  Browse mode only (dimming one pane of a diff would break "unchanged things are the same
  pixel in both panes").
- **Select = identity, persistent.** It dims nothing; it marks *this one*: an accent ring
  that closes in around the node, drawn on the label layer above cytoscape — so it stays
  vivid while hover dims the graph underneath.
- **Semantic edges are drawn above containment edges**: structure is the ground,
  what's drawn on top of it is the figure.
- Opening/closing the detail panel or resizing the window **keeps the camera**: the point
  at the center stays at the center, zoom unchanged. Only the very first size fits.
- **Dark mode**: pass `theme={DARK_THEME}` and override the `--gb-*` CSS variables. No
  transparency tricks — the default-node color and the containment ramp are mixed from
  `theme.canvas`, so they follow the background. 2.5D layer colors are hues too: the
  plate is mixed from the canvas (`plateColors`).

## Theming & embedding

cytoscape renders to canvas and cannot read CSS variables, so graph-element theming
is an object (`GraphTheme`, passed as `<GraphCanvas theme>`). The surrounding UI
(toolbar, detail panel) is ordinary DOM and uses `--gb-*` CSS variables — override
them to reskin. Complete defaults are built in, so an offline single-file page
looks right with zero setup.

**A palette is configured once, for a light canvas.** On a dark canvas every palette color
goes through `themeColor(theme, hex)`: in OKLCH its lightness is folded by distance from the
canvas — `L' = lc + (1−L)(1−lc)`, with `lc` the canvas lightness — hue is kept, and chroma
carries over as a fraction of the most that lightness can hold in sRGB. One formula for every
color, no threshold, so the light-to-dark order flips as a whole: pale candy colors become
dark ones of the same hue, and the black that stood out most on white becomes the brightest
thing on dark. Darkened yellow is brown (dark yellow is brown). The fold is one-to-one, so
`untheme` inverts it — a color picker on a dark canvas shows what is drawn and stores the
light-canvas value (pick white, see white, store black). A pale, vivid color picked on dark
stores as a near-black, where hex is coarse, so it comes back a few units off.

The canvas carries three things, placed by when you need them: top-left, a search
box (`/` or ⌘K) and — for multi-layer graphs — a layer switch; a "More ⋯" menu for
the rarely-touched (the source filter, and Add node / Add edge when editable) appears
only when there is something in it; bottom-right, the camera (zoom in/out, fit — also `+` `-` `0`) and the issues
button. Layout choice, boxes vs. edges, collapse depth and relayout are not on the
canvas: those are decisions a developer makes in code, not buttons a reader presses.

Issues are derived (`validateModel` = built-in checks + `profile.validate`). A number
that is always large becomes wallpaper, so the button shows only the most urgent level —
the error count in red if there are errors, otherwise the warning count, muted. Opening
it lists each `group` with its count; expand one to see the items, click an item with a
node to select it and fly there.

Sections can be switched off individually where the host already has an equivalent
control, so there is never a second source of truth:

```tsx
<GraphCanvas controls={{ origins: false }} />
```

Sections: `search` `origins` `layers` `zoom`.

**Long text** in the detail panel (a node's `description`, list fields) is markdown: paragraphs,
lists, emphasis, code, links and images, rendered straight to React elements — raw HTML in the
data stays text. External links open in a new tab; `node:<id>` links fly to that node (a
profile's `linkify` can rewrite references into them); relative paths go through
`resolveUrl(url, node)`, so docs-derived images show:

```tsx
<GraphCanvas resolveUrl={(u) => new URL(u.replace(/^\//, ''), 'https://raw.githubusercontent.com/org/docs/main/static/').href} />
```

Pass `renderText` to use your own renderer instead.

The **inspector** (detail and edit) slides in on the right; set `--gb-inspector-bg` to match your
own sidebar. On a narrow canvas it is a bottom sheet and the toolbar takes the full width.

**Language.** Every word the library draws itself is in one object. English by default;
pass `strings` (all of it or just a few keys) to change it — the same pattern as AG Grid's
`localeText` or MUI's locales; there is no language switch inside the canvas, that belongs to
the host. `examples/strings-zh.ts` is a complete Chinese set and the template for writing another.
Visible text on the canvas comes only from your data; the library's own words appear in
tooltips, popovers and the inspector.
Words that come from your data (node names, layer names, kind names, issue messages)
belong to the data and the profile.

```tsx
import { ZH_CN } from './strings-zh';   // copied from examples/
<GraphCanvas strings={ZH_CN} />
```

`glassbrain`, `glassbrain/react/GraphCanvas` and `glassbrain/react/DetailPanel` carry the
`'use client'` directive (`glassbrain/core` does not) — import them from a client component (in Next's App Router, `dynamic(..., { ssr: false })` is the
usual form since the canvas needs a DOM).

## Interaction

- Wheel / two-finger = pan; Ctrl(⌘)+wheel or pinch = zoom at cursor (as in Figma / tldraw)
- Hover = a glance: the node and its one hop light up, gone when you move away
- Click a node = select it: detail panel and ring. Click empty space = deselect
- **Double-click a node = zoom to it**, as in a map: the camera frames it and its one hop.
  Only the camera moves — nothing about *what* you are looking at changes, so there is
  nothing to exit
- When the panel opens, the node you clicked stays where it is on screen (it only moves if
  the panel would cover it), so the second click of a double-click still lands
- `/` or ⌘K = search; ↑↓ previews a result (the camera follows), Enter selects, Esc clears
- More ⋯ → Source = only one file. The active filter shows as a chip next to the toolbar;
  its × goes back to everything. A filter naming a file the data doesn't have is ignored,
  so switching data never filters the graph down to nothing. Stacked, the plates shrink
  to what is visible and a layer with nothing left gets no plate

## Editing

Pass `onEdit` and the graph becomes editable; leave it out and nothing about the canvas
changes. Creating is deliberately quiet — **More ⋯ → Add node… / Add edge…** — and
editing happens where the object is: the detail panel gets an **Edit** button and turns
into a form in place.

The library never touches your model or your files. Every change is one `EditOp`; you
apply it and hand the new model back, and the ordinary transition animates it:

```tsx
const [ops, setOps] = useState<EditOp[]>([]);
const model = useMemo(() => applyEdits(base, ops, profile).model, [base, ops]);
<GraphCanvas model={model} profile={profile} onEdit={(op) => setOps([...ops, op])} />
```

That list of ops is a **patch**, and it does three jobs at once: undo (drop the last one,
replay), a draft, and the export — one small file no matter how many source files the
graph came from. Replaying it after the pipeline regenerates the source keeps the manual
changes; ops that no longer apply are skipped and reported, not fatal.

What can change, and how:

| | Fields | Handled by |
|---|---|---|
| Constrained by the UI | `id` (given on create, checked for duplicates, fixed after), the parent, both ends of an edge | inputs and node pickers (search-as-you-type), so the result is always valid |
| Free content | `label`, `kind`, `data`; an edge's `kind` / `label` | a JSON box — swap it for your own editor with `renderEditor` |
| Not editable | layer definitions and a node's layer (it follows the parent it is put under, unless the profile derives it from fields), `origin` (a new node takes the source being filtered on, else its parent's), flags, issues, the virtual root | — |

Deleting is only for leaves, and takes their edges with them (the confirmation says how
many). Compare mode is read-only. `checkEdit(model, op)` tells you why an op would not apply;
`toPhysical(model)` writes the whole graph back out as plain `{nodes, edges}`.

---

