# Delegation briefs — Beamer canvas editing routine work

Written 2026-08-01 for handing to a delegated agent (e.g. GPT 5.6) one
brief at a time. Each brief is self-contained given this file's ground
rules and the referenced sections of `design/beamer-canvas-editing.md`.
The briefs cover the "routine" pile: design decisions are already made;
what remains is careful implementation against the invariants below.

## Ground rules (apply to every brief)

- Work on the `beamer` branch. Match the commit style in `git log`
  (lowercase, concise, no scope prefixes except `design:` for doc-only
  commits).
- Work alone in one session. Do not spawn subagents or parallel
  sessions.
- Gates before every commit: `npm run typecheck`, `npm run lint:prod`
  (zero warnings), `npx vitest run` (do NOT use `npm run test -- run` —
  it misparses and runs only 2 files), and the Beamer e2e file:
  `cd apps/web && npx playwright test e2e/beamer-canvas-text-editing.spec.ts`.
- No new dependencies. CSS Modules only (no Tailwind, no component
  libraries). Zustand store conventions as in
  `packages/app/src/store/`.
- Keep diffs minimal; do not refactor unrelated code. Match the
  comment density and idiom of the file you are editing.
- Read the relevant sections of `design/beamer-canvas-editing.md`
  before starting; it is the authority on UX decisions. If a decision
  seems missing there and in this brief, choose the smallest behavior
  and leave a `design/` note, do not invent UX.
- Core invariant (staleness): canvas geometry describes the LAST
  RECONCILED snapshot. Every source mutation must go through one of the
  two guarded paths:
  1. Deck edit actions: dispatch `APPLY_EDIT_ACTION` with a
     `DeckEditAction` (`packages/core/src/beamer/deck-edit-actions.ts`);
     the reducer resolves the layout via
     `activeDoc.snapshot.deck.activeFrame.layout` only when
     `snapshot.source === activeDoc.source`, else refuses. Deck results
     must keep `incrementalChangedSourceIds = result.changedSourceIds ?? []`
     (empty array, never null — null routes recompute through the
     typing debounce and drops fast follow-up edits).
  2. Text-session structural patches: compute a
     `BeamerStructuralPatch` against the caret domain and apply it via
     the session helpers in
     `packages/app/src/ui/canvas-panel/useCanvasTextEditSession.ts`
     (`sessionTextAfterStructuralPatch` verifies every edited range
     still matches the domain source; `applyTextEditBufferReplacement`
     writes DOM inputs before dispatching `structural_edit`).
- Live preview + single-undo-step drags/scrubs follow the pattern in
  `packages/app/src/ui/inspector-panel/DeckInspectorPanel.tsx`
  (`beginDeckScrub` + `useInspectorPreviewScrub`): freeze
  `{source, layout}` at pointerdown, preview by dispatching
  `SET_SOURCE_TRANSIENT` with `applyDeckEditAction(frozenBase, …)`
  output, and on release commit ONE recorded `APPLY_EDIT_ACTION`
  carrying `precomputedResult` + `precomputedSource: frozenBase.source`
  (the scrub helper restores the base first so the precomputed source
  matches).
- e2e conventions: use `resetStorageBeforeNavigation`/`gotoApp`/
  `setSource` from `apps/web/e2e/helpers` (without the storage reset,
  markers never render). Deck text sessions open by clicking
  `[data-hit-region-interaction-mode="text"]` regions (see
  `openScopeContaining` in `beamer-canvas-text-editing.spec.ts`). The
  selection outline attributes live on the `rect` inside
  `[data-testid="deck-object-selection"]`, not the `<g>`. Playwright's
  actionability checks stall on small floating popovers — use
  `dispatchEvent("click")` there and cover the pointer path by hand.

---

## Brief A — Glue bands (hover-reveal, select, delete)

Doc: "Stage 3c — direct manipulation" bullet (glue bands, decided
2026-07-31) and "Selection: three tiers". Decision: vertical glue
(`\vspace{…}`, `\smallskip`, `\medskip`, `\bigskip`, `\vfill`) gets a
faint horizontal band in its gap, revealed on hover; click selects it
(labeled band); Delete/Backspace removes the command. Discoverability
by hover was an explicit user decision.

Current state and the key missing piece:

- The body parser already yields `kind: "vertical-space"` flow nodes
  with source spans, and the internal render model keeps them
  (`PreparedFrameFlowItem`/`PreparedColumnFlowItem` `"vertical-space"`
  in `packages/core/src/beamer/render-model.ts`). BUT the published
  `BeamerFrameLayout.items` drops them: `BeamerFrameLayoutItemKind`
  (`packages/core/src/beamer/types.ts:209`) has no vertical-space kind.
  Step one is core: emit a `"vertical-space"` layout item (id,
  `sourceSpan`, `bounds` = the gap rect at its resolved position,
  `parentId` = owning column/block/frame flow) from the flow
  positioning in `packages/core/src/beamer/render.ts`
  (`positionPreparedFrameFlow` and the column flow equivalent). Note
  `PreparedColumnFlowItem`'s vertical-space variant currently carries
  only `height` — thread the node/span through.
- Scope for v1: flow-level vertical space only. Glue INSIDE a
  paragraph's vlist (e.g. `\medskip` between wrapped lines of one
  paragraph chunk) is out of scope; leave a code comment where it
  would attach.
- Selection: extend the object index
  (`packages/core/src/beamer/object-index.ts`) with a
  `"vertical-space"` object kind built from the new layout items. That
  buys the whole Stage 3a machinery for free: hit regions, the Esc
  ladder, `deckDeleteObject` (whose `objectTightSpan`/
  `tokenRemovalSpan` line-removal semantics are exactly right for a
  `\medskip` on its own line), and reducer bookkeeping. Add an entry to
  `OBJECT_TITLES` in `packages/core/src/beamer/deck-inspector.ts` and
  return a minimal inspector model (a text field is NOT required for
  v1 — title only is fine; if trivial, expose the `\vspace` length as
  a text field writing through `deckSetEnvironmentOption`-style span
  replacement, else skip).
- Hover reveal: the object hit regions are rendered per object kind in
  the canvas panel (`packages/app/src/ui/canvas-panel/CanvasPanel.tsx`
  and `CanvasPanelView.tsx`, grep `deck-object`). For glue objects,
  render a band element styled via CSS `:hover` (faint fill, e.g. the
  accent at low opacity) inside the hit-region layer so no JS hover
  state is needed; when the object is selected, show the band solid
  with a small label ("\medskip" / "\vspace{1em}") like the selection
  outline chrome. Do not show the band for `visibility: "hidden"`
  overlay states.

Tests:

- Unit (`test/`): render a frame with `Alpha\n\n\medskip\n\nBeta` and
  `\vspace{2em}` inside a column; assert the published layout contains
  vertical-space items with correct `sourceSpan` and positive-height
  `bounds` sitting between the neighboring paragraphs' bounds; assert
  object index contains them with the right parent.
- e2e (`apps/web/e2e/beamer-canvas-text-editing.spec.ts` style): click
  a glue band → selection outline reports the kind; press Backspace →
  the command's line is gone from source; undo restores it.

---

## Brief B — Graphics corner resize handles

