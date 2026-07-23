# Beamer Editor Architecture

## Purpose

Extend TikZ Editor into a WYSIWYG editor for Beamer presentations — a
"PowerPoint for Beamer". Users open an existing `.tex` deck, see slides
rendered faithfully, rearrange and edit them visually, and the file on disk
remains ordinary, idiomatic Beamer source that coauthors can edit in Overleaf
or any text editor.

This document records the architectural decisions, grounds the scope in a
corpus of real decks, and lays out implementation phases. It builds directly
on `design/tex-like-layout-architecture.md`; most of that plan's paragraph,
list, vlist, display-math, source-map, caret, and SVG-glyph foundations are
now implemented, leaving Beamer page composition as the missing layer.

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
- **LuaLaTeX with Latin Modern is the reference profile and oracle.** Beamer
  text rendering uses the existing LuaLaTeX-oriented text profile, with a
  Beamer font-role/size layer selecting Latin Modern Sans where Beamer selects
  sans. Compiler comparisons, glyph traces, and cached oracle artifacts use
  LuaLaTeX rather than mixing pdfLaTeX metrics with LuaLaTeX traces.
- **Installed Beamer sources are the normative layout specification.** Page
  geometry, frame skips, columns, blocks, overlays, and theme chrome are
  transcribed from the corresponding `beamer*.sty`/`beamer.cls` definitions
  located through `kpsewhich`, then locked down with oracle tests. Screenshots
  and remembered constants are not specifications.

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
- Pixel-identical math rendering across the full LaTeX surface. Supported
  math uses the native TeX math IR; unsupported constructs fall back at the
  smallest source-backed box boundary.

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
| `\colorbox` | 52 | 19/22 | native inline highlight boxes implemented in node text |
| `tcolorbox` | 32 | 18/22 | subset or styled-box fallback (see below) |
| `align` (display math) | 30 | 10/22 | native display-math boxes needed |
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

The scanner that produced these numbers is maintained as
`scripts/scan-beamer-corpus.mjs`; the construct list should also join the
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

This refactor lands before **app integration**, not before the headless Beamer
renderer. The core renderer can scan and render source-backed frames without
changing `activeFigureId`, compute snapshots, navigation, or undo state.
Before frames enter `packages/app`, per-root editing-session state
(`activeFigureId`, compute snapshot, undo grouping) must depend on a root
abstraction, not on "active tikzpicture".

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

A frame body reuses the implemented simple-TeX/vlist IR described by
`design/tex-like-layout-architecture.md` for paragraphs, lists, quotes,
vertical glue, and display math, plus frame-level constructs:

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
- **Display math** (`equation`, `align`, `\[...\]`): native TeX math boxes,
  placed as atomic vboxes while retaining source-backed hit geometry.
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

The reference compiler is LuaLaTeX, so the editor's Beamer profile builds on
`luaLatexDefaultTextFontProfile`. Beamer's default font theme selects a sans
family at multiple sizes (frametitle, body, footline, footnote); the Beamer
font-role layer therefore resolves those roles to Latin Modern Sans with the
same requested sizes, series, and shapes as the class and theme sources.
The existing scalable Latin Modern outlines and metrics are reused rather than
introducing a second text engine.

The TeX Live 2025 Metropolis font theme requests Fira Sans when available; v1
renders it with the Latin Modern Sans profile and reports the substitution
(metric-faithful Fira is a later font profile). Moloch 0.6 no longer selects
Fira in its font-theme source, so it inherits Beamer's active sans family and
does not report that substitution.

Beamer's default math setup remains a separate fidelity surface. The native
math profile may differ visibly from LuaLaTeX's complete Beamer math setup;
that is an accepted v1 gap tracked by the frame oracle (one corpus deck opts
out via `\usefonttheme{professionalfonts}`).

## Core Rendering Architecture

Beamer rendering is a headless `packages/core` feature before it is an editor
mode. The core boundary has three source-backed records:

