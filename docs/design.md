# How glassbrain works

The reasoning behind the behavior: why one data switch is one union transition, why the diff never
solves the union, how layout scales by dividing, and the measurements that decided each of these.
None of it is needed to use the library (that is the [guide](guide.md)); it is for contributors and
for anyone who wants to know why the picture moves the way it does.

## Time: one data switch is one union transition

Views give you space. Transitions and `diff` give you **time** — and they are two
readings of *one* thing:

```
diff  = hold the union still and look at it
switch = play the union through, then put the past half away
```

Swapping data is not "replace old with new". Both versions are mounted together,
the transition plays, and then the past half is hidden. That single decision removes
a whole class of problems: **the position target is the union layout, and there is
only one of it**, so "how do I align two layouts" never arises. Interpolating between
*two* layouts is what makes nodes scatter, and there is no second layout here.

Motion happens in exactly three cases, each with a definite meaning:

A switch is **a short scene with an order to it**, not one interpolation. Think of
step1→step2 the way a director would: first cut the things that are going away loose
from their branches — **the edges snap first, then the severed piece kicks outward and
drops a notch darker** — and let them drift off like falling leaves; halfway through
that, the survivors start moving to their new places; as they settle, the new ones grow
out of their parent like a shoot, and **only at the very end are they wired into the
existing structure**. The camera opens up first to give all of it room, then closes in
at the end to crop the empty space.

step2→step1 runs **the same score** — the only difference is the data (43 leaves and no
buds one way, the reverse the other). So there is no second choreography, and no
"is this a zoom-in or a zoom-out" test.

| track | who | window | curve |
|---|---|---|---|
| cut | **edges across the cut** (one endpoint survives) | 0 – 10% | linear, fast |
| snap | the severed piece: a short kick outward, **one notch darker** | 7 – 20% | easeOutCubic |
| leaf | then the long drift, finishing the fade | 18 – 95% | near-linear, non-zero terminal velocity |
| move | everyone who stays | 22 – 74% | **sigmoid** |
| present | entering opacity (incl. the edges that grow with them) + past skin → present skin | 64 – 94% | linear |
| sprout | entering = added ∪ their own structure | 68 – 100% | slight overshoot (easeOutBack) |
| graft | **edges from new nodes into the existing structure** | 86 – 100% | linear |
| open / close | camera | 0–30% / 58–100% | sigmoid |

The score is a **palindrome**: `cut` at the head severs the old connections, `graft` at
the tail attaches the new ones, and everything in between is movement. One piece of
physics justifies both ends — an edge straddling "the part that is leaving" and "the part
that stays" has its length decided by two independent ends, so one of them travelling
draws it into a filament. Edges that do not straddle ride with their own side and never
change length. The windows overlap at the seams, so the order is readable without costing
three times the duration.

## The whole model in one line

    every channel = base + Σ(track progress × amount)

Three channels: **position** (x,y), **presence** (opacity), **appearance** (skin). Same
shape, and the base is always the value in the last frame before the switch:

| | position's base | legs |
|---|---|---|
| kept / changed | last frame's position | move → its position in the union |
| moved | last frame's position (**not** the old parent box) | move → its new position |
| merged | itself | rides its pair + converges onto it |
| removed | itself | the **whole piece** kicks off and drifts (once cut, it stops riding the tree) |
| added | its **anchor** (nearest ancestor that was on screen last frame) | rides the anchor + **shoots out** to its own place |

At t=0 every track's progress is 0, so every channel equals its base:

> **"Frame 0 is identical to the last frame" is not a rule to keep. It is a theorem of
> this model.**

That cost something to arrive at. Position was additive first: `moved` used to start from
the old parent box ("it changed branches"), at the cost of a second-level node teleporting
onto its parent the instant the transition began (449 units measured). And **that jump
happens before any frame has moved, so comparing consecutive frames can never catch it** —
catching it means comparing the frame before the click against frame 0 of the transition,
and doing so by **normalized key**: pairing renames nodes, and comparing by id silently
skips every relocated one (a trap this project has fallen into more than once).

