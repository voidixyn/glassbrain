'use client';
/* glassbrain · legend: what each thing on the graph is, and the entry point to its look
 *
 * It sits at the bottom left of the canvas. Each entry is "this class": a mark (same shape and color as on the graph, read from the graph), a name, a count. Resting on an entry
 * (or clicking, tapping, Enter) pops this class's panel: visibility toggle, color, size multiplier, one row; while the panel is open this class
 * lights up on the graph. The action that changes the result (toggling, picking a color) closes the panel and clears the highlight, so what you see is the result.
 *
 * Each piece of state has its own owner:
 *   which classes are hidden   the view (`GraphView.hiddenNodeKinds / hiddenEdgeKinds`): "what to look at"
 *   color / size               the look (`GraphLook`): "how I like it drawn", layered over the profile's palette without changing the profile
 *   which class lights up      the legend's own transient state, handed to the canvas as emphasis
 *
 * Kind names come from the data (`profile.kindLabels`, else the kind itself); the two entries without a kind (nodes with no color
 * configured, containment edges) and the change categories in compare mode use the library's own strings (`strings`); longer explanations are in tooltips.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { GraphDelta, ChangeKind } from '../diff';
import { cls } from '../elements';
import type { GraphModel } from '../model';
import { arrowOf, shapeOf, type Arrow, type Shape } from '../paint';
import type { GraphProfile } from '../profile';
import { DIFF_COLORS, PAST_KINDS, defaultNodeColor, skeletonColor, themeColor, untheme, type GraphTheme } from '../style';
import { useStrings } from './i18n';
import { I, Icon } from './icons';

/**
 * The look the viewer changed, layered over the profile (anything not set follows the profile). Colors are stored **as the light-background version** (see
 * `themeColor` / `untheme`), one copy shared by light and dark themes. `skeleton` changes the skeleton color (`theme.skeleton`).
 */
export interface GraphLook {
  skeleton?: string | null;
  nodePalette?: Record<string, string>;
  edgePalette?: Record<string, string>;
  nodeSize?: Record<string, number>;
  edgeWidth?: Record<string, number>;
}

/** profile + look overrides → the effective one. With no overrides it returns as is (same reference). */
export function applyLook(profile: GraphProfile, look: GraphLook | null | undefined): GraphProfile {
  if (!look || !(look.nodePalette || look.edgePalette || look.nodeSize || look.edgeWidth)) return profile;
  return {
    ...profile,
    nodePalette: { ...profile.nodePalette, ...look.nodePalette },
    edgePalette: { ...profile.edgePalette, ...look.edgePalette },
    nodeSize: { ...profile.nodeSize, ...look.nodeSize },
    edgeWidth: { ...profile.edgeWidth, ...look.edgeWidth },
  };
}

const isEmptyLook = (l: GraphLook) =>
  !l.skeleton && ![l.nodePalette, l.edgePalette, l.nodeSize, l.edgeWidth].some((m) => m && Object.keys(m).length);

interface Stroke { dash: string; head: Arrow; tail: Arrow }
/** Marks are read from the graph: take any element of this class and ask what shape, dash and arrow it is drawn with right now. Whatever the profile's `style`
 *  says, the legend shows. Results are remembered (void when the instance or style rules change); defaults are drawn until read. */
interface MarkCache { cy: unknown; style: unknown; shapes: Map<string, Shape>; strokes: Map<string, Stroke> }
function readMarks(c: MarkCache, cy: any, style: unknown, nodeKinds: string[], edgeKinds: string[]) {
  if (c.cy !== cy || c.style !== style) { c.cy = cy; c.style = style; c.shapes.clear(); c.strokes.clear(); }
  const live = cy && !cy.destroyed();
  for (const k of nodeKinds) {
    if (c.shapes.has(k) || !live) continue;
    const n = cy.nodes(`.${cls(k)}`)[0];
    if (n) c.shapes.set(k, shapeOf(n.pstyle('shape').value));
  }
  for (const k of edgeKinds) {
    if (c.strokes.has(k) || !live) continue;
    const e = cy.edges(`.${cls(k)}`)[0];
    if (e) c.strokes.set(k, { dash: e.pstyle('line-style').value, head: arrowOf(e.pstyle('target-arrow-shape').value), tail: arrowOf(e.pstyle('source-arrow-shape').value) });
  }
  return {
    shape: (k: string): Shape => c.shapes.get(k) ?? 'circle',
    stroke: (k: string): Stroke => c.strokes.get(k) ?? { dash: 'solid', head: 'none', tail: 'none' },
  };
}

