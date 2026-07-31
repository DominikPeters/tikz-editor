# Beamer Canvas Editing UX

Decided 2026-07-30 in design discussion. This document specifies the slide
canvas editing model for deck mode and supersedes the one-paragraph Phase B3
sketch in `design/beamer-editor.md`. It assumes the rendering, source-map,
caret, and hit-map infrastructure described there; it changes interaction
architecture, not the rendering pipeline.

Revised the same day after an external implementation review whose findings
were independently verified against the code and by direct experiment (see
Core prerequisites and the masking section): the UX model stands, but the
original staging understated the infrastructure work, and one masking
assumption was demonstrated to be wrong.

## Diagnosis of the current state

The first beamer canvas text editing slice (commit 78923231) bound an editing
session to a `BeamerEditableTextSpan`: a maximal source-contiguous run of
caret-policy text/space segments inside one paragraph
(`packages/core/src/beamer/render.ts`, `collectBeamerEditableTextSpans`).
Because a run is cut by every soft line wrap, every `$…$`, every inline
command, every `\item`, and every macro use, the user experiences editing
that "stops" at invisible boundaries. Clicking past the run's edge threw an
unhandled rejection (`documentOffsetToTextarea` out of range) that froze the
caret. The session surface was a visible one-line popup textarea in
`inline-typo` mode (Enter closes, no newlines).

The diagnosis: the *session scope* and the *input surface* were wrong; the
pipeline below them is right and is kept unchanged. In particular:

- `MathCaretEntry` carries per-source-offset caret geometry (x, y, height,
  depth) inside rendered math, consumed by both `getKnuthPlassCaretFromPoint`
  and `getKnuthPlassPointFromOffset` — click-into-math and caret-drawn-in-math
  both already work in the TikZ node path.
- Partial input degrades locally: unknown or half-typed commands render as
  literal runs at the smallest boundary (`ir.ts` malformed-input literals,
  `partialFallbackSupported`), and the structural mask keeps the frame parse
  stable while a span is being edited.
- Span patches, session-local undo merged into one store step, and the
  ≤50 ms/keystroke latency gate all carry over.

The TikZ node model — popup as raw-TeX buffer, canvas as live view with a
true caret — is the validated architecture. Deck editing generalizes it; it
does not replace it. TikZ node editing itself is unchanged by this document.

## Core model

### One session per scope; the buffer is the scope's full source span

An editing session opens on click into slide text. Its buffer is the entire
source span of the caret's **scope** (defined below) — not a fragment. All
text, inline math, display math, commands, braces, and macro calls inside the
scope are in-buffer. There are no session hops while the caret stays in
scope, and no click inside the scope can fall outside the buffer (the
out-of-range failure class is eliminated by construction).

### Scope rule

The scope is the nearest *container* ancestor of the click:

1. a `column`'s content;
2. the frame title argument (`\begin{frame}{…}` / `\frametitle{…}`);
3. otherwise the whole frame body.

Rationale, grounded in the KKT fixture
(`test/fixtures/beamer/kkt_theorem_beamer.tex`):

- Frame 3 ("Problem form and notation") is one continuous no-blank-line flow
  of text, display math, and `\vspace` — any finer unit would recreate the
  seam problem. Scope = whole body keeps it seam-free.
- Frame 2's columns are spatial regions sitting side by side. Arrow keys
  clamping at a column edge matches PowerPoint (arrows never leave a text
  box), and "flowing" into a column that is *beside* the caret would be
  spatially wrong. Scope = column content.
- **Blocks are transparent to the caret**, not scope boundaries (decided
  2026-07-30, revisitable). A block is decorated flow, usually mid-thought
  with its surrounding paragraphs ("The theorem" frames: block → paragraph →
  itemize is one train of thought). Blocks remain fully selectable objects
  via their chrome. Columns are spatial; blocks are flow — that distinction,
  not size, decides scopehood. Transparent is also the reversible choice.
- Theorem-family environments follow blocks (transparent).
- Lists are not scopes; items are flow with structural key semantics.

Scope bounds the source surface's window. It does **not** bound the
structural mask: masking any scope that contains nested structure destroys
flow topology (see Masking and structural recovery), so mask and session
span are independent for *every* scope type.

**Preamble-backed fields** are the one genuinely separate session kind: on a
`\titlepage` frame, clicking a rendered metadata field opens a session whose
buffer is the corresponding preamble argument (`\title{…}` etc.). Same
machinery, different span. Current gap: `prepareTitlePage` lays out only
title and subtitle as source-backed paragraphs; author, institute, and date
must become source-backed rendered paragraphs before they are clickable.
The scope rule explicitly covers subtitle, institute, and `\framesubtitle`
alongside the fields named above.

### Two surfaces, one buffer; focus picks the key interpretation

A session has two synchronized surfaces:

- the **canvas**: the rendered slide with a caret and selection overlay;
- the **source surface**: a raw-TeX text field showing a window of the
  buffer. Placement is a user setting: **docked bar** (Excel-formula-bar
  style strip on the canvas edge; ~5–8 lines, auto-scrolled to keep the
  caret visible) or **floating popup** (anchored near the edited text,
  showing the caret's enclosing chunk). Same component, different anchoring.
  The iPad default should be the bar (popup and software keyboard fight for
  space).

The floating popup does not scale to whole-body scopes (a 20-line KKT
frame 3 buffer would occlude half the slide): above a small buffer-size
threshold the popup placement auto-falls-back to the docked bar. The
placement setting is honored for column/title scopes and small bodies.

Both surfaces edit the same buffer and share one caret/selection. Keyboard
focus determines how navigation and structure keys are interpreted:

| | Canvas focused (WYSIWYG keys) | Bar focused (source keys) |
| --- | --- | --- |
| typing | insert literal chars at caret | insert literal chars at caret |
| ←/→ | rendered caret stops: atomic over `\textbf{`, macro calls, ligature interiors; per-atom inside math | one source character |
| ↑/↓ | rendered lines | source lines |
| Enter | structural (table below); no-op in math | newline in source |
| Backspace | previous rendered atom; objects and glue select-then-delete | one source character |
| Tab | list indent/outdent | literal / focus move |
| Cmd+B, Cmd+I, … | wrap/toggle selection | same |

This is the resolution of the "two modes" question: the modes exist, but as
a focus state the user flows through constantly (Excel's cell vs formula
bar), not a persistent setting. The bar being always visible during a
session is what makes canvas-focused editing safe: `\textbf{bold|}` vs
`\textbf{bold}|` collapse to one canvas caret stop (defaulting **inside**,
so typing continues the style — decided 2026-07-30), and the bar shows which
side of the brace the caret is really on. A half-typed `\rightarr` while
canvas-focused renders as a literal run on the slide and as correct source
in the bar.

**Safety property (deliberate):** the two modes agree on plain typing.
They differ only in navigation and structure keys, and the worst misread
(Enter in the bar when an item split was intended) inserts a harmless,
undoable newline. Focus indicators are for fluency, not damage prevention.

Focus gestures: click slide text → canvas focus; click into the bar (or
Cmd+E) → bar focus at the same caret; Esc from the bar → canvas focus.
(Exact chords to be finalized; consider F2 for Excel muscle memory.)

### Focus indication

1. **Only the focused surface blinks.** The unfocused surface shows a
   static, lower-contrast caret at the same position.
2. **Selection color**: accent in the focused surface, gray in the
   unfocused one (macOS active/inactive convention) — the selection is
   visible in both, ownership is visible by color.
3. **Focus ring** on the bar when hot; slightly dimmed bar chrome when not.
4. **PPT edit border on the canvas**: canvas focus draws PowerPoint's dashed
   text-edit outline around the scope container (column or body); a selected
   object draws a solid outline; bar focus drops the dashed outline to a
   faint state. The dashed border doubles as scope visualization — the user
   can see where arrow keys will clamp.

### Caret mapping details

- Clicks map through the existing hit maps, including `mathCaretEntries`
  (subscript-level positions inside math work).
- Macro output: the caret cannot enter an expansion (`macro` policy);
  clicking rendered macro output selects the macro *call*'s span in the
  buffer, visible in the bar. Typing replaces the call. (Strictly more
  capable than the previous drop-macro-spans-entirely behavior.)
- Zero-width syntax (braces, `%`, declarations like `\Large`): the canvas
  caret sits at the collapsed visual stop with inside preference; the bar is
  the disambiguator. Ligature/kern interiors keep the existing skip policy.
- Overlay steps: the caret domain per step excludes source hidden on the
  current step (the hidden-span filter already does this). A ghosted
  "show covered content" view (Beamer's `transparent`) is a later toggle.

## Structural keys (canvas focus)

| Caret context | Enter | Source patch |
| --- | --- | --- |
| inside an `\item`'s text | split into new item | insert `\n<indent>\item ` (indent copied from neighbor) |
| in an empty item | delete item, exit list | remove `\item`; remove the env if now empty |
| ordinary paragraph text | paragraph break | blank line |
| inside display/inline math | no-op (v1) | — |
| frame title argument | no-op or jump to body start | — |
| Shift+Enter in text | line break | `\\` |

- **Backspace at item start**: merge with the previous item — remove
  `\item` plus surrounding newline/indent and join with a single space
  (whitespace repair is part of the patch; the source stays idiomatic).
- **Backspace/arrow onto a non-text flow object** (`\vspace`/`\vfill`/glue,
  embedded tikzpicture, `\includegraphics`): first press *selects* the
  object — glue renders as a thin highlighted band labeled with its source
  (e.g. `\vspace{.3em}`) — second press deletes its span. Select-then-delete
  is the Word convention and is also the discoverability answer for vertical
  glue (160 corpus uses of `\vspace`).
- **Tab/Shift+Tab** in an item: nest/unnest one itemize level (wrap/unwrap
  a nested `itemize` around the item).

## Selection: three tiers

1. **Bar selection is free.** Any source range, balanced or not — the user
   sees raw source and is trusted (same as TikZ nodes today).
2. **Canvas drags within continuous text snap to construct boundaries.**
   Extending the existing math-delimiter snapping to display math, command
   groups, and macro calls: a drag from prose into a display selects the
   whole `\[…\]`. Result ranges are always balanced; deletion is safe.
   Text→text crossings within one scope all work, including across display
   math and glue.
3. **Canvas drags crossing container boundaries promote to whole-node
   object selection.** Endpoints round outward until they are siblings:
   mid-item-1 → mid-item-3 selects items 1–3 (deleting all items removes
   the env); prose → block-body selects {paragraph, block}; column →
   column selects whole columns (Word table-cell rule). Tier-3 selections
   render as object outlines, not text highlight — the user sees they are
   about to operate on structure. Body ↔ frame title drags clamp (the title
   is a template area, not flow).

## Object layer

Objects are selectable structural nodes with published hit geometry and
stable ids (the object-layer analog of `BeamerEditableTextSpan`). They are
never in front of text: clicking text always yields a caret; objects are
selected by clicking chrome/non-text renders, via Esc, or via caret
traversal (select-then-delete).

- **Esc ladder**: caret → containing object (item → list → block → column)
  → clear. Enter/F2 drills back in.
- **Blocks**: click chrome → select; inspector: type dropdown
  (block/alertblock/exampleblock — env rename patch), title field, overlay
  spec; Delete / Cmd+D duplicate; drag-reorder in flow later.
- **`\includegraphics`**: corner resize handles in v1 — the graphics IR
  already retains per-option key/value spans precisely so a resize adapter
  can rewrite only the authored value. Corner drag rewrites
  `width=0.63\textwidth`, preserving the symbolic `\textwidth`-relative
  form; aspect preserved by leaving `height` unset.
- **Columns**: hover the inter-column gap → col-resize cursor spanning the
  column height; drag with live re-layout; on release rewrite *both*
  adjacent width coefficients preserving their sum (`.55/.42` → `.48/.49`),
  rounded to two decimals, symbolic form preserved. With three columns each
  divider touches only its two neighbors. Inspector holds the exact numeric
  field.
- **Embedded tikzpictures**: click → select (inspector shows `scale=`/
  `\scalebox` value when present — same retained-span rewrite);
  double-click or Enter on the selected picture → the nested figure
  editor with a breadcrumb back to the slide ("Slide 4 ▸ Figure"); Esc
  returns. Design settled 2026-07-31 — see "Nested TikZ figure editing"
  below. In-place editing stays deferred (Phase B5); the breadcrumb keeps
  the interaction grammar stable when it lands.
- **Vertical glue**: selectable via caret traversal / backspace, and
  **discoverable by hover** (decided 2026-07-31, superseding the earlier
  no-hover-target lean): moving the pointer through the gap reveals a
  faint band; clicking it selects the glue. The selected state is the
  labeled band (label = the source command). Covers the whole
  vertical-space family the engine already parses — `\vspace`,
  `\smallskip`, `\medskip`, `\bigskip`, `\vfill`.

Foundation vs gaps: `BeamerFrameLayoutItem` already publishes stable ids,
parent relationships, source spans, and bounds for columns, blocks,
graphics, and TikZ, and graphics retain parsed option metadata — the
geometry side is largely present. Missing for editing: column content and
width-*value* spans in the app-facing layout, block env/title/overlay edit
metadata, explicit list/item object nodes, deck-specific edit actions
(generic `APPLY_EDIT_ACTION` is deliberately rejected for Beamer documents
today) with selection state, and topology-preserving duplicate/delete
adapters. Stage 3 is therefore a real workstream, not wiring.

**Stage 3a is implemented** (selection foundation). Core: a per-frame
object index (`packages/core/src/beamer/object-index.ts`) publishes
selectable nodes for blocks, columns environments, columns, graphics,
embedded tikzpictures, lists, and items — env/atom kinds from the frame
layout items, list/item nodes synthesized from the engine's published list
topology with bounds unioned from caret-stop rows plus the item's marker
box. Parent links are computed uniformly from source-span nesting, which
is exactly the Esc ladder order; `beamerObjectAtOffset` gives the
innermost node for the caret→object rung. List markers carry the label
hbox's source range (the whole list), so marker→item association is
geometric (the item on whose first rendered line the marker sits) and
published as `objectIdByMarkerId`. Deletion/duplication are pure patch
builders in `structural-edit.ts` (`beamerObjectDeletionPatch` /
`beamerObjectDuplicationPatch`): line-extent removal with promotion rules
(only item → whole list env, only column → whole columns env), duplication
inserts the line-extent copy below and reports a `selectSpan` for
reselection. App: `deckObjectSelection` lives in ephemeral store state
(cleared automatically whenever a text session starts); canvas-focus Esc
hands the caret's document offset to the panel, which selects the
innermost containing object before the session closes and refocuses the
viewport; further Escs walk `parentId`; Enter/F2 drills back in (first
caret stop inside the object, or the whole atom span for
graphics/tikzpictures); Delete/Backspace and Cmd/Ctrl+D dispatch the
patches through `APPLY_SOURCE_PATCHES` (store history undo works; both
edits are refused while `snapshot.source !== source`, the layout-staleness
guard); after a duplicate the copy is reselected by matching the object
whose span *starts* inside the inserted range once the snapshot catches
up. Click layering per the invariant above: block/columns/column chrome
regions render *under* the deck text regions (text always wins),
graphics/tikz/marker regions render *on top* (clicking a non-text render
selects the object; the stage-1c click-to-select-atom-span behavior moved
one keystroke away, behind Enter). The selected object shows a dashed
outline (`deck-object-selection` overlay). Implementing 3a fixed a core
publishing gap: block bodies laid out lists without the theme list profile
(default margins, no marker metadata), so lists inside blocks published
no `list-marker` layout items — block bodies now pass
`beamerListLayoutProfile(theme)` like frame flow, and `emitPreparedBlock`
emits the body's markers. Gotcha for future click handlers:
`onBackgroundClick` fires on both the interaction svg and the viewport
div, and the first invocation consumes `suppressNextBackgroundClickRef`,
so background-clearing logic must also require
`event.target === event.currentTarget`. Still open for 3b/3c: inspectors
(block type/title/overlay, column width, image, embedded tikz), graphics
resize handles, column divider drag, glue bands, tier-3 drag promotion,
the nested-TikZ compute-mode branch for the breadcrumb, and deck edit
actions beyond delete/duplicate — split into Stages 3b/3c under Staging
below.

## Nested TikZ figure editing (settled 2026-07-31, not yet implemented)

Entering an embedded `tikzpicture` turns the canvas into the *real* TikZ
editor on that picture — scene, edit handles, drag, snapping, the TikZ
inspector and styles cascade — scoped to the picture's source span inside
the deck document. This is Stage 3c's largest item; the design below was
discussed and settled with Dominik; implementation is deliberately
deferred until scheduled.

### Addressing and entry

- Nested pictures are already first-class roots:
  `frame:${i}:tikzpicture:${j}` in the document-root codec
  (`packages/core/src/document/root-id.ts`), published by the Beamer scan
  in the root inventory. Today `resolveDeckFrameIndex` maps such a root to
  its owning frame; entering the figure means giving this root kind its
  own compute behavior instead.
- **Entry gestures**: double-click on the rendered picture, or Enter/F2
  while the picture object is selected (3a currently opens the raw-source
  atom session on Enter; that behavior is *replaced* — the raw source
  stays reachable through the source panel and the session bar).
- **Nothing to click**: a picture removed at the current step (`\only`)
  has no hit region, and a covered one (`\uncover`, action specs) is
  deliberately unselectable (hidden items are skipped by the object
  index). Entry for invisible pictures goes through the figure navigator,
  which lists every nested root regardless of visibility — or by stepping
  the deck until the picture appears. Covered "ghost" pictures do not
  become clickable in v1.
- **Exit**: breadcrumb bar over the canvas — "Slide 4 ▸ Figure" — where
  clicking the slide crumb or pressing Esc (with nothing else to unwind)
  returns to the deck surface with `activeRootId = frame:${i}`. The
  per-root overlay step (`deckStepByRootKey`) is untouched by the round
  trip.

### Compute: a third branch, absolute spans via masking

`computeSnapshot` currently routes by `documentKind` alone; beamer source
always produces a deck snapshot. The new routing: beamer document **and**
`activeRootId` parsing to `beamer-frame-tikz` → run the **TikZ pipeline**
(parse → semantic → emitSvg), but over the **full-length document source
with everything outside the picture span masked to spaces** — the same
structural-masking trick used by edit sessions and
`createBeamerSyntaxContext`. The parser sees one tikzpicture in a
document of blanks, so every span in the scene, edit handles, and source
maps is an **absolute document offset with no remapping layer**.
Consequences that fall out for free:

- TikZ edit actions work unmodified: `applyEditAction` patches the real
  document source; undo/redo shares the document history; the source
  panel highlights the right text; returning to the slide re-renders the
  edited picture.
- The snapshot is TikZ-shaped (`scene`, `editHandles`, `svg`, one-entry
  `figures`); it additionally carries the breadcrumb context (owning
  frame id/index/title — a small `deck`-side field, with `activeFrame`
  null).
- The text engine uses the same Beamer font profile as
  `prepareEmbeddedTikz`, so the nested editor and the slide render agree
  glyph-for-glyph.

**Mode is a function of `(documentKind, activeRootId)`**, not of the
document alone. The reducer's `APPLY_EDIT_ACTION` branch accepts TikZ
actions (and rejects deck actions) while a nested root is active, and
vice versa on the deck surface. Implementation step one is an audit of
every site that assumes `documentKind === "beamer"` implies a deck
snapshot (canvas panel, inspector switch, deck step controls, edit-action
gating, figure navigator, thumbnails).

### Preamble context: selective unmasking (follow-up to v1)

Pictures reference preamble material: `\tikzset` styles, `\definecolor`/
`\colorlet` colors, `\newcommand` macros, `\usetikzlibrary`. The TikZ
parser has first-class statements for all of these
(`TikzSetStatement`, `DefineColorStatement`, the `Macro*Statement`
family), so the masking approach extends naturally: **leave whitelisted
preamble support statements unmasked** alongside the picture. Styles,
colors, and macros then resolve at their true offsets — the styles
cascade in the inspector works against the real preamble spans (and the
StylesPanel can plausibly edit deck-wide TikZ styles unchanged). The same
extracted statements get *prepended* to `prepareEmbeddedTikz`'s snippet
so the slide preview shows identical output (prepending is fine there —
the preview discards spans). v1 masks everything except the picture,
which degrades exactly like today's embedded preview (consistent, if
imperfect); the unmasking pass is the immediate follow-up because it
upgrades preview and editor symmetrically.

### Deck chrome while nested

Step controls and the deck inspector hide; the TikZ inspector, styles
panel behavior, and TikZ toolbars return (the surface *is* a TikZ
editor). The canvas transform should fit the figure on entry and restore
the deck view on exit (per-root transform, mirroring per-figure fit in
TikZ documents).

### Deferred alongside

- **Overlays inside the picture** (`\node<2->`, `\visible<2->{…}` — the
  Beamer-TikZ overlay extension): the slide preview *already* renders the
  raw unprojected snippet, so the nested editor showing "all steps at
  once" is consistent, not a regression. Making inner-picture overlays
  actually step — in preview and editor both — is its own feature, near
  Phase B5.
- Beamer theme colors (`structure.fg` …) referenced inside pictures.
- In-place (on-slide) figure editing: Phase B5; the breadcrumb editor is
  its interaction-grammar placeholder.

## Masking and structural recovery

The original draft assumed mask-equals-session was safe for column scopes.
**Verified false** (probe, 2026-07-30): rendering the KKT fixture's frame 2
with the first column's body masked collapses the column's itemize into the
preceding paragraph — the distinct `column:0:list:0` flow node disappears
and its list markers re-parent under `column:0:paragraph:0` with new IDs.
Masking replaces `\begin{itemize}`/`\item` with spaces for the Beamer
frontend, so any scope containing nested structure (lists, blocks,
theorems, glue, TikZ — i.e. most real columns and bodies) changes topology
under its own mask.

Requirements:

- Session span and structural recovery are independent for **every** scope
  type. The mask may only ever cover a structure-free chunk around the
  caret, and even that is not sufficient for edits that delete or cross
  construct boundaries.
- The robust model is a **session-baseline structural projection**: capture
  the scope's container topology (flow nodes, stable IDs) when the session
  opens and project it through the session's patches while input is
  transiently invalid, rather than re-deriving topology from masked source.
  An equivalent recovery mechanism preserving original container topology
  is acceptable; silent re-derivation is not.
- Tests must assert **topology and stable IDs** across masked/mid-edit
  renders (paragraph/list/block node identity), not merely that the frame
  still renders. The probe above is the seed regression.

The user-facing invariant this work serves: **the canvas must never
visibly restructure content the user is not editing, mid-keystroke.**
If baseline topology projection proves harder than expected, the
sanctioned plan B is to visually freeze the edited scope's render (show
the stale layout with a live caret) until the source is structurally
valid again — a deliberate degradation, decided here, not something an
implementer should improvise.

