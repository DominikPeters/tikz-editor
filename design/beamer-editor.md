# Beamer Editor Architecture

## Purpose

Extend TikZ Editor into a WYSIWYG editor for Beamer presentations — a
"PowerPoint for Beamer". Users open an existing `.tex` deck, see slides
rendered faithfully, rearrange and edit them visually, and the file on disk
remains ordinary, idiomatic Beamer source that coauthors can edit in Overleaf
or any text editor.

This document records the architectural decisions, grounds the scope in a
corpus of real decks, and lays out implementation phases. It builds directly
on `design/tex-like-layout-architecture.md`, which already anticipates Beamer
frame layout as Phase 7 of the text subsystem.

## Decisions Already Made

These were settled in design discussion and are treated as fixed below:

- **`.tex` is the source of truth.** The editor supports a defined subset and
  round-trips everything else untouched, exactly like the TikZ editor does
  for TikZ source. No native document format, no sidecar metadata, no magic
  comments.
- **Same app, not a separate app.** A Beamer deck is a document whose roots
  are frames instead of tikzpictures. Mode follows the file
  (`\documentclass{beamer}`), not the app. Separate branding, if ever wanted,
  is a thin extra entry in `apps/`.
- **Theme targets: classic (default/Madrid) and metropolis/moloch, both from
  the start**, so the theme interface is designed against two structurally
  different chrome styles and does not overfit to either.
- **Web/desktop parity from day one.** No feature may *require* a local TeX
  installation or unrestricted filesystem access; desktop may *enhance*
  (compiled fallback previews, file watching).
- **v1 optimizes for opening existing decks**, not for the new-deck authoring
  flow. Coverage and faithful rendering come before insertion templates.
- **Overlays are core MVP**, not a later phase. The step model is part of the
  frame IR from the beginning.

## Goals

- Open a real academic Beamer deck and render most frames faithfully,
  including overlay steps.
- Edit slide text, lists, columns, and blocks visually with source-span
  patches, preserving untouched source byte-for-byte.
- Reuse the TikZ editor for figures embedded in frames.
- Degrade gracefully, at the right granularity, when a deck uses constructs
  outside the supported subset.
- Export nothing: the document *is* the export.

## Non-Goals

- Reimplement all of Beamer or LaTeX.
- Support arbitrary `\setbeamertemplate` structural hacks (corpus: rare).
- Frame transitions (`\transfade` etc.) and continuous animation.
- Poster classes (`beamerposter`), `pgfpages` handout layouts, article mode.
- Pixel-identical math rendering (MathJax islands remain the math engine).

## Corpus Evidence

Scanned 22 real decks (511 frames) found under `~/GitHub` — academic talks in
computational social choice, several authors. Biased toward one community,
but real. Construct frequencies:

| Construct | Occurrences | Decks | Implication |
| --- | ---: | ---: | --- |
| `\begin{frame}` | 511 | 22/22 | ~23 frames/deck |
| `itemize` | 379 | 21/22 | core |
| `\newcommand` | 323 | 21/22 | macro handling is the #1 coverage lever |
| `\vspace` | 160 | 17/22 | manual vertical glue must be a supported item |
| `\definecolor` | 145 | 17/22 | preamble color mining required |
| `tikzpicture` (in deck) | 108 | 17/22 | embedded figures core |
| `\includegraphics` | 104 | 17/22 | graphics core |
| `tabular` | 94 | 18/22 | **tables are core for slides**, not deferrable |
| `\setbeamercolor` | 45 | 18/22 | color overrides as data, on top of theme presets |
| `columns` | 77 | 18/22 | core |
| `theorem` | 58 | 13/22 | theorem-style blocks core for math talks |
| `\footnote` | 57 | 16/22 | needed, medium priority |
| `\scalebox` | 56 | 12/22 | scale-transform wrapper needed |
| `\colorbox` | 52 | 19/22 | inline highlight boxes needed |
| `tcolorbox` | 32 | 18/22 | subset or styled-box fallback (see below) |
| `align` (display math) | 30 | 10/22 | display math islands needed |
| overlay angle specs `<...>` | 116 | — | explicit specs dominate |
| `\only<` / `item<` / `\uncover<` | 32 / 21 / 6 | — | `\only` is the common form |
| `\pause` | 4 | 4/22 | rare; renumbering concern is nearly moot |
| `\setbeamertemplate` | 9 | 4/22 | structural theme hacks are rare |
| `[fragile]` / verbatim | 0 | 0/22 | not needed for v1 |
| `textpos` / free placement | ~0 | — | overlay-layer drawing is a want, not a need |

