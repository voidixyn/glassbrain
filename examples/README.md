# examples

Not shipped in the npm package (see `files` in `package.json`); these are here to be read and
copied.

| | |
|---|---|
| [`strings-zh.ts`](strings-zh.ts) | A complete language pack (Chinese) for every string the library shows. Copy it to translate the UI; the keys match `EN` one to one (a test checks). |
| [`standalone/kg-viewer.tsx`](standalone/kg-viewer.tsx) | The smallest offline viewer: about 30 lines that mount `GraphCanvas` over data inlined into the page as `window.__KG_DATA__`. Bundle it to one IIFE and the page opens from `file://` with no server. It must use `inlinePool`, since browsers refuse `new Worker()` on `file://`. |

For profiles, the demo datasets are the worked examples: each is plain `{nodes, edges}` plus a
declarative `_profile.json` ([`data/demo/`](../data/demo/)).