Opacity and skin, meanwhile, each had their own way of being written, so each had to keep
the same rule separately — and **something always slips through**. Between mounting the
union and the layout coming back there is an await, a render, several painted frames, and
nobody was governing those: in browse mode `gb-added` is just an ordinary class, so the new
nodes and the new edges were **painted in full** under the default style. The viewer sees
"the new thing is already here" first, and after that the cut and the sprout have nothing
left to say. A skin change was worse still: it jumped straight to the present skin, then
got painted back to the past one when the transition finally started — **it ran backwards**.

Once all three channels are additions, frame 0 depends on neither the score nor the
coordinates (it is all base), so it can be written **the moment the union is mounted**. A
slow layout then just means lingering a little longer on the last frame. The fix is not to
shorten that window — that only lowers the odds — it is to make what gets painted in that
window *be* frame 0.

"It came from the old branch" is already said by travelling from its own old position —
which was on the old branch. A more explicit callout is the overlay's job (it draws a line
back to the old parent), not something to act out with position.

Six rules; drop one and something silently stops animating:

1. **An edge is identified by its two ends; change one end and it is a different edge.**
   An edge cannot outlive its endpoints — and "it changed branches" is not a node
   property, it is **one containment edge gone and another arrived**. In link mode
   containment is a synthetic edge generated from `parent` at render time and never
   carries a flag, so that pair of changes is invisible to flags. See "changed branches"
   below.
2. **An instant and a velocity are not the same number.** A track's window is the
   instant; its curve is the velocity. Easing `p` globally and then comparing it against
   windows collapses every instant toward the front: under easeOutCubic the instant
   `0.4` lands at **15.7%** of wall time — 110ms into a 700ms transition, which reads as
   "nothing animated". Sampling now takes one input: wall-clock time.
3. **Everything "present" is driven by one scalar** — `fade.in`. Entering opacity and
   past-skin-to-present-skin progress are the same number, so they cannot drift apart.
4. **Group by skin; never write styles per element.** Elements sharing a past/present
   skin pair have identical differences, so one collection-level style call per frame is
   enough: 206 nodes × 4 properties measured at **2.79ms/frame**, the same order as the
   presence channel already costs, against 6.06ms/frame per element. Presence works the
   same way: four envelopes in total (cut / out / in / graft), four calls per frame.
5. **Bounce belongs in the curve, never in the size.** Positions are written every frame
   anyway — the floor price of any movement — so a different curve is **free**; bouncing
   a node from 0.85 to 1 means writing width/height every frame, which drags in style
   recalculation, bounding-box invalidation and compound-parent recomputation. So
   "sprout" is **movement**, not scaling.
6. **No ghost elements.** The fix for "n2 fades out, n1 moves, and the edge still drags
   n1 along" is not an invisible copy of n1 — it is splitting "ride the parent" and
   "drift away" into **two additive legs**: work it out and during the move beat n2 rides
   exactly with n1 (the edge keeps its length), and only the leaf beat detaches it. One
   multiply-add in the frame function; no extra elements, no id collisions, no layout
   side effects.

The unit of this beat is a **piece**, not a node: a piece is a group of leaving nodes
connected by parent links (a cut subtree). Every node in a piece shares **the same legs**,
so the piece translates rigidly and its internal shape never changes — a
lock of hair falling, not a burst of particles. Per-node drift produces a very visible
accident: the top of a piece has a surviving parent (so it rides along for over a
thousand units) while its children's parents are themselves leaving (Δ = 0, no ride), so
**one object rides with its top half and not its bottom half, and is torn into a
filament**.

**Once cut, it stops following.** Cutting and riding contradict each other: a thing that
has already fallen off does not travel with the tree. Making leaving nodes ride their
parent was a cure for "the edge gets stretched", and that illness is now cured by the cut
itself — so riding is not just redundant, it drags a severed piece thousands of units
across the view (4016 measured) and snaps it back at the end, which is exactly what reads
as "the structure jumps at the moment of the cut". Hair falls to the floor; the person
walks away, the hair does not follow.