Theme usage: 13× `moloch` (maintained metropolis fork, with options
`block=fill, progressbar=frametitle`), 3× `metropolis`, 2× `default`,
2× `Madrid`. Aspect ratio: `aspectratio=169` in 10 decks, rest 4:3.

Consequences adopted in this document:

1. Tables move into the core plan (they were "deferred" in the text-layout
   doc; the corpus says otherwise for slides).
2. Theme presets must accept *options* (`moloch` is used with option lists).
3. `\pause` preservation policy is simple because `\pause` is rare.
4. Macro expansion strategy matters more than any single environment.
5. `[fragile]`/verbatim support can wait indefinitely.

The scanner that produced these numbers should become a maintained tool
(`scripts/scan-beamer-corpus.mjs`) and the construct list should join the
capabilities matrix (`packages/core/src/capabilities/`), so subset coverage
is a tracked metric, not a guess.

## Document Model

### Document roots

Generalize the figure inventory (`packages/core/src/parser/figure-scan.ts`,
`FigureNavigator`) into a **document root inventory**:

```ts
type DocumentRoot =
  | { kind: "tikzpicture"; span: Span; ... }            // existing
  | { kind: "frame"; span: Span; title?: Span;
      options: FrameOptions; children: DocumentRoot[] } // tikzpictures inside
  | { kind: "section"; span: Span; level: 1 | 2; title: Span };
```

The frame scanner is the same delimiter-matching approach as
`scanTikzFigures` with `\begin{frame}`/`\end{frame}` delimiters; it must
also collect `\section`/`\subsection` commands between frames, because
chrome (navigation, section pages) depends on them. Frames nest
tikzpictures, so the inventory becomes shallowly hierarchical.

This refactor lands *before* any Beamer feature: per-root editing-session
state (`activeFigureId`, compute snapshot, undo grouping) must depend on a
root abstraction, not on "active tikzpicture".

### Render order vs source order

The slide sorter shows the **render order**, which is not 1:1 with source
spans:

- `\AtBeginSection`-generated section frames (and metropolis-style section
  pages) exist in output but not as `\begin{frame}` in source. They appear
  in the sorter as derived slides whose only editable content is the section
  title.
- Each frame expands to one slide *per overlay step*. The sorter shows one
  thumbnail per frame (final step, i.e. handout view) with a step-count
  badge; the canvas shows one step at a time.

### Preamble mining

The preamble is never parsed fully; it is *mined* best-effort for:

- `\documentclass` options (`aspectratio`, base font size).
- `\usetheme` / `\usecolortheme` / `\usefonttheme` with options.
- `\title`, `\author`, `\institute`, `\date` (drives `\titlepage`).
- `\definecolor`, `\colorlet`, `\setbeamercolor` (data-shaped; applied as
  patches on the theme record).
- `\graphicspath`.
- `\newcommand`/`\renewcommand`/`\def` definitions (see Macro Handling).
- `\AtBeginSection` blocks, recognized against known shapes (TOC frame,
  section page) rather than executed.

Everything else in the preamble is opaque and preserved untouched.

## Frame Content Model

A frame body parses into the block IR from
`design/tex-like-layout-architecture.md` (paragraphs, lists, quotes), plus
frame-level constructs:

- **Vertical layout root** with Beamer's default vertical centering (`[c]`),
  and `[t]`/`[b]` variants from frame options.
- **`columns` / `column{<dim>}`**: constrained side-by-side vboxes. Widths
  are kept symbolic (`0.48\textwidth`) and evaluated against the theme's
  content geometry; editing the divider rewrites the coefficient.
- **`block` / `alertblock` / `exampleblock` / `theorem` / `definition` /
  `example` / `proof`**: decorated vboxes; decoration comes from the theme's
  inner style + color record.
- **`center` environment, `\centering`**: alignment state, already modeled
  in paragraph layout.
- **`\vspace`, `\vfill`, `\bigskip` etc.**: vertical glue items (corpus:
  160 uses; first-class, not fallback).
- **`\scalebox{s}{...}` / `\resizebox`**: transform wrapper around a
  measured box (commonly wraps tikzpictures and tabulars).
