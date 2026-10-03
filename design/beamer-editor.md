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
- **Theme targets: all 28 presentation themes shipped by Beamer first, then
  metropolis/moloch.** Theme fidelity proceeds through Beamer's reusable
  outer/inner/color/font components rather than 28 renderer branches.
  Metropolis and moloch remain architectural test cases, but do not precede
  complete support for the built-in component families.
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

The initial scan covered 22 real decks (511 frames) found under `~/GitHub` — academic talks in
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
| `\pause` | 4 | 4/22 | uncommon in this initial sample |
| `\setbeamertemplate` | 9 | 4/22 | structural theme hacks are rare |
| `[fragile]` / verbatim | 0 | 0/22 | absent from this initial sample |
| `textpos` / free placement | ~0 | — | overlay-layer drawing is a want, not a need |

Theme usage: 13× `moloch` (maintained metropolis fork, with options
`block=fill, progressbar=frametitle`), 3× `metropolis`, 2× `default`,
2× `Madrid`. Aspect ratio: `aspectratio=169` in 10 decks, rest 4:3.

Consequences adopted in this document:

1. Tables move into the core plan (they were "deferred" in the text-layout
   doc; the corpus says otherwise for slides).
2. Theme presets must accept *options* (`moloch` is used with option lists).
3. Overlay preservation requires broader evidence than the initial low `\pause` count.
4. Macro expansion strategy matters more than any single environment.
5. The initial sample did not establish a priority for `[fragile]`/verbatim;
   the broader review below establishes that code coverage belongs in the plan.

The scanner that produced these numbers is maintained as
`scripts/scan-beamer-corpus.mjs`; the construct list should also join the
capabilities matrix (`packages/core/src/capabilities/`), so subset coverage
is a tracked metric, not a guess.

### Broader source and manual review, 2026-10-02

Eight downloaded source collections now provide 211 candidate entry points.
The conservative expanded-source scanner discovers 3936 frames, or 3666 complete
distinct source forms after exact-source deduplication per repository. These
counts exclude incomplete recovery spans and can miss command-form and
macro-generated frames. They describe this corpus, not general package popularity.

| Feature family | Complete source forms | Collections |
| --- | ---: | ---: |
| Tables (`tabular`, rules, related constructs) | 178 | 7/8 |
| Graphics/paragraph wrappers | 104 | 7/8 |
| Explicit overlays and `\pause` | 482 | 6/8 |
| Aligned display math | 231 | 6/8 |
| Frame sizing/break options | 199 | 6/8 |
| Code/listings/verbatim | 100 | 6/8 |

The second manual review inspected 34 additional source frames across all eight
collections, with 39 native snapshots and 62 generated TeX reference pages.
Thirty-three frames have compiled references; one requires an unavailable private
package. This was a feature-diverse purposive sample, not a fidelity pass-rate
measurement. Author-engine references identify content/flow gaps; typography
scores still require the fixed LuaLaTeX/font profile and valid document state.

The strongest candidates are ordinary composition failures: tables become literal
source, `figure` wrappers hide otherwise loadable assets, math/code block bodies
disappear, and a footnote can replace an entire surrounding list. Built-in
`overprint` with declaration-form `\onslide` produces five TeX states where native
discovery finds one. `allowframebreaks` produces three or four continuation pages
where native emits a single clipped slide. Continuation pages need their own
mapping, separate from overlay states. For `alltt` and `lstlisting`, the immediate
requirement is recognizing unsupported environments and preserving supported
siblings, including inside blocks. Full code typesetting is a separate feature
decision.

The candidate list in [beamer-corpus-todos.json](beamer-corpus-todos.json) records
21 tasks, priorities, standard/package provenance, source paths/frame numbers,
observations, positive controls and unresolved causes. Defined interfaces of
`amsmath`, `graphicx`/`booktabs`, algorithm packages, `pgfplots`,
`tcolorbox` and `siunitx` merit coverage. An author-defined `wideitemize`,
`myboxtitle`, `Procedure` or slide wrapper instead motivates generic expansion of
supported source definitions; those names should not become renderer features.

`compare:beamer-priorities` runs 20 minimal fidelity frames through the existing
exact glyph/font/geometry gates and six code-environment recognition frames
through a separate source-preservation contract. Its manifest links reproductions
to the candidate list. Count mismatches fail without asserting a correspondence
between continuations and overlays; current failures are not accepted goldens.

`scripts/shortlist-beamer-corpus.mjs` selects cases by repository/feature diversity
and optionally reports text-engine literal fallbacks and unsupported/missing
content suspicions. These signals improve triage but cannot certify fidelity:
one inspected `exampleblock` loses both prose and code with no literal fallback
or unsupported item. Paint-aware content coverage and valid full-project oracle
state are separate evaluation TODOs. The ignored gallery is
`artifacts/beamer-corpus-renderer/manual-review-round2/index.html`.

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

The frame inventory is a Beamer semantic projection over the shared TeX CST
syntax index. It consumes flat, source-ordered environment boundaries and
performs name-aware `frame` pairing itself, so malformed unrelated
environments cannot hide a later frame. The same projection collects
`\section`/`\subsection` commands between frames, because chrome (navigation,
section pages) depends on them. Frames nest tikzpictures, so the inventory
becomes shallowly hierarchical.

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

Everything else in the preamble is semantically opaque and preserved
untouched. The whole source is still parsed once by the shared tolerant TeX
grammar; "mining" describes the selective Beamer projection, not a second
raw-source lexer.

## Frame Content Model

A frame body reuses the implemented simple-TeX/vlist IR described by
`design/tex-like-layout-architecture.md` for paragraphs, lists, quotes,
vertical glue, and display math, plus frame-level constructs:

- **Vertical layout root** with Beamer's default vertical centering (`[c]`),
  and `[t]`/`[b]` variants from frame options.
- **`columns` / `column{<dim>}`**: constrained side-by-side vboxes. Widths
  are kept symbolic (`0.48\textwidth`) and evaluated against the theme's
  content geometry; editing the divider rewrites the coefficient. Beamer
  implements each column as a minipage, so inside it `\linewidth`,
  `\textwidth`, and `\columnwidth` all resolve to the column width.
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

Beamer's default math setup is a separate, class-owned font profile rather
than the generic LuaLaTeX math default. Following
`beamerbasefont.sty`, literal Latin variables and digits resolve through the
active sans text family, delimiters and relations use Beamer's `cmss`
operators family, and Greek, symbol, extension, and AMS families remain in
their ordinary Computer Modern math fonts. The math-font request retains the
source symbol so the profile can distinguish literal Latin letters from Greek
commands without inventing a global pseudo-family. A later font-theme pass
must model opt-outs such as `\usefonttheme{professionalfonts}` explicitly.

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