And **the edges across the cut have to be severed first**. Edges inside a piece ride with
it and never change length; edges with one surviving endpoint would stretch by exactly as
far as the piece drifts. So they get a much shorter envelope (the first 10%), and the
piece only starts moving once they are gone — at the instant of the cut the piece is still
fully opaque, which is what makes it read as a cut. This is also the final answer to
"should we copy an invisible parent node": **no**. The goal was never to keep the edge —
it was to cut it.

**A cut has to be visible, so it is two beats.** Once the edges are gone the piece
**kicks outward briefly and drops a notch darker** (snap, 7–20%); only the remaining
distance and the remaining opacity are handed to the long drift (leaf, 18–95%). A curve
cannot do this — a curve changes speed, it cannot make two beats — and it is that short
impulse in position, paired with the notch it loses in the same beat, that gives the snip
its weight. Both legs are collinear and shared by the whole piece, so the piece is still
rigid.

Symmetrically, **new edges are attached last** (graft, 86–100%): grow first, then connect.

## Changing branches = one containment edge gone, another arrived

Both ends come down to a single axiom: **what arrives grows, what leaves falls — and an
edge is identified by its two ends, so changing one end makes it a different edge.**

So "it changed branches" is not a node property at all. In link mode the containment edge
is generated from `parent` at render time, and the union carries the **new** parent for a
`moved` node — so that one removal and one addition are **invisible to flags**: the new
edge runs from the new parent to a node that, on frame 0, is still standing at its old
position, so the instant the transition starts a thick line spanning the whole graph
appears out of nowhere (median **1257** units measured), while the old one simply blinks
out. Both ends are mutations.

The fix is not a special case for containment edges in the presence channel — it is making
the union **complete**: `diffModels` records the old parent on the node (`prevParent`) and
`buildElements` emits both edges, each carrying its own `gb-added` / `gb-removed` (the old
one with `_force=false`: it is there to play one exit, never to influence a solve).
Downstream then never has to know that containment edges exist.

What is left is evaluating "follow your endpoints" for each edge. **An edge has no position
of its own**; it can only be drawn between its two ends:

| its two ends | fate |
|---|---|
| same fate (both leaving / both arriving) | follow along — the piece drifts as one, or the edge grows with the shoot; length never changes |
| different fates | it cannot follow, so it must break; then it only shows during the stretch when **neither end moves** |

Head and tail look asymmetric, but it is one criterion: **the past side still has to
travel; the future side has already stopped.** A leaving edge's surviving end is about to
go to its new position (move, 22–74%), so it must be severed before that or it is drawn
into a filament across the graph; an arriving edge's existing end settled long ago, so it
can afford to wait.

This is also the final answer to "should we pin a changed edge with a transparent node":
**no**. The stretch is contributed by the **surviving** end, so pinning the dying end
achieves nothing; to avoid the stretch you would have to pin both ends, which is a frozen
copy of the old graph — exactly the "interpolate between two layouts" the union design
exists to remove. **Use timing, not compensation.**

The drift distance must be **small**. The point of this beat is the snip at the tip, not
an explosion: the pieces scatter only slightly and still look like what they were. Default
**8%** — a number only a slider can settle: 8% is the line between "you can see something
fell off" and "it exploded". Drifting further buries the cut.

**Leaving is the longest beat**, and it deliberately runs through the later ones: when
the new shoots start growing, the fragments are still drifting at about 30% opacity. That
is what makes "how much went away" comparable to "how much arrived" — both in frame at
once, rather than one after the other. The curve matters as much as the window:
`easeOutCubic` spends its whole travel in the first 20% and then the fragments just sit
there fading, which reads exactly like fading in place; drifting needs a **non-zero
terminal velocity** (the flick itself is the `snap` beat's job, so the drift proper is
close to uniform). Each fragment also varies a little (±30% of the distance, plus some
sideways sway, seeded from a hash of the id), otherwise a uniform scale-out looks like a
shell expanding rather than debris scattering. All of that is computed once when the
score is laid out; the frame loop is still one multiply-add.

