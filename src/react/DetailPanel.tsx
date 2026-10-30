'use client';
/* glassbrain · detail panel: the field table is driven by profile.detail; the core knows no business field.
 * Values not registered in the field table that are not objects all land in an "Other" section at the bottom: a field added
 * to the data shows up without writing code. */
import type { ReactNode } from 'react';
import type { DetailSpec } from '../profile';
import { useStrings } from './i18n';
import { I, Icon } from './icons';
import { renderInline, renderMarkdown, type MarkdownOptions } from './markdown';

export interface SelectedNode {
  id: string;
  label: string;
  kind: string;
  layer?: string;
  origin?: string | null;
  /** Has children. */
  container?: boolean;
  flags: string[];
  detail: Record<string, unknown> | null;
}

const asStr = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const asArr = (v: unknown) => (Array.isArray(v) ? v.map(asStr).filter(Boolean) : []);

export interface DetailPanelProps {
  node: SelectedNode;
  spec: DetailSpec;
  kindLabels: Record<string, string>;
  onClose: () => void;
  /** Rich text renderer injection (the host's markdown component). Defaults to the library's small one (see markdown.tsx). */
  renderText?: (text: string) => ReactNode;
  /** For the default markdown: how relative URLs resolve, and where a `node:<id>` link goes when clicked. */
  markdown?: MarkdownOptions;
  /** Only when editable: the header gets "Edit", and the panel swaps to the edit form (see EditPanel). */
  onEdit?: () => void;
  /** Its color on the graph: the dot before the kind in the title, the same mark as on the graph and in the search dropdown. */
  color?: string;
}

export default function DetailPanel({ node, spec, kindLabels, onClose, renderText, onEdit, color, markdown }: DetailPanelProps) {
  const t = useStrings();
  const d = node.detail ?? {};
  const line = spec.line ?? [];
  const list = spec.list ?? [];
  const text = (s: string): ReactNode => (renderText ? renderText(s) : renderMarkdown(s, markdown));
  const item = (s: string): ReactNode => (renderText ? renderText(s) : renderInline(s, markdown));
  // linkify produces markdown; markdown rendering is on by default, so it always works.
  const value = (field: string, raw: string) => (spec.linkify ? spec.linkify(field, raw) : raw);
  const known = new Set<string>([
    ...line.map((f) => f.key), ...list.map((f) => f.key), ...(spec.skip ?? []),
    // Structural fields (nodes carry them in the generic format) are already told by the title and the graph itself; not listed again.
    'name', 'description', 'kind', 'id', 'label', 'parent', 'layer', 'flags',
  ]);
  const extras = Object.entries(d).filter(([k, v]) => !known.has(k) && v != null && typeof v !== 'object');
  // Nothing below the name reads as a broken panel; one quiet line says it is the data.
  const empty = !extras.length && !asStr(d.description)
    && !node.flags.some((f) => spec.flagNotes?.[f])
    && !line.some((f) => asStr(d[f.key])) && !list.some((f) => asArr(d[f.key]).length);

  return (
    <div className="gb-detail">
      <div className="gb-dh">
        <span className="gb-dh-title gb-kind"><i className="gb-dot" style={{ background: color }} />{kindLabels[node.kind] ?? (node.kind || t.node)}</span>
        <span className="gb-dh-act">
          {onEdit && (
            <button className="gb-ibtn gb-ibtn-text" onClick={onEdit} title={t.edit}><Icon d={I.edit} size={14} /><span>{t.edit}</span></button>
          )}
          <button className="gb-ibtn" onClick={onClose} aria-label={t.close} title={t.close}><Icon d={I.x} size={15} /></button>
        </span>
      </div>
      <div className="gb-db">
        <div className="gb-dt">{node.label}</div>
        {node.flags.map((f) => {
          const note = spec.flagNotes?.[f];
          return note ? <div key={f} className="gb-flag">{note}</div> : null;
        })}
        {line.map((f) => {
          const v = asStr(d[f.key]);
          return v ? (
            <div key={f.key} className="gb-line"><span className="gb-k">{f.label}</span><span>{v}</span></div>
          ) : null;
        })}
        {asStr(d.description) && <div className="gb-desc">{text(asStr(d.description))}</div>}
        {list.map((f) => {
          const items = asArr(d[f.key]);
          return items.length ? (
            <div key={f.key} className="gb-sect">
              <span className="gb-k">{f.label}</span>
              <ul>
                {items.map((it, i) => (
                  <li key={i}>{item(value(f.key, it))}</li>
                ))}
              </ul>
            </div>
          ) : null;
        })}
        {empty && <div className="gb-dempty">{t.noDetails}</div>}
        {extras.length > 0 && (
          <div className="gb-extras">
            {extras.map(([k, v]) => (
              <div key={k} className="gb-line"><span className="gb-k">{k}</span><span>{asStr(v)}</span></div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