Generic TeX syntax has one authoritative structural interpretation: the
reusable Lezer CST in `packages/lezer-tex`. The TeX document and fragment
parsers use the same grammar; Beamer is an editor-language dialect, TikZ
node-text groups mount the TeX fragment parser, and TeX documents mount the
TikZ parser for `tikzpicture` environments. Core lowers that CST into
source-backed text IR. The native math parser remains a semantic parser below
this boundary: Lezer owns math delimiters, environments, groups, and command
spans, while the math parser owns TeX atom classes, macro meaning, dimensions,
and box construction.

Beamer's document model is a separate semantic projection, not another text
IR. It owns name-aware frame/environment pairing, preamble and navigation
models, overlay semantics, and recovery policy. The implemented boundary is
**one CST, multiple semantic IRs**:

```text
Lezer TeX CST (caller-selected parser/dialect)
        |
        v
shared immutable TeX syntax index
        |
        +-- generic text IR
        |
        +-- Beamer semantic model
              frames, sections, themes, overlays,
              navigation and theorem occurrences
```

`packages/core/src/text/tex/syntax-index.ts` is the sole structural syntax
service. It exposes source-backed control sequences, comments, whitespace,
required/optional/overlay arguments, flat environment boundaries, parser
errors, and binary-search range queries. Generic text lowering and Beamer
consume that same contract. Generic callers may use its bounded parser-keyed
cache; parser identity (and therefore top rule/dialect) is part of the cache
identity. A prepared Beamer revision instead builds one Beamer-dialect
`BeamerSyntaxContext` explicitly and passes it through document, frame-body,
overlay, theorem, and render preparation, avoiding both cross-dialect cache
reuse and per-frame reparsing.

Opaque/verbatim-family handling occurs in the Lezer lexical layer, before
ordinary comment, group, command, or environment tokenization. The external
tokenizer recognizes the supported opaque family and emits one atomic token
from its `\begin{...}` through the matching terminator; an unterminated body
is retained through the source limit with a parser recovery error. The syntax
index projects exact begin/body/end spans from that token. Thus literal `%`,
unmatched braces, or frame-looking text in the body cannot become structural
tokens, and Beamer has no raw-source fallback for these regions.

The shared index exposes flat environment boundaries rather than imposing CST
nesting on semantic consumers. Beamer therefore retains its deliberate
name-aware pairing and edit-state recovery: incomplete frames remain in the
inventory, unmatched or nested frame ends are diagnosed, mismatched unrelated
environments do not suppress later frames, and argument association is bounded
by the current frame/document limit. Semantic parsers over already-delimited
values—overlay interval decoding, dimensions, theorem options, macro meaning,
and math atoms—remain below this syntax boundary.

Generic text rendering, capability reporting, resource discovery,
source-mode projections, hit-map reconciliation, and later editing consume
the CST or its lowered IR rather than recognizing commands independently in
raw source. Raw-source scans may otherwise be used only as non-authoritative
performance prefilters or UI hints. Macro expansion is an explicit pre-CST
phase: it owns expansion semantics and mapped-source provenance, but
downstream consumers parse its materialized result through the shared
frontend. In particular, the shared text frontend produces a
`SimpleTexResourceManifest`, currently retaining command and filename spans
plus parsed options; the target contract also retains the option-argument and
per-entry spans described under Graphics. It can flatten an existing
inline/block IR or traverse the same CST resource nodes over arbitrary
document source before structural layout. The app resolves that manifest
asynchronously before layout and passes the resulting document-local resolver
back to core.

*Implemented for the shared TeX frontend (2026-07-26):* math boundaries,
nested math environments, balanced groups and optional arguments, environment
boundaries, control-sequence identity, comments, whitespace, prose tokens,
graphics discovery, TikZ multipart `\nodepart` splitting, node font/space
normalization, forced-break/restricted-horizontal-mode projections, and
hit-map line-break reconciliation all use the shared CST/IR path. Comments
are zero-width source-backed IR nodes, so rendering ignores them without
losing editor ownership of their spans. The Beamer document, content, overlay,
and theorem frontends now consume the same extracted syntax index; the former
raw lexical scanner and manual frame-option splitter have been deleted.

The resolver contract is `DocumentGraphicsResolver` in
`packages/core/src/graphics`, not a node-text service. The top-level TikZ and
Beamer render options accept it directly. Beamer composition threads the same
instance through chrome/text paragraphs, blocks, columns, and nested TikZ
evaluation so resource identity, cache revisions, and file watching cannot
diverge between rendering layers.

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
selection, and atomic-graphics geometry. `TexVListLayout.graphicsPlacements`
is the renderer-independent image contract: each entry has command and
filename spans, resource identity/status, intrinsic and displayed dimensions,
crop facts, baseline, and bounds in the VList coordinate system. Native TikZ
node text also exposes these entries on its cached render payload and semantic
`SceneText`, so TikZ rendering does not lose the interaction contract. Beamer
lifts frame-text entries into absolute page coordinates and adds them to both
`BeamerFrameLayout.graphics` and the shared item tree. Graphics inside an
embedded TikZ picture remain owned by that nested figure while the picture is
an atomic Beamer item.

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
- `beamerbaseauxtemplates.sty` and `beamerbaseboxes.sty`: block template
  entry/exit skips, rounded-box construction, title/body slots, PGF `bp`
  geometry, transitions, and shadows. Block dimensions must be transcribed
  from these sources rather than inferred from a theme screenshot.
- `beamerbaseoverlay.sty` plus the overlay decoder: pause counters,
  default overlay specifications, action environments, and keep-space versus
  remove-space behavior.
- `beamerbasesection.sty` and `beamerbasenavigation.sty`: the document-wide
  section/subsection/frame entry stream, current navigation state, and page
  ranges consumed by outer themes. Isolated-frame oracle probes must seed the
  corresponding `.nav` topology; compiling only the selected frame with a
  total-frame counter is not a valid navigation oracle.
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
2. A preset registry expands aggregate themes (the 28 shipped presentation
   themes, followed later by `metropolis` and `moloch`) into the same
   outer/inner/color/font component patches that their `.sty` files apply.
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

This split follows Beamer's implementation rather than merely its public
theme naming convention. `beamerbasethemes.sty` implements
`\usetheme`/`\useoutertheme`/`\useinnertheme`/`\usecolortheme`/
`\usefonttheme` as ordered package loaders, and the shipped
`beamertheme*.sty` files are mostly short programs that invoke those loaders
and then apply a few local overrides. Native aggregate presets therefore use
an ordered component list plus a narrow post-component override hook; they
are not independent renderer classes.

