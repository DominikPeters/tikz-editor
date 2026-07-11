# tex-text Reconciliation Plan

*Written 2026-07-11, after merging `code-quality-2026-07-10` into master.*

## Purpose

The `tex-text` branch (~300 commits ahead) and the just-merged quality work
overlap on 17 files, including the three most heavily restructured on both
sides: `mathjax-engine.ts`, `CanvasPanel.tsx`, and `semantic/evaluate.ts`.
This document is the handoff for the session that reconciles the two, and
records the agreed sequencing around it.

## Agreed sequencing (2026-07-11)

1. **Reconcile `tex-text` with master first** — before starting the add-on
   hook phases or Beamer. It is the hard dependency of Beamer B2+ (CM Sans
   fonts, block layout), and integration debt compounds while the branches
   drift.
2. **Add-on Phases A–B next** (small: `@tikz-editor/addon-api`, grammar
   seam, engine hooks — the doc's "Phase 0" prerequisites all landed with
   the quality branch). Can overlap with the reconciliation; nearly
   orthogonal to the text engine.
3. **Beamer B0/B1 can start any time** (corpus scanner, document-root
   abstraction, frame scanner + sorter with source-card fallback) — they do
   not need tex-text. B2+ waits for the text engine's block layout.
4. **Beamer is a core mode, not an add-on.** The add-on v1 scope is
   deliberately environment-claiming ("pgfplots-shaped") add-ons that lower
   to `SceneElement`s. Beamer changes the document root, app chrome, and
   session state; routing it through the add-on API would warp the API
   around its biggest consumer. Build Beamer's registries (themes,
   recognizers) in the same *shape* as the add-on registries so extension
   stays possible later.

## What the quality work did to each overlapping file

Guides take-theirs vs re-apply decisions. Full rationale: the status blocks
in `design/CODE-REVIEW-2026-07-03.md` and the commit messages
(`git log be197d85..c6043c41 --oneline -- <file>` gives per-file rationale).

| File | Change on master | Merge guidance |
| --- | --- | --- |
| `text/mathjax-engine.ts` | Two space-factor tokenizers unified into `tokenizeWrappedTextSpacing` (preserves the `\\$` quirk bug-for-bug); sync/async measurement unified via a maybe-promise fold; caches capped; async renders serialized (pre-branch, on master since 07-04) | On tex-text this file hosts the TeX engine; MathJax is a fallback slated for deletion (`design/tex-total-rendering.md`). Prefer tex-text's structure; re-apply *intent* (single tokenizer, capped caches) only where the fallback still exists |
| `ui/canvas-panel/CanvasPanel.tsx` | Text editing extracted to `useCanvasTextEditSession.ts` + `CanvasTextEditPopup.tsx` (verbatim moves, ~1.3k lines); drag listeners registered once behind latest-refs; render-phase bookkeeping moved to layout effects; node-position preflight lazy | tex-text's canvas text-editing changes must be re-sited into the extracted hook, not merged into CanvasPanel |
| `semantic/evaluate.ts` | Node shape emission extracted to `nodes/shape-emission.ts` (line-identical move); copy-on-write registries; shared clip chains; single-eval incremental priming; computeBounds loop | tex-text edits to node text emission likely belong in the new file |
| `semantic/context.ts` | Frame registries are `PersistentMap`/COW; `forkSemanticContextFrame` excludes them from `structuredClone` (load-bearing, commented in code) | Do not let a merge reintroduce registries into the structuredClone path |
| `text/knuth-plass/editor/hitmap.ts` | Four entry points deduped through `resolveHitMap` + error factory | Mechanical; re-site tex-text endpoint changes into the shared prologue |
| `apps/desktop/.../desktop-platform.ts` | Split into `bridge.ts` / `native-menu.ts` / `adapter.ts` behind typed `DesktopBridge`; e2e mock `satisfies DesktopBridge` | Any tex-text desktop changes re-site into the split modules |
| `capabilities/registries.ts` | Derived by filtering the matrix | Regenerate, never hand-merge list conflicts |
| `text/knuth-plass/KnuthPlassVisitor.ts` | Pass-2 hyphenation lazy via `selectMainParagraphPass` (selection predicate provably unchanged) | Keep laziness if tex-text kept the two-pass shape |
| Lower risk | `compute.ts` (narrow subscriptions/prewarm), `App.tsx` (layout effects, ref-backed handlers), `TikzJaxModal.tsx`, `nodes/evaluate.ts`, `nodes/multipart-layout.ts`, `canvas-panel/text-offset-map.ts`, `package.json`/lock, `test/knuth-plass-*.spec.ts` | Normal merging |

## New gates tex-text will trip

- CI `lint:ci` now runs `lint:prod` + `lint:test` (no `it.only`) + knip
  `--max-issues 35`; the count sits exactly at the cap, so any new dead
  export fails.
- Root typecheck includes `apps/desktop/src` **and** `apps/desktop/e2e`.
- Grammar-drift guard (`generate:grammar` + `git diff --exit-code`).
- All imports use `@tikz-editor/core/*`; the `tikz-editor/*` alias is gone.
  tex-text's commits predate the rename — expect mass import-path conflicts
  that are mechanical (sed) to fix.

## Other traps

- SVG def ids are content-hash-derived; the incremental reuse path's
  correctness depends on it.
- Option-list writes go through `rewriteSourceBackedOptionListMutations`
  (Note A in the review doc: never re-join entry raws, spans from the
  parser only).
- `design/beamer-editor.md` (on tex-text) still assumes MathJax math
  islands — stale once the fallback is deleted; update it during the merge.
