# One vertical-list builder for text, lists and Beamer containers

Status: in progress (2026-11-22). Steps 1–3 and the display stage done; Beamer containers next (see "Progress" and "Next"). Survey and evidence: `design/engine-survey/`. TeX references:
`tex-src/` (see `tex-src/README.md`).

## Problem

Vertical spacing between paragraphs, lists, alignments, displays, blocks,
columns and pictures is computed in four places:

1. `text/tex/vlist/spacing.ts` (2,700 lines) plans the skip before each
   paragraph of one TeX layout.
2. `beamer/render.ts` `prepareFrameFlow` + `frame-flow.ts`
   `positionPreparedFrameFlow` stack frame-level flow items.
3. `render.ts` `prepareColumnContent` / `prepareColumnFlowNode` stack a
   column's items.
4. `render.ts` `prepareBlockWithTheme` stacks a block body's items, with
   per-style (`default` / `rounded` / …) end handling.

All four approximate the same LaTeX mechanism, each from a different subset of
information, so a fuzz case typically finds a rule present in one path and
missing in another (see the fix table in
`design/engine-survey/vertical-spacing.md`).

Two structural causes:

- **Lost events.** `text/tex/ir.ts` walks the source in order and knows exactly
  where `\begin{itemize}`, `\item`, `\end{center}`, `\color`, `\par` occur, but
  emits only paragraph/glue/display/box items; lists, items and trivlists
  survive only as `scopePath` / `listContext` / `ancestorListLabels` on each
  paragraph. `spacing.ts` reconstructs what happened between two paragraphs by
  diffing those, keeping ~20 fields of history.
- **Split containers.** A Beamer frame body is cut into flow items (paragraph,
  block, columns, tikzpicture, …) that are laid out independently and stacked
  with scalar `leadingSkipPt` / `trailingSkipPt` / `afterSkipPt` fields and
  source-regex adjustments. Blocks and columns nested inside list paragraphs
  take a second route ("inline flow", external-flow hboxes) that needs a
  fixed-point loop to resolve which item label a box consumes.

## Goal

A single `VerticalListBuilder` that performs LaTeX's vertical-mode operations in
source order, used for every vertical container: a plain text box, a frame
body, a block body, a column, a minipage. Containers nest; a child container is
built when the parent reaches it, and returns a box.

Non-goals for this project: horizontal layout and line breaking (unchanged:
the builder receives laid-out paragraph lines), math layout, page/frame
breaking, PGF.

## The TeX model the builder implements

State (names follow LaTeX; values are `TexGlue` with natural/stretch/shrink, in
sp-rounded pt):

| State | Meaning | Source |
| --- | --- | --- |
| tail of the list | last item, `\lastskip`, `\lastpenalty` | tex.web §424 |
| `prevdepth` | depth of last box, or "ignore" (−1000pt) | tex.web §679 |
| `baselineskip`, `lineskip`, `lineskiplimit` | current registers | tex.web §679 |
| `parskip` | current paragraph skip (`\parsep` inside lists) | |
| `@outerparskip` | parskip outside the innermost list | latex.ltx 12780, `\list` 12806 |
| per list level: `@topsepadd`, `@topsep`, registers (`topsep`, `partopsep`, `itemsep`, `parsep`) captured at `\list` | | `\@trivlist` 12829 |
| flags `@inlabel`, `@noparlist`, `@noparitem`, `@newlist`, `@nobreak`, `@endpe`, `@minipage` | | latex.ltx 12806–12950, 13230 |

Operations (each method cites its macro):