```ts
interface BeamerDocumentModel {
  source: string;
  preamble: BeamerPreambleModel;
  sections: BeamerSectionModel[];
  frames: BeamerFrameModel[];
  diagnostics: Diagnostic[];
}

interface BeamerFrameLayout {
  frameId: string;
  step: number;
  page: Rect;
  contentArea: Rect;
  items: BeamerPositionedItem[];
  paragraphReports: ParagraphLayoutReport<"document">[];
  vlistLayouts: TexVListLayout<"document">[];
}

interface RenderBeamerFrameResult {
  document: BeamerDocumentModel;
  frame: BeamerFrameModel;
  layout: BeamerFrameLayout;
  svg: string;
  svgModel: SvgRenderModel;
  diagnostics: Diagnostic[];
}
```

The Beamer frontend owns structural commands and environments: frames,
columns, blocks, theme constructs, and overlays. Textual leaves are
`MappedText` values expanded through `expandMacroBindingsMapped` and laid out
by the existing simple-TeX/vlist pipeline. Beamer-specific concepts do not
fork or specialize that generic text IR.

The page layout is a Beamer composition IR, not a `SceneFigure`: theme chrome,
horizontal columns, decorated blocks, text vlists, and atomic embedded
figures are not TikZ scene elements. The emitter lowers the positioned page
items to the existing source-addressed `SvgRenderModel`, preserving stable
part IDs and incremental-diff compatibility. Initially an embedded TikZ
picture may be one transformed nested SVG part; part-level composition is
deferred until in-place figure editing.

The production vlist/glyph SVG renderer currently hosted by the node text
engine becomes a public renderer over `ParagraphLayoutReport` plus
`TexVListLayout`. The headless Beamer result returns those reports directly;
an app adapter may later register them with the existing hit-testing
infrastructure.

This boundary deliberately preserves the facts required by later editing
without implementing editing now: every structural node has an absolute
document span and stable source ID, macro-expanded leaves retain their
`TextSourceMap`, and the positioned layout retains block, line, glyph, caret,
and selection geometry.

### Beamer source fidelity

Implementation constants must cite the Beamer source definition they model.
At minimum the initial profiles are derived from:

- `beamer.cls`: aspect-ratio page sizes, geometry defaults, and base-size
  selection.
- `beamerbaseframe.sty` and `beamerbaseframesize.sty`: frame-title boxing,
  available text height, `[c]`/`[t]`/`[b]` skips, shrink, and footnote
  interaction.
- `beamerbaseframecomponents.sty`: `columns`, `onlytextwidth`, `totalwidth`,
  `T`/`t`/`c`/`b` alignment, minipage construction, and margin behavior.
- `beamerbaseoverlay.sty` plus the overlay decoder: pause counters,
  default overlay specifications, action environments, and keep-space versus
  remove-space behavior.
- The selected outer, inner, color, and font theme `.sty` files. For example,
  Madrid is the composition of its declared color, inner, and outer themes;
  `seahorse` is then applied as a color-theme patch.

Tests and comparison reports record the LuaLaTeX version and relevant Beamer
source version/hash so a TeX Live upgrade changes the oracle explicitly.

## Theme Engine

Beamer's own four-way decomposition is the source-level interface boundary,
but the renderer must not branch on theme names. Theme handling is a
four-stage pipeline:

1. The preamble scanner records theme/component uses and options in source
   order.
2. A preset registry expands aggregate themes (`Madrid`, `metropolis`,
   `moloch`) into the same outer/inner/color/font component patches that their
   `.sty` files apply.
3. A reducer applies those patches, followed by explicit
   `\usecolortheme`/`\usefonttheme` and supported preamble overrides, to
   produce one immutable `ResolvedBeamerTheme`.
4. The frame composer consumes only that resolved record. Structural
   templates return composition boxes/items; the generic SVG emitter knows
   neither theme names nor Beamer color names.

This matters for combinations such as `Madrid` followed by `seahorse`: Madrid
chooses the `infolines` outer structure, while seahorse replaces palette data.
It must not require a `Madrid + seahorse` renderer variant.

A theme is therefore **code for structural templates, data for appearance and
dimensions**:

