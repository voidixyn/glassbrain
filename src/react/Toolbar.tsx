'use client';
/* glassbrain · tools resident on the canvas
 *
 * Only three, placed by "when does someone need it":
 *   top left      search (`/` or ⌘K): find a thing and fly there.
 *                 layers (only for multi-layer graphs): which layer to look at; with stacking on, any layers stacked as 2.5D.
 *                 more ⋯: things rarely touched: only a certain source; "Add node / Add edge" when editable; "Relayout". Absent if empty. (Whether a kind of node or edge shows
 *                 belongs to the legend: toggle where you read the colors, see `GraphView.hiddenNodeKinds`.)
 *   bottom right  camera: zoom in, zoom out, fit to window.
 * Everything else (layout algorithm, boxes / lines, folding depth) is not here: those are decided by developers in code. "Relayout"
 * is in ⋯ because "try another arrangement" is the viewer's own business: a host with only a canvas and no other UI should have it too.
 *
 * Each section can be turned off by the host (controls), because hosts often have an equivalent already: e.g. a platform's
 * file tree on the left is the "source / subgraph" selector, and another dropdown would make two sources of truth.
 * No view state is held here: it reads view and every change goes out through callbacks. It only remembers purely UI things
 * like "is the dropdown open, which entry is picked".
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { GraphIssue, LayerSpec } from '../profile';
import { queryMarker, type GraphView } from '../view';
import { useStrings } from './i18n';
import { I, Icon } from './icons';

export type ControlId = 'search' | 'origins' | 'layers' | 'relayout' | 'zoom';

export const ALL_CONTROLS: ControlId[] = ['search', 'origins', 'layers', 'relayout', 'zoom'];

export interface SearchResult { id: string; label: string; path: string[]; kind?: string }


/** Bold the matched parts of a name: one glance at the list shows why each is there. What counts as a match is shared with search (`queryMarker`). */
function Hl({ text, re }: { text: string; re: RegExp | null }) {
  if (!re) return <>{text}</>;
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (!m[0]) break; // do not spin in place when a regex can match the empty string
    out.push(text.slice(last, m.index), <mark key={m.index}>{m[0]}</mark>);
    last = m.index! + m[0].length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}

/* ── Layers: a row of layer names + a "stack" toggle ────────────────────────────────────
 * "Which layers" and "how they are arranged" are two things, so two controls, not one radio row:
 *   stack off  layer names are single select, a sliding backing points at the current layer (flat)
 *   stack on   layer names become multi-select, each lit (at least one stays), the selected ones stack as 2.5D
 * Layer order comes from the data; it is not adjustable here. */
