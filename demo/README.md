# demo

```bash
npm run demo          # → demo/dist/index.html    everything under data/demo/
npm run demo:public   # → demo/dist/public.html   only the allow-listed datasets (the live demo)
```

The result is **one self-contained html file**: double-click it, no server, no network. Data is
inlined into the page (browsers refuse `fetch` of neighboring files on `file://`), and layout runs
on the main thread there (browsers refuse `Worker` on `file://`); over http the page uses the
worker pool.

The public build **trusts its allow-list, not `.gitignore`**: anything else you keep in
`data/demo/` locally is never inlined into the published page. A new public dataset has to be
named in `PUBLIC` in `build.mjs`.

## What the page is

A host application, with "what the host passes" in plain sight. The canvas, legend, search and
inspector are the library; the page owns only its sidebar, laid out like a settings page: every
row is a `<GraphCanvas>` prop with its current value. `</>` shows the code for the current
settings, and the line that just changed lights up.

- **Datasets and versions.** Pick a dataset, then a version; browsing another version plays the
  transition. **Compare** puts a reference version next to it, sharing one set of coordinates:
  unchanged things are on the same pixel in both panes. Added is marked only on the right,
  removed only on the left, changed on both; the halo size says how big the change is.
- **Editing.** Click a node → Edit, or ⋯ → Add. Edits are kept per version in this browser; undo
  them or export a patch or the whole graph.
- **Your own data.** "Open folder…" (or drag one in) reads your `{nodes, edges}` files, with a
  `_profile.json` and a patch if the folder has them.
- **Language.** The switch changes the page's text and, through `strings`, the library's
  ([`examples/strings-zh.ts`](../examples/strings-zh.ts) is the Chinese pack); text in the data
  stays as it is.
- On a phone the sidebar is a drawer. Diagnostics (the transition report) show with `?dev`.

Data conventions are in [`data/demo/README.md`](../data/demo/README.md). `host.ts` is where a host
would add what a `_profile.json` cannot say (a profile written as code, an id matching rule); the
bundled datasets need none of it.