```ts
interface BeamerThemePreset {
  id: string;
  apply(use: ThemeUse, state: BeamerThemeBuilder): void;
}

interface BeamerTemplateSet {
  headline: BeamerTemplate;
  footline: BeamerTemplate;
  frameTitle: BeamerTemplate;
  titlePage: BeamerTemplate;
  sectionPage: BeamerTemplate;
  block: BeamerTemplate;
  bullets: readonly BeamerTemplate[];
}

interface ResolvedBeamerTheme {
  id: string;
  colors: Readonly<BeamerColorRecord>;
  fonts: Readonly<BeamerFontRecord>;
  dimensions: Readonly<BeamerThemeDimensions>;
  templates: Readonly<BeamerTemplateSet>;
  options: Readonly<Record<string, string | boolean>>;
  appliedComponents: readonly ThemeComponentProvenance[];
}
```

`BeamerTemplate` is a pure layout function over a `BeamerTemplateContext`. It
returns source-addressed composition IR (boxes, text requests, rules, fills,
and child slots), never SVG markup. The context carries frame
title/subtitle, frame number and total, section/subsection structure, document
metadata, slide geometry, current overlay step, and the resolved theme roles.
The composition engine measures requested text and children, resolves
alignment/stretch, and produces positioned items. This keeps measurement out
of theme preset resolution and keeps SVG concerns out of templates.

Presets are records: `default`, `Madrid` (infolines outer), `metropolis`,
`moloch` (+ option handling). Because `\usecolortheme`/`\usefonttheme` and
preamble `\setbeamercolor`/`\definecolor` are data-shaped, they compose as
patches on the record — this is why the appearance dimension must stay data,
not code. Only unrecognized `\usetheme` or structural `\setbeamertemplate`
degrades chrome (see Fallback).

The initial implementation must exercise the resolver against both theme
families before frame rendering grows: `Madrid` + a later color-theme patch,
and `metropolis`/`moloch` + options such as
`progressbar=frametitle`. Theme-specific source constants live only in their
preset/template modules and cite the `.sty` definitions. Frame parsing,
block composition, paragraph layout, embedded TikZ placement, and SVG
emission are theme-independent.

Each structural template is a small, source-addressed layout unit validated
against real Beamer output with the structural and visual comparison
harnesses. A template must distinguish its **painted bounds** from the edge
space reserved for frame layout. For example, Infolines paints its
`ht=2.25ex,dp=1ex` footline boxes, while
`beamerbaseframecomponents.sty` adds a separate 4pt to `\footheight`;
the extra reserve must not enlarge the colored rectangles. Similarly, the
default frame-title color box and `beamerbaseframe.sty`'s trailing `0.25em`
skip are separate dimensions. Template text may provide an explicit baseline
when Beamer positions a color-box baseline independently of the rendered
glyph extents.

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

Beamer compiles one PDF page per step. A LuaLaTeX-compiled frame therefore
*is* the oracle for the step model: page count validates step counting, and
per-page structural and visual comparison validates per-step layout
(including `\only` reflow). The harness follows the existing text comparison
strategy: Lua node/page traces are the primary geometry signal and raster
diffs are a secondary diagnostic normalized against converter noise.

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
- **Frame layout oracle**: compile single frames with LuaLaTeX and compare
  page size, positioned boxes/rules, line breaks, font IDs, glyph codes, and
  glyph positions before raster comparison — the same harness family as
  `compare-tex-text-visual-fuzz.mjs`, with frames instead of nodes.
- **Overlay oracle**: PDF page count = step count; per-page diffs validate
  per-step layout including `\only` reflow.
- **Round-trip property tests**: open → no-op → byte-identical source;
  open → edit one element → diff touches only that element's spans.

## Implementation Phases

### Phase B0: Measurement and Renderer Contract

**Progress (2026-07-23):** The initial source contract and scanner are in
place under `packages/core/src/beamer`: exact document/frame/header/body
spans, frame options and titles, sections/subsections, basic preamble mining,
absolute nested-TikZ roots, recovery diagnostics, and a public
`scanBeamerDocument` entry point. `npm run probe:beamer-frame` compiles a
selected source frame with LuaLaTeX and records the Beamer source
version/hash, TeX page dimensions, PDF page box, positioned structured text,
PDF, and SVG. The frame layout/result contracts, ordered theme-component
resolver, registered structural chrome plans, and initial source-backed
columns/list/glue/TikZ body IR are now in place. The first headless renderer
composes the representative Madrid/Seahorse frame through those boundaries;
broader body nodes, overlay steps, and oracle-driven visual refinement remain.