## Core prerequisites (Stage 0)

Scope-wide sessions are not "a bigger buffer" over the existing machinery;
four contracts must change first. Verified against the current code:

1. **A core-owned Beamer edit index.** Deck hit regions are currently built
   only from `editableTextSpans`, which exclude math, macro output,
   generated content, graphics, and hidden material by construction. The
   edit index replaces that with, per frame: scope inventory (id, kind,
   buffer span), visual hit geometry for direct text *and* math, atomic
   source ranges for commands and macro calls (the caret API currently
   returns only offset + text/space/math kind — it must also return the
   enclosing atomic range so click-on-macro-output can select the
   invocation), paragraph id + document offsets for every hit, and explicit
   hidden/read-only/generated policy per range. Object topology (below)
   rides the same index.
2. **Session shape.** `TextEditingSession` holds one `paragraphId`, one
   rendered text, one hit region — one rendered paragraph. A scope spans
   many rendered paragraphs (block → prose → list; a column with prose,
   glue, list, TikZ). The session must separate: stable scope identity +
   full buffer span; the active rendered paragraph under the caret;
   canonical selection in document offsets; and zero-or-more per-paragraph
   selection overlays (a cross-paragraph selection renders as multiple
   overlay rect sets).
3. **Minimal-diff patches.** The edit machine currently emits the entire
   session buffer as the patch replacement on every input event
   (`applySessionTextUpdate` → `replacement: nextText`). Fine for a
   ten-character typo span; with scope buffers every keystroke becomes a
   scope-sized replacement, defeating incremental CST parsing and making
   the latency gate measure the wrong workload. Compute the minimal
   prefix/suffix diff inside the buffer and dispatch only that.