How far they drift can only be measured **as a fraction of the picture**: the camera
frames the graph, so a few percent of the graph's span is a few percent of the screen,
whatever the graph or the zoom. Measuring it against each node's own distance to its
parent was tried and failed — that distance spans two orders of magnitude within one
graph (140 for a leaf hugging its parent, 2400 for a top-level node on the virtual root),
so the close ones drifted 60 units while simultaneously riding their parent for over a
thousand: completely drowned out, indistinguishable from fading in place.

**Framing has exactly one basis: the visible nodes.** There used to be a `cy.fit()`
shortcut (all elements, edges and edge labels included) whenever nothing was filtered and
nothing was leaving — so one graph had two bases, and which one you got depended on
**whether the previous step had anything leaving**. That is the previous scene leaking
into this one.

**A zero-width track produced by the lead-cut does not happen — it is not "finishes
instantly".** On a skin-only step the camera's `open` beat gets cut to zero width; divide a
zero-width window by some floor and it saturates to 1 on the first frame. The content
tracks don't care (those groups are empty) but the camera reads the same number, so the
picture teleports to the union framing on frame 1 and eases back over the whole duration.
Frame 0 is continuous and frame 1 jumps — which is exactly what a somersault looks like.

**No dead air — and no stretching what is left.** When a transition has no leaves and no
movement, "present" should not sit waiting until 64%: the empty lead is cut (windows shift
forward and re-normalize to [0,1]) **and the wall clock is multiplied by `span`**. The two
scalings cancel, so:

> **How long a beat takes does not depend on how many beats this step has.**

| what this step has | span | actual duration (default 1800ms) |
|---|---|---|
| leaves (a full scene) | 1 | 1800ms |
| movement only | 0.78 | 1404ms |
| arrival only (skin / sprout) | 0.36 | **648ms** |

It used to do only the shift: the remainder was stretched back to fill [0,1] and the
duration never changed, so a step that only filled in content played the arrival beat
**2.78× slower** and still took the whole 1800ms. What the viewer waits through is not the
empty beat — it is the stretched one.

Appearance is a third kind of change, on par with "is it there" and "where is it", and
it is **not** the same as `changed`: `changed` compares data, a skin comes from
kind/flags, and either can happen alone (that flag often depends on *other* nodes). In
real data one whole step can be nothing but "167 placeholders got filled in", with zero
movement, zero additions and zero edges — without this channel that step has no
animation at all.

How the color actually eases: **the core knows no specific color.** At the start of a
transition it asks the renderer what the element computes to under its past skin and
under its present skin, picks out the properties that genuinely differ, interpolates the
ones that have a middle (colors per channel, numbers linearly) and leaves the ones that
do not (`dashed`→`solid` and friends) to switch at the start of the present beat. It writes **inline
style, not classes** — inline overrides the class, so dropping it at the end lands back
on the present skin with no "switch it back" step. Any profile, any palette, any style
property added later goes down this path without being registered anywhere.

The appearance channel **changes what is painted, never how much room it takes**: width,
height, padding, font size and shape are off limits. Coordinates were solved for the
present sizes; resizing mid-transition desynchronises compound bounds and edge endpoints
from the positions being tweened.


**On by default; nothing to wire.**

```tsx
<GraphCanvas model={next} />                        // already transitioning
<GraphCanvas model={next} animate={false} />        // off
<GraphCanvas model={next} animate={{ duration: 900 }} />                          // quicker
<GraphCanvas model={next} animate={{ drift: 0.2, bounce: 2 }} />                  // wilder
```

The defaults are **1800ms / 8% drift / 0.6 bounce**. None of those three can be settled on
paper; they came off a slider. `duration` is how long **a full scene** takes; beats this
step does not have cost no time (see `span` above). This scene exists to let someone compare "how much went
away" against "how much arrived" — it is not a transition effect, and rushing it leaves
nothing but a smear.