- Maintain the corpus scanner and add Beamer constructs to the capabilities
  matrix. Scanner metrics must count file-defined macro use inside math and
  other atomic constructs rather than silently removing the main coverage
  signal.
- Define `BeamerDocumentModel`, `BeamerFrameLayout`, and
  `RenderBeamerFrameResult`, including absolute source spans, mapped text,
  retained geometry reports, diagnostics, and `SvgRenderModel` output.
- Extract a public native vlist/glyph SVG renderer from the node text engine.
- Add a LuaLaTeX page-trace/oracle probe and record compiler/Beamer source
  versions in its artifacts.

`npm run compare:beamer-frame -- --input <deck.tex> --frame <n>` now renders
the same selected source frame through the native renderer and the LuaLaTeX
oracle. It writes fixed-size renderer/oracle PNGs, a side-by-side image,
pixel difference and 50% overlay images, both SVGs, and a structured report
under `artifacts/beamer-frame-compare`. The minimal
`test/fixtures/beamer/hello_world_beamer.tex` fixture is the first visual
baseline; it isolates Madrid/seahorse chrome, Latin Modern text, and centered
one-column body placement before the KKT fixture adds lists and embedded
TikZ. The oracle PNG is rasterized directly from the selected PDF page rather
than its diagnostic SVG, because dvisvgm omits Beamer's PGF radial sphere
shadings.

The comparison's primary evidence is now a full-page LuaLaTeX shipout trace,
not its raster diff. The probe walks the final page box without modifying it
and records boxes, painted rules, glyphs, glue, and kerns in integer scaled
points. Glue records retain their natural and effective sizes plus
stretch/shrink orders, so frame-fill behavior can be derived from the final
TeX page list rather than estimated from pixels.
The comparison normalizes those records to the frame contract's top-left,
y-down TeX-point space, then matches native template rectangles and
source-backed paragraph lines against the oracle. Its structural report
contains edge deltas, absolute glyph/baseline deltas, glyph/font agreement,
and unmatched records. Raster differences remain the final check for PDF
literal paths, clipping, images, and antialiasing. Native embedded-TikZ glyph
records are explicitly marked outside the current structural-text coverage
rather than counted as renderer omissions.

The first refinement driven by that report separates Madrid/Infolines paint
from reserved frame insets, uses the `lmsans12` optical design for the
14.4pt frame title, places Infolines text on its TeX baseline, and models the
thin spaces in the total-frame-number template. Default centered frames use
the 1fill:1.5fill top/bottom ratio from `beamerbaseframe.sty`; remaining body
offsets were therefore attributable to the columns/vlist natural-height model
rather than theme chrome. The next refinement preserves Beamer's `T` column
mode in the content IR and composes columns as TeX reference-line boxes with
separate height, depth, and visible-content extents. In particular,
`beamerbaseframecomponents.sty` implements `T` as a top minipage with a
zero-height leading box and `\vskip-1ex\nointerlineskip`; the renderer now
models that construction directly. It also evaluates the frame-title's
trailing `0.25em` after restoring the normal body font, matching
`beamerbaseframe.sty`. On the Hello fixture this reduces the maximum absolute
body baseline delta from about 5.31pt to 0.000012pt. The KKT fixture's
list pass then exposes document-profile list parameters in the shared
simple-TeX/vlist API instead of adding Beamer-only placement code. The Beamer
profile transcribes `\leftmargini` through `\leftmarginiii`, `\topsep`,
`\partopsep`, `\itemsep`, and `\parsep` from
`beamerbaselocalstructure.sty`; the vlist fragment contract additionally
carries the active `\baselineskip` and the preceding external box depth.
This reproduces TeX's interline glue when a source-backed list is laid out
separately from its preceding paragraph. Normalized Unicode paired quotes
also consult their OT1 slots for Latin Modern lig/kern rules, preserving
source-facing Unicode while matching LuaLaTeX's period–closing-quote kern.
On the KKT frame all nine source-backed body baselines now agree within
0.000028pt and body glyph x positions within 0.019792pt. The full-page
maximum x delta is 0.315379pt in the frame title.

