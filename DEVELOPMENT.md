# Development

This document is for contributors to tikz-editor.

## Architecture

The core library uses a layered pipeline:

1. **Parser** (`packages/core/src/parser`) — Parses TikZ into a lossless AST with diagnostics
2. **Semantic Evaluator** (`packages/core/src/semantic`) — Resolves styles, transforms, coordinates, and path semantics into a scene graph
3. **SVG Backend** (`packages/core/src/svg`) — Emits pure SVG from scene elements
4. **Render API** (`packages/core/src/render`) — End-to-end source → SVG orchestration

## Apps

- **Web app** (`apps/web`) — Vite + React
- **Desktop app** (`apps/desktop`) — Tauri v2

## Scripts

```bash
# Type checking
npm run typecheck

# Run all tests
npm test

# Capability matrix tests only
npm run test:capabilities

# PGF corpus regression tests
npm run test:corpus

# Web e2e tests (Playwright)
npm run test:e2e

# Web e2e tests in Firefox or WebKit
npm run test:e2e:firefox
npm run test:e2e:webkit
npm run test:e2e:all-browsers

# Desktop e2e tests
npm run test:desktop:e2e

# Build core package
npm run build

# Build web app
cd apps/web && npm run build
```

### Renderer Comparison Scripts

Compare our renderer against TeX reference output:

```bash
# Single snippet
npm run compare:renderers -- --input path/to/snippet.tex

# PGF manual snippets (generates side-by-side gallery)
npm run compare:pgf-docs -- --source-file pgfmanual-en-tikz-paths.tex
```

Outputs go to `artifacts/renderer-compare/`.

## Capability Matrix

Capabilities are tracked in:
- `packages/core/src/capabilities/feature-ids.ts`
- `packages/core/src/capabilities/matrix.ts`
- `packages/core/src/capabilities/registries.ts`

CI enforces capability drift via `test/capabilities.spec.ts`.

## Corpus

The repository includes `pgf-docs/`, a copy of the PGF manual source files used for testing and capability tracking. `pgf-src/` contains PGF source files for reference.

## Codespaces

`.devcontainer/devcontainer.json` runs `npm run codespaces:startup` on creation, which installs Tauri Linux dependencies and builds prerequisites.

## Profiling

Performance profiling is organized under `apps/web/profiling/` and exposed through scripts instead of ad hoc Playwright commands.

Run from the repo root:

```bash
npm run profile:web
npm run profile:web -- --scenario paper-drag
npm run profile:web -- --category canvas-edit
```

Run from `apps/web/` if you want the app-local entrypoint instead:

```bash
npm run profile
npm run profile -- --scenario scope-edit
npm run profile -- --category paper
```

Supported scenario ids:

- `actions`
- `basic-drag`
- `paper-selection`
- `paper-drag`
- `paper-color`
- `scope-edit`
- `dense-path-edit`
- `path-tool`

Supported categories:

- `actions`
- `basic-drag`
- `paper`
- `canvas-edit`

Artifacts are written to `apps/web/profiling/traces/`:

- `<scenario-id>-<variant-id>.cpuprofile`
- `<scenario-id>-report.json`

Set `TIKZ_PROFILE_VERBOSE=1` for verbose scenario logging.

Analyze or compare profiles:

```bash
npm run profile:web:analyze -- apps/web/profiling/traces/paper-drag-visible.cpuprofile --dist apps/web/dist
npm run profile:web:compare -- apps/web/profiling/traces/paper-drag-visible.cpuprofile apps/web/profiling/traces/paper-drag-hidden-both-panels.cpuprofile --dist apps/web/dist --app-only
npm run profile:web:compare-report -- apps/web/profiling/traces/paper-drag-report.json apps/web/profiling/traces/scope-edit-report.json
```