function LayerPicker({ layers, view, setView, disabled }: {
  layers: LayerSpec[]; view: GraphView; setView: (patch: Partial<GraphView>) => void; disabled?: boolean;
}) {
  const t = useStrings();
  const box = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
  const stacked = !!view.planes;
  const on = new Set(view.layers ?? layers.map((l) => l.id));
  const single = stacked ? null : view.layers?.[0] ?? layers[0].id;
  useLayoutEffect(() => {
    const root = box.current;
    if (!root || single == null) { setThumb(null); return; }
    // Measures the buttons' positions relative to this row. Late fonts or late-injected stylesheets make the first measurement wrong, so remeasure whenever size changes.
    const measure = () => {
      const el = root.querySelector<HTMLButtonElement>(`button[data-v="${CSS.escape(single)}"]`);
      if (!el) return;
      const r = root.getBoundingClientRect(), e = el.getBoundingClientRect();
      setThumb({ x: e.left - r.left - root.clientLeft, w: e.width });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
  }, [single, layers.length]);
  const click = (id: string) => {
    if (!stacked) { if (id !== single) setView({ layers: [id] }); return; }
    if (on.has(id) && on.size === 1) return; // at least one layer stays
    const next = layers.map((l) => l.id).filter((l) => (l === id ? !on.has(l) : on.has(l)));
    setView({ layers: next });
  };
  return (
    <div className={`gb-segm gb-layers${stacked ? ' is-multi' : ''}`} ref={box} role={stacked ? 'group' : 'radiogroup'}>
      {thumb && <i className="gb-thumb" style={{ transform: `translateX(${thumb.x}px)`, width: thumb.w }} />}
      {layers.map((l) => {
        const lit = stacked ? on.has(l.id) : l.id === single;
        return (
          <button
            key={l.id} data-v={l.id} disabled={disabled} className={lit ? 'on' : ''}
            {...(stacked ? { 'aria-pressed': lit } : { role: 'radio', 'aria-checked': lit })}
            title={stacked ? t.stackLayer(l.label, lit) : t.viewLayer(l.label)}
            onClick={() => click(l.id)}
          >{l.label}</button>
        );
      })}
      <span className="gb-sep" aria-hidden />
      <button
        className={`gb-stack${stacked ? ' on' : ''}`} aria-pressed={stacked} disabled={disabled}
        aria-label={t.stack} title={t.stackTip(stacked)}
        onClick={() => setView(stacked ? { planes: false } : { planes: true, layers: null })}
      ><Icon d={I.stack} /></button>
    </div>
  );
}

/** A popover that closes on an outside click or Esc. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key); };
  }, [open]);
  return { open, setOpen, ref };
}

/* ── Search ──────────────────────────────────────────────────────────────── */
function SearchBox(p: {
  query: string; setQuery: (q: string) => void;
  search: { results: SearchResult[]; total: number; elsewhere: { layer: string; label: string; count: number }[] } | null;
  colorOf: (id: string) => string | undefined;
  onPreview: (id: string | null) => void; onPick: (id: string) => void; onLayer: (layer: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const t = useStrings();
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  /** The entry being previewed (picked with arrow keys). Typing does not preview: flying on every keystroke is unusable. */
  const previewing = useRef(false);
  const results = p.search?.results ?? [];
  const open = focused && !!p.query.trim();
  const stopPreview = () => { if (previewing.current) { previewing.current = false; p.onPreview(null); } };
  useEffect(() => { setActive(0); stopPreview(); }, [p.query]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!open) stopPreview(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const move = (d: number) => {
    if (!results.length) return;
    const i = (active + d + results.length) % results.length;
    setActive(i);
    previewing.current = true;
    p.onPreview(results[i].id);
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Enter') {
      const r = results[active];
      if (r) { e.preventDefault(); previewing.current = false; p.onPick(r.id); e.currentTarget.blur(); }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (p.query) p.setQuery('');
      else (e.target as HTMLInputElement).blur();
    }
  };
  const q = p.query.trim();
  const marker = queryMarker(q);

  return (
    <div className={`gb-search${focused ? ' is-focus' : ''}${open ? ' is-open' : ''}`}>
      <div className="gb-field">
        <Icon d={I.search} />
        <input
          ref={p.inputRef} value={p.query} spellCheck={false} aria-label={t.search} placeholder={t.search}
          title={t.searchTip}
          onChange={(e) => p.setQuery(e.target.value)}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onKeyDown={onKey}
        />
        {p.query
          ? <button className="gb-clear" aria-label={t.clearSearch} onMouseDown={(e) => e.preventDefault()} onClick={() => p.setQuery('')}><Icon d={I.x} size={14} /></button>
          : !focused && <kbd>/</kbd>}
      </div>
      {open && (
        // Pressing the mouse in the list does not take focus: the dropdown closes as soon as the input blurs, and the click would miss.
        <div className="gb-drop" onMouseDown={(e) => e.preventDefault()}>
          {results.length > 0 ? (
            <ul role="listbox">
              {results.map((r, i) => (
                <li
                  key={r.id} role="option" aria-selected={i === active} className={i === active ? 'on' : ''}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => { previewing.current = false; p.onPick(r.id); p.inputRef.current?.blur(); }}
                >
                  <i className="gb-dot" style={{ background: p.colorOf(r.id) }} />
                  <span className="gb-r-main">
                    <span className="gb-r-label"><Hl text={r.label} re={marker} /></span>
                    {r.path.length > 0 && <span className="gb-r-path">{r.path.join(' / ')}</span>}
                  </span>
                  {r.kind && <span className="gb-r-kind">{r.kind}</span>}
                </li>
              ))}
            </ul>
          ) : <div className="gb-drop-empty">{t.noMatch(q, !!p.search?.elsewhere.length)}</div>}
          {(p.search && p.search.total > results.length) || p.search?.elsewhere.length ? (
            <div className="gb-drop-foot">
              {p.search && p.search.total > results.length && <span>{t.moreResults(p.search.total - results.length)}</span>}
              {p.search?.elsewhere.map((e) => (
                <button key={e.layer} onClick={() => p.onLayer(e.layer)}>
                  {t.inLayer(e.label, e.count)} <Icon d={I.arrow} size={13} />
                </button>
              ))}
            </div>
          ) : null}
          {results.length > 0 && <div className="gb-drop-keys"><kbd>↑</kbd><kbd>↓</kbd> {t.keysBrowse} <kbd>↵</kbd> {t.keysPick} <kbd>esc</kbd> {t.keysClear}</div>}
        </div>
      )}
    </div>
  );
}

/* ── View ⋯: the rarely touched things ───────────────────────────────────────────── */
function ViewMenu(p: { children: ReactNode; foot: ReactNode }) {
  const t = useStrings();
  const pop = usePopover();
  return (
    <div className="gb-menu" ref={pop.ref}>
      <button
        className={`gb-icon-btn${pop.open ? ' on' : ''}`} aria-label={t.more} aria-expanded={pop.open}
        title={t.more} onClick={() => pop.setOpen(!pop.open)}
      ><Icon d={I.more} /></button>
      {pop.open && (
        <div
          className="gb-panel" role="dialog"
          // Close once chosen: an item clicked, or a value changed in a select. A popover is "go do one thing", and once done it should get out of the way.
          onClick={(e) => { if ((e.target as HTMLElement).closest('.gb-menu-item')) pop.setOpen(false); }}
          onChange={(e) => { if ((e.target as HTMLElement).tagName === 'SELECT') pop.setOpen(false); }}
        >
          {p.children}
          <div className="gb-panel-foot">{p.foot}</div>
        </div>
      )}
    </div>
  );
}

export interface ToolbarProps {
  view: GraphView;
  setView: (patch: Partial<GraphView>) => void;
  layers: LayerSpec[];
  origins: string[];
  stats: { nodes: number; edges: number };
  busy: boolean;
  controls: Record<ControlId, boolean>;
  search: { results: SearchResult[]; total: number; elsewhere: { layer: string; label: string; count: number }[] } | null;
  colorOf: (id: string) => string | undefined;
  onPreview: (id: string | null) => void;
  onPick: (id: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  /** Only when editable: ⋯ gets "Add node / Add edge". */
  onAdd?: (what: 'node' | 'edge') => void;
  /** "Relayout" in ⋯: another arrangement of the same data. Without it the item is absent. */
  onRelayout?: () => void;
}

export default function Toolbar(p: ToolbarProps) {
  const { view, setView, controls } = p;
  const t = useStrings();
  const shortOrigin = (o: string) => o.split('/').pop() ?? o;
  const originPick = controls.origins && p.origins.length > 1;
  const multi = controls.layers && p.layers.length > 1;
  /** "In other layers" under search: unstacked, switch to that layer; stacked, add that layer to the stack. */
  const showLayer = (l: string) => setView(view.planes ? { layers: [...(view.layers ?? []), l] } : { layers: [l] });

  return (
    <div className="gb-bar">
      {controls.search && (
        <SearchBox
          query={view.query ?? ''} setQuery={(q) => setView({ query: q })}
          search={p.search} colorOf={p.colorOf} onPreview={p.onPreview} onPick={p.onPick}
          onLayer={showLayer} inputRef={p.inputRef}
        />
      )}
      {multi && <LayerPicker layers={p.layers} view={view} setView={setView} disabled={p.busy} />}
      {originPick && view.origins?.length === 1 && (
        /* Filtering by source: the state is in plain sight, and one × returns to everything. */
        <span className="gb-chip" title={view.origins[0]}>
          <Icon d={I.file} size={13} />
          <span>{shortOrigin(view.origins[0])}</span>
          <button aria-label={t.allOrigins} title={t.allOrigins} onClick={() => setView({ origins: null })}><Icon d={I.x} size={12} /></button>
        </span>
      )}
      {(originPick || p.onAdd || p.onRelayout) && (
        <ViewMenu foot={t.stats(p.stats.nodes, p.stats.edges)}>
          {originPick && (
            <div className="gb-panel-sec">
              <div className="gb-panel-h">{t.origins}</div>
              <select
                className="gb-select" value={view.origins?.length === 1 ? view.origins[0] : ''}
                onChange={(e) => setView({ origins: e.target.value ? [e.target.value] : null })}
              >
                <option value="">{t.allOrigins}</option>
                {p.origins.map((o) => <option key={o} value={o}>{shortOrigin(o)}</option>)}
              </select>
            </div>
          )}
          {p.onAdd && (
            <div className="gb-panel-sec gb-menu-list">
              <button className="gb-menu-item" onClick={() => p.onAdd!('node')} disabled={p.busy}>{t.addNode}</button>
              <button className="gb-menu-item" onClick={() => p.onAdd!('edge')} disabled={p.busy}>{t.addEdge}</button>
            </div>
          )}
          {p.onRelayout && (
            <div className="gb-panel-sec gb-menu-list">
              <button className="gb-menu-item" onClick={p.onRelayout} disabled={p.busy}>{t.relayout}</button>
            </div>
          )}
        </ViewMenu>
      )}
    </div>
  );
}

/* ── Bottom right: the camera, plus the validation badge ─────────────────────────────────────────── */

const GROUP_CAP = 100;

/**
 * Validation: a number that is always big is wallpaper, so
 *   · the badge reports only the most important level: the error count if there are errors (red), otherwise the warning count (faint);
 *   · the panel first lists "what, how many" per category, and a category opens to show items; clicking an item with a node flies there.
 */
function Issues({ issues, onPick }: { issues: GraphIssue[]; onPick: (id: string) => void }) {
  const t = useStrings();
  const pop = usePopover();
  const groups = useMemo(() => {
    const by = new Map<string, { name: string; error: boolean; items: GraphIssue[] }>();
    for (const it of issues) {
      const name = it.group ?? it.kind;
      const g = by.get(name) ?? by.set(name, { name, error: false, items: [] }).get(name)!;
      g.items.push(it);
      if (it.level === 'error') g.error = true;
    }
    return [...by.values()].sort((a, b) => +b.error - +a.error || b.items.length - a.items.length);
  }, [issues]);
  const errors = issues.filter((i) => i.level === 'error').length;
  const warns = issues.length - errors;
  const target = (it: GraphIssue) => it.nodeId ?? it.edge?.source;
  return (
    <div className="gb-menu" ref={pop.ref}>
      <button
        className={`gb-pill ${errors ? 'gb-err' : 'gb-hint'}`} onClick={() => pop.setOpen(!pop.open)} aria-expanded={pop.open}
        title={t.issuesTip(errors, warns)}
      >
        <Icon d={I.warn} size={14} /> {errors || warns}
      </button>
      {pop.open && (
        <div className="gb-panel gb-panel-up gb-issues" role="dialog">
          <div className="gb-panel-h">{t.issuesTitle(errors, warns)}</div>
          {groups.map((g) => (
            <details key={g.name} open={groups.length === 1}>
              <summary className={g.error ? 'is-err' : ''}><span>{g.name}</span><b>{g.items.length}</b></summary>
              <ul>
                {g.items.slice(0, GROUP_CAP).map((it, i) => {
                  const id = target(it);
                  return (
                    <li key={i} className={id ? 'is-link' : ''} onClick={id ? () => { onPick(id); pop.setOpen(false); } : undefined}>
                      {it.message}
                    </li>
                  );
                })}
                {g.items.length > GROUP_CAP && <li className="gb-more">{t.moreItems(g.items.length - GROUP_CAP)}</li>}
              </ul>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

export function ZoomDock(p: {
  zoom: boolean; onZoom: (dir: 1 | -1) => void; onFit: () => void;
  issues: GraphIssue[]; onPick: (id: string) => void;
}) {
  const t = useStrings();
  if (!p.zoom && !p.issues.length) return null;
  return (
    <div className="gb-dock">
      {p.issues.length > 0 && <Issues issues={p.issues} onPick={p.onPick} />}
      {p.zoom && (
        <div className="gb-group" title={t.cameraTip}>
          <button aria-label={t.zoomOut} title={t.zoomOut} onClick={() => p.onZoom(-1)}><Icon d={I.minus} /></button>
          <button aria-label={t.zoomIn} title={t.zoomIn} onClick={() => p.onZoom(1)}><Icon d={I.plus} /></button>
          <button aria-label={t.fit} title={t.fit} onClick={p.onFit}><Icon d={I.fit} /></button>
        </div>
      )}
    </div>
  );
}