Putting the past half away is a `display` toggle — the same "views only decide
visibility" rule the rest of the library runs on. No rebuild, no re-layout, no jump.

### A transition is one scene, and it does not get interrupted

New data arriving mid-scene does not cut in — it **waits**: the next leg plays once this
one lands, and only the newest version is kept (the ones in between were never painted for
a single frame, so skipping them loses nothing — that is what a trailing throttle means).
Swapping data mid-scene truncates it: the previous leg's fragments are still in the air
when the whole union is replaced by another leg's.

```tsx
<GraphCanvas model={next} onBusy={setBusy} />
```

`onBusy` is the switch on that door, so the host can grey out its own "change the data"
controls. **Silently swallowing the click is worse than blocking it.** The window matches
the scene exactly: from accepting a switch (starting the layout) to the final settle, and
**the layout wait counts** — the picture is holding on the last frame, which belongs to
this switch.

### Pairing is a `key`, not an id

```tsx
<GraphCanvas model={next} matchKey={(n) => n.id.replace(/^[^~]+~/, '')} />
```

An id is what the *host* chose to call something, not what makes two things the same
thing. When the two versions live in different namespaces — a common shape: before a
merge each enumeration carries its own prefix, after it there is one numbering —
comparing ids literally yields "everything added, everything removed" for data that is
plainly the same. A normalizing function fixes it.

And when **two old nodes normalize to one key while the new version has one**, that
is not a collision — that is a *merge*: the first becomes the body, the rest are
recorded as `merged` pointing at it, and in the transition they converge onto it.
`diffModels` takes the same `key`, so pairing has exactly one implementation and the
animation can never claim "these are the same" while the diff says "one deleted, one
added".

Similarity matching is deliberately **not** offered. When a guess is wrong the picture
confidently animates a correspondence that does not exist, which is worse than not
knowing. Not knowing degrades to add+remove, which is honest. An explicit `mapping`
(old id → new id) is available for what only the upstream can know.

### diff never solves the union

`diffModels` produces a union graph, but the **coordinates do not come from solving
it**. Each version is solved on its own, and whatever exists only in the old version is
translated as a rigid block onto its surviving anchors:

```
pos[ghost] = posBefore[ghost] + ( anchor in the new layout − anchor in the old layout )
```

A pure translation, no rotation or scale; the anchors are that block's neighbours in the
old graph that are still alive in the new one.

Free-solving the union was the old path, and it treats "two points in time" as "one
bigger graph": AB→CD tiles into four components, and — worse — **the surviving part gets
rearranged too**. CD's coordinates inside the union have nothing to do with the CD you
were just browsing, so the reader loses the only anchor they had: *I recognise this graph*.

Now the new side's layout input is **byte-identical** to browsing that version
(`shapeHash` only reads structure), so **pressing "compare" moves not a single surviving
node**. Large changes **degrade on their own** — no threshold, no mode switch: the fewer
anchors a block has, the more of it is placed as a rigid body, and when nothing is anchored
each pane simply shows its own version, both still shaped the way you know them.

### Two panes: two views of one graph

diff *is* two panes — there is no other layout: left = past, right = now, **sharing one
set of coordinates and one viewport** — any node present in both versions sits on the **same
screen pixel** in both panes (measured: max coordinate difference 0). The left instance is a
**dumb mirror**: no layout, no view algebra, no transitions — it copies positions, writes
visibility, follows the viewport.

**The left pane draws the old version's own elements, not the union.** This one was learned
the hard way: in the union, a node present in both versions takes the **new** version's
label, kind and data; the old copy survives only as `prevData`. Drawing the left pane from
the union therefore shows "the new content arranged on the old structure" — both panes look
like the same version, which is exactly the question two panes exist to answer. So
`unionSides` builds its two sides differently: the new side is sliced out of the union (which
preserves "byte-identical layout input"), while the old side goes back to the original old
model for content and only rewrites ids into the union's namespace.

### Fusion: one shared frozen skeleton