- **`tabular`**: alignment IR per the text-layout doc, promoted into the
  core plan; slides use small, simple tables (no `multirow`/`longtable` in
  corpus).
- **Display math** (`equation`, `align`, `\[...\]`): block-level MathJax
  islands, measured as atomic vboxes.
- **Embedded `tikzpicture`**: an atomic box rendered by the existing
  pipeline; see TikZ Integration.
- **`\includegraphics`**: see Graphics.
- **Inline**: existing inline IR plus `\alert{...}` (theme color),
  `\textcolor`, `\colorbox` (background rect behind an hbox),
  `\footnote` (marker inline; note text in a footline-anchored area),
  `\structure{...}`.

`tcolorbox` (18/22 decks, typically via preamble macros) is *not* parsed as
tcolorbox. Recognized simple uses degrade to a generic "decorated box"
(fill, frame color, rounded corners) when the options are recognizable;
otherwise the box falls back at inline/block granularity (see Fallback).

### Fonts

Beamer's default is Computer Modern **Sans** at multiple sizes
(frametitle, body, footline, footnote sizes). The TFM→metrics→glyph pipeline
from the text-layout doc handles this; it is vendored-data expansion
(`cmss10/12/17`, bold sans, plus the size-substitution table), not new
architecture — but it is a prerequisite for the first rendered frame.
metropolis/moloch uses Fira Sans when available; v1 renders it with the CM
Sans profile and notes the substitution (metric-faithful Fira is a later
font profile).

Beamer's default math setup is sans-influenced; MathJax islands will render
classic CM serif math. This is an accepted v1 fidelity gap (one corpus deck
even opts out via `\usefonttheme{professionalfonts}`).

## Theme Engine

Beamer's own four-way decomposition is the interface boundary. A theme is
**code for structure, data for appearance**:

```ts
interface OuterThemeRenderer {
  // chrome: headline, footline, sidebar, frametitle bar, progress indicators
  renderChrome(ctx: FrameChromeContext): SvgFragment;
  // the rect the block layout engine fills; depends on slide size and chrome
  contentArea(ctx: FrameChromeContext): Rect;
}

interface InnerThemeStyle {
  bullet(level: number): BulletRenderer;       // triangle | circle | ball | square
  blockStyle: "plain" | "rounded" | "shadow" | "fill";
  titlePage(ctx: TitlePageContext): BlockTree;
  sectionPage?(ctx: SectionContext): BlockTree;
}

interface BeamerThemeRecord {
  colors: BeamerColorRecord;   // ~30 named beamer-colors (structure, palettes,
                               // block title/body, frametitle, alerted text, ...)
  fonts: BeamerFontRecord;     // size/series/family per element
  outer: OuterThemeRenderer;
  inner: InnerThemeStyle;
  options: Record<string, string | boolean>;   // e.g. moloch's progressbar=frametitle
}
```

`FrameChromeContext` carries: frame title/subtitle, frame number and total,
section/subsection structure (for navigation chrome and progress bars),
title/author/date fields, slide geometry (4:3 = 128mm × 96mm,
16:9 = 160mm × 90mm), and current overlay step.

Presets are records: `default`, `Madrid` (infolines outer), `metropolis`,
`moloch` (+ option handling). Because `\usecolortheme`/`\usefonttheme` and
preamble `\setbeamercolor`/`\definecolor` are data-shaped, they compose as
patches on the record — this is why the appearance dimension must stay data,
not code. Only unrecognized `\usetheme` or structural `\setbeamertemplate`
degrades chrome (see Fallback).

Each outer renderer is a small, screenshot-testable unit validated against
real Beamer output with the existing visual-compare harness.

## Overlays (Core MVP)

### Model

