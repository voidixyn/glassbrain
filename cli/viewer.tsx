/* The page `npx glassbrain` opens: a self-contained html with data inlined in `window.__GLASSBRAIN__`.
 *
 * Just a thin layer around GraphCanvas: with several versions it adds a version bar (‹ version n › + compare with previous);
 * everything else is the library itself. Opening by double click (file://) works too: no pool is passed, layout runs on the main thread.
 */
import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { diffModels } from '../src/diff';
import { parseSources } from '../src/profile';
import { DARK_THEME, LIGHT_THEME } from '../src/style';
import GraphCanvas from '../src/react/GraphCanvas';
import { ignoreOf, profileFromJson } from './model';

export interface Payload {
  title: string;
  profile: Record<string, unknown> | null;
  versions: { name: string; sources: { origin: string; text: string }[] }[];
  layouts: Record<string, Record<string, { x: number; y: number }>> | null;
  /** On open: which version to show; `compare` = compare with the previous one. */
  start: { at: number; compare: boolean };
}

declare global { interface Window { __GLASSBRAIN__: Payload; __glassbrain?: { layoutMs?: number; source?: string; nodes: number } } }

const data = window.__GLASSBRAIN__;
const profile = profileFromJson('glassbrain-cli', data.profile);
const ignore = ignoreOf(data.profile);
const models = new Map<number, ReturnType<typeof parseSources>>();
const modelAt = (i: number) => {
  let m = models.get(i);
  if (!m) { m = parseSources(data.versions[i].sources, profile); models.set(i, m); }
  return m;
};

const dark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;

function App() {
  const n = data.versions.length;
  const [at, setAt] = useState(Math.min(data.start.at, n - 1));
  const [compare, setCompare] = useState(data.start.compare && n > 1);
  const [isDark, setDark] = useState(dark);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const on = () => setDark(mq.matches);
    mq?.addEventListener('change', on);
    return () => mq?.removeEventListener('change', on);
  }, []);
  useEffect(() => {
    if (n < 2) return;
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea')) return;
      if (e.key === 'ArrowLeft') setAt((i) => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setAt((i) => Math.min(n - 1, i + 1));
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [n]);

  const cur = modelAt(at);
  const diffing = compare && at > 0;
  const delta = useMemo(() => (diffing
    ? diffModels(modelAt(at - 1), cur, { labels: { before: data.versions[at - 1].name, after: data.versions[at].name }, ignore })
    : null), [diffing, at, cur]);
  const theme = isDark ? DARK_THEME : LIGHT_THEME;
  const name = data.versions[at].name;
  const fg = theme.nodeText;

  useEffect(() => { document.body.style.background = theme.canvas; }, [theme]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', color: fg, font: '13px/1.4 system-ui, sans-serif' }}>
      {n > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderBottom: `1px solid ${theme.edge}55`, flexWrap: 'wrap' }}>
          <b style={{ marginRight: 4 }}>{data.title}</b>
          <button type="button" style={btn(theme)} disabled={at === 0} onClick={() => setAt(at - 1)} aria-label="Previous version">‹</button>
          <span style={{ minWidth: 0 }}>{at + 1}/{n} · {name}</span>
          <button type="button" style={btn(theme)} disabled={at === n - 1} onClick={() => setAt(at + 1)} aria-label="Next version">›</button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8, opacity: at === 0 ? 0.5 : 1 }}>
            <input type="checkbox" checked={compare} disabled={at === 0} onChange={(e) => setCompare(e.target.checked)} />
            compare with {at > 0 ? data.versions[at - 1].name : 'previous'}
          </label>
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        <GraphCanvas
          model={delta ? delta.model : cur}
          profile={profile}
          theme={theme}
          diff={delta}
          layout={data.layouts?.[name] ?? null}
          layoutMode="continue"
          onLayout={(pos, info) => { window.__glassbrain = { layoutMs: info.ms, source: info.source, nodes: Object.keys(pos).length }; }}
          note={delta
            ? <span><b>{delta.labels.before}</b> → <b>{delta.labels.after}</b> · {delta.changes.length} changes</span>
            : <span><b>{n > 1 ? name : data.title}</b> · {cur.nodes.length} nodes</span>}
        />
      </div>
    </div>
  );
}

const btn = (t: typeof LIGHT_THEME) => ({
  font: 'inherit', color: 'inherit', background: 'transparent', border: `1px solid ${t.edge}88`, borderRadius: 6,
  width: 26, height: 24, cursor: 'pointer',
});

const css = document.createElement('style');
css.textContent = '*{box-sizing:border-box}html,body,#glassbrain{height:100%;margin:0}';
document.head.appendChild(css);
const host = document.getElementById('glassbrain') ?? document.body.appendChild(Object.assign(document.createElement('div'), { id: 'glassbrain' }));
createRoot(host).render(<App />);