Navigation has a separate upstream boundary. `beamerbasesection.sty` writes
section/subsection entries and page ranges, while
`beamerbasenavigation.sty` replays that document-wide `.nav` entry stream
through whichever outer-theme template is active. The native equivalent is
one immutable `BeamerNavigationModel` containing frame, section, and
subsection topology, plus a `BeamerFrameNavigationSnapshot` selecting the
current entries and local frame ordinals. Template planners consume this
snapshot. They must not rescan source spans or reconstruct hierarchy from
`document.frames`, which would couple every navigation family to parsing and
make active/shaded/miniframe state inconsistent.

Presets are records. The built-in aggregate themes expand into shared
components such as `infolines`, `tree`, `split`, `miniframes`, `smoothbars`,
`smoothtree`, `shadow`, `sidebar`, `rounded`, `rectangles`, and their color
themes. Because `\usecolortheme`/`\usefonttheme` and preamble
`\setbeamercolor`/`\definecolor` are data-shaped, they compose as patches on
the record — this is why the appearance dimension must stay data, not code.
Only unrecognized `\usetheme` or structural `\setbeamertemplate` degrades
chrome (see Fallback).

The implementation exercises source-order composition with `Madrid` plus a
later color-theme patch. Metropolis/moloch options such as
`progressbar=frametitle` remain represented by the same interface, but their
fidelity pass follows the shipped themes. Theme-specific source constants
live only in preset/template modules and cite the `.sty` definitions. Frame
parsing, block composition, paragraph layout, embedded TikZ placement, and
SVG emission are theme-independent.

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

- **Resolution target:** `\graphicspath` + relative paths; extensionless
  references try pdfTeX's order (`.pdf`, `.png`, `.jpg`, `.jpeg`, ...).
  Relative paths and extensionless lookup are implemented for desktop-backed
  documents; `\graphicspath` and browser project-directory lookup are not.
- Discovery is a two-stage contract: the shared text frontend emits
  source-backed graphics resources with parsed options (including PDF
  `page`), then the platform asset layer performs filesystem lookup,
  rasterization, caching, and watching. It does not rescan `\includegraphics`
  or parse graphicx options from strings. Discovery currently traverses the
  unexpanded source CST; resolving resources introduced through parameterized
  macros remains to be implemented at the explicit expansion boundary.
- Graphics dimensions remain structured expressions until layout. The IR must
  preserve absolute lengths and expressions such as `.8\textwidth` and
  `\linewidth`, then resolve them against the active `\linewidth`,
  `\textwidth`, `\columnwidth`, `\paperwidth`, `em`, and `ex`. Each graphicx
  option entry retains its complete, key, and value spans so a later resize
  adapter can rewrite only the authored value. *Current status (2026-07-26):*
  implemented for `width` and `height`, including absolute dimensions,
  width registers, `em`/`ex`, ordered duplicate and unknown options, and
  source-map projection of option/key/value spans. Resolution uses the
  paragraph breaker's effective list-local `\linewidth`; minipages reset all
  three local width registers, while parboxes reset only `\linewidth`.
  `trim` and `viewport` deliberately remain absolute in this slice. Ambient
  document registers for graphics inside embedded TikZ nodes remain a
  separate render-request-context task.
- Layout is likewise staged rather than inferred from paint. The inline TeX
  box retains a payload-free `DocumentGraphicsAsset`; paragraph reports carry
  the image as an atomic source-backed segment; the VList then publishes its
  final positioned object. SVG remains only the paint representation and is
  never parsed to recover image bounds or identity.
- Caret policy is explicit: control sequence/options/braces collapse to the
  image's left or right edge, while offsets within the filename map
  monotonically across its width (`filename-linear`). This preserves the
  existing rigorous source-caret contract while allowing a later canvas
  adapter to select the whole graphic or enter filename editing deliberately.
- Layout metadata never retains asset bytes or local filesystem paths. It
  carries the resolver revision and MIME/intrinsic-size facts needed for
  identity and invalidation; the render cache owns the data URI.