Theme-owned itemize markers use the same resolved-template boundary as frame
chrome. The shared list profile accepts measured 1000-units-per-em vector
markers, including negative depth for raised TeX boxes, so marker painting,
VList geometry, comparison bounds, and future editor hit geometry cannot
drift apart. The Madrid `rounded` inner theme resolves to the `ball` template;
its first-level marker transcribes `bigsphere` as a `1.06ex` square raised by
`0.2pt` from `beamerbaseauxtemplates.sty`. The KKT comparison now matches all
four marker rules at 5.153508pt against the oracle's 5.153473pt, leaving zero
unmatched native rectangles or oracle rules. Default triangle, circle,
square, metropolis, and moloch marker families resolve through the same
profile rather than renderer conditionals. Embedded-TikZ glyphs remain
explicitly excluded until their trace is merged.

The next KKT pass uses the geometry frame to calibrate display math and
embedded-picture composition. An embedded `tikzpicture` contributes its
natural PGF bounding box to the enclosing TeX hbox; the standalone SVG
renderer's 12pt presentation padding is therefore disabled at this
composition boundary. The hbox is placed at the column's `\raggedright`
left edge rather than centered. Display skips are now a document-profile
input to the shared VList engine: Beamer's default 11pt profile transcribes
the `size11.clo` `\normalsize` registers instead of inheriting the generic
article/10pt constants. These changes reduce the geometry frame's maximum
matched-glyph vertical delta from 10.134688pt to 0.158409pt (the remaining
maximum is the already-known frame-title baseline); all matched body lines
agree to 0.000004pt. The native diagram path geometry is visually aligned
with the LuaLaTeX page. Embedded-TikZ glyph trace composition is the next
measurement refinement for its node labels.

Root frame flow and column flow now share one reference-box composer rather
than selecting a `columns` node and dropping its siblings. The composer keeps
paragraph VList metrics, ending material depth, column height/depth, and
painted extents distinct. This makes the KKT bound-constrained example's
three leading display/prose groups render before its final columns. The
trailing `\vspace` boundary follows the shipped Beamer list: the display's
depth determines the interline glue to the empty paragraph created by the
columns environment, then the columns hbox is appended on its own reference
line. Matched frame-13 prose and column baselines are now within 1.034pt,
down from an 83.397pt column displacement; display-math rules and glyph-line
grouping still need to be added to the structural comparator.

Exit: the renderer contract is covered by type/tests; scanner reports
trustworthy per-frame construct profiles; a probe can compare a LuaLaTeX
Beamer page's structural geometry.

### Phase B1: Headless Deck Document Model

- Frame + section scanner, render-order list (incl. `\AtBeginSection`
  recognition), preamble mining (theme, colors, title fields, graphicspath,
  macro table).
- Structural frame frontend for paragraphs, lists, blocks, columns, overlays,
  and source-backed fallback nodes. Text leaves reuse `MappedText` and the
  existing simple-TeX frontend.

Exit: any corpus deck produces a document/frame inventory and diagnostics
without app state or source mutation; no-op parsing preserves all source
bytes.

### Phase B2: Headless Frame Rendering, Both Theme Families, Step Model

- Beamer Latin Modern Sans font-role and size profile over the existing
  LuaLaTeX text profile.
- Block layout: frametitle, paragraphs, lists, blocks/theorems, columns,
  center, vspace/vfill, scalebox, native display-math boxes, embedded
  tikzpictures (existing renderer), `\includegraphics` (incl. PDF.js), and
  the core `tabular` subset.
- Theme engine with `default`, `Madrid`, `metropolis`, `moloch`(+options);
  titlepage and section pages; `\setbeamercolor`/`\definecolor` patches.