- `addvspace(g)`: `\addvspace` / `\@xaddvskip` (latex.ltx 7504–7530): if
  `\lastskip` is zero append `g`; else keep the larger, replacing the tail skip
  (with LaTeX's negative-skip rules).
- `addpenalty(p)`.
- `startParagraph(lines)`: append `parskip` glue unless suppressed (`@minipage`
  at the start of a minipage, `\if@nobreak`), then interline glue before the
  first line: `baselineskip − prevdepth − height` if ≥ `lineskiplimit`,
  else `lineskip` (tex.web §679); same between lines (already done by the
  paragraph builder); set `prevdepth`.
- `box(b)`: interline glue as above, append, set `prevdepth = b.depth`.
- `listBegin(registers)`: `\list` + `\@trivlist`: compute `@topsepadd`
  (+`partopsep` when in vertical mode), set `@noparlist` from `@inlabel`,
  `@outerparskip := parskip`, `parskip := parsep`, push level.
- `item(label)`: `\@item` (12921): `@noparitem` → `\@donoparitem` (12909:
  `lastskip + @outerparskip − parskip` unless `@minipage`); else
  `@newlist` → `addvspace(@topsep)`, `addvspace(−parskip)`; else
  `addpenalty(itempenalty)`, `addvspace(itemsep)`; set `@inlabel`.
- `trivlistBegin(kind)` for center/flushleft/flushright/quote/verse…:
  `\trivlist` (12861) = `\@trivlist` with an implicit `\item[]`.
- `listEnd` / `trivlistEnd`: `\endtrivlist` (12873): flush `@inlabel`,
  `\par`; unless `@noparlist`: if `lastskip > 0`, replace it with
  `lastskip + parskip − @outerparskip`; then `\@endparenv` (12895):
  `addpenalty(endparpenalty)`, `addvspace(@topsepadd)`, `@endpe`.
  Restore the outer level.
- `display(above, below, short)`: the display's own skips (tex.web §1199ff,
  `\predisplaysize` short-skip test §1146); the empty-line paragraph when a
  display starts in vertical mode.
- `whatsit()` (`\color`, specials, marks): append a non-glue node, so the
  next `addvspace` sees `lastskip = 0`.
- `vskip(g)`, `penalty(p)`, `nointerlineskip()`, `sizeChange(registers)`,
  `groupBegin()` / `groupEnd()` (save/restore register values; `\small` etc.
  reinstall the size's `\@listi` values: `size1x.clo`, beamer's
  `beamerbaselocalstructure.sty` 150–170; `squeeze`/`shrink` install
  `\beamer@cramped` = `\itemsep0pt\topsep0.5pt`, `beamerbaseframesize.sty` 21–35).

Container semantics:

- **Minipage-like container** (Beamer column = `minipage` + `\leavevmode` +
  `\beamer@colheadskip`, `beamerbaseframecomponents.sty` 202–268; block body;
  `\parbox`): `@minipage` true at start, column's `\leavevmode` starts an
  empty paragraph; at end `\par\unskip` (`\endminipage`, latex.ltx 13269),
  box height/depth from the vlist (`\vtop`/`\vbox`/`\vcenter` per alignment).
- **Frame body**: the frame's vbox, `[t]`/`[c]`/`[b]` packing, `\vfill`,
  shrink scale computed from the built box.
- **Block**: template chrome (title box, body container, before/after skips)
  around a minipage-like body. The template geometry stays in
  `theme/blocks.ts`; the body is a nested builder.

Label transfer becomes sequential: when a parent reaches a child container
while a label is pending (`@inlabel`), it passes the pending label into the
child build, and the child reports whether it consumed it. No fixed point.

## Event stream from the IR

`ir.ts` already handles these points in order (`environment-boundary`
begin/end around line 5510, item commands, `\par`, size declarations, box
items). Add a `SimpleTexVerticalEventItem` to `SimpleTexBlockItem`:

```ts
type VerticalEvent =
  | { kind: "list-begin"; list: SimpleTexListContext; registers: ListRegisters }
  | { kind: "item"; list: SimpleTexListContext }
  | { kind: "list-end"; list: SimpleTexListContext }
  | { kind: "trivlist-begin" | "trivlist-end"; env: "center" | "flushleft" | "flushright" | "quote" | "quotation" | "verse" }
  | { kind: "par" }
  | { kind: "whatsit"; reason: "color" | "special" }
  | { kind: "size-change"; registers: SizeRegisters }
  | { kind: "group-begin" | "group-end" };
```

