'use client';
/* glassbrain · edit panel: takes the detail panel's place; you edit an object where you look at it.
 *
 * It is the same **inspector** as the detail panel (the right column outside the canvas, about "this object"), so the shell is the same:
 * header, scrolling body, footer pinned at the bottom. Fields look like the canvas overlays: inputs look like the search box,
 * the node picker dropdown like the search dropdown, nodes carry their color on the graph.
 *
 * Three kinds of fields, three treatments (see edit.ts):
 *   UI constrained  id (filled on creation, checked for duplicates on the spot), what it hangs under, an edge's ends: inputs / search pickers, valid by construction
 *   free content    label / kind / data: one JSON box; the host can swap in its own editor with `renderEditor`
 *   not editable    layer, source, derived flags: not shown
 *
 * The panel only produces ops and hands them to `onSubmit`, which returns null (done) or a reason. It never touches the model.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { checkEdit, edgesOf, type EditError, type EditOp, type NodeFields } from '../edit';
import { indexModel, type GraphModel } from '../model';
import { searchNodes } from '../view';
import { useStrings } from './i18n';
import { I, Icon } from './icons';

/** Slot for the free content editor. Defaults to a monospaced textarea. */
export type RenderEditor = (p: { value: string; onChange: (v: string) => void }) => ReactNode;

export type EditTarget =
  | { what: 'node'; id?: string; parent?: string | null }
  | { what: 'edge'; source?: string };

type ColorOf = (id: string) => string | undefined;

const PICK_MAX = 8;

/** What a node looks like in the panel: its color on the graph + name (+ a grey line). Used by dropdowns, the selection and edge lists. */
function NodeRef({ id, model, colorOf, sub }: { id: string; model: GraphModel; colorOf: ColorOf; sub?: string }) {
  const n = model.index.get(id);
  return (
    <>
      <i className="gb-dot" style={{ background: colorOf(id) }} />
      <span className="gb-ref-main">
        <span className="gb-ref-label">{n?.label ?? id}</span>
        {sub && <span className="gb-ref-sub">{sub}</span>}
      </span>
    </>
  );
}

