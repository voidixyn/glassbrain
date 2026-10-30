/* The demo page's own styles. The library's styles (gb-*) are injected by GraphCanvas itself; this only handles the shell.
 *
 * Deliberately restrained: this page is for looking at graphs, and the quieter the shell the better. The UI language is the information itself: position, weight and alignment
 * do the talking, not explanatory text. One rhythm: row height 30 (lists, knobs), block spacing 20, titles one row in small caps.
 *
 * The inspector on the right is the library's; its background uses --gb-inspector-bg, set here to match the left column: symmetric sides with the canvas in between. */
export const CSS = `
:root {
  --ink:#0f172a; --ink2:#475569; --ink3:#64748b;
  --line:#e6eaf0; --bg:#ffffff; --rail:#f8fafc; --tint:#eef1f6;
  --accent:#4f46e5; --accent-soft:#eef2ff;
  /* Header card: the background takes a little accent color to separate it from the form below, without mixing with the accent strokes of "open / selected". */
  --brand-bg: color-mix(in srgb, var(--accent) 20%, var(--bg));
  --gb-inspector-bg: var(--rail); --gb-inspector-border: var(--line);
  color-scheme: light;
}
/* Dark: the page shell has one set of variables, the library's toolbar / inspector another (--gb-*); the primitives' own dark colors are in
   GraphTheme (DARK_THEME), because cytoscape cannot read CSS variables. */
:root[data-theme=dark] {
  --ink:#e2e8f0; --ink2:#a3b1c6; --ink3:#7c8ba1;
  --line:#1e293b; --bg:#0f172a; --rail:#0b1222; --tint:#1a2335;
  --accent:#818cf8; --accent-soft:#1e1b4b;
  --brand-bg: color-mix(in srgb, var(--accent) 20%, var(--bg));
  color-scheme: dark;
  --gb-text:#e2e8f0; --gb-muted:#94a3b8; --gb-muted2:#64748b;
  --gb-border:#1e293b; --gb-panel:rgba(15,23,42,.9); --gb-panel2:#0f172a;
  --gb-tint:#1e293b; --gb-active:#1e3a5f; --gb-accent:#38bdf8; --gb-accent-border:#0369a1;
  --gb-mask:rgba(2,6,23,.6);
  --gb-warn:#fbbf24; --gb-warn-bg:#291d05; --gb-warn-border:#78350f;
  --gb-err:#f87171; --gb-err-bg:#2a0f12; --gb-err-border:#7f1d1d;
  --gb-on-accent:#0b1220;
}
* { box-sizing:border-box; margin:0; }
html, body, #root { height:100%; }
body {
  font: 13px/1.5 ui-sans-serif, system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  color:var(--ink); background:var(--bg); -webkit-font-smoothing:antialiased;
}
button { font:inherit; color:inherit; cursor:pointer; }
button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible { outline:2px solid var(--accent); outline-offset:1px; }

.app { display:flex; height:100%; }
.stage { flex:1; min-width:0; }
.topbar, .scrim, .rail .close { display:none; }

/* ── Sidebar = a settings page (like VS Code's settings): groups → rows; each row = field name (the prop name) + one line of description + a value control.
 *    Controls are only these: select, segmented, switch, slider, button, ⋯ menu, read-only reading. Nothing else is drawn. ── */
.rail { width:340px; flex:none; display:flex; flex-direction:column; background:var(--rail);
  border-right:1px solid var(--line); overflow:hidden; }
/* Top: a Finder-like panel (what is being looked at), roomy; the card below is dense. */
.finder { flex:none; display:flex; flex-direction:column; gap:10px; margin:8px 8px 0; padding:12px 12px 10px;
  background:var(--brand-bg); border:1px solid var(--line); border-radius:18px; box-shadow:0 6px 18px -12px rgba(15,23,42,.5); position:relative; z-index:2; }
.f-top { display:flex; align-items:center; gap:5px; padding:0 0 0 4px; }
.f-top .dot { flex:none; width:9px; height:9px; margin-right:6px; border-radius:50%; background:var(--accent); box-shadow:0 0 0 3px var(--accent-soft); }
.f-top h1 { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:18px; font-weight:700; letter-spacing:-.025em; }
.f-top h1 a { color:inherit; text-decoration:none; }
.f-top h1 a:hover { text-decoration:underline; text-underline-offset:3px; }
/* The glass the panel's controls sit on: the panel's tint shows through. */
.f-bar, .tiles, .f-cmp { background:color-mix(in srgb, var(--bg) 62%, transparent); }
.f-ds { display:flex; align-items:center; gap:8px; }
.f-bar { flex:1; min-width:0; display:flex; align-items:center; gap:4px; height:40px; padding:4px 4px 4px 6px; border-radius:13px; }
.f-bar .stepper { flex:1; min-width:0; height:32px; background:var(--bg); border-color:transparent; box-shadow:0 1px 2px rgba(15,23,42,.08); }
.lead { flex:none; display:grid; place-items:center; width:20px; height:28px; color:var(--ink2); }
.lead svg { fill:none; stroke:currentColor; stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round; }
/* Compare: a round toolbar button, filled when on (a Finder toolbar toggle). */
.f-cmp { flex:none; display:grid; place-items:center; width:40px; height:40px; border:0; border-radius:50%; color:var(--ink2); transition:background .15s, color .15s, box-shadow .15s; }
.f-cmp svg { fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
.f-cmp:hover:not(:disabled) { color:var(--ink); background:var(--bg); }
.f-cmp.on { background:var(--accent); color:#fff; box-shadow:0 4px 12px -4px color-mix(in srgb, var(--accent) 70%, transparent); }
:root[data-theme=dark] .f-cmp.on { color:var(--gb-on-accent); }
.f-cmp:disabled { opacity:.4; cursor:default; }
/* Versions as icons: same brain for every version, name below (two lines at most), Finder's selection: grey square behind the icon, name in a pill. */
.tiles { position:relative; display:flex; gap:2px; overflow-x:auto; overflow-y:hidden; padding:10px 6px 2px; border-radius:13px;
  overscroll-behavior-x:contain; }
/* The scrollbar stays visible (overlay scrollbars hide it until you scroll, and then nobody knows the row goes on). */
.tiles::-webkit-scrollbar { height:12px; }
.tiles::-webkit-scrollbar-track { margin:0 12px; }
.tiles::-webkit-scrollbar-thumb { border:4px solid transparent; border-radius:6px; background:color-mix(in srgb, var(--ink3) 40%, transparent) padding-box; }
.tiles::-webkit-scrollbar-thumb:hover { background-color:color-mix(in srgb, var(--ink3) 65%, transparent); }
@supports not selector(::-webkit-scrollbar) { .tiles { scrollbar-width:thin; scrollbar-color:color-mix(in srgb, var(--ink3) 45%, transparent) transparent; } }
.tile { flex:none; width:82px; display:flex; flex-direction:column; align-items:center; gap:6px; padding:0 2px 6px; border:0; background:none; border-radius:10px; }
.tile-i { display:grid; place-items:center; width:54px; height:54px; border-radius:15px; color:var(--ink);
  background:linear-gradient(165deg, #ffffff 0%, #f1f3f9 100%);
  box-shadow:inset 0 0 0 1px rgba(15,23,42,.06), 0 1px 1.5px rgba(15,23,42,.1), 0 5px 12px -7px rgba(15,23,42,.45);
  transition:box-shadow .15s, transform .15s; }
.tile-i svg { fill:none; stroke:currentColor; stroke-width:1.25; stroke-linecap:round; stroke-linejoin:round; }
.tile-i .b-fill { fill:color-mix(in srgb, var(--accent) 12%, transparent); }
.tile:hover:not(:disabled) .tile-i { transform:translateY(-1px); }
.tile-n { max-width:100%; padding:1px 5px; border-radius:6px; font-size:11.5px; font-weight:500; line-height:1.3; text-align:center; color:var(--ink);
  display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; overflow-wrap:break-word; hyphens:auto; }
.tile.on .tile-i, .tile.ref .tile-i { box-shadow:inset 0 0 0 1px rgba(15,23,42,.06), 0 1px 1.5px rgba(15,23,42,.1), 0 0 0 5px color-mix(in srgb, var(--ink) 11%, transparent); }
.tile.on .tile-n { background:var(--accent); color:#fff; }
:root[data-theme=dark] .tile.on .tile-n { color:var(--gb-on-accent); }
.tile.ref .tile-i { box-shadow:inset 0 0 0 1px rgba(15,23,42,.06), 0 0 0 5px color-mix(in srgb, var(--ink) 6%, transparent); }
.tile.ref .tile-n { background:color-mix(in srgb, var(--ink) 16%, transparent); }
.tile.off { opacity:.4; }
.tile:disabled { cursor:progress; }
:root[data-theme=dark] .tile-i { background:linear-gradient(165deg, #273349 0%, #1a2335 100%);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.07), 0 5px 12px -7px rgba(0,0,0,.8); }
:root[data-theme=dark] .tile-i .b-fill { fill:color-mix(in srgb, var(--accent) 22%, transparent); }
/* Comparing: which is "before", which is "after", in the panel's own words. */
.f-diff { display:flex; align-items:center; gap:6px; flex-wrap:wrap; padding:0 2px; font-size:12px; color:var(--ink2); }
.f-diff em { flex-basis:100%; font-style:normal; font-size:11px; color:var(--ink3); padding-left:2px; }
.f-arrow { color:var(--ink3); }
.f-src { margin:0; padding:0 2px; font-size:12px; line-height:1.45; color:var(--ink2); }
.f-src a { color:inherit; text-decoration:underline; text-decoration-color:var(--ink3); text-underline-offset:2px; }
.f-src a:hover { color:var(--ink); }
.f-after { display:inline-flex; align-items:center; gap:6px; font-weight:600; color:var(--ink); }
.sw-ref, .sw-cur { width:9px; height:9px; border-radius:3px; }
.sw-ref { background:color-mix(in srgb, var(--ink) 22%, transparent); }
.sw-cur { background:var(--accent); }
.kebab { flex:none; font-weight:700; color:var(--ink3); }
.link { border:0; background:none; padding:0; font-size:11.5px; color:var(--accent); text-transform:none; letter-spacing:0; font-weight:500; }
.link:hover:not(:disabled) { text-decoration:underline; }
.link:disabled { opacity:.4; cursor:default; }
.pm svg, .st-pick svg { display:block; }
/* Options: labeled dropdowns (icon · current value · ⋮). */
.menu.pm > summary { width:auto; list-style:none; display:flex; align-items:center; gap:5px; height:28px; padding:0 4px 0 8px; border:1px solid var(--line);
  border-radius:8px; background:var(--bg); color:var(--ink2); font-size:12px; cursor:pointer; }
.menu.pm > summary::-webkit-details-marker { display:none; }
.menu.pm > summary:hover { border-color:var(--accent); color:var(--ink); }
.menu.pm > summary svg { fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
.menu.pm > summary span { color:var(--ink); font-weight:500; white-space:nowrap; }
.menu.pm > summary b { font-weight:700; color:var(--ink3); padding:0 2px; }
.menu.pm[open] > summary { border-color:var(--accent); }
.f-top .menu.pm > summary { border-color:transparent; box-shadow:0 1px 2px rgba(15,23,42,.1); }
.f-top .menu.pm > summary:hover, .f-top .menu.pm[open] > summary { border-color:var(--accent); }
.f-diff .menu.pm > summary { height:24px; padding-left:7px; }
.f-diff .menu > div { left:0; right:auto; }
.stepper svg { fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
/* ‹ name ⋮ ›: the arrows switch directly; the middle opens a card list. */
.stepper { display:grid; grid-template-columns:26px minmax(0,1fr) 26px; align-items:center; height:30px; border:1px solid var(--line);
  border-radius:9px; background:var(--rail); }
.st-arrow { height:100%; border:0; background:none; color:var(--ink2); font-size:16px; line-height:1; border-radius:8px; }
.st-arrow:hover:not(:disabled) { background:var(--tint); color:var(--ink); }
.st-arrow:disabled { opacity:.3; cursor:default; }
.st-pick { position:relative; min-width:0; height:100%; }
.st-pick > summary { list-style:none; display:flex; align-items:center; justify-content:center; gap:7px; height:100%; padding:0 6px; cursor:pointer;
  font-size:13px; font-weight:600; color:var(--ink); border-left:1px solid var(--line); border-right:1px solid var(--line); }
.st-pick > summary::-webkit-details-marker { display:none; }
.st-pick > summary span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.st-pick > summary:hover { background:var(--tint); }
.st-it i { flex:none; display:grid; place-items:center; min-width:18px; height:18px; padding:0 4px; border-radius:5px;
  font-style:normal; font-size:10.5px; font-weight:700; }
.st-pop { position:absolute; z-index:40; top:calc(100% + 8px); left:-60px; right:-40px; max-height:340px; overflow:auto; padding:4px;
  border:1px solid var(--line); border-radius:12px; background:var(--bg); box-shadow:0 12px 32px -12px rgba(15,23,42,.45);
  display:flex; flex-direction:column; gap:1px; scrollbar-width:thin; }
.st-it { display:flex; flex-direction:column; gap:1px; text-align:left; padding:6px 8px; border:1px solid transparent; border-radius:8px; background:none; }
.st-it:hover:not(:disabled) { background:var(--tint); }
.st-it.on { border-color:var(--accent); background:var(--accent-soft); }
.st-t { display:flex; align-items:center; gap:7px; font-size:12.5px; color:var(--ink); }
.st-t b { font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.st-t em { margin-left:auto; font-style:normal; font-size:11px; color:var(--ink3); }
.st-d { font-size:11px; color:var(--ink3); line-height:1.35; }
.st-foot { margin-top:3px; padding:7px 8px 4px; border-top:1px solid var(--line); }
.st-foot .link span { color:var(--ink3); margin-left:4px; }

/* Bottom: one card, dense. The props / code switch is fixed in its top-right corner; the title row scrolls away under it. */
.card { position:relative; flex:1 1 auto; min-height:0; display:flex; flex-direction:column; margin:8px; border:1px solid var(--line);
  border-radius:16px; background:var(--bg); box-shadow:0 6px 18px -14px rgba(15,23,42,.5); overflow:hidden; }
.card-body { flex:1; min-height:0; overflow:auto; scrollbar-width:thin; }
.card-h { display:flex; align-items:center; gap:12px; height:46px; padding:4px 96px 0 16px; }
.card-h h2 { font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--ink3); }
.card-tog { position:absolute; z-index:6; top:8px; right:8px; display:flex; gap:2px; padding:3px; border-radius:11px;
  background:color-mix(in srgb, var(--tint) 88%, transparent); backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px);
  box-shadow:0 0 0 1px var(--line), 0 6px 14px -8px rgba(15,23,42,.35); }
.card-tog button { display:grid; place-items:center; width:34px; height:28px; border:0; border-radius:8px; background:none; color:var(--ink3); transition:color .15s, background .15s; }
.card-tog button svg { fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
.card-tog button:hover { color:var(--ink); }
.card-tog button.on { background:var(--bg); color:var(--accent); box-shadow:0 1px 2px rgba(15,23,42,.14), 0 0 0 1px rgba(15,23,42,.04); }
.thesis { padding:0 16px 2px; font-size:11.5px; color:var(--ink3); }
/* Groups: separated by a thin line, title one row in small caps, collapsible. */
/* A thin line between groups with margins on both sides: it separates paragraphs of the form, not panels of the sidebar. */
/* The divider starts at the left of the disclosure triangle and leaves 16 on the right too; rows in a group are indented to the title text column. */
.grp { background:linear-gradient(var(--line), var(--line)) no-repeat 16px 100% / calc(100% - 32px) 1px; }
.grp:last-of-type { background:none; }
.grp > summary { list-style:none; cursor:pointer; user-select:none; display:flex; align-items:center; gap:7px;
  padding:14px 16px 6px; font-size:11px; font-weight:700; letter-spacing:.07em; text-transform:uppercase; color:var(--ink); }
.grp > summary::-webkit-details-marker { display:none; }
.grp > summary::before { content:''; border-left:4px solid currentColor; border-top:3.5px solid transparent; border-bottom:3.5px solid transparent; transition:transform .15s; }
.grp[open] > summary::before { transform:rotate(90deg); }
.grp > summary:hover { color:var(--accent); }
.grp-p { font-weight:500; letter-spacing:0; color:var(--ink3); }
.grp[open] .grp-p { display:none; }
.grp-d { padding:0 16px 2px 27px; font-size:11px; color:var(--ink3); }
.grp-d code { font:10.5px ui-monospace, SFMono-Regular, Menlo, monospace; color:var(--ink2); }
.grp-b { padding:2px 8px 10px 19px; }
/* A row: name + description on the left, control on the right; wide things (version list, multi-select) take a full row below. */
.row { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:1px 10px; padding:4px 8px; border-radius:8px; }
.row-n { font:500 12px ui-monospace, SFMono-Regular, Menlo, monospace; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.row-d { grid-column:1 / -1; font-size:11px; line-height:1.35; color:var(--ink3); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.row-c { grid-column:2; grid-row:1; min-height:24px; display:flex; align-items:center; gap:6px; justify-content:flex-end; }
.row-b { grid-column:1 / -1; margin-top:4px; }
.row .sg { width:150px; }
.row .sg-btn { padding:3px 0; font-size:11.5px; }
/* Selects, buttons, readings, sliders: the same height, the same border. */
.sel { height:24px; width:136px; padding:0 22px 0 8px; border:1px solid var(--line); border-radius:7px; font:12px/1 inherit;
  color:var(--ink); background:var(--bg) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%2394a3b8' stroke-width='1.5'/%3E%3C/svg%3E") no-repeat right 8px center;
  appearance:none; -webkit-appearance:none; cursor:pointer; }
.btn { height:24px; padding:0 10px; border:1px solid var(--line); border-radius:7px; background:var(--bg); font-size:12px; color:var(--ink2); }
.btn:hover:not(:disabled) { border-color:var(--accent); color:var(--ink); }
.btn:disabled { opacity:.45; cursor:default; }
.btn.mono { font:11.5px ui-monospace, SFMono-Regular, Menlo, monospace; }
.tag { margin-left:6px; padding:1px 6px; border-radius:4px; border:1px dashed var(--line); font:normal 10px ui-sans-serif, system-ui, sans-serif; color:var(--ink3); }
.file { display:inline-flex; align-items:center; gap:6px; height:24px; max-width:220px; padding:0 9px 0 7px; border:1px solid var(--line);
  border-radius:7px; background:var(--bg); color:var(--ink2); }
.file:hover { border-color:var(--accent); }
.file svg { fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
.file b { font:600 11.5px ui-monospace, SFMono-Regular, Menlo, monospace; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.file em { font-style:normal; font-size:11px; color:var(--ink3); white-space:nowrap; }
.file.empty { border-style:dashed; font:11.5px ui-monospace, SFMono-Regular, Menlo, monospace; color:var(--ink3); }
.menu > div button.sep { margin-top:4px; border-top:1px solid var(--line); border-radius:0 0 6px 6px; padding-top:9px; }
.menu > div button.on::after { content:'✓'; float:right; margin-left:12px; color:var(--accent); }
.pill { padding:2px 8px; border-radius:999px; background:var(--tint); font:600 11px ui-monospace, SFMono-Regular, Menlo, monospace; color:var(--ink2); white-space:nowrap; }
.ro { font:11.5px ui-monospace, SFMono-Regular, Menlo, monospace; color:var(--ink2); white-space:nowrap; }
.rng { display:flex; align-items:center; gap:8px; }
.rng input { width:104px; accent-color:var(--accent); }
.rng input:disabled { opacity:.35; }
.rng em { width:38px; text-align:right; font-style:normal; font:11.5px ui-monospace, SFMono-Regular, Menlo, monospace; color:var(--ink2); }
/* ⋯ menu */
.menu { position:relative; }
.menu > summary { list-style:none; display:grid; place-items:center; width:24px; height:24px; border:1px solid var(--line);
  border-radius:7px; background:var(--bg); color:var(--ink2); cursor:pointer; font-size:14px; line-height:1; }
.menu > summary::-webkit-details-marker { display:none; }
.menu[open] > summary { border-color:var(--accent); }
.menu > div { position:absolute; right:0; top:30px; z-index:30; min-width:150px; padding:4px; border-radius:9px;
  background:var(--bg); border:1px solid var(--line); box-shadow:0 8px 24px -8px rgba(15,23,42,.25); display:flex; flex-direction:column; }
.menu > div button { border:0; background:none; text-align:left; padding:6px 10px; border-radius:6px; font-size:12px; color:var(--ink); }
.menu > div button:hover:not(:disabled) { background:var(--tint); }
.menu > div button:disabled { color:var(--ink3); cursor:default; }
/* Multi-select (controls) */
.chips { display:flex; flex-wrap:wrap; gap:4px; }
.chip { height:24px; border:1px solid var(--line); background:var(--bg); border-radius:999px; padding:0 9px;
  font:11px ui-monospace, SFMono-Regular, Menlo, monospace; color:var(--ink3); text-decoration:line-through; }
.chip.on { color:var(--ink); border-color:var(--accent); text-decoration:none; }
.src-fresh, .src-relayout { color:#b45309; } .src-continue { color:var(--accent); } .src-cache, .src-preset { color:#059669; }
/* Viewing raw text (model / profile): a modal card. */
dialog.peek { margin:auto; width:min(560px, 92vw); max-height:80vh; padding:0; border:1px solid var(--line); border-radius:12px;
  background:var(--bg); color:var(--ink); box-shadow:0 24px 64px -16px rgba(15,23,42,.45); }
dialog.peek::backdrop { background:rgba(15,23,42,.35); }
dialog.peek header { display:flex; justify-content:space-between; align-items:center; padding:10px 14px; border-bottom:1px solid var(--line);
  font:600 12px ui-monospace, SFMono-Regular, Menlo, monospace; }
dialog.peek pre { margin:0; padding:12px 14px; max-height:calc(80vh - 48px); overflow:auto; font:11px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; color:var(--ink2); }

.sg { position:relative; display:grid; grid-template-columns:repeat(var(--n),1fr);
  background:var(--tint); border-radius:8px; padding:2px; isolation:isolate; }
.sg-thumb { position:absolute; z-index:0; top:2px; bottom:2px; left:2px; width:calc((100% - 4px) / var(--n));
  transform:translateX(calc(var(--i) * 100%)); transition:transform .18s cubic-bezier(.4,0,.2,1);
  background:var(--bg); border-radius:6px; box-shadow:0 1px 2px rgba(15,23,42,.12), 0 0 0 1px rgba(15,23,42,.04); }
.sg-btn { position:relative; z-index:1; border:0; background:transparent; border-radius:6px; padding:5px 4px;
  font-size:12px; color:var(--ink3); transition:color .18s; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.sg-btn.on { color:var(--ink); font-weight:600; }
.sg-btn:disabled { opacity:.4; cursor:not-allowed; }
.sw { flex:none; display:inline-flex; align-items:center; gap:6px; border:0; background:transparent; padding:0;
  font-size:11.5px; color:var(--ink3); font-variant-numeric:tabular-nums; }
.sw i { width:26px; height:16px; border-radius:999px; background:var(--line); position:relative; transition:background .18s; }
.sw i::after { content:''; position:absolute; top:2px; left:2px; width:12px; height:12px; border-radius:50%;
  background:#fff; box-shadow:0 1px 2px rgba(15,23,42,.25); transition:transform .18s cubic-bezier(.4,0,.2,1); }
.sw.on { color:var(--ink2); }
.sw.on i { background:var(--accent); }
.sw.on i::after { transform:translateX(10px); }

.app.is-drop .stage { outline:2px dashed var(--accent); outline-offset:-8px; border-radius:14px; }

/* Code: the same settings as code. Changed lines are bright, the one that just changed flashes; a line with a control pops it up under it. */
.code { position:relative; padding-bottom:16px; }
.code pre { margin:0; font:11px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; }
/* Soft wrapping; continuation lines indent one step more than the first. */
.code .ln { display:block; padding:0 12px 0 32px; text-indent:-16px; white-space:pre-wrap; word-break:break-all; color:var(--ink); }
.code .ln.has { cursor:pointer; }
.code .ln.has:hover { background:var(--tint); }
.code .ln.open { background:var(--accent-soft); }
.code .ln.dim { color:var(--ink3); }
.code .ln.dim i { color:inherit !important; }
.code .ln.set { color:var(--ink); font-weight:600; }
.code .ln.flash { animation: kg-flash 1.2s ease-out; }
.pop { position:absolute; z-index:4; left:8px; right:8px; margin-top:7px; padding:3px 0; border-radius:12px; background:var(--bg);
  border:1px solid color-mix(in srgb, var(--accent) 50%, var(--line));
  box-shadow:0 0 0 4px color-mix(in srgb, var(--accent) 13%, transparent), 0 16px 34px -14px rgba(15,23,42,.5); animation:pop-in .14s ease-out; }
.pop::before { content:''; position:absolute; top:-6px; left:30px; width:10px; height:10px; background:var(--bg); transform:rotate(45deg);
  border-left:1px solid color-mix(in srgb, var(--accent) 50%, var(--line)); border-top:1px solid color-mix(in srgb, var(--accent) 50%, var(--line)); }
.pop .row { padding:5px 10px; }
@keyframes pop-in { from { opacity:0; transform:translateY(-3px); } }
/* Syntax highlighting */
.c-tag { color:#7c3aed; font-style:normal; } .c-attr { color:#2563eb; font-style:normal; } .c-str { color:#059669; font-style:normal; }
.c-key { color:#2563eb; font-style:normal; } .c-num { color:#c2410c; font-style:normal; } .c-kw { color:#c026d3; font-style:normal; }
.c-com { color:var(--ink3); font-style:italic; }
:root[data-theme=dark] .c-tag { color:#c4b5fd; } :root[data-theme=dark] .c-attr, :root[data-theme=dark] .c-key { color:#93c5fd; }
:root[data-theme=dark] .c-str { color:#86efac; } :root[data-theme=dark] .c-num { color:#fdba74; } :root[data-theme=dark] .c-kw { color:#f0abfc; }
dialog.peek .pl { display:inline; }
@keyframes kg-flash { from { background:color-mix(in srgb, var(--accent) 35%, transparent); } }
/* Diagnostic readings (?dev). */
.log { padding:8px 16px; display:flex; flex-direction:column; gap:4px; font:10.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; color:var(--ink3); }

/* ── Narrow screens: the sidebar becomes a drawer pulled out from the left, with a bar at the top saying what is being looked at ── */
@media (max-width: 760px) {
  /* On phones this row has an extra close button and no room for text: language and theme keep only the icon + ⋮ (the current value is checked in the menu). */
  .f-top .pm > summary span { display:none; }
  .app { flex-direction:column; }
  .topbar { display:flex; align-items:center; gap:10px; height:48px; padding:0 12px 0 6px; flex:none;
    background:var(--rail); border-bottom:1px solid var(--line); }
  .topbar .icon, .rail .close { display:grid; place-items:center; width:36px; height:36px; border:0; background:none; border-radius:8px; color:var(--ink2); }
  .topbar svg, .rail .close svg { fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; }
  .tb-ds { font-weight:600; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .tb-ver { color:var(--ink3); font-size:12.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .stage { flex:1; min-height:0; }
  .rail { position:fixed; z-index:40; top:0; bottom:0; left:0; width:min(340px, calc(100vw - 20px));
    box-shadow: 12px 0 40px -12px rgba(2,6,23,.55); transform:translateX(-102%); transition:transform .24s cubic-bezier(.2,.8,.3,1); }
  .app.rail-open .rail { transform:none; }
  .scrim { display:block; position:fixed; inset:0; z-index:39; background:rgba(15,23,42,.35); opacity:0; pointer-events:none; transition:opacity .2s; }
  .app.rail-open .scrim { opacity:1; pointer-events:auto; }
  .rail .close { display:grid; }
  :root[data-theme=dark] .rail { box-shadow: 16px 0 48px -8px rgba(0,0,0,.8); }
}
/* Narrower still (320-class small screens), even ⋮ goes, only icons remain. */
@media (max-width: 340px) {
  .f-top .pm > summary b { display:none; }
  .f-top .pm > summary { padding:0 7px; }
}
`;