Two panes are what makes "put the changes in comparable places" possible. The starting
point is the new version's free solve (the one you were just browsing); whatever exists
only in the old version is translated into place by `diffPositions`, and then the two sides
take turns **pushing their own exclusive nodes apart**:

```
x     coordinates of the shared nodes — one copy, used by both panes
ownA  old-version-only          ownB  new-version-only

for k in 0..rounds-1:
  iter = floor(iterations / 2^k)     push rounds halve every step, stop at 0
  relax (k even ? old : new), seeded with x ∪ that side's own nodes; x pinned when snap is on
```

**`ownA` and `ownB` are never in the same problem**, so nothing repels them from each other
and both settle into the same free space — the old branch in the left pane and the new one
in the right pane end up in the same place.

The same consequence decides where a block with **no anchors at all** goes. The two versions
never share a frame, so stepping aside buys nothing — measured on two versions with no
overlap at all (107 added, 141 removed, 0 kept), it grew the union from 1945 wide to 3898,
and since both panes share one viewport, **half of each pane went blank**. So the block keeps
the old layout's shape exactly (one shared translation, not a point moves inside it) and is
simply centred on the new graph.

| | |
|---|---|
| `rounds` | how many turns. **1 = the new version never moves** (default) |
| `iterations` | push rounds for the first step, halved each step |
| `snap` | on (default) = shared coordinates pinned to the new version's free solve |

### Why that step is not a force layout

It was, until it was measured. The numbers live at the top of `layout/relax.ts` (124 nodes,
graph about 2200 wide):

- **cose-bilkent throws on any `numIter` below ~400** — `RangeError: Invalid array length`,
  and it throws **asynchronously, inside its own tick**, so `layoutstop` never fires, the
  `await` never returns, and the whole canvas hangs on "laying out" with no trace of why.
- **`numIter` is not a step size.** fcose moves things exactly as far with `numIter: 1` as
  with `numIter: 1200` (1461 vs 1523). Neither engine has a "just nudge it" mode.
- **Even seeded, one solve moves the shared nodes by a median of 586 and a max of 1422.**
  Those coordinates then get snapped back, so the exclusive nodes were placed against a
  skeleton that teleports out from under them.
- **fcose's `fixedNodeConstraint` cannot be used here either**: divide-and-conquer splits
  the graph into components, and most of the ids in the constraint are not in a given
  component's job, so it throws.

What the extra pass was for was never "lay it out again" — it was "a rigid translation does
no collision check, so it lands on top of things". That is a local problem, a local operator
suffices, and a local operator actually responds to an iteration count: each round pushes
overlapping boxes apart along the minimum translation vector, then pulls the movable set's
**centroid** back toward where it started (pulling each node back individually is wrong —
separation and homing then fight to a standstill). On the same data the whole fusion takes
2–5ms, moves things at most 41 units, and never moves a pinned node.

### The diff UI language: the pane carries meaning, hue only reinforces

Element color belongs to you. Mapping five change kinds onto five hues pressed *time* into
the *color* channel — a channel that also carries domain semantics and selection/hit.

With two panes the argument disappears: **which pane something is in already says added vs
removed**. Hue drops to redundant reinforcement, which is the one situation where red/green
is safe. "Safe" is not enough though — the palette owes something to the ~8% of men with a
red-green deficiency, so the three inks are ordered by **lightness**:

| | ink | lightness |
|---|---|---|
| removed (left pane only) | deep red | **darkest** |
| added (right pane only) | teal-leaning green | middle |
| changed (marked in both) | pale yellow | **lightest** |

(The actual values live in `DIFF_INK` and are meant to be tuned; the CSS fallbacks and the
demo legend both read from that one place.)

Three things stack up: the **pane** means red and green are never side by side (within one
pane you only separate "removed vs changed" or "added vs changed"); **green leaning teal**
puts the right pane's pair on the blue-yellow axis, which red-green deficiency leaves
intact; **red pushed dark and yellow pulled light** opens up the left pane's pair by
lightness. Hue is for looking good; lightness and pane position do the talking.