Each event carries its `sourceSpan` for diagnostics and the shadow diff.
Paragraphs keep their current fields; the scope fields remain during
migration and are deleted at the end.

Beamer frame and column bodies use the same IR, with blocks, columns,
pictures, title pages and contents as box items resolved by a callback (the
existing `resolveBlockBox` hook generalized), replacing frame-level flow
segmentation.

## Migration

1. **Events, no behavior change.** Emit events from `ir.ts`; lower them through
   `lower-simple.ts` as zero-size marker items. Add a debug dump
   (`TIKZ_VLIST_TRACE=1`).
2. **Builder in shadow mode.** Implement `VerticalListBuilder` with unit tests
   per LaTeX macro (constructed event sequences vs hand-derived TeX values,
   cross-checked with tiny LuaLaTeX probes). Run it next to `spacing.ts` on
   plain TeX layouts and record per-boundary skip differences. Diff harness
   over: `test/beamer-fuzz-spacing.spec.ts` sources, fidelity fixtures,
   regression manifests and a fixed set of fuzz seeds. Every difference is
   classified: builder bug, old planner bug (check TeX), or missing event.
3. **Cut over plain text layouts** (non-Beamer `layoutSimpleTex` users) once
   the diff is clean or each residual is a confirmed old-planner bug.
4. **Block bodies and columns** as nested builders; delete per-style end
   handling, `trailingScopedBeamerListSkip`, `trailingBeamerTrivlistSkip`,
   `startsWithTrivlist`, the column interline/clamp code, `externalAfterSkip` /
   `externalPendingParskip`.
5. **Frame body** as one builder; remove `positionPreparedFrameFlow`'s glue
   rules, frame flow segmentation and the inline-flow fixed point.
6. **Displays** move fully into the builder (abovedisplay/short test, empty
   line, `\par` after display); delete display branches in `spacing.ts`.
7. Delete `spacing.ts`'s planner and the scope-diff state.

Gates at every step: `npm run typecheck`, `npm run lint:prod`, beamer + tex
vitest suites, `compare:beamer-fuzz-regressions`, a structural-only fuzz sweep
over a fixed seed set (failure count must not rise), and the corpus tests.

## Risks and open questions

- **Paragraph builder coupling.** The seam for plain layouts is
  `vlist/prepare-simple.ts`: `materializeParagraphVerticalGlueInVList` inserts
  the planned skips as glue items before paragraphs, display glue is added by
  `materializeDisplayMathVerticalGlueInVList` /
  `resolveDisplayMathVerticalGlueInVList`, and `layoutTexVListItems` applies
  the baseline/`\lineskip` rule with measured paragraphs. The shadow builder
  produces the same glue items at that seam and is compared per paragraph
  `blockIndex`. Display skips depend on measured `\predisplaysize`, so the
  display part of the builder runs at the `resolveDisplayMath…` stage.
- **Stretch/shrink.** Frame shrink and `[c]`/`[b]` packing depend on glue
  flex; the builder must keep natural/stretch/shrink, not just naturals (the
  current planner already tracks some flex).
- **Overlays.** Hidden material still occupies space (`\visible`, `\uncover`)
  or is removed (`\only`); events must respect the existing overlay
  projection, which runs before the IR.
- **Edit mapping.** Source maps and caret stops rely on current item identity
  (`blockIndex`, `vlistPath`); keep these stable or update consumers.
- **Performance.** Sequential nested builds replace a fixed-point loop, which
  should help; measure with the slide-switch profiling scripts.

## Progress

- **Step 1 (events)**: `ir.ts` records `SimpleTexVerticalEvent`s: list/item/
  trivlist/quote begin and end, `\par`, groups, list register assignments, and
  each list's font size and register depth (`test/tex-vertical-events.spec.ts`).