function tally(model: GraphModel, profile: GraphProfile) {
  const nodes: Record<string, number> = {};
  const edges: Record<string, number> = {};
  let plain = 0;
  for (const n of model.nodes) {
    const hollow = !!n.flags?.some((f) => profile.placeholderFlags.includes(f));
    if (!hollow && n.kind && n.kind in profile.nodePalette) nodes[n.kind] = (nodes[n.kind] ?? 0) + 1;
    else plain++;
  }
  for (const e of model.edges) if (e.kind && e.kind in profile.edgePalette) edges[e.kind] = (edges[e.kind] ?? 0) + 1;
  return { nodes, edges, plain };
}

/** Size multiplier: three levels, multiplied with the size the data gives. */
const SCALES = [0.5, 1, 2] as const;
/** How long to rest before the panel pops (no flashing all along when sweeping a row), and how long before it closes after leaving (moving from entry to panel crosses a gap). */
const OPEN_DELAY_MS = 120;
const CLOSE_GRACE_MS = 200;
const CHANGE_ORDER: ChangeKind[] = ['added', 'changed', 'moved', 'merged', 'removed'];

/** Interaction within a panel is managed by Legend as a whole; each entry only reports events with its own key. */
interface LegendCtl {
  enter: (key: string, e: React.PointerEvent) => void; leave: (key: string, e: React.PointerEvent) => void;
  tap: (key: string) => void; focus: (key: string, on: boolean, visible: boolean) => void;
  /** The action that changes the result (toggling, picking a color): close the panel, clear the highlight, show the real look. */
  done: (key: string, byKeyboard: boolean) => void;
  picking: (on: boolean) => void;
}

function Item(p: {
  k: string; open: boolean; ctl: LegendCtl; title: string; mark: ReactNode; label?: ReactNode; count?: number;
  color: string; onPick: (c: string) => void;
  off?: boolean; onToggle?: () => void;
  scale?: number; onScale?: (k: number) => void; glyph?: 'dot' | 'line';
}) {
  const t = useStrings();
  const { k, open, ctl } = p;
  const btn = useRef<HTMLButtonElement>(null);
  const well = useRef<HTMLInputElement>(null);
  // Native color picker: `input` previews live all the way (React's onChange), `change` is the final pick (picker closed).
  useEffect(() => {
    const el = well.current;
    if (!el) return;
    const commit = () => ctl.done(k, false);
    el.addEventListener('change', commit);
    return () => el.removeEventListener('change', commit);
  }, [ctl, k, open]);
  const finish = (byKeyboard: boolean) => { ctl.done(k, byKeyboard); if (byKeyboard) btn.current?.focus({ preventScroll: true }); };
  return (
    <span className={`gb-lg-item${p.off ? ' off' : ''}${open ? ' is-open' : ''}`}
      onPointerEnter={(e) => ctl.enter(k, e)} onPointerLeave={(e) => ctl.leave(k, e)}
      onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); finish(true); } }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) ctl.focus(k, false, false); }}>
      <button
        ref={btn} type="button" className="gb-lg-hit" aria-expanded={open} aria-haspopup="dialog" title={p.title}
        aria-label={p.label ? undefined : p.title}
        onClick={() => ctl.tap(k)}
        onFocus={(e) => ctl.focus(k, true, e.currentTarget.matches(':focus-visible'))}
      >
        {p.mark}{p.label && <span>{p.label}</span>}{p.count != null && <b>{p.count}</b>}
      </button>
      {open && (
        <div className="gb-lg-pop" role="dialog" aria-label={p.title}>
          {p.onToggle && (
            <button type="button" className={`gb-lg-eye${p.off ? ' off' : ''}`} aria-pressed={!p.off}
              aria-label={p.off ? t.legendShow : t.legendHide} title={p.off ? t.legendShow : t.legendHideTip}
              onClick={(e) => { p.onToggle!(); finish(e.detail === 0); }}>
              <Eye off={p.off} />
            </button>
          )}
          <label className="gb-lg-well" title={`${t.legendColor} · ${p.color}`}>
            <i style={{ background: p.color }} />
            <input ref={well} type="color" value={p.color} aria-label={t.legendColor} onClick={() => ctl.picking(true)}
              onChange={(e) => p.onPick(e.target.value)} />
          </label>
          {p.onScale && <i className="gb-lg-sep" />}
          {p.onScale && (
            <span className="gb-lg-segm" role="group" aria-label={t.legendSize}>
              {SCALES.map((s) => (
                <button key={s} type="button" className={s === (p.scale ?? 1) ? 'on' : ''} aria-pressed={s === (p.scale ?? 1)}
                  title={`${s}×`} onClick={() => p.onScale!(s)}>
                  <svg viewBox="0 0 16 10" width={16} height={10}>
                    {p.glyph === 'line'
                      ? <line x1={2} y1={5} x2={14} y2={5} stroke="currentColor" strokeWidth={s * 1.6} strokeLinecap="round" />
                      : <circle cx={8} cy={5} r={1.6 + s * 1.4} fill="currentColor" />}
                  </svg>
                </button>
              ))}
            </span>
          )}
        </div>
      )}
    </span>
  );
}