- Overlay specs parsed into the IR and per-step layout.
- Block/inline fallback placeholders; chrome fallback.
- Drive the Madrid/seahorse KKT fixture to faithful rendering one frame at a
  time, ordered by reusable primitives: calibrate the already-lowered column
  frames (2, 5, 13, 20); add ordinary root flow (3, 4); add
  block/theorem/proof composition (6–12); finish specialized example content
  and overlays (14–19); then finish the title page (1) and run a full-deck
  structural/raster regression.
  Add small dedicated overlay and metropolis/moloch fixtures so the main deck
  does not overdetermine the architecture.

Exit: ≥70% of corpus frames render without frame-level fallback; overlay
oracle passes on frames using `\only`/`\uncover`/`item<>`; theme fixtures
match real Beamer within tolerance.

### Phase B2.5: App and Root Integration

- Generalize figure inventory → document-root inventory and refactor
  per-root session state (`activeFigureId`, compute snapshots, thumbnails,
  source synchronization, viewport persistence, undo grouping) onto it.
- Add deck-mode source cards, slide sorter, selected-step state, and the
  read-only step scrubber using the established headless renderer result.

Exit: any corpus deck opens in the app; the sorter shows render order and
fallback cards; existing TikZ editing remains unaffected.

### Phase B3: Editing

- Canvas text editing over the frame block tree; ghost placeholders;
  formatting toolbar; inspector panes; overlay editing UI; column divider
  drag; insertion templates and slide-type recognition.

Exit: round-trip property tests pass; a corpus deck can have a typo fixed,
a bullet added, an overlay step adjusted, and a slide inserted — all from
the canvas, with minimal diffs.

### Phase B4: Footnotes and Advanced Inline Boxes

- `\footnote`, `\colorbox`, and generic decorated-box rendering for
  recognizable `tcolorbox` uses.

Exit: corpus frame coverage ≥85%; footnotes and common inline/decorated boxes
render correctly across the supported themes.

### Phase B5: Deep TikZ Integration and Authoring Polish

- Free-form overlay layer with existing drawing tools; in-place embedded
  figure editing (coordinate composition); image drag-insertion; outline
  panel; new-deck flow.
- Desktop enhancement: compiled-preview frame fallback via local TeX.

Exit: rectangle-anywhere works and round-trips as `[remember picture,
overlay]`; double-click-to-edit works in place.

## Risks and Tradeoffs

- **Beamer composition is the critical path** (frame glue, horizontal
  columns, decorated boxes, theme chrome, and per-step projection). Generic
  paragraph, list, vbox, glue, display-math, source-map, and caret machinery
  already exists and must be reused rather than forked.
- **Macro expansion can expand without bound.** The expansion subset must be
  explicit and the use-site fallback must be cheap, or coverage work becomes
  a macro interpreter project.
- **Theme fidelity perfectionism.** The bar is "visually correct chrome +
  correct line breaks", with fallback layers absorbing the tail; the text
  stack's near-pixel standard should not be the gate for chrome.
- **Two corpora biases**: 22 decks from one community. The scanner should be
  easy to point at other corpora (e.g. arXiv source of `beamer` decks)
  before locking the subset.
- **Native math vs LuaLaTeX's Beamer math setup** may remain a visible
  fidelity gap in v1; it is measured by the same oracle and stated in the UI
  rather than hidden.
- **Per-step layout cost** is assumed cheap; if profiling disagrees,
  keep-space steps can share layout and only `\only`-bearing frames pay
  per-step.

## Open Questions

- `tcolorbox`: how far should "recognizable simple uses" go? (Corpus
  suggests one or two common shapes per deck, usually via a single preamble
  macro — per-deck recognition may cover most uses.)
- Fira Sans metric profile for metropolis/moloch: when does metric-faithful
  Fira matter vs Latin Modern Sans substitution?
- `\footnote` placement interaction with footline chrome across themes.
- Should the sorter offer a per-step expanded view (one thumbnail per step)
  for overlay-heavy frames?
- File watching / external-change reload semantics when Overleaf or a
  coauthor edits the deck concurrently (desktop: fs watch; web: FS Access
  API polling).
- Where does deck-mode UI live in `packages/app` — a parallel `DeckPanel`
  set, or document-kind switches inside existing panels?