/** Pick a node by searching. The value is an id; empty = none picked (for "hangs under", that means top level). */
function NodePicker({ model, value, onChange, exclude, empty, autoFocus, label, colorOf, id: inputId }: {
  model: GraphModel; value: string | null; onChange: (id: string | null) => void;
  exclude?: (id: string) => boolean; empty?: string; autoFocus?: boolean; label: string; colorOf: ColorOf; id?: string;
}) {
  const t = useStrings();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const idx = useMemo(() => indexModel(model), [model]);
  const hits = useMemo(
    () => (q.trim() ? searchNodes(model, q).filter((id) => !exclude?.(id)).slice(0, PICK_MAX) : []),
    [model, q, exclude],
  );
  useEffect(() => setActive(0), [q]);
  /** After picking, focus stays on this field (the input becomes a button for the selection), and Tab moves on. */
  const curRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  const choose = (id: string | null) => { onChange(id); setQ(''); setOpen(false); refocus.current = !!id; };
  const cur = value ? model.index.get(value) : null;
  useEffect(() => { if (refocus.current && curRef.current) { refocus.current = false; curRef.current.focus(); } });
  const pathOf = (id: string) => idx.ancestorsOf(id).slice(0, 2).reverse().map((a) => model.index.get(a)?.label).filter(Boolean).join(' / ');
  return (
    <div className={`gb-pick${open ? ' is-open' : ''}`}>
      {cur && !open ? (
        <button ref={curRef} type="button" id={inputId} className="gb-pick-cur" aria-label={`${label}: ${cur.label}`}
          onClick={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); choose(null); } }}>
          <NodeRef id={cur.id} model={model} colorOf={colorOf} sub={cur.id} />
          <i className="gb-pick-x" aria-hidden onClick={(e) => { e.stopPropagation(); choose(null); }}><Icon d={I.x} size={12} /></i>
        </button>
      ) : (
        <span className="gb-input gb-pick-field">
          <Icon d={I.search} size={14} />
          <input
            id={inputId} aria-label={label} value={q} spellCheck={false}
            placeholder={value === null && empty ? empty : t.pick}
            autoFocus={autoFocus || open}
            onChange={(e) => { setQ(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              else if (e.key === 'Enter') { e.preventDefault(); if (hits[active]) choose(hits[active]); }
              else if (e.key === 'Escape') { e.stopPropagation(); setQ(''); setOpen(false); }
            }}
          />
        </span>
      )}
      {open && hits.length > 0 && (
        <ul className="gb-pick-list" role="listbox" onMouseDown={(e) => e.preventDefault()}>
          {hits.map((id, i) => (
            <li key={id} role="option" aria-selected={i === active} className={i === active ? 'on' : ''}
              onMouseEnter={() => setActive(i)} onClick={() => choose(id)}>
              <NodeRef id={id} model={model} colorOf={colorOf} sub={pathOf(id) || id} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const pretty = (v: unknown) => JSON.stringify(v, null, 2);

/** The JSON box holds `{ label, kind, data }`; other top-level keys merge into data, so a hand-written flat object works too. */
function readContent(text: string): NodeFields | null {
  let raw: unknown;
  try { raw = JSON.parse(text || '{}'); } catch { return null; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { label, kind, data, ...rest } = raw as Record<string, unknown>;
  const out: NodeFields = {};
  if (typeof label === 'string' && label.trim()) out.label = label;
  if (typeof kind === 'string') out.kind = kind || undefined;
  const d = { ...(data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {}), ...rest };
  if (Object.keys(d).length) out.data = d;
  return out;
}

/** The inspector shell: header (title + close), scrolling body, footer pinned at the bottom. Same as the detail panel. */
function Shell({ title, onClose, onSubmit, foot, error, children }: {
  title: ReactNode; onClose: () => void; onSubmit: () => void; foot: ReactNode; error: string | null; children: ReactNode;
}) {
  const t = useStrings();
  return (
    <form className="gb-detail gb-edit" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
      onKeyDown={(e) => { if (e.key === 'Escape' && !e.defaultPrevented) onClose(); }}>
      <div className="gb-dh">
        <span className="gb-dh-title">{title}</span>
        <span className="gb-dh-act">
          <button type="button" className="gb-ibtn" onClick={onClose} aria-label={t.close} title={t.close}><Icon d={I.x} size={15} /></button>
        </span>
      </div>
      <div className="gb-db gb-form">{children}</div>
      {error && <div className="gb-edit-err" role="alert">{error}</div>}
      <div className="gb-df">{foot}</div>
    </form>
  );
}

export default function EditPanel({ target, model, onSubmit, onCancel, onRetarget, renderEditor, colorOf = () => undefined }: {
  target: EditTarget;
  model: GraphModel;
  /** Hand over one op. Returns null = done; otherwise the reason it could not be applied. */
  onSubmit: (op: EditOp) => EditError | null;
  onCancel: () => void;
  /** Add an edge while editing a node. */
  onRetarget: (t: EditTarget) => void;
  renderEditor?: RenderEditor;
  /** A node's color on the graph (the dot in dropdowns, the selection and edge lists). */
  colorOf?: ColorOf;
}) {
  return target.what === 'node'
    ? <NodeForm key={target.id ?? '+'} target={target} model={model} onSubmit={onSubmit}
        onCancel={onCancel} onRetarget={onRetarget} renderEditor={renderEditor} colorOf={colorOf} />
    : <EdgeForm key={target.source ?? '+'} source={target.source} model={model} onSubmit={onSubmit} onCancel={onCancel} colorOf={colorOf} />;
}

/** Submit one op, and show the reason if it fails. */
function useSubmit(onSubmit: (op: EditOp) => EditError | null) {
  const t = useStrings();
  const [error, setError] = useState<string | null>(null);
  const submit = (op: EditOp) => {
    const e = onSubmit(op);
    setError(e ? t.error[e] : null);
    return !e;
  };
  return { error, setError, submit };
}

function NodeForm({ target, model, onSubmit, onCancel, onRetarget, renderEditor, colorOf }: {
  target: { id?: string; parent?: string | null }; model: GraphModel;
  onSubmit: (op: EditOp) => EditError | null;
  onCancel: () => void; onRetarget: (t: EditTarget) => void; renderEditor?: RenderEditor; colorOf: ColorOf;
}) {
  const t = useStrings();
  const uid = useId();
  const { error, setError, submit } = useSubmit(onSubmit);
  const node = target.id ? model.index.get(target.id) : undefined;
  const creating = !node;
  const [id, setId] = useState('');
  const [parent, setParent] = useState<string | null>(node ? node.parent ?? null : target.parent ?? null);
  const initial = useMemo(
    () => pretty(node ? { label: node.label, kind: node.kind ?? '', data: node.data ?? {} } : { label: '', kind: '', data: {} }),
    [node],
  );
  const [text, setText] = useState(initial);
  const [confirming, setConfirming] = useState(false);
  const idErr = creating && id ? checkEdit(model, { op: 'addNode', id, set: {} }) : null;
  /** Cannot hang under itself or anything below itself. */
  const below = useMemo(() => {
    if (!node) return null;
    const out = new Set<string>([node.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const n of model.nodes) if (n.parent && out.has(n.parent) && !out.has(n.id)) { out.add(n.id); grew = true; }
    }
    return out;
  }, [model, node]);
  const edges = node ? edgesOf(model, node.id) : [];
  const childCount = node ? model.nodes.filter((n) => n.parent === node.id).length : 0;

  const save = () => {
    const content = readContent(text);
    if (!content) { setError(t.badJson); return; }
    if (creating) {
      if (submit({ op: 'addNode', id: id.trim(), set: { ...content, parent } })) onCancel();
      return;
    }
    // Submit only what changed: one op is one edit, so the patch reads well.
    const set: NodeFields = {};
    if ((content.label ?? node.id) !== node.label) set.label = content.label ?? node.id;
    if ((content.kind ?? undefined) !== node.kind) set.kind = content.kind;
    if (pretty(content.data ?? {}) !== pretty(node.data ?? {})) set.data = content.data ?? {};
    if (parent !== (node.parent ?? null)) set.parent = parent;
    if (!Object.keys(set).length) { onCancel(); return; }
    if (submit({ op: 'updateNode', id: node.id, set })) onCancel();
  };

  const foot = confirming && node ? (
    <>
      <span className="gb-confirm">{t.confirmRemove(edges.length)}</span>
      <span className="gb-form-act">
        <button type="button" className="gb-btn" onClick={() => setConfirming(false)}>{t.cancel}</button>
        <button type="button" className="gb-btn gb-danger" onClick={() => { if (submit({ op: 'removeNode', id: node.id })) onCancel(); }}>{t.remove}</button>
      </span>
    </>
  ) : (
    <>
      {node ? (
        <button type="button" className="gb-btn gb-danger-text" disabled={childCount > 0}
          title={childCount > 0 ? t.error['has-children'] : undefined}
          onClick={() => setConfirming(true)}>{t.remove}</button>
      ) : <span />}
      <span className="gb-form-act">
        <button type="button" className="gb-btn" onClick={onCancel}>{t.cancel}</button>
        <button type="submit" className="gb-btn gb-primary" disabled={creating && (!id.trim() || !!idErr)}>{creating ? t.create : t.save}</button>
      </span>
    </>
  );

  return (
    <Shell title={creating ? t.newNode : t.editNode} onClose={onCancel} onSubmit={save} foot={foot} error={error}>
      <div className="gb-fld">
        <label className="gb-k" htmlFor={`${uid}-id`}>{t.id}</label>
        {creating ? (
          <>
            <input id={`${uid}-id`} className={`gb-input${idErr ? ' is-bad' : ''}`} value={id} autoFocus spellCheck={false}
              onChange={(e) => setId(e.target.value)} />
            <small className={idErr ? 'is-bad' : ''}>{idErr ? t.error[idErr] : t.idHint}</small>
          </>
        ) : <code className="gb-id">{node.id}</code>}
      </div>
      <div className="gb-fld">
        <label className="gb-k" htmlFor={`${uid}-parent`}>{t.parent}</label>
        <NodePicker id={`${uid}-parent`} model={model} value={parent} onChange={setParent} empty={t.noParent} label={t.parent}
          exclude={below ? (x) => below.has(x) : undefined} colorOf={colorOf} />
      </div>
      <div className="gb-fld gb-grow">
        <label className="gb-k" htmlFor={`${uid}-json`}>{t.content} <em>{t.contentHint}</em></label>
        {renderEditor
          ? renderEditor({ value: text, onChange: setText })
          : <textarea id={`${uid}-json`} className="gb-input gb-json" value={text} spellCheck={false} rows={9}
              onChange={(e) => setText(e.target.value)} />}
      </div>
      {node && (
        <div className="gb-fld">
          <span className="gb-k">{t.relations} <em>{edges.length || ''}</em></span>
          <ul className="gb-rel">
            {edges.map((e, i) => {
              const out = e.source === node.id;
              return (
                <li key={i}>
                  <span className="gb-rel-dir" aria-hidden>{out ? '→' : '←'}</span>
                  <NodeRef id={out ? e.target : e.source} model={model} colorOf={colorOf} />
                  {e.kind && <span className="gb-r-kind">{e.kind}</span>}
                  <button type="button" className="gb-ibtn" aria-label={t.removeEdge} title={t.removeEdge}
                    onClick={() => submit({ op: 'removeEdge', edge: { source: e.source, target: e.target, kind: e.kind } })}>
                    <Icon d={I.x} size={13} />
                  </button>
                </li>
              );
            })}
          </ul>
          <button type="button" className="gb-add" onClick={() => onRetarget({ what: 'edge', source: node.id })}>
            <Icon d={I.plus} size={13} />{t.addEdge}
          </button>
        </div>
      )}
    </Shell>
  );
}

function EdgeForm({ source: src, model, onSubmit, onCancel, colorOf }: {
  source?: string; model: GraphModel; onSubmit: (op: EditOp) => EditError | null; onCancel: () => void; colorOf: ColorOf;
}) {
  const t = useStrings();
  const uid = useId();
  const { error, submit } = useSubmit(onSubmit);
  const [source, setSource] = useState<string | null>(src ?? null);
  const [target, setTarget] = useState<string | null>(null);
  const [kind, setKind] = useState('');
  const [label, setLabel] = useState('');
  const kinds = useMemo(() => [...new Set(model.edges.map((e) => e.kind).filter(Boolean) as string[])].sort(), [model]);
  const save = () => {
    const op: EditOp = {
      op: 'addEdge',
      edge: { source: source ?? '', target: target ?? '', ...(kind.trim() ? { kind: kind.trim() } : {}), ...(label.trim() ? { label: label.trim() } : {}) },
    };
    if (submit(op)) onCancel();
  };
  const foot = (
    <>
      <span />
      <span className="gb-form-act">
        <button type="button" className="gb-btn" onClick={onCancel}>{t.cancel}</button>
        <button type="submit" className="gb-btn gb-primary" disabled={!source || !target}>{t.create}</button>
      </span>
    </>
  );
  return (
    <Shell title={t.newEdge} onClose={onCancel} onSubmit={save} foot={foot} error={error}>
      <div className="gb-fld">
        <label className="gb-k" htmlFor={`${uid}-s`}>{t.source}</label>
        <NodePicker id={`${uid}-s`} model={model} value={source} onChange={setSource} autoFocus={!src} label={t.source} colorOf={colorOf} />
      </div>
      <div className="gb-fld">
        <label className="gb-k" htmlFor={`${uid}-t`}>{t.target}</label>
        <NodePicker id={`${uid}-t`} model={model} value={target} onChange={setTarget} autoFocus={!!src} label={t.target} colorOf={colorOf}
          exclude={source ? (x) => x === source : undefined} />
      </div>
      <div className="gb-fld">
        <label className="gb-k" htmlFor={`${uid}-k`}>{t.kind}</label>
        <input id={`${uid}-k`} className="gb-input" value={kind} list={`${uid}-kinds`} spellCheck={false} onChange={(e) => setKind(e.target.value)} />
        <datalist id={`${uid}-kinds`}>{kinds.map((k) => <option key={k} value={k} />)}</datalist>
      </div>
      <div className="gb-fld">
        <label className="gb-k" htmlFor={`${uid}-l`}>{t.edgeLabel}</label>
        <input id={`${uid}-l`} className="gb-input" value={label} spellCheck={false} onChange={(e) => setLabel(e.target.value)} />
      </div>
    </Shell>
  );
}