function Eye({ off }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.4}
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z" />
      <circle cx={8} cy={8} r={2} />
      {off && <path d="M2.5 2.5l11 11" />}
    </svg>
  );
}

function NodeMark({ color, shape = 'circle', ring, off, scale = 1 }: {
  color: string; shape?: Shape; ring: string; off?: boolean; scale?: number;
}) {
  // Turned off: hollow, only a ring of its own color. The size multiplier shows a little (the mark's cell is only so big).
  const paint = off ? { fill: 'none', stroke: color, strokeWidth: 1.4 } : { fill: color, stroke: ring, strokeWidth: 1.2 };
  const r = (off ? 4.8 : 5.5) * (1 + 0.2 * Math.log2(scale));
  return (
    <svg className="gb-lg-mark" viewBox="0 0 14 14" width={14} height={14}>
      {shape === 'hexagon'
        ? <polygon points={[0, 1, 2, 3, 4, 5].map((i) => `${7 + r * Math.sin(i * Math.PI / 3)},${7 - r * Math.cos(i * Math.PI / 3)}`).join(' ')} {...paint} />
        : shape === 'diamond' ? <polygon points={`7,${7 - r} ${7 + r},7 7,${7 + r} ${7 - r},7`} {...paint} />
          : shape === 'rect' ? <rect x={7 - r * 0.85} y={7 - r * 0.85} width={r * 1.7} height={r * 1.7} rx={1.5} {...paint} />
            : <circle cx={7} cy={7} r={r} {...paint} />}
    </svg>
  );
}

const DASH: Record<string, string | undefined> = { dashed: '4 2.5', dotted: '0.1 3' };

function EdgeMark({ color, stroke, off, scale = 1 }: { color: string; stroke: Stroke; off?: boolean; scale?: number }) {
  const sw = 1.8 * (1 + 0.3 * Math.log2(scale));
  const x1 = stroke.tail === 'triangle' ? 6 : 2, x2 = stroke.head === 'triangle' ? 18 : 22;
  return (
    <svg className="gb-lg-mark" viewBox="0 0 24 12" width={24} height={12} opacity={off ? 0.35 : 1}>
      <line x1={x1} y1={6} x2={x2} y2={6} stroke={color} strokeWidth={sw}
        strokeLinecap={stroke.dash === 'dotted' ? 'round' : undefined} strokeDasharray={DASH[stroke.dash]} />
      {stroke.head === 'triangle' && <polygon points="17,2.5 23,6 17,9.5" fill={color} />}
      {stroke.tail === 'triangle' && <polygon points="7,2.5 1,6 7,9.5" fill={color} />}
      {stroke.head === 'tee' && <path d="M22,2.5 V9.5" stroke={color} strokeWidth={1.8} />}
      {stroke.tail === 'tee' && <path d="M2,2.5 V9.5" stroke={color} strokeWidth={1.8} />}
    </svg>
  );
}

/** Containment edges: a wedge from thin to thick, light to dark: the skeleton ramp on the graph itself. */
function SkeletonEdge({ theme }: { theme: GraphTheme }) {
  const id = useMemo(() => `gb-lg-contain-${Math.random().toString(36).slice(2)}`, []);
  return (
    <svg className="gb-lg-mark" viewBox="0 0 30 12" width={30} height={12}>
      <defs>
        <linearGradient id={id}>
          <stop offset="0" stopColor={skeletonColor(theme, 0)} />
          <stop offset="1" stopColor={skeletonColor(theme, 1)} />
        </linearGradient>
      </defs>
      <polygon points="1,5.25 29,3 29,9 1,6.75" fill={`url(#${id})`} />
    </svg>
  );
}