4. **Masking/recovery independence** per the previous section.

## Implementation notes

- **Canvas focus input**: a hidden textarea (IME/composition capture)
  feeding the existing `beforeinput`-intercepting machine; the machine and
  its `compositionRange` model are unchanged. Stage 2 only.
- **Rendered caret-stop domain**: canvas-focus arrow motion needs an
  ordered stop sequence over the scope (all runs in flow order, atoms as
  single stops, math via `mathCaretEntries`). Stage 2 only.
- The bar/popup is one component with a placement setting; `inline-typo`
  mode (Enter closes, `rows=1`) is retired for deck sessions in favor of
  multi-line source-key behavior.
- Session lifecycle: click text opens; click background, Esc-ladder past
  the top, or selecting another root closes. Patches keep flowing per
  keystroke as today; undo grouping unchanged.
- The per-keystroke deck compute path (prepared-document rebuild + full
  frame re-layout) stays within the existing latency gate; the gate
  (`profile-beamer-canvas-text-latency.spec.ts`) must keep running with
  **actual full KKT body/column buffers**, not the current short spans.
  Frame-level IR reuse across revisions remains the known optimization
  (tracked in `design/beamer-editor.md` Phase B2.5).

## Staging

Status (2026-07-31, branch `beamer`): **Stage 0 and Stage 1 (a)–(d) are
implemented and verified** (commits 9ac0e5f6..238c023c) — scope-wide
sessions with per-run structural masks and minimal-diff patches, the
docked-bar/popup placement setting, click-into-math (inline and display),
atomic-render click-to-select, and preamble-backed title-page fields
(author/institute/date now render as source-backed paragraphs; each
metadata field is a `preamble-field` edit scope). The latency gate
measures the full KKT column scope buffer on both browsers. **Stage 2a is
implemented**: `focusSurface` in the edit machine (scope sessions enter in
canvas focus, node sessions stay bar-only), a hidden canvas textarea
feeding the same beforeinput machine (both surfaces mirror buffer and
selection, so native word-deletes/IME report correct offsets from either),
Cmd+E in / Esc out (Esc from bar → canvas focus, Esc from canvas → close),
and the indication set: only the focused surface blinks (static
low-contrast caret on the other), accent vs gray selection in both
directions (the bar mirror-measures its range rects while unfocused, since
an unfocused textarea hides its native selection), bar focus ring/dimmed
chrome, and the dashed PPT edit border on the scope container
(`anchorBounds`), faint under bar focus. **Stage 2b is implemented**:
rendered-stop motion under canvas focus. The stop domain is derived from
the click hit-map's own stop-building pass, exported DOM-free as
`getKnuthPlassParagraphCaretStops` (display-math rows included via the
vlist items), and shaped per scope by
`buildBeamerCaretStopDomain` (`packages/core/src/beamer/caret-stops.ts`):
stops are gated by `editableTextSpans` (which already exclude
overlay-hidden content, list chrome, and read-only macro-argument glyphs)
and collapsed over atomic spans (macro invocations, atomic renders), with
page-space rows for vertical motion. Canvas-focus keys: ←/→ step by
rendered stops (atomic over macro calls, per-offset inside math and
ligatures — matching what clicks can reach), ↑/↓ move by rendered rows
(nearest-x with a sticky goal column that survives consecutive vertical
presses through short rows, clamping to row start/end at the edges —
clamping resets the goal, standard editor convention), Home/End and
Cmd+←/→ go to rendered-row edges, Cmd+↑/↓ to the scope's visual extremes,
Shift extends all of these, and Backspace/Delete beside an atom select it
first (select-then-delete) with the second press deleting the invocation.
Alt-modified keys and everything in the bar stay native source-style.
Known 2b gaps: `caretPolicy: "filename-linear"` for graphics was never
implemented in the hit map and remains whole-atom selection; inter-
paragraph glue (`\vspace`/`\vfill`) and frame-level flow objects (embedded
tikz, graphics) are not yet in the traversal/select-then-delete domain —
they arrive with the object layer. **Stage 2c is implemented**: structural
keys under canvas focus, powered by the engine-retained topology decided
above. The chunk scan (`text/tex/ir.ts`) records
`SimpleTexListTopology` (env begin/end token spans, per-item
command/label/content spans, 1-based depth) on a stack parallel to
`listStack`, threads it through the paragraph IR and
`layoutSimpleTexParagraph` (spans remapped through the sourceMap; lists
touching macro-generated material are dropped whole), and publishes it as
`BeamerParagraphLayout.listStructure`. The caret domain carries the
structural context (`lists`, `mathSpans`, paragraph roles, and the source
it was built from), and `packages/core/src/beamer/structural-edit.ts`
computes pure multi-edit patches with explicit post-edit caret offsets:
Enter splits the item at the caret (whitespace repair, indent copied from
the item's line; at content start it opens an empty item above), Enter on
an empty *last* item deletes it and exits onto a fresh line after the env
(removing the whole env when it was the only item; an empty middle item
just splits again, the Word convention), Enter in body/block-body prose
inserts a blank line, Shift+Enter inserts ` \\ `, Backspace at item
content start merges into the previous item (single-space join; first item
swallows), forward Delete at rendered item end merges the next item in,
Tab wraps the item in a same-kind nested env — extending an adjacent
nested env left by a previous Tab instead of chaining siblings — and
Shift+Tab unnests with first/middle/last/single-item env splitting. The
`\item` command's swallowed whitespace tail counts as item interior
(clamped to content start) so a caret parked right after a fresh split
resolves to the empty item. Enter/Shift+Enter are swallowed inside math
islands and non-flow roles (titles); with no published topology or no
paragraph context the keys degrade to plain source behavior per the safety
property. App side: a `structural_edit` machine action applies an atomic
buffer replacement with explicit caret and its own undo checkpoint through
the same minimal-diff patch path as typing; the hidden-input keydown
handler intercepts Enter/Tab/Backspace/Delete before rendered motion,
verifies each edit span against the live buffer (staleness guard — a
not-yet-reconciled domain swallows rather than corrupts), and writes the
DOM inputs before dispatching so queued selectionchange events cannot echo
the stale caret back into the machine. Implementing 2c surfaced and fixed
an engine layout bug: a multi-item nested list followed by another outer
item crashed rendering ("paragraph-baseline hbox is not immediately before
its paragraph") because plain-paragraph interline glue was inserted
between a list-label hbox and its paragraph; the glue now goes above the
label/paragraph pair (`vlist/spacing.ts`, regression test in
`test/beamer-frame-render.spec.ts`). 2c gaps, deliberate: Enter with a
non-empty selection is swallowed (no delete-then-split yet); Backspace at
the *first* item's content start is swallowed rather than dissolving the
item into a paragraph (object-layer work); Tab on a first item is a no-op
(LaTeX forbids an env before the first `\item`). The editing fixture
corpus below is built
(`test/fixtures/beamer/editing_corpus_beamer.tex`, tests in
`test/beamer-editing.spec.ts`); building it surfaced and fixed two
content-flow bugs (command-form `\frametitle`/`\framesubtitle` leaked into
body prose as literal editable text; mid-paragraph `\vfill` aborted the
whole text chunk and silently dropped its content — both fixed by
parse-level passes in `content.ts`). Known gaps the corpus documents:
`\vfill` splits paragraphs but its fill glue is not yet distributed (and
column-level inline `\vfill` still aborts its chunk), description labels
are not editable, and frame subtitles are scanned but not rendered by any
headline template. **Stage 3a is implemented** — object-selection
foundation; full status paragraph in the Object layer section above.

- **Stage 0 — editing infrastructure** (added after review): the Core
  prerequisites above — Beamer edit index, session refactor (scope buffer +
  active paragraph + document-offset selection + multi-paragraph overlays),
  minimal-diff patching, mask/recovery independence for all scopes — plus
  topology-preservation and latency tests using actual full KKT
  body/column buffers. No UX change ships here; Stage 1's UX claims are
  only honest once this exists.
- **Stage 1 — scope-wide sessions, bar focus only** (decided 2026-07-30):
  scope rule, whole-scope buffers, docked-bar + floating-popup placement
  setting, source-key behavior throughout (no structural keys). The user
  experience is today's proven TikZ interaction with a bigger buffer and a
  docked placement; it fixes the fragmentation complaint outright.
  Acceptance is split, in order: (a) direct text across a whole scope;
  (b) click-into-math caret mapping; (c) atomic-render click-to-select —
  clicking a macro's output, an embedded tikzpicture, or a graphic selects
  that atom's full source span in the enclosing scope's bar (one rule, one
  code path; not object selection, but no click is ever dead);
  (d) preamble-backed title-page fields (requires rendering author/
  institute/date as source-backed paragraphs first). Ship, gather usage.
- **Stage 2 — canvas-focus mode**: hidden input, rendered-stop motion,
  structural Enter/Backspace/Tab, focus indication set (blink/gray/ring/
  dashed border), focus gestures.
- **Stage 3 — object layer**, split into sub-stages (2026-07-31):
  - **Stage 3a — selection foundation (implemented)**: per-frame object
    index (blocks, columns, column, graphics, tikz, lists, items), click
    chrome/markers/atoms to select, Esc ladder with Enter/F2 drill-in,
    Delete and Cmd+D with undo, dashed selection outline. Details in the
    Object layer section.
  - **Stage 3b — inspectors and deck edit actions**: property editing over
    the 3a selection. Deck edit actions replacing the blanket
    `APPLY_EDIT_ACTION` rejection (env rename, option value set, …), then
    the inspectors built on them: block (type dropdown block/alertblock/
    exampleblock via env-rename patch, title field, overlay spec), column
    (exact width numeric field), image (width/height/scale), embedded tikz
    (`scale=`/`\scalebox` value via the retained-span rewrite). Also the
    structural-edit stragglers that need object semantics: Backspace at
    the first item's content start dissolving the item into a paragraph,
    and Enter with a non-empty selection (delete-then-split).
    **Implemented except the stragglers** (2026-07-31, decided with
    Dominik: inspector lives in the existing inspector panel; no-selection
    state shows frame options, never the frame title — that is
    canvas-editable; overlay specs are free text; number-label scrub is
    kept). Core: `DeckEditAction` family in
    `packages/core/src/beamer/deck-edit-actions.ts` — pure
    `(source, frame layout, action) → EditActionResult` sharing the tikz
    result type — and `deck-inspector.ts` model builders that read current
    values from the same spans the actions rewrite. App: the reducer's
    beamer branch routes deck actions with a snapshot-freshness guard
    (deck results reconcile immediately — an empty changed-ids list skips
    the typing debounce; a duplicate-then-delete race taught us that);
    `DeckInspectorPanel` reuses the tikz inspector's CSS and scrub
    machinery, holds drafts in text/number fields (commit on Enter/blur —
    per-keystroke commits would race the frame re-render), and scrubs
    against a frozen base source+layout, previewing via
    `SET_SOURCE_TRANSIENT` and committing one recorded action as a
    precomputed result. Implementing 3b exposed and fixed a rendering
    bug: `\begin{block}<2->{…}` was treated as an uncoverenv-style
    wrapper and vanished entirely; content environments with action specs
    now keep their structure and uncover as one unit.
  - **Stage 3c — format toolbar (implemented 2026-07-31)**: a compact
    button row attached to the existing text-edit popup/bar (decision:
    attach, not a separate floating Keynote-style bar), shown for every
    text session. Wrap buttons B/I/U/tt + color swatch menu + alert
    toggle `\textbf`/`\textit`/`\underline`/`\texttt`/`\textcolor`/
    `\alert` around the selection via pure helpers in
    `packages/core/src/text/format-commands.ts` (lexical wrapper scan,
    innermost-active detection, unwrap, in-place color-argument replace;
    wrap safety = balanced braces, even `$` count, no blank line, no
    comment start; new wraps additionally reject selections containing
    `\item`/`\begin`/`\end` tokens — unwrapping an active wrapper is
    always legal). Buttons dispatch through the machine's
    `structural_edit` path (own undo checkpoint, minimal-diff source
    patch); Cmd+B/I/U ride the shared modifier-key handler. List buttons
    (Gmail-style): bullets/numbered call
    `beamerStructuralListTogglePatch` (same-kind → dissolve the item back
    to prose, boundary removals keep an empty line so the environment's
    implicit paragraph break survives; other kind → rename the innermost
    environment's boundary tokens; outside a list → wrap the caret's
    blank-line-delimited paragraph chunk in a fresh single-item
    environment), indent/outdent reuse `beamerStructuralTabPatch`; all
    structural patches share the staleness-guarded session apply. The
    engine gained native inline `\alert{…}` rendering: the simple-tex
    scanner resolves the reserved alias `TEX_ALERT_COLOR_ALIAS` through
    the layout `colorResolver`, which beamer render supplies from the
    theme's "alerted text" foreground (an `\alert<spec>` surviving to
    layout colors every step; per-step projection is deferred). Also
    deferred: mixed-run partial toggling, `\structure`, font-size
    controls.
  - **Stage 3c — direct manipulation**: graphics corner resize handles
    (rewrite the authored `width=0.63\textwidth` value span, symbolic form
    preserved), column divider drag with live re-layout (rewrite both
    adjacent coefficients preserving their sum), glue bands (vertical glue
    enters the caret-traversal/select-then-delete domain; hover reveals
    the band — decided 2026-07-31 — covering `\vspace`/`\smallskip`/
    `\medskip`/`\bigskip`/`\vfill`), tier-3 selection promotion (text
    drags crossing containers promote to object selection), and the
    nested-TikZ breadcrumb editor — the largest single item; design
    settled 2026-07-31, see "Nested TikZ figure editing".
- **Stage 4 — gap closing**: the deliberate gaps accumulated across
  stages 1–3, none of which block the object layer but all of which are
  user-visible: `\vfill` glue distribution (and column-level inline
  `\vfill` aborting its chunk), description-label editing, frame subtitle
  rendering (scanned but no headline template shows it),
  `caretPolicy: "filename-linear"` for graphics (currently whole-atom
  selection), and whatever the open questions below resolve to (tier-2
  snapping catalog, glue-band hover styling, Esc-ladder length in tall
  blocks). Sequencing within Stage 4 is by user pain, not architecture —
  each item is independent.
- **Later** (unchanged from `design/beamer-editor.md`): insertion templates
  and ghost placeholders, drag-reorder in flow, formatting toolbar polish,
  free-form overlay layer, in-place embedded figure editing (Phase B5;
  the 3c breadcrumb is its interaction-grammar placeholder).

### Editing fixture corpus

The nine rendering fixtures are a good rendering corpus but an insufficient
editing corpus: across them there are columns, blocks, lists, TikZ
pictures, and one title page, but no `\includegraphics`, `description`,
nested lists, `\frametitle`/`\framesubtitle` command forms, or populated
author/institute/date. Stage 0/1 should add editing-specific fixtures
covering: those gaps, empty items, multiple overlay steps (`\alt`,
`\temporal`, list `[<+->]`, `\pause`), macro calls with arguments, explicit
text `\\`, `\vfill`, graphics with width/height/scale variants, and a
fragile/verbatim frame (expected: frame fallback, no session).

## Settled Stage 2 decisions (2026-07-31)

- Focus-switch chord: **Cmd+E in / Esc out**, as assumed; no F2 binding.
- Double-click on canvas text keeps its **word-select** meaning; it is not
  a focus switch.
- Structural Enter splits paragraphs by inserting a **blank line**, also
  in dense no-blank-line bodies (KKT frame 3 style); no `\par` variant.
- **Item topology comes from the text engine, not a second parser**
  (decided 2026-07-31): the engine's chunk scan already holds every span
  structural keys need when it handles `\item` (command token span,
  optional-label span, content start, live list stack with
  kind/depth/itemIndex) and currently discards the topology, keeping only
  per-block breadcrumbs (`listScope`/`scopePath`) and box roles. Stage 2c
  retains a per-chunk list-structure record at parse time and threads it
  to `BeamerParagraphLayout` the way `macroArgumentRuns` already is — the
  same "engine keeps source facts it learned while parsing" pattern as
  `mathCaretEntries`. Rejected: an independent source-level item pass in
  the Beamer content layer (two interpretations of `\item` that could
  diverge) and deriving items from rendered vlist box geometry
  (render-coupled, per-step, lacks the token/label/whitespace spans a
  patch needs). When a chunk fails to parse there is no topology and
  structural keys degrade to plain source behavior — correct per the
  safety property.

## Open questions

- Tier-2 snapping catalog: exact list of constructs that snap (math,
  command groups, macro calls, environments?) and whether snapping is
  extend-only or can shrink a drag.
- ~~Glue band styling and whether hover should reveal glue targets before
  caret traversal does.~~ Settled 2026-07-31: hover reveals glue bands
  (all vertical-space commands, incl. `\medskip` and friends); exact band
  styling is an implementation detail.
- When blocks-transparent meets very tall blocks, does the Esc ladder
  (caret → item → list → block → column) feel too long in practice?