- **Step 2 (builder, shadow)**: `vlist/vertical-builder.ts` implements the
  macros above (`test/tex-vertical-builder.spec.ts`).
  `vlist/vertical-shadow.ts` replays a raw vlist plus events through it
  (`computeVerticalBuilderSkips`) and compares per top-level item with the old
  planner (`VLIST_SHADOW=1 npx vitest run test/vertical-shadow.spec.ts`). Over
  all fidelity fixtures: 2 of 4,513 inner items differ (both package
  environments the IR emulates: `lstlisting`, a starred table caption); 24 of
  2,181 first items; 62 of 1,230 items next to displays.
  Mechanisms confirmed on the way: Beamer lists push a color before `\list`
  (the pop precedes `\@endparenv`'s glue, per LuaLaTeX `\showlists`); a block
  whose first paragraph runs `\everypar` places pending labels inside itself;
  `\beamer@cramped` sets `\topsep` after `\list` captured its skips, so a
  nested alignment reads the cramped value.
- **Step 3 (first layer)**: for inner top-level items whose natural skip the
  builder reproduces, the glue's stretch/shrink now come from the builder
  (`materializeParagraphVerticalGlueInVList`). All suites and the fuzz
  regression manifest pass.

- **Layout stage (displays, baseline glue)**: `vlist/vertical-layout.ts`
  replays the measured vlist and the events through the builder and replaces
  `resolveDisplayMathVerticalGlueInVList` for documents with events
  (default; `VLIST_LAYOUT=0` restores the old path). The builder tracks
  `\prevdepth` and appends baseline/lineskip glue (tex.web §679); displays
  take the normal/short above skip from `\predisplaysize`, the below skip
  follows that variant, and horizontal mode resumes after the display;
  display alignment rows and `\intertext` keep their own glue. Also added:
  `whatsit` events for vertical-mode `\color`; list events carry the
  register font size (Beamer selects a nested list's body font, e.g.
  `\small`, before `\list` reads `\@listi`); `quote`/`quotation` are lists;
  `thebibliography` has zero itemsep/topsep/partopsep and no color;
  `\partopsep` only after an explicit `\par` (LuaLaTeX). Across all fidelity
  fixtures the natural glue equals the old resolution (`VLIST_COMPARE=1`
  prints per-item differences); stretch/shrink differ in 471 places where TeX's
  glue arithmetic now carries over (e.g. a zero-size `\parskip` with 1pt
  stretch). Piece edges (glue before the first and after the last material of
  a frame piece, block body or column) and material vboxes still come from the
  old resolution, which is why the old planner still runs.

## Next

1. **Beamer containers (step 4), chained builders.** An experiment that
   stopped extracting top-level blocks and columns into separate frame pieces
   (sending them through the inline-flow path as external boxes) broke 439
   Beamer tests: frame pieces carry geometry, overlay and emission behaviour
   the inline path does not reproduce, so a single vlist per frame body is a
   later step. Instead, keep the pieces and run one frame-level builder over
   them in order: each paragraph piece exposes the builder operations its
   layout replayed (events and leaves with metrics); blocks, columns, pictures,
   vertical space and title pages become builder operations from their beamer
   templates (block begin `\par\vskip\medskipamount`, end `\vskip\smallskipamount`;
   column `minipage` + `\leavevmode`; a picture paragraph). Piece positions come
   from the frame builder, replacing `positionPreparedFrameFlow`'s glue,
   `leadingAdjustment`, `sharedTrivlistSkip`, `trailingListGlue` /
   `trailingScopedBeamerListSkip`, `trailingBeamerTrivlistSkip` and the
   column/block-body stacking rules. Columns and block bodies are nested
   frame-level builders with `minipage: true`.
2. **Material vboxes** (`\parbox`, `minipage` in text): pass the box body's
   IR events through `rebaseSimpleTexBoxBody` and build them as nested builders.
3. **Delete** `planSimpleTexParagraphVerticalSkips`'s scope-diff state,
   `materializeParagraphVerticalGlueInVList`'s planning and
   `resolveDisplayMathVerticalGlueInItems` once no caller needs them. Until
   then the layout stage also runs the old resolution for piece edges, which
   costs one extra pass per layout.