Doc: "Stage 3c — direct manipulation" (graphics corner resize —
"rewrite the authored `width=0.63\textwidth` value span, symbolic form
preserved").

- Trigger: a selected `"graphics"` object (deck object selection,
  Stage 3a) shows four corner handles on its selection outline
  (`[data-testid="deck-object-selection"]` rendering in
  `CanvasPanelView.tsx`). Follow the TikZ resize handle look
  (`packages/app/src/ui/canvas-panel/resize-frames.ts` /
  CanvasPanel.module.css) for size/cursor conventions.
- Drag semantics: corner drag scales the AUTHORED dimension(s).
  Read the current options exactly like the inspector does
  (`buildDeckObjectInspector` graphics fields in
  `packages/core/src/beamer/deck-inspector.ts`, `splitDeckDimension`
  for `0.63\textwidth` → `{value: 0.63, suffix: "\\textwidth"}`).
  Cases:
  - `width=` authored (any suffix): rewrite its value; factor = old
    value × (new rendered width / old rendered width).
  - only `height=` authored: rewrite height by the same ratio.
  - both authored: rewrite both by the same ratio (aspect preserved —
    do not introduce independent axis scaling).
  - none authored: insert `width=<factor>\textwidth` where factor =
    new rendered width / frame text width (bounds of the object vs its
    parent's bounds from the layout).
  Never convert symbolic units to pt. Format numbers with the
  4-decimal trim used by the deck inspector (`formatDeckNumber` in
  `DeckInspectorPanel.tsx` — export it or duplicate the one-liner).
- Mutation path: `deckSetGraphicsOption` (already in
  `deck-edit-actions.ts`) with the scrub pattern from the ground rules
  for live preview during the drag and ONE recorded action on release.
  Min size clamp: don't let the factor go below 0.02.

Tests: unit — none needed beyond what exists for
`deckSetGraphicsOption` unless you add a helper (then test it). e2e:
select the fixture's `\includegraphics[width=0.8\linewidth]{…}`
(corpus fixtures under `test/fixtures/beamer/` have one; the e2e
SOURCE can inline its own), drag a corner by a known delta, assert the
source now has a smaller/larger factor and STILL ends in
`\linewidth`; undo restores the original text exactly.

---

## Brief C — Column divider drag

Doc: "Stage 3c — direct manipulation" (column divider drag — "rewrite
both adjacent coefficients preserving their sum").

- Trigger: with a `"column"` object selected — or on hover over the
  gap between two adjacent column objects (object index `columns` node
  children, in order) — show a vertical divider affordance with a
  col-resize cursor.
- Core: add a `deckSetColumnPairWidths` action to
  `packages/core/src/beamer/deck-edit-actions.ts` — `{kind, frameId,
  leftObjectId, rightObjectId, leftValue, rightValue, leftSuffix,
  rightSuffix}` — that rewrites BOTH columns' width arguments in one
  `EditActionResult` (two `SourcePatch`es through the existing
  `finishEdits` machinery; model it on `applySetColumnWidth`). Add the
  kind to `DECK_EDIT_ACTION_KINDS`; the reducer's `isDeckEditAction`
  branch then handles history ("set-property") and
  `changedSourceIds ?? []` automatically — verify, don't assume.
  Refuse (unsupported) when either column has no authored width
  argument (v1: divider only appears when both widths are authored).
- Drag math: px delta → fraction delta via the columns environment's
  rendered width (bounds of the `columns` parent object). left' =
  clamp(left + delta, 0.05, sum − 0.05); right' = sum − left' EXACTLY
  (compute right from the clamped left before formatting, so the sum
  is preserved up to the 4-decimal formatting of each side). Each side
  keeps its OWN suffix (`\textwidth` vs `\linewidth` may differ).
- Preview/commit: the standard scrub pattern (ground rules).

Tests: unit in `test/beamer-deck-edit-actions.spec.ts` — pair action
rewrites both value spans, preserves suffixes and sum, refuses on a
wrong `frameId` and on a missing width. e2e: drag the divider in a
two-column fixture, assert both coefficients changed, sum still equals
the original (parse the two numbers), single undo restores both.

---

## Brief D — Structural stragglers (first-item Backspace, Enter with selection)

Doc: "Structural keys (canvas focus)". Two deliberate gaps from Stage
2c, now to be closed:

1. **Backspace at the content start of a FIRST item** currently
   returns `"swallow"` (`beamerStructuralBackspacePatch`,
   `packages/core/src/beamer/structural-edit.ts`, `index === 0`
   branch). Desired: dissolve the item back into prose — exactly the
   same-environment branch of `beamerStructuralListTogglePatch`
   (`dissolveItemPatch`, same file — not exported; export it or call
   the toggle patch with `context.list.environment`). The
   paragraph-break-preserving boundary removal (`boundaryRemovalEdit`)
   must be reused, not reimplemented. Keep the existing guards: only
   at `contentSpan.from`, not inside math. Extend
   `test/beamer-structural-edit.spec.ts`: Backspace at the start of
   the first item dissolves it above the list (blank line kept when
   the previous line is prose); Backspace at the start of a LATER item
   still merges into the previous item (existing behavior, existing
   test must stay green).

2. **Enter with a non-empty selection** inside one item currently
   swallows (`handleCanvasStructuralKey` in
   `packages/app/src/ui/canvas-panel/useCanvasTextEditSession.ts`,
   `if (hasRange) return swallow()` under `isEnter`). Desired:
   delete-then-split in one keystroke and one undo step. Scope
   STRICTLY: both selection ends inside the SAME item's `contentSpan`
   (use `beamerListItemAt` on both document offsets; identical item)
   — otherwise keep swallowing. Implementation: compute
   `beamerStructuralEnterPatch(domain, selectionStartOffset)`; if it
   returns a patch, prepend a `{span: [start, end), insert: ""}` edit
   for the selected range. The split-point insertion produced by the
   enter patch lands at or before `start` and the deletion is
   after it, so the edits do not overlap — assert this defensively
   and fall back to swallow if they do. Apply through
   `sessionTextAfterStructuralPatch` + `applyTextEditBufferReplacement`
   like the other structural keys (the staleness guard then covers the
   combined edit list). e2e: select a word mid-item, press Enter,
   assert the item split at the selection start and the selected text
   is gone; single Cmd+Z restores it.

---

## Brief E — Stage 4 gap-closing minis

Doc: "Stage 4 — gap closing". Four independent items; take them as
separate commits (or separate sessions). Each is
investigate-then-implement: the pointers below are entry points, not
full designs — read the code first.

- **E1: `\vfill` glue distribution.** Frame flow currently reserves
  fixed heights for vertical-space items; `\vfill` (and multiple
  `\vfill`s) should distribute the frame's free height by fill weight,
  like the title-page template's `leadingFillWeight`/
  `trailingFillWeight` already do. Entry points:
  `packages/core/src/beamer/frame-flow.ts`
  (`positionPreparedFrameFlow`) and the vertical-space handling in
  `render.ts`. Also: a column-level inline `\vfill` currently aborts
  its chunk — find the fallback and fix or diagnose it. Oracle: the
  frame-compare trace harness (`scripts/lib/beamer-frame-compare.mjs`,
  `test/beamer-frame-oracle.spec.ts`) — add a fixture with
  `text \vfill text \vfill text` and compare against real beamer
  geometry if the oracle flow supports it; at minimum assert the gaps
  are equal and fill the page.
- **E2: description labels.** `description` environments parse
  (`SimpleTexListKind` includes it; items carry `labelSpan`) but the
  label is not rendered as beamer does (bold/structure-colored label,
  hanging layout). Entry: the list profiles and marker resolution in
  `packages/core/src/beamer/theme/` (`resolveBeamerItemizeMarkers`,
  list layout profile) and the item label handling in
  `text/tex/ir.ts`. Editing the label text should fall out of the
  session buffer (it's in-span source); verify the caret domain treats
  the label as editable text, and add a caret-stop test if it does
  not.
- **E3: frame subtitles.** `scanBeamerDocument` already captures the
  subtitle; no headline template renders it. Default beamer shows the
  subtitle below the title in the frametitle template (smaller font,
  same color box). Entry: `planBeamerFrameChrome` in
  `packages/core/src/beamer/theme/` and the frame-title layout item
  emission in `render.ts` (there is already a
  `"frame-subtitle"` layout item kind reserved in `types.ts` — wire
  it). Make the subtitle a text-editable paragraph like the title
  (edit scope inventory in `edit-scopes.ts`).
- **E4: consume `caretPolicy: "filename-linear"` for graphics.** The
  ENGINE side already exists: graphics placements publish
  `caretPolicy: "filename-linear"` with the filename's source span
  (`packages/core/src/text/tex/layout-inline-items.ts:1281`, carried
  through `packages/core/src/beamer/types.ts:388` and
  `render.ts:693`). The APP side ignores it: the atomic-render span
  collection (`collectBeamerAtomicRenderSpans`, `render.ts:3358`) and
  the caret-stop domain (`buildBeamerCaretStopDomain`,
  `packages/core/src/beamer/caret-stops.ts`) treat the whole
  `\includegraphics[...]{...}` as one atom, so clicking it selects the
  atom instead of placing a caret in the filename. Implement
  consumption: per-character caret stops inside the filename span,
  atomic behavior for the rest of the command. Follow the precedent of
  how math islands vs text runs are distinguished in
  `BeamerEditableTextSpan` (`types.ts:319`). Add a caret-stops unit
  test (`test/beamer-caret-stops.spec.ts`) asserting per-character
  stops inside the filename and atomic stops around the option list.