Neither pane is desaturated — the left one *is* the old version and the right one *is* the
new one, each should look like itself. `diffStyle` therefore overrides no domain rule at
all; it only lifts selection/hit back to the top.

The overlay is drawn **below** the canvas (cytoscape's canvas is z-index 1–3 and
transparent), so diff never covers a single pixel of your elements. The whole layer is a
**single-digit number of DOM nodes**: every rounded rect and curve of one ink and one level
is concatenated into one `d`. **There is no permanent blinking** — wherever you draw it, it
costs a full-viewport composite every frame, and it hides half the information half the
time, which is the opposite of what two panes are for.

### How big is the change: three levels

`NodeChange.amount` (0–1) picks one of three halo radii. It is defined only for nodes
**present in both versions** — added and removed are existential, a node either is there or
it isn't, so they always sit at the top level.

The metric is a **real edit distance**, kept affordable by two constraints (measured: 96
changes in 12ms):

- **Only the changed fields are compared**, concatenated into one string per side and
  compared **once**. Per-field would mean 22 DP runs for a 22-field node — billions of cells
  over a hundred nodes.
- **Characters are compared up to 512**; beyond that the remainder counts as wholly
  different. One comparison is therefore always `O(CAP²)`, however big `data` gets.

Normalisation is **across nodes**: divide by the graph's maximum, with no brightening. Not
"fraction of this node's own fields" — that scores every "one of 22 fields changed" at 4.5%
and loses the ranking within a step. A square root to compress the tail was tried and
dropped: it lies to the reader, because a node that only gained one `dependencies` entry
**should** be faint. Measured on one real pipeline step, 34 of its 41 changes land in
the lowest level — which is exactly right.

**One level drives both radius and opacity**; moving radius alone leaves the three levels
looking alike. The lowest is deliberately weak but never zero — intensity is for *ranking*,
and you still have to see it up close.

**Levels are discrete, not continuous**, for two concrete reasons: same ink and same level
concatenate into one path, which is what keeps the layer's DOM count independent of graph
size; and the eye cannot compare continuous radii anyway.

### Containment edges: marked only when nothing else can say it

A containment edge is not data, it is a projection of `parent`. So the question is not "did
it change" but **is anything else already saying this**:

| | who says it | mark the edge? |
|---|---|---|
| node added / removed | the node's own halo already did | **no** — edges are long, saying it twice drowns out the node |
| **reparented** | **nothing else can** — present in both, marked "changed" in both, the only difference is who it hangs under | **yes**: red on the left, teal on the right |

The two panes mark in opposite directions, hence `buildElements`' `past` flag: `prevParent`
always means "who it hangs under in *the other* version", and the flag says which version
this is. The left pane's edge still **bears force** — it *is* the old structure; only the
synthesised other-version edge is excluded from every solve.

### Reading it back

```tsx
<GraphCanvas onTransition={(r) => console.log(r)} />
// { total, moved, movedMedian, entering, leaving, relocated, converging,
//   edgesIn, edgesOut, layoutMs, animated }
```

An animation cannot be replayed for inspection. This report is the record it leaves.
Read `movedMedian`, not `moved`: a count over a small epsilon reports "everything
moved" for a settle of a few units, which tells you nothing.

## Layout that scales by dividing

Split into components → lay each out in parallel → place non-structural layers →
lay out the coarse graph (each component as one super-node) → translate and
assemble. Coordinates are cached in
`localStorage`, addressed by a content hash, so a reload is instant.

Two interchangeable execution channels, same computation, same result:

| | Use when |
|---|---|
| `inlinePool` (**default**) | anywhere. **Required** for offline `file://` pages — browsers disable `Worker` there |
| `workerPool` | the host has a bundler (Next/webpack, Vite): multi-core, main thread stays free |

```tsx
import { workerPool } from 'glassbrain/layout/worker-pool';
<GraphCanvas model={model} pool={workerPool} />
```

The library defaults to the one that always works rather than guessing your bundler.

