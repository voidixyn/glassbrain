# Contributing

Issues and pull requests are welcome. A few things make them land faster.

## Setup

```bash
npm ci
npm run verify        # typecheck → build → package check → tests; CI runs the same
npm run demo          # demo/dist/index.html, open it directly (no server)
```

Node 22.18 or newer for development (the tests are TypeScript run directly by Node); the
published package needs Node 20. Tests run against the build output (`dist/`); `npm test` builds
first.

The browser benchmarks (`npm run bench`, `scripts/scale.mjs`, `scripts/filmstrip.mjs`) drive a
local Chrome: set `CHROME=/path/to/chrome` if it is not at the macOS default location.

## Where things are

| | |
|---|---|
| `src/` | the library: model, profile, diff, transitions, layout, the React canvas |
| `adapters/` | other tools' formats → glassbrain JSON (pure functions, one file each) |
| `cli/` | `npx glassbrain`: view, diff, validate, convert |
| `demo/` | the demo page, a host app built on the library |
| `skills/` | agent skills |
| `schema/` | JSON Schema for graph files and `_profile.json` |
| `docs/` | the [guide](docs/guide.md), the [CLI reference](docs/cli.md) and [how it works](docs/design.md) |

## Guidelines

- **The library knows no domain.** Anything specific to one kind of data belongs in a profile or an
  adapter, not in `src/`.
- **Same input, same picture.** Layout is cached by structure; a change that makes the picture move
  when the structure did not is a bug.
- **A new format** is an adapter in `adapters/`, a minimal fixture in `test/fixtures/` cut down from
  real output, and a test in `test/cli.test.ts`. Real outputs of other people's code stay out of
  the repository.
- Comments explain *why*; the code says *what*. Keep the existing tone: short, concrete, measured
  numbers where they exist.
- One topic per pull request. Add a test when you fix a bug.