Every block/inline IR node carries an optional **visibility spec**, the
parsed form of `<2->`, `<2-4>`, `<1,3>`, `<+->` etc. A frame has a derived
step count (max referenced step, with `<+->` counters resolved during
parsing, per Beamer's `beamerpauses` semantics).

Two visibility semantics, matching Beamer:

- **Keep-space** (`\uncover`, `\visible`, `\invisible`, `item<...>` in the
  default `\beamerdefaultoverlayspecification`): layout once, filter at
  render. Hidden content renders as blank space (or optionally ghosted in
  the editor, a view setting Beamer itself offers via `transparent`).
- **Remove** (`\only`, `\alt`, `\temporal`): content participates in layout
  only on its steps, so **layout runs per step**. Frames are small and the
  incremental engine exists; per-step layout is acceptable. The corpus says
  `\only` is the *most common* overlay command (32 uses), so this is not an
  edge case.

`\pause` (rare: 4 uses) parses into the step model and is preserved verbatim
in source as long as edits do not change the step structure around it; an
edit that forces renumbering rewrites it to explicit specs. `\alert<2>{...}`
and overlay-decorated commands follow the same spec model.

### UI

- **Step scrubber** on the canvas (`◀ 2/5 ▶`, keyboard arrows). The canvas
  always shows one concrete step; there is no "all steps at once" editing
  view.
- Selected elements show an **overlay badge** ("from step 3"); the inspector
  offers the common patterns (always / from step k / only on step k / on
  steps k–m) and writes the minimal spec syntax.
- Lists get a one-click "reveal items one by one" toggle ↔ `[<+->]`.
- Sorter thumbnails show the final step (handout view) with a step badge.

### Oracle

Beamer compiles one PDF page per step. A compiled frame therefore *is* the
oracle for the step model: page count validates step counting, and per-page
visual comparison validates per-step layout (including `\only` reflow). The
existing compare-harness pattern (compile, cache, raster-diff) applies
directly.

## Slide Types and Templates

PPT's "slide layout" is a persistent attribute; Beamer has no such object.
The analog is three mechanisms:

1. **Insertion templates** ("New Slide ▾"): scaffold idiomatic source —
   title slide (`[plain]` + `\titlepage`, creating preamble fields if
   missing), title+content, two columns, comparison (2×2), picture with
   caption, blank `[plain]`, outline (`\tableofcontents`), section header
   (inserts `\section{...}`, not a frame — see below), standout/closing.
2. **Structural recognition**, not stored attributes: a frame whose body is
   one `columns` env is a two-content slide (gets divider drag + swap
   button); body `\titlepage` → title slide (inspector edits preamble
   fields); body `\tableofcontents` → outline slide. Same philosophy as
   style provenance: derive, never annotate.
3. **Ghost placeholders**: a frame without `\frametitle` shows a dashed
   ghost title that materializes `\frametitle{...}` on first edit; empty
   columns/frames show ghost content regions. Nothing exists in source until
   filled (an empty `\frametitle{}` would change real output).

The outline panel (sections → frames, drag to restructure = span reorder)
falls out of the document-root model and is strictly better than PPT's
text-box-inferred outline.

## TikZ Integration

Two modes, matching Beamer idiom:

- **Flow figures**: a `tikzpicture` in the frame body is an atomic box.
  v1: double-click opens it in the existing editor view (it is already a
  document root; the carousel/editing machinery applies unchanged). In-place
  editing on the slide canvas — composing the existing CanvasPanel scene at
  a transform inside the slide scene — is deferred; it is a real
  coordinate-space project (cf. the branded-point-types plan in TODO.md).
- **Free-form layer**: PPT-style "rectangle anywhere" maps to one
  `\begin{tikzpicture}[remember picture, overlay]` anchored to
  `current page` per frame, created on demand when a drawing tool is used on
  the slide. Existing tools operate on it directly — it is just a
  tikzpicture whose coordinates are the page. Round-trips as idiomatic
  Beamer. Corpus shows free placement is rare in existing decks, so this is
  an authoring feature, not a coverage feature; it ships after editing
  basics.

The slide canvas is a composition root: theme chrome (non-editable) + flow
blocks (block layout engine) + embedded figure boxes (existing renderer) +
free-form layer (existing renderer + tools). Unlike the infinite tikz
canvas, it is page-bounded with fit-to-view zoom.

## Graphics (`\includegraphics`)

The project unit is the **directory** (what Overleaf, git, and arXiv
tarballs already are). Opening a `.tex` roots the project at its directory.

- Resolution: `\graphicspath` + relative paths; extensionless references try
  pdfTeX's order (`.pdf`, `.png`, `.jpg`, `.jpeg`, ...).
- **PDF figures render via PDF.js** (Apache-2.0; poppler/pdftocairo WASM
  rejected on license and maintenance grounds). Raster preview is
  sufficient because the compiled deck embeds the original vector PDF — the
  editor's rendering never reaches the output. Rasterize at
  `zoom × devicePixelRatio`, embed as `<image>`, cache by
  `(file hash, page, dpi)`. Size by the **CropBox** (pdfTeX's default box),
  falling back to MediaBox. PDFium-wasm (BSD) is the fallback engine if
  PDF.js fidelity disappoints; desktop may later shell out to user-installed
  tools as an opt-in enhancement.
- Web: File System Access API directory handle (Chromium); degraded mode
  elsewhere = placeholder + "locate file". The arXiv source browser is the
  friendlier web path since a tarball provides the whole tree.
- Insertion (drag image onto slide): copy into the project dir (or
  `figures/`), emit `\includegraphics[width=0.8\textwidth]{figures/name}` —
  what the user would have written by hand.

## Fallback Layers

Failure decomposes by granularity; each layer has its own answer and none
requires TeX:

1. **Chrome fallback**: unrecognized `\usetheme` or structural
   `\setbeamertemplate` → render content with the default theme's chrome +
   a warning badge. Content stays fully editable. This is the whole-deck
   failure mode, and it is deliberately mild.
2. **Frame fallback**: a frame body outside the subset → the frame renders
   as a source card (grey slide showing its source, editable in the source
   panel), correctly placed in the sorter. Desktop enhancement (later):
   compiled preview via local TeX, reusing the oracle pipeline and cache.
3. **Block/inline fallback**: a single unsupported environment or command
   inside an otherwise-supported frame → placeholder box of estimated size
   with the source snippet, rest of the frame stays WYSIWYG. This keeps one
   exotic `tcolorbox` from demoting a whole frame.

Parse-level whole-document failure should not exist: the frame scanner is
delimiter-based and survives arbitrary preamble and body content.

### Macro handling

`\newcommand` appears 323 times across 21/22 decks; this is the single
biggest determinant of coverage. Strategy:

- Mine definitions into a macro table (the AST already has
  macro-definition statements).
- **Expand** macros whose bodies are within the supported subset (text
  shorthands, math snippets, color/styling wrappers) at the frontend, with
  source spans mapping through expansion so editing patches land in the
  *use site*, never inside the definition.
- Editing text that came *from* a macro body is read-only in v1 (caret
  skips it, like ligature interiors), with "go to definition" as the edit
  path.
- Unexpandable macros trigger block/inline fallback at the use site.

## Editing and UI

- **Slide sorter** replaces the figure carousel in deck mode (same
  inventory abstraction); supports drag-reorder (span moves), duplicate
  (span copy), delete.
- **Canvas text editing** extends the existing report-driven caret/selection
  system (line boxes + source spans + caret stop maps) from one node's
  paragraphs to the frame's block tree. Typing emits `SourcePatch`es; Enter
  = new `\item` inside lists, new paragraph outside; toolbar/shortcuts wrap
  selections in `\textbf{}`/`\emph{}`/`\alert{}`.
- **Inspector** panes per selection kind: frame (title, options, label),
  list (bullet style, reveal-one-by-one), column (width), block
  (type, title), image (width coefficient), overlay spec.
- **Column divider drag** rewrites width coefficients, preserving the
  `\textwidth`-relative form.
- Undo/redo, multi-root navigation, and source panel sync all reuse the
  existing machinery — these must not fork for deck mode.

## Validation

- **Corpus coverage scanner** (`scripts/scan-beamer-corpus.mjs`): per-deck
  and per-frame subset classification; the headline metric is "% of frames
  fully supported / block-fallback / frame-fallback". Run against the
  22-deck corpus and tracked over time via the capabilities matrix.
- **Theme chrome fixtures**: per theme × geometry × (frame number, section
  structure) screenshot comparison against real Beamer output.
- **Frame layout oracle**: compile single frames with pdfLaTeX, compare
  rendered SVG against editor output — same harness family as
  `compare-tex-text-visual-fuzz.mjs`, with frames instead of nodes.
- **Overlay oracle**: PDF page count = step count; per-page diffs validate
  per-step layout including `\only` reflow.
- **Round-trip property tests**: open → no-op → byte-identical source;
  open → edit one element → diff touches only that element's spans.

## Implementation Phases

### Phase B0: Measurement and Root Abstraction

- Build the corpus scanner and add Beamer constructs to the capabilities
  matrix.
- Generalize figure inventory → document-root inventory; refactor
  per-root session state onto the abstraction. (Useful for multi-figure
  documents regardless of Beamer.)

Exit: scanner reports per-frame construct profiles on the 22-deck corpus;
existing tikz editing unaffected by the root refactor.

### Phase B1: Deck Document Model

- Frame + section scanner, render-order list (incl. `\AtBeginSection`
  recognition), preamble mining (theme, colors, title fields, graphicspath,
  macro table).
- Slide sorter UI in deck mode; frames render as source cards (universal
  fallback first).

Exit: any corpus deck opens; sorter shows all slides in render order;
reordering frames produces correct minimal source diffs.

### Phase B2: Frame Rendering (read-only), Both Themes, Step Model

- CM Sans font profile (metrics + glyphs, key sizes).
- Block layout: frametitle, paragraphs, lists, blocks/theorems, columns,
  center, vspace/vfill, scalebox, display-math islands, embedded
  tikzpictures (existing renderer), `\includegraphics` (incl. PDF.js).
- Theme engine with `default`, `Madrid`, `metropolis`, `moloch`(+options);
  titlepage and section pages; `\setbeamercolor`/`\definecolor` patches.
- Overlay specs parsed into the IR; per-step layout; step scrubber
  (read-only).
- Block/inline fallback placeholders; chrome fallback.

Exit: ≥70% of corpus frames render without frame-level fallback; overlay
oracle passes on frames using `\only`/`\uncover`/`item<>`; theme fixtures
match real Beamer within tolerance.

### Phase B3: Editing

- Canvas text editing over the frame block tree; ghost placeholders;
  formatting toolbar; inspector panes; overlay editing UI; column divider
  drag; insertion templates and slide-type recognition.

Exit: round-trip property tests pass; a corpus deck can have a typo fixed,
a bullet added, an overlay step adjusted, and a slide inserted — all from
the canvas, with minimal diffs.

### Phase B4: Tables, Footnotes, Inline Boxes

- `tabular` subset (alignment IR), `\footnote`, `\colorbox`, generic
  decorated-box rendering for recognizable `tcolorbox` uses.

Exit: corpus frame coverage ≥85%; tables render with correct column widths
on corpus decks.

### Phase B5: Deep TikZ Integration and Authoring Polish

- Free-form overlay layer with existing drawing tools; in-place embedded
  figure editing (coordinate composition); image drag-insertion; outline
  panel; new-deck flow.
- Desktop enhancement: compiled-preview frame fallback via local TeX.

Exit: rectangle-anywhere works and round-trips as `[remember picture,
overlay]`; double-click-to-edit works in place.

## Risks and Tradeoffs

- **The block layout engine is the critical path** (vbox stacking, vertical
  centering, per-step reflow). It is shared with the text subsystem's
  Phase 6/7; Beamer work should accelerate, not fork, that plan.
- **Macro expansion can expand without bound.** The expansion subset must be
  explicit and the use-site fallback must be cheap, or coverage work becomes
  a macro interpreter project.
- **Theme fidelity perfectionism.** The bar is "visually correct chrome +
  correct line breaks", with fallback layers absorbing the tail; the text
  stack's near-pixel standard should not be the gate for chrome.
- **Two corpora biases**: 22 decks from one community. The scanner should be
  easy to point at other corpora (e.g. arXiv source of `beamer` decks)
  before locking the subset.
- **MathJax serif math vs Beamer sans math** is a visible fidelity gap in
  v1; acceptable, but should be stated in the UI (font profile note), not
  silent.
- **Per-step layout cost** is assumed cheap; if profiling disagrees,
  keep-space steps can share layout and only `\only`-bearing frames pay
  per-step.

## Open Questions

- `tcolorbox`: how far should "recognizable simple uses" go? (Corpus
  suggests one or two common shapes per deck, usually via a single preamble
  macro — per-deck recognition may cover most uses.)
- Fira Sans metric profile for metropolis/moloch: when does metric-faithful
  Fira matter vs CM Sans substitution?
- `\footnote` placement interaction with footline chrome across themes.
- Should the sorter offer a per-step expanded view (one thumbnail per step)
  for overlay-heavy frames?
- File watching / external-change reload semantics when Overleaf or a
  coauthor edits the deck concurrently (desktop: fs watch; web: FS Access
  API polling).
- Where does deck-mode UI live in `packages/app` — a parallel `DeckPanel`
  set, or document-kind switches inside existing panels?