export interface LegendProps {
  /** The host's model (counts follow it). */
  model: GraphModel;
  /** The effective profile (look applied) and the one **without the look**: "Reset" resets to the latter. */
  profile: GraphProfile;
  theme: GraphTheme;
  look: GraphLook;
  onLook: (l: GraphLook) => void;
  /** The main instance: marks are read from it. */
  cy: unknown;
  hidden: { nodes: string[]; edges: string[] };
  onToggle: (which: 'nodes' | 'edges', kind: string) => void;
  /** "Reset" also brings hidden kinds back: the legend does three things (color, hide, size), and reset resets all three. */
  onShowAll: () => void;
  onEmphasis: (em: { nodeKinds?: string[]; edgeKinds?: string[] } | null) => void;
  delta: GraphDelta | null;
  /** The host's caption (`note`), on the legend's top row: which dataset this is, how big. */
  caption?: ReactNode;
  /** Collapsed: only a button remains. */
  collapsed: boolean;
  onCollapsed: (v: boolean) => void;
}

export default function Legend(p: LegendProps) {
  const t = useStrings();
  const { look, onLook, theme, profile } = p;
  const count = useMemo(() => tally(p.model, profile), [p.model, profile]);

  /* ── One "focus": from entering an entry until the result changes or the mouse leaves ─────────────────
   * Keys are `n:kind` / `e:kind`; the two structure entries are `n:` / `e:`.
   *   open    which entry's panel is open (it is the spotlighted class)
   *   focused which entry has keyboard focus (spotlight only, no panel)
   *   picking the native color picker is open: leaving does not close the panel (the picker is outside the window), no dimming either
   *   quiet   the entry whose result just changed: even with the mouse still on it, no popping and no spotlight until it leaves */
  const [open, setOpen] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const quiet = useRef<string | null>(null);
  const pointer = useRef<string>('mouse');
  const over = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const openRef = useRef(open); openRef.current = open;
  const pickingRef = useRef(picking); pickingRef.current = picking;
  const close = useCallback(() => { clearTimeout(timer.current); setOpen(null); setPicking(false); }, []);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      pointer.current = e.pointerType;
      if (openRef.current && !rootRef.current?.querySelector('.gb-lg-item.is-open')?.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [close]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const ctl = useMemo<LegendCtl>(() => ({
    enter: (key, e) => {
      if (e.pointerType !== 'mouse') return;
      over.current = key;
      clearTimeout(timer.current);
      if (quiet.current === key || openRef.current === key) return;
      // One entry is already open: switch directly, like a menu bar.
      if (openRef.current && !pickingRef.current) { setOpen(key); return; }
      if (!openRef.current) timer.current = setTimeout(() => setOpen(key), OPEN_DELAY_MS);
    },
    leave: (key, e) => {
      if (e.pointerType !== 'mouse') return;
      if (over.current === key) over.current = null;
      if (quiet.current === key) quiet.current = null;
      clearTimeout(timer.current);
      if (openRef.current === key && !pickingRef.current) timer.current = setTimeout(close, CLOSE_GRACE_MS);
    },
    tap: (key) => {
      clearTimeout(timer.current);
      quiet.current = null;
      // Touch screens have no hover: tap to open, tap again to close. With a mouse it is usually already open from hover, and clicking does not close it.
      if (openRef.current === key) { if (pointer.current === 'touch') close(); return; }
      setPicking(false);
      setOpen(key);
    },
    focus: (key, on, visible) => {
      if (on) { if (visible && quiet.current !== key) setFocused(key); return; }
      setFocused((f) => (f === key ? null : f));
      if (quiet.current === key && over.current !== key) quiet.current = null;
      if (openRef.current === key && !pickingRef.current) close();
    },
    done: (key, byKeyboard) => { quiet.current = byKeyboard || over.current === key ? key : null; close(); },
    picking: (on) => setPicking(on),
  }), [close]);
  const slot = (key: string) => ({ k: key, open: open === key, ctl });
  const nodeKinds = Object.keys(profile.nodePalette).filter((k) => count.nodes[k]);
  const edgeKinds = Object.keys(profile.edgePalette).filter((k) => count.edges[k]);
  const markCache = useRef<MarkCache>({ cy: null, style: null, shapes: new Map(), strokes: new Map() });
  const marks = readMarks(markCache.current, p.cy, profile.style, nodeKinds, edgeKinds);

  const spot = picking || p.collapsed ? null : open ?? focused;
  const onEmphasis = p.onEmphasis;
  useEffect(() => {
    const kind = spot?.slice(2);
    onEmphasis(!kind ? null : spot!.startsWith('n:') ? { nodeKinds: [kind] } : { edgeKinds: [kind] });
  }, [spot, onEmphasis]);
  useEffect(() => () => onEmphasis(null), [onEmphasis]);

  const set = <K extends keyof GraphLook>(key: K, kind: string, v: unknown) =>
    onLook({ ...look, [key]: { ...(look[key] as Record<string, unknown> | undefined), [kind]: v } });
  const setSkeleton = (c: string) => onLook({ ...look, skeleton: c });
  const name = (k: string) => profile.kindLabels[k] ?? k;
  /* The swatch and the color picker both show **the color on the graph under this theme**; what is stored is the light version. */
  const shown = (c: string) => themeColor(theme, c);

  if (p.collapsed) {
    return (
      <button type="button" className="gb-lg-toggle" aria-expanded={false} aria-label={t.legend} title={t.legend}
        onClick={() => p.onCollapsed(false)}>
        <Icon d={I.legend} />
      </button>
    );
  }

  return (
    <div className="gb-lg" ref={rootRef}>
      {p.caption && <div className="gb-lg-cap">{p.caption}</div>}
      <div className="gb-lg-row">
        <Item {...slot('n:')} color={theme.skeleton} onPick={setSkeleton} title={t.legendPlain}
          mark={<NodeMark color={defaultNodeColor(theme, 0.3)} ring={theme.canvas} />} label={t.legendPlainName} count={count.plain} />
        {nodeKinds.map((k) => {
          const off = p.hidden.nodes.includes(k);
          const scale = profile.nodeSize[k] ?? 1;
          return (
            <Item key={k} {...slot(`n:${k}`)} color={shown(profile.nodePalette[k])} title={name(k)} off={off}
              onToggle={() => p.onToggle('nodes', k)}
              onPick={(c) => set('nodePalette', k, untheme(theme, c))}
              scale={scale} glyph="dot" onScale={(s) => set('nodeSize', k, s)}
              mark={<NodeMark color={shown(profile.nodePalette[k])} shape={marks.shape(k)} ring={theme.canvas} off={off} scale={scale} />}
              label={name(k)} count={count.nodes[k]} />
          );
        })}
      </div>
      <div className="gb-lg-row">
        <Item {...slot('e:')} color={theme.skeleton} onPick={setSkeleton} title={t.legendContains}
          mark={<SkeletonEdge theme={theme} />} label={t.legendContainsName} />
        {edgeKinds.map((k) => {
          const off = p.hidden.edges.includes(k);
          const scale = profile.edgeWidth[k] ?? 1;
          return (
            <Item key={k} {...slot(`e:${k}`)} color={shown(profile.edgePalette[k])} title={name(k)} off={off}
              onToggle={() => p.onToggle('edges', k)}
              onPick={(c) => set('edgePalette', k, untheme(theme, c))}
              scale={scale} glyph="line" onScale={(s) => set('edgeWidth', k, s)}
              mark={<EdgeMark color={shown(profile.edgePalette[k])} stroke={marks.stroke(k)} off={off} scale={scale} />}
              label={name(k)} count={count.edges[k]} />
          );
        })}
      </div>
      {p.delta && (
        /* Change legend: only a legend, not a filter. Marks match the text on the graph: strikethrough = removed, underline = added. */
        <div className="gb-lg-row gb-lg-diff">
          {CHANGE_ORDER.filter((k) => p.delta!.counts[k] > 0).map((k) => (
            <span key={k} className={`gb-lg-chg${PAST_KINDS.has(k) ? ' past' : ''}`}>
              <i style={{ boxShadow: `0 0 0 2px ${DIFF_COLORS[k]}b0, 0 0 0 5px ${DIFF_COLORS[k]}40` }} />
              {/* Same marks as the text on the graph: strikethrough = removed, underline = added. */}
              <span style={k === 'added' ? { textDecoration: `underline 2px ${DIFF_COLORS[k]}`, textUnderlineOffset: 3 }
                : PAST_KINDS.has(k) ? { textDecoration: `line-through 2px ${DIFF_COLORS[k]}` } : undefined}>{t.change[k]}</span>
              <b>{p.delta!.counts[k]}</b>
            </span>
          ))}
        </div>
      )}
      <div className="gb-lg-foot">
        {isEmptyLook(look) && !p.hidden.nodes.length && !p.hidden.edges.length
          ? <span>{t.legendHint}</span>
          : <button type="button" onClick={() => { onLook({}); p.onShowAll(); }}>{t.legendReset}</button>}
      </div>
      <span className="gb-lg-act">
        <button type="button" className="gb-lg-btn" onClick={() => p.onCollapsed(true)} aria-expanded aria-label={t.legend} title={t.legend}>
          <Icon d={I.collapse} size={13} />
        </button>
      </span>
    </div>
  );
}
