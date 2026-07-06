# tikz-editor

WYSIWYG TikZ editor with a parser -> semantic scene graph -> SVG pipeline.

## Project Map
- `packages/core`: TikZ parser, AST, semantic evaluator, edit actions, capability matrix, SVG/render pipeline.
- `packages/app`: shared React editor UI, state, menus, platform abstractions, workspace/file sync.
- `apps/web`: browser shell for `@tikz-editor/app`, web platform adapter, Playwright e2e/profiling.
- `apps/desktop`: Tauri shell for `@tikz-editor/app`; local Tauri docs are in `tauri-docs/`.
- `apps/landing`: landing/marketing site.
- `pgf-docs`, `pgf-src`: untracked local PGF manual/source references for renderer behavior. Reference this frequently to make sure that app behavior conforms to PGF; do not guess about TikZ semantics.

## Core Pipeline
- Parser: `packages/core/src/parser`
- Semantic evaluator: `packages/core/src/semantic`
- SVG backend: `packages/core/src/svg`
- End-to-end render API: `packages/core/src/render`

## Capabilities
Update these together when feature support changes:
`packages/core/src/capabilities/feature-ids.ts`,
`matrix.ts`, `registries.ts`.
Capability drift is guarded by `test/capabilities.spec.ts`.

## Common Commands
- `npm run typecheck`
- `npm run lint:prod`
- `npm test`
- `npm run test:capabilities`
- `npm run test:corpus`
- `npm run test:e2e`
- `npm run test:desktop:e2e`
- `npm run build`
- `npm run build:landing`
- `npm run build:desktop`

Use `npm run lint:prod` as the production lint gate. `npm run lint` is a noisy full-repo audit. Vitest does not support `--runInBand` here.

## Renderer Comparison
Use `npm run compare:renderers -- --input path/to/snippet.tex` for focused TeX-vs-editor checks. Use `npm run compare:pgf-docs -- --source-file ...` for PGF manual snippet galleries.

## Profiling Scripts
Performance profiling scripts live in `apps/web/profiling/`, e.g.
```
npx playwright test --config profiling/playwright.config.ts profiling/profile-paper-drag.spec.ts
etc.
```

Set `TIKZ_PROFILE_VERBOSE=1` for verbose logging. Output `.cpuprofile` and `-report.json` files go to `apps/web/profiling/traces/`; use `scripts/analyze-cpuprofile.mjs` for analysis.

# My approach to git

I sometimes keep "dirty" files in the work tree, especially when they are draft changes, before committing them. Typically the request I make will not touch the same files. So you don't have to worry about changes already in the repo, and certainly there is no need to stop your work once you see such files, because the presence of these files is expected.