- **PDF figures render via PDF.js** (Apache-2.0; poppler/pdftocairo WASM
  rejected on license and maintenance grounds). Raster preview is
  sufficient because the compiled deck embeds the original vector PDF — the
  editor's rendering never reaches the output. Page selection and a capped
  fixed-scale raster preview are implemented. The target is to rasterize at
  `zoom × devicePixelRatio`, embed as `<image>`, and cache by
  `(file hash, page, dpi)`; adaptive rerasterization and DPI-sensitive
  invalidation remain. Size by the **CropBox** (pdfTeX's default box),
  falling back to MediaBox; add an explicit box-selection regression before
  treating that fidelity point as closed. PDFium-wasm (BSD) is the fallback
  engine if PDF.js fidelity disappoints; desktop may later shell out to
  user-installed tools as an opt-in enhancement.
- Web: File System Access API directory handle (Chromium); degraded mode
  elsewhere = placeholder + "locate file". The arXiv source browser is the
  friendlier web path since a tarball provides the whole tree.
- Insertion (drag image onto slide): copy into the project dir (or
  `figures/`), emit `\includegraphics[width=0.8\textwidth]{figures/name}` —
  what the user would have written by hand.

## Fallback Layers

### Bounded source cards (2026-10-01)

The frame/column implementation covers:

1. Preserve unsupported, matched environments as source-backed flow nodes
   before extracting any supported descendants. Ask the native text frontend
   whether it recognizes the opening; leave math, lists, inline wrappers and
   nested block bodies with their existing frontend.
2. Carry cards through frame and column layout. Reserve their estimated height
   for covered overlays, omit removed overlays, and paint only visible cards.
   Failed paragraph layout and whole-body failure also receive source cards;
   empty frames and entirely removed content stay empty.
3. Paint one shared SVG card in the canvas and thumbnails: a label and up to
   three abbreviated lines of escaped literal source. Preview scanning is
   capped at 512 characters and card height at 54pt. These dimensions are an
   editor estimate, not a claim about the unsupported construct's TeX size.
4. Publish the original source span and selectable geometry. Clicking a card
   opens the source panel, selects the exact source and focuses the editor.
   Revealing a card does not edit source or add an undo entry. Stale snapshots
   cannot request selection against a newer source revision.
5. Check mixed flow, columns, unsupported outer containers, overlays, bounded
   previews, markup escaping, source reveal, replacement and undo. Existing
   Beamer rendering tests protect supported math and text behavior.

This completes the basic frame/column source-card path. Per-inline failure
cards and cards nested inside supported block bodies remain out of scope,
with the native text renderer retaining its existing fallback behavior.

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

Parse-level whole-document failure should not exist: the tolerant Beamer
dialect produces a CST and syntax index for incomplete source, while the
Beamer projection pairs flat environment boundaries independently of generic
CST nesting. Unsupported preamble/body content remains source-backed and
cannot by itself prevent discovery of later well-formed frames.

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

### Slide clipboard and drag feedback

The focused Slides panel handles Cmd/Ctrl+C and Cmd/Ctrl+V, plus Copy/Paste in
its context menu. The clipboard holds ordinary LaTeX frame fragments, preserving
comments and source order. Paste inserts after the final selected frame (or into
an empty deck), selects the inserted group, and records one undo entry. Colliding
literal labels and references within the copied group are renamed together.
Complete frame fragments can also be pasted from a source editor; full documents
and unrelated outside commands are rejected. Macro uses keep the destination's
context. Native clipboard actions use the existing platform bridge and clipboard
events; browser shortcuts use clipboard events. Async reads are discarded if the
document, revision or selection changes before they finish.

Dragging multiple slides uses a thumbnail stack marked with the selected count.
The drag preview is removed on drop, cancellation, source change or unmount.
Source dimming retains the source text associated with its frame ranges, so a
coalesced CodeMirror update cannot shift already-updated ranges a second time.

### Slide move analysis

Drag and Alt+arrow reordering use the same analysis before changing source.

- Matching TeX group and conditional branch identities are required. Incomplete
  boundaries and moves that split enclosing constructs are blocked.
- Macro uses are compared by declaration identity before and after the move,
  including transitive references, captured `\let` aliases, and unmoved slides.
  A missing known provider blocks the move; a changed provider requires review.
- Private, zero-argument literal definitions can move with their consumers,
  including pure transitive definitions and aliases. The analysis requires a
  single declaration, matching scope, no outside references, and no unknown
  document commands that could hide consumers. Exact source and comments travel
  with the definition. Shared definitions stay in place.
- Warnings require an identified operation: global definitions, conditional
  definitions, counter updates, or settings/assignments that persist into other
  slides. Ordinary local definitions and formatting travel with their frame.
- Understood macro calls are inspected at their actual bindings, including
  captured aliases, substituted arguments, and defaults that are actually used.
  Stored bodies and unused arguments are not executed. A warning names the
  operation and shows the invocation and definitions through which it runs.
  Literal numeric `\foreach` variables are local to their loop.
- Unknown commands, package environments, computed names, and cyclic or opaque
  expansions do not warn just because their effects are unknown. Expansion is
  bounded, and generated bindings that cannot be resolved stay quiet. This is
  an intentional best-effort check, not a proof that a move is safe in all TeX.
  An unknown `\if...` name needs a matching branch delimiter before it is treated
  as a boundary; known primitives and `\newif` declarations are still checked.
- The stricter proof used for automatic definition relocation remains separate:
  unknown code can hide consumers, so it prevents relocation without creating
  an effect warning. A move that would then lose a known provider is still blocked.
- The existing modal presents the reason and source excerpts. Each excerpt opens
  and selects its exact range in Source. Only reviewable moves offer “Move anyway”.
  The request expires when the document or source revision changes. The reducer
  rechecks the move, so a confirmation cannot override a structural failure.
- A move and any carried definitions are one undo transaction. Section membership
  and ordinary slide numbering changes are expected consequences of reordering.

### Implemented links and manual references

The native Beamer renderer supports `\hyperlink{target}{text}`,
`\hyperref[label]{text}`, `\hypertarget{target}{text}`, and `\label{label}`.
Frame `[label=name]` options define `name` and `name<step>` destinations.
Explicit overlay specifications on labels, targets, and hyperlinks use the
same overlay decoder as frame content. Hyperlink and target text is removed
outside its active steps, following Beamer's `\only` semantics. Reference
lookup uses visibility boundaries and lazy frame aliases so its cost does not
grow with the largest overlay number. HTTP, HTTPS, and mailto `\href` and `\url`
links use the platform's external URL opener.

Manual `thebibliography` environments support `\bibitem{key}`,
`\bibitem[label]{key}`, item overlays, and `\newblock` paragraph breaks.
`\cite[note]{key1,key2}` renders the resolved labels and links each citation
to its bibliography entry's first visible overlay. Numbering restarts in
each bibliography; explicitly labeled items do not advance the counter.
Bibliographies use Beamer's stock `default`/`article`, `text`, `book`,
`online`, and `triangle` item templates. The icon artwork comes from Beamer.
Label widths, left alignment, long-label first-line offsets, author struts,
entry colors, and `\newblock` state follow Beamer's definitions. Local
`\small`/`\footnotesize` retain the class label gap and their size-specific
paragraph spacing.

`test/beamer-bibliography.spec.ts` checks every glyph's position, font and
size, plus icon rectangles, against frozen LuaLaTeX shipout traces with a
0.001pt tolerance. The fixtures cover stock templates, custom labels,
wrapped small/footnotesize text, and bibliographies next to ordinary lists. Regenerate
only from LuaLaTeX with `node scripts/update-beamer-bibliography-oracles.mjs`;
the snapshots include engine versions and source hashes. The default icon
and colors have also been visually compared to the PDF. The 9pt Latin
Modern sans faces are included so `\footnotesize` does not substitute a
scaled 10pt face. Regenerate those faces with
`node scripts/generate-tex-font-data.mjs --fonts=lmsans9-regular,lmsans9-oblique --fonttools-outlines`.

Arbitrary template/font/color redefinitions, BibTeX/biblatex, external
`.bib` files, and PDF link annotations are outside this subset.

`references.ts` builds a document-wide index when the document is prepared.
Each paragraph projects reference commands into existing text/list primitives
after macro expansion, retaining authored source mappings. Link hit regions
are measured in layout coordinates before source remapping, so multi-key
citations and wrapped links retain separate destinations. The canvas adds
these regions above text hit regions in selection mode, and removes them
while a text-edit session is active. Clicking a link changes the active frame
and overlay without changing the source or undo history.

Unknown targets leave their text readable; unknown citations display `?`.
Both produce source diagnostics. Duplicate keys use the first destination
and report a warning. Targets generated by custom macros and full reference
numbering (`\ref`, `\pageref`, `\autoref`) are not implemented. Bibliography
source remains editable, but its generated list is omitted from structural
list topology so Enter cannot accidentally insert `\item` in place of
`\bibitem`.

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
- **Frontend recovery and latency gate**: malformed document/frame/argument
  fixtures, all supported opaque families, generic-vs-Beamer overlay dialect
  ownership, and one-parse prepared-document instrumentation are permanent
  tests. `scripts/benchmark-beamer-frontend.mjs` measures unique source
  revisions of both `scanBeamerDocument` and `prepareBeamerDocument` on the
  20-frame KKT deck. The direct CST cutover artifacts are
  `design/benchmarks/beamer-frontend-{pre,post}-cst-cutover.json`; on the
  recorded Apple Silicon/Node 26 profile the post-cutover result is
  7.792 ms median / 9.331 ms p95 for scan and 7.733 ms median / 8.885 ms p95
  for prepare, within the 8/12 ms and 9/13 ms acceptance budgets.

## Implementation Phases

### Phase B0: Measurement and Renderer Contract

**Progress (2026-07-26):** The source contract and Beamer semantic projection
are in place under `packages/core/src/beamer`: exact
document/frame/header/body spans, frame options and titles,
sections/subsections, preamble mining, absolute nested-TikZ roots, recovery
diagnostics, and a public `scanBeamerDocument` entry point. The projection now
uses the shared CST syntax index end to end; the direct-cutover workstream is
recorded in `design/beamer-cst-scanner-cutover-plan.md`, and no legacy scanner
or fallback remains. `npm run probe:beamer-frame` compiles a selected source
frame with LuaLaTeX and records the Beamer source version/hash, TeX page
dimensions, PDF page box, positioned structured text, PDF, and SVG. The frame
layout/result contracts, ordered theme-component resolver, registered
structural chrome plans, and source-backed columns/list/glue/TikZ body IR are
in place.

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
source-backed paragraph lines against the oracle. Native tracing walks both
paragraph line segments and positioned VList display-math/display-alignment
boxes, so math glyphs on subsidiary array, script, and alignment baselines
participate in the same font/code/position comparison. Its structural report
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
down from an 83.397pt column displacement. Positioned display-math and
display-alignment glyph rows now join the structural comparator as described
above; display-owned rules remain the next geometry-trace extension.

The ordinary-math KKT pass also connects Beamer preamble mining to the shared
mapped macro-expansion contract. Parsed `\def`, `\let`, `\newcommand`,
`\providecommand`, `\DeclareRobustCommand`, and `\DeclareMathOperator`
definitions compile into the same `MacroBinding` representation used by TikZ
and are expanded before paragraph/math layout while retaining use-site source
mapping. The shared context collector resolves definitions visible at each frame's
start, including declarations between slides. Closed frame/group definitions stay
local; bindings are cached per frame for repeated overlay renders. This is a document-level facility, not a list of presentation- or
fixture-specific aliases. It makes the frame-3 `array` and its `\R`, `\act`,
and `\Lagr` commands render through the native math engine.

The same pass keeps math typography and vertical material profile-owned.
Array strut height/depth and AMS alignment baseline skip come from the active
Beamer font role rather than renderer constants. Math style sizes follow
LaTeX's `fontmath.ltx` `\DeclareMathSizes` table—so Beamer's 10.95pt body uses
8pt script and 6pt scriptscript fonts—falling back to NFSS's 0.7/0.5 ratios
only for undeclared text sizes. Font selection then follows the Computer
Modern `.fd` optical-size rules (`cmmi8` at 8pt, not `cmmi7` enlarged to 8pt).
AMS alignment lowering carries the active `\baselineskip`, `\lineskip`,
`\lineskiplimit`, and `\jot` across the math/VList contract; the VList applies
the resulting `\openup\jot` registers instead of reverting to article-class
constants.

The math SVG contract emits 100 internal units per TeX point; the paragraph
renderer converts those units with one fixed `0.01` transform, while
individual glyph paths own the font-size scale. This prevents non-10pt Beamer
math from being scaled twice even when its traced font metrics are correct. In
vertical flow, relative `em`/`ex` glue resolves against the active font, and a
post-display `\vspace` remains an explicit `\vadjust`-like attachment after
the resumed paragraph line, including the source interword space that follows
the command. Frame-fill placement measures the first material box for TeX's
initial `\topskip`, rather than the aggregate paragraph VList height.
Ragged Beamer text retains the active font's finite interword stretch and
shrink for line-break feasibility, while LaTeX's `0pt plus 1fil` right skip
absorbs positive slack and therefore leaves ordinary underfull spaces at their
natural widths. Centered material similarly delegates alignment to its margin
glue. Template struts provide fixed baselines such as the default frame title.

Rounded blocks now follow the same theme-template boundary as chrome and list
markers. The frame frontend lowers `block`, `alertblock`, and `exampleblock`
to source-backed nodes both at the frame root and inside columns; the
composer asks the resolved block template for semantic color/font roles and
source-derived geometry. Madrid's `rounded` inner theme therefore selects one
`beamer/block/rounded-shadow` plan instead of renderer-side theme checks. Its
initial geometry transcribes the `4bp` outer extent, `3bp` rounded inset,
`1.5pt` title-depth floor, title/body transition, and body lead from
`beamerbaseauxtemplates.sty` and `beamerbaseboxes.sty`.

The frame-20 oracle pass also fixes two reusable vertical-box contracts
exposed by `center` followed by `[T]` columns. Initial interline glue uses the
active named-size baseline (`\Large` is 14.4/18pt in Beamer's 11pt class)
rather than the enclosing text VList height, and a glue-ending paragraph
carries its real final line depth into the following columns hbox rather than
the wrapper vbox depth. The Beamer adapter accounts for the class's natural
9pt center-trivlist `\topsep` where the generic text profile expresses
`.8em`. On the Takeaways frame, all 16 text lines and 307 glyphs match the
LuaLaTeX trace with matching font IDs/codes; maximum glyph deltas are
0.003519pt horizontally and 0.014666pt vertically.

The following block/list pass keeps the shared VList responsible for list
internals while making the Beamer frame/column composer retain class-owned
outer skips at source-fragment boundaries. A root block always contributes
the rounded template's trailing `\smallskipamount`; column blocks and
list-ending paragraph fragments contribute their trailing skip when another
column item follows. Root list markers are emitted from the same resolved
theme profile as column markers, so comparison rectangles and painted
geometry share one source of truth.

Frame 6 also exposes why Beamer's inherited `\raggedright` cannot be modeled
as shrink-only word glue. Its infinite right skip makes loose lines free while
the font's finite shrink still admits the final word on a nearly full line.
The generic paragraph option now preserves an explicitly infinite right-skip
stretch, reproducing that TeX model without a Beamer-specific breaker. The
same comparison found a generic native-math discrepancy: a superscript on a
single-character math alphabet such as `\mathbb{R}^m` must use character-noad
script shifting, not apply `\supdrop` to an artificial alphabet wrapper.
After those fixes, frames 6, 7, 19, and 20 have zero unmatched text rows and
matching glyph codes/fonts; frame 6 compares all 575 glyphs with maximum
deltas of 0.003519pt horizontally and 0.014664pt vertically. Previously exact
frames 2–4 retain their oracle agreement.

The theme-fidelity pass then separated frame composition, embedded TikZ,
theme-vector markup, rounded-shadow paint, title-page planning, and block
planning into explicit renderer boundaries. The class-default templates are
now measured independently from Madrid rather than inheriting rounded-theme
constants: an empty-background frame title uses Beamer's smaller colorbox,
the default title page uses its unwrapped colorbox dimensions, and itemize
triangles are traced as the real raised `msam10` glyph. Default blocks follow
`beamerinnerthemedefault.sty` at the vertical-list level: the title line owns
the outer inter-line calculation, the body colorbox starts its first baseline
at the active `\baselineskip-.25ex`, and glue preserves `\prevdepth`.
`npm run compare:beamer-themes` runs both the Madrid/Seahorse and class-default
variants through the same materialized input and LuaLaTeX oracle. All 20 KKT
frames and the three dedicated conformance frames pass the structural
contract for both variants.

The comparison matrix also emits a self-contained `index.html` gallery.
`--variants built-in` expands to the 28 current presentation themes shipped
as `beamertheme*.sty` files (excluding legacy compatibility aliases), while
removing the fixtures' explicit Seahorse patch so each aggregate theme is
measured as shipped. The gallery provides theme/deck/slide navigation plus
split, wipe, overlay, and difference views, structural metrics, diagnostics,
and report links. The initial three-slide baseline contains 84 raster
comparisons: default and Madrid account for the six passing comparisons; the
remaining entries intentionally document the unimplemented component gap.

The navigation infrastructure now mirrors Beamer's auxiliary-file boundary.
Scanning produces one immutable topology model and a frame-local snapshot;
the oracle materializer writes the equivalent `\sectionentry`,
`\beamer@subsectionentry`, `\slideentry`, frame-page, document-page, and total
frame records to the isolated probe's `.nav` file, then restores the selected
frame's current section and subsection state. This prevents a theme comparison
from silently using an empty headline merely because the probe omitted the
original compilation's auxiliary state.

The direct `infolines` outer-theme pass is the first consumer of that
contract. Its two half-page headline color boxes, `2.65ex` height plus
`1.5ex` depth, 6pt Latin Modern Sans labels, `2ex` horizontal padding, and
shared baseline are transcribed from `beamerouterthemeinfolines.sty`.
Section and subsection text remain separate source-backed paragraphs in the
native layout, while the comparison trace clusters co-baseline fragments into
the same visual glyph line exposed by LuaTeX. All three frames of the
navigation fixture pass the structural contract with no unmatched rules or
text lines, matching glyph codes/fonts and a maximum position delta below
0.007pt.

The first palette/aggregate pass transcribes the shipped wolverine, rose,
dolphin, beaver, and spruce color programs, including their xcolor mixes and
source-order interaction. This unlocks AnnArbor, Boadilla, CambridgeUS, and
EastLansing as ordered aggregate records rather than renderer branches.
Their local font, headline-option, and item-marker overrides remain data on
the resolved theme. The same pass distinguishes rounded templates with and
without shadows and models Beamer's empty-background rule: a rounded title
page whose title color has no background uses the ordinary colorbox geometry.
Across the 20-frame KKT deck and three-frame conformance deck, all 92
comparisons for these four aggregates pass with zero unmatched rectangles or
text lines and matching glyph codes/fonts.

The shared tree/split/miniframes pass follows
`beamerouterthemetree.sty`, `beamerouterthemesplit.sty`, and
`beamerouterthememiniframes.sty` rather than implementing aggregate themes
one by one. Pure template planners consume the existing document navigation
snapshot and emit section/subsection labels, active/shaded states, mini-frame
markers, separation rules, and footline metadata as ordinary composition
primitives. Aggregate records then unlock Antibes, Montpellier, Luebeck,
Malmoe, Copenhagen, Berlin, Dresden, Ilmenau, Szeged, and Singapore by
applying the ordered components and local overrides from their respective
`beamertheme*.sty` sources. Singapore's centered frame title, circle marker,
and 1.25cm head fade remain data/template choices; neither the page composer
nor SVG emitter checks the aggregate theme name.

The same oracle pass generalizes two non-navigation details exposed by those
themes. Non-empty default block colors select
`beamerinnerthemedefault.sty`'s `.75ex` colorbox geometry from resolved color
roles, rather than from a theme list. Frames whose navigation chrome reduces
the available body height use Beamer's flexible list glue from
`beamerbaselocalstructure.sty`: list scopes participate in the enclosing
vbox's single stretch/shrink ratio, while real nested TeX vboxes retain an
independent ratio. This fixes the densely filled KKT frame 17 without a
frame- or theme-specific adjustment.

All three section-aware conformance frames and all 20 KKT frames now pass the
structural oracle for each of these ten aggregate themes: 30/30 and 200/200
comparisons respectively, with matching glyph codes/fonts and no unmatched
text lines or template rectangles. The built-in-theme HTML gallery includes
both decks. Structural-only runs reuse the retained native and LuaLaTeX SVGs,
so adding the KKT deck does not require rerunning rasterization or retaining
PDF/compiler intermediates; themes without results for the selected deck are
disabled in the gallery navigation.

The smooth-navigation family follows
`beamerouterthemesmoothbars.sty`, `beamerouterthemesmoothtree.sty`, and
`beamerouterthemeshadow.sty` at the same component boundary. Shared planners
emit smoothbar mini-frame navigation, smooth-tree section/subsection rows,
gradient frame titles, and shadow layers; Darmstadt, Frankfurt, JuanLesPins,
and Warsaw only assemble those planners with their shipped color, font, and
inner-theme components. In particular, `shadow` composes the existing
`split` planner just as Beamer loads `split`, rather than duplicating its
headline. The generic vector primitive contract now carries source-role
gradient stops, so the SVG backend owns gradient serialization while theme
planners own geometry and color roles.

Oracle measurements also preserve a non-obvious TeX layout fact from
`smoothbars`: Frankfurt's subsection-free headline is an overfull two-row
template whose declared height/depth does not cover all painted content.
Frame-title and body placement therefore use the template's actual TeX box
contract instead of deriving an inset from the visible gradient. All three
conformance frames and all 20 KKT frames pass for each of the four aggregates:
12/12 and 80/80 comparisons, with matching glyph codes/fonts and no unmatched
text lines or template rectangles. The retained gallery now contains KKT
comparisons for 14 built-in themes and passes 340 of 364 entries; the remaining
24 entries identify the unimplemented sidebar/inmargin family.

The sidebar/inmargin pass follows `beamerouterthemesidebar.sty` and
`beamerinnerthemeinmargin.sty` as shared page and flow components. Responsive
or absolute sidebars are part of resolved page geometry, producing a
sidebar-independent frame area and text area; canvas, title, section, and
subsection templates then consume those rectangles without aggregate-name
checks. Berkeley, Goettingen, Hannover, Marburg, PaloAlto, Pittsburgh, and
Rochester are ordered assemblies of that outer component and their shipped
color/font/inner overrides. Bergen uses the same responsive geometry with
the source's `.25\paperwidth` left sidebar, but its inmargin inner component
owns the two-column block/title-page flow and its special list margins.

The narrow sidebar layouts also exposed two generic horizontal-list facts.
A source space after display math remains ordinary stretchable/shrinkable
glue when horizontal mode resumes; it is not a fixed first-line indent.
Likewise, whitespace immediately before horizontal-mode `\vspace` precedes
the non-discardable `\vadjust` node and therefore remains in the final line's
glue set. Both rules now live in the TeX paragraph model, including source
spans for glyph/caret reporting, rather than in Beamer composition. All
three conformance frames and all 20 KKT frames pass for each of the eight
aggregates: 24/24 and 160/160 comparisons, with matching glyph codes/fonts
and no unmatched text lines or template rectangles.

The retained gallery is now complete for the built-in presentation themes:
all 28 themes have three section-aware conformance comparisons and all 20
KKT comparisons. The resulting 644/644 structural checks pass, with maximum
observed deltas of 0.012371pt horizontally for matched glyphs, 0.002795pt
vertically, and 0.007003pt for matched template-rectangle edges.

The first multi-page overlay contract is also implemented. A source-backed
overlay program resolves explicit intervals, open ranges, relative `+`/`.`
specifications, and `\pause` against one frame-local counter. It covers
`\only`, `\uncover`, `\visible`, `\invisible`, braced `\onslide`, `\alt`,
`\temporal`, the corresponding simple environments, explicit `\item<...>`,
and list-level `[<+->]` defaults. Remove-mode branches are projected out
before line breaking. Covered text and list branches retain source/caret
geometry, covered structural nodes retain their layout footprint, and both
suppress paint. `renderBeamerFramePages` returns every concrete step while
`renderBeamerFrame` remains the single-page entry point.

The dedicated five-frame overlay fixture emits 12 pages, all of which pass
the LuaLaTeX structural oracle. The comparison trace records covered glyph
lines and marker rules separately because LuaTeX retains those nodes even
when Beamer's PDF paint state makes them invisible. Maximum visible-content
deltas are 0.003514pt horizontally, 0.000012pt vertically, and 0.007003pt
for template edges. Action-qualified overlays such as `\alert<...>` and
arbitrary `\beamerdefaultoverlayspecification` changes remain later work.

The theorem-family frontend follows `beamerbasetheorems.sty`,
`beamerinnerthemedefault.sty`, and `beamerbaseauxtemplates.sty`. Built-in
theorem, definition, example, proof, and compatibility environments are
source-independent declarations in the preamble model; user `\newtheorem`
and `\newtheorem*` statements add ordered, source-backed declarations with
their active `\theoremstyle`, shared counter, and reset counter. As with the
existing macro-definition pass, declaration syntax is collected separately
from uses and command bodies are excluded from accidental rescanning. Frame
lowering resolves the declaration visible at each environment begin and
assigns counters once in document order, independently of overlay pages.

The resulting theorem node is a semantic specialization of the shared block
contract: it selects the ordinary/example block environment, supplies a
generated but source-owned heading, and carries theorem style, template,
counter, overlay, and proof/QED facts. Theme-owned block planners still own
all chrome and geometry. The ordinary text engine owns the heading/body
faces—including Latin Modern Sans 12pt oblique for AMS remark headings—and
the QED symbol is emitted from the exact `amsthm` open-box dimensions. This
keeps themes, source mapping/caret geometry, and overlay retention composable
instead of introducing theorem-specific SVG layout.

The default, numbered, AMS-style, and normal-font fixtures currently produce
12 pages, all passing the LuaLaTeX structural oracle with matching glyph
codes/fonts and no unmatched text lines or template rectangles. Supported
counter behavior includes shared theorem counters, starred declarations, and
Beamer's `envcountsect` section reset. Custom `\newtheoremstyle` definitions,
counter-printing redefinitions beyond the section form, translated theorem
names, and display-aware `\qedhere` placement remain later extensions.

Implementation follows shared source components, not alphabetical theme
names: first palette/inner-marker variants and frame-title alignment; then
Infolines; tree/split/miniframes; smoothbars/smoothtree/shadow; and finally
sidebar/inmargin page geometry. Each component pass is applied to every
aggregate theme that imports it and rerun through the gallery. Metropolis and
moloch can now begin from this green built-in matrix.

Aggregate presets are exposed only when every nested component and local
override needed for a faithful result is registered. In particular, the
Infolines headline alone does not make AnnArbor, Boadilla, CambridgeUS, or
EastLansing complete: their shipped definitions also require the wolverine,
rose/dolphin, beaver, or spruce color themes and theme-local font, marker, or
headline overrides. Registering those names early would turn a known
component gap into a misleading partial implementation.

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

### Phase B2: Headless Frame Rendering, Built-in Themes, Step Model

- Beamer Latin Modern Sans font-role and size profile over the existing
  LuaLaTeX text profile.
- Block layout: frametitle, paragraphs, lists, blocks/theorems, columns,
  center, vspace/vfill, scalebox, native display-math boxes, embedded
  tikzpictures (existing renderer), `\includegraphics` (incl. PDF.js), and
  the core `tabular` subset.
- Theme engine covering all 28 shipped presentation themes through their
  shared outer/inner/color/font components; titlepage and section pages;
  `\setbeamercolor`/`\definecolor` patches.
- Overlay specs parsed into the IR and per-step layout.
- Block/inline fallback placeholders; chrome fallback.
- Drive the Madrid/seahorse KKT fixture to faithful rendering one frame at a
  time, ordered by reusable primitives: calibrate the already-lowered column
  frames (2, 5, 13, 20); add ordinary root flow (3, 4); add
  block/theorem/proof composition (6–12); finish specialized example content
  and overlays (14–19); then finish the title page (1) and run a full-deck
  structural/raster regression.
  Add a small dedicated overlay fixture so the main deck does not
  overdetermine the architecture.
- After every built-in aggregate passes its conformance/KKT matrix, add
  dedicated metropolis/moloch fixtures and implement those theme families
  through the same component/template boundary.

Exit: ≥70% of corpus frames render without frame-level fallback; overlay
oracle passes on frames using `\only`/`\uncover`/`item<>`; theme fixtures
match real Beamer within tolerance.

### Phase B2.5: App and Root Integration

**Core prerequisites (Milestone 0).** Mapping the app boundary (2026-07-24)
found two gaps in the headless surface:

1. **Prepared document session — done (2026-07-24).**
   `prepareBeamerDocument(source): PreparedBeamerDocument`
   in `packages/core/src/beamer/render.ts` hoists scan, theme resolution,
   page geometry, macro bindings, navigation topology, and the document-wide
   theorem-occurrence pass (previously re-run inside every
   `parseBeamerFrameBody`) into one shared context, caches frame body IRs
   lazily, and exposes `frameStepCount` from the overlay scanner without
   rendering. Since the 2026-07-26 syntax cutover, that context also owns
   exactly one Beamer-dialect CST/syntax index for the complete source
   revision and supplies it to all frontend passes.
   `renderBeamerFrame`/`renderBeamerFramePages` are one-shot wrappers over it;
   equivalence, error behavior, and the one-parse invariant are covered by
   `test/beamer-prepared-document.spec.ts`.
2. **Basic frame/column source cards are implemented (2026-10-01).**
   Unsupported flow nodes retain their source spans and estimated geometry,
   and paint a bounded source snippet. The shared renderer also supplies
   thumbnails. Inline and nested block-body cards, sorter-specific fallback
   presentation and per-frame coverage reporting remain separate work.

**Root generalization is a re-architecture pass, not a bolt-on.** The app
encodes "a document is a list of tikzpictures" through ad-hoc mechanisms
that must be replaced with explicit abstractions rather than extended.
*Implemented (2026-07-24):* the four bullets below are implemented — root id
codec (`packages/core/src/document/root-id.ts`), `rootKey` for per-root
ephemeral state (`packages/app/src/root-key.ts`; the thumbnail cache stays
content-addressed and navigator scroll document-scoped by design), named
policies (`packages/app/src/root-inventory.ts`: `parseWindowRootId`,
`hasMultipleRoots`, `reconcileActiveRootSelection`), `documentKind`
detection (`packages/core/src/document/kind.ts`, projected on
`EditorState`), and `activeRootId` with workspace persistence v4. Core
parse options keep `activeFigureId` (the TikZ parse window is genuinely
figure-scoped); app call sites map explicitly at that boundary. The deck
compute path adds a kind-tagged `deck` section to `SessionSnapshot`; changing
the entire snapshot into a strict discriminated union remains an optional
cleanup because the transitional shape still carries nullable TikZ fields:

- One shared root-id codec owns TikZ figures, Beamer frames, and nested frame
  TikZ roots; call sites no longer parse id strings ad hoc.
- Per-root ephemeral state keys use `rootKey(documentId, rootRef)`. The
  thumbnail cache remains content-addressed and navigator scroll remains
  document-scoped by design rather than being forced into that record.
- Explicit root-inventory policies replace `figures.length` as a proxy for
  auto-selection, navigator visibility, dock behavior, source dimming, and
  status reporting.
- `EditorState.documentKind` is detected from the source and
  `activeFigureId` has become `activeRootId`, with the workspace persistence
  migration applied. Core TikZ parse options deliberately retain
  `activeFigureId` at their figure-scoped boundary.

**Decisions (2026-07-24):**

- **CanvasPanel becomes root-kind-aware now**, rather than adding a
  parallel read-only deck canvas: B3 canvas editing follows immediately, and
  a temporary fork risks becoming permanent. Shared infrastructure
  (viewport/zoom, SVG layer + DOM patcher, hit-testing, canvas text
  editing) is factored so TikZ-specific interaction controllers are
  isolated; the deck controller starts as read-only + step scrubber, and
  the deck canvas is page-bounded with fit-to-view zoom.
- **FigureNavigator is rewritten**, not extended. The replacement is a
  root navigator over the document-root inventory with flexible layout
  (horizontal strip / vertical strip / grid) used by both modes; section
  headers, step badges, fallback/source cards, and drag-sorting are
  deck-mode features of the same component. The thumbnail worker gains a
  root-kind discriminant instead of unconditionally rendering tikz.

*Implemented through 2026-07-25:* the first deck view works end-to-end in the
web app. `SessionSnapshot` carries frame inventory, titles and step counts,
and the selected frame/step page. A module-level compute session reuses
`prepareBeamerDocument` and memoizes pages per frame/step. The canvas shows
the frame through the existing SVG layer with a step scrubber (buttons +
arrow keys); TikZ interactions are inert on the empty deck scene and the
reducer rejects edit actions in deck mode. The navigator, thumbnail worker
(final-step renders, step badges, and path-free graphics preview bundles),
dock auto-open, source dimming/caret sync and Beamer diagnostics, and status
bar consume deck frames as roots. Browser code no longer pulls the
Node-backed corpus helpers through the core package root.

*Remaining:* typing still invalidates the whole prepared session per
keystroke and needs `TreeFragment`-backed incremental CST parsing plus
frame-level IR reuse across revisions. Inline and nested block-body source cards, chrome-level
diagnostic badges, deck-aware inspector panes, and a dedicated
open→no-op→byte-identical Beamer round-trip test also remain.

Exit: any corpus deck opens in the app; the sorter shows render order and
fallback cards; existing TikZ editing remains unaffected.

*Implemented 2026-10-02:* `RootNavigator` now serves both Figures and Slides
through the existing dock panel and thumbnail worker. It adapts to a short
horizontal strip, a narrow vertical list, or a wide grid. Slides show the
final overlay with a step count, while the canvas retains its viewed step.
Source section/subsection headings collapse their descendants. The Slides
panel remains available for zero or one frame.

Click opens a slide; Shift selects a range; Cmd/Ctrl toggles selection.
Selected slides move together in source order by dragging, with an insertion
marker on either side of a frame or section heading. Alt+arrow moves the
selection from the keyboard. New slide inserts an empty frame after the
selection; Duplicate and Delete are available in the context menu and via
Cmd/Ctrl+D and Delete. Undo/redo restores the active frame, selection, and
viewed overlay steps. Each operation is one source transaction.

Frame source, including directly attached comment lines, travels intact;
section commands and unrelated inter-frame code remain in place. Copies get
fresh literal labels and update links within the copied group. Incomplete
frames and frames owned by TeX groups or enclosing environments remain
source-editable. Whole-section moves, arbitrary generated frames, and
renaming computed label expressions are outside this manager's scope.

### Phase B3: Editing

The canvas editing UX is specified in `design/beamer-canvas-editing.md`
(2026-07-30): scope-wide editing sessions (column / frame body / title),
a two-surface focus model (canvas WYSIWYG keys vs docked-bar source keys),
three-tier selection, and the object layer. Its Stage 1–3 sequencing
refines the bullet below.

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
- **Font-theme math overrides** such as `professionalfonts` remain a fidelity
  surface beyond the default Beamer sans-math profile; they are measured by
  the same oracle and must be represented as profile changes rather than
  hidden substitutions.
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
- ~~Where does deck-mode UI live in `packages/app` — a parallel `DeckPanel`
  set, or document-kind switches inside existing panels?~~ Resolved
  2026-07-24: root-kind-aware existing panels (see Phase B2.5 decisions);
  no parallel panel set.
