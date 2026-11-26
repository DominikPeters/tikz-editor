# Beamer posters (beamerposter)

Status: design, 2026-11-26, revised the same day after two reviews (Fable,
with TeX probes; codex `gpt-6.2-sol`) and restructured so that the general
parts stand on their own. Nothing implemented yet.

Posters made with `\usepackage{beamerposter}` open and edit as Beamer
documents, rendered natively at all times, as for decks. The package itself
is small. Most of the work is general and has its own design:

- [Preamble execution and template interpretation](beamer-preamble-and-templates.md):
  local theme files, lengths, and `\setbeamertemplate` bodies laid out as
  LaTeX content. Almost every poster uses a theme of its own.
- [Runtime fonts](runtime-fonts.md): fontspec fonts through harfbuzzjs, and
  pdfLaTeX font packages.
- [Body content](#body-content) below: constructs posters use often and decks
  use too.

This document covers what is specific to posters: the corpus, the package,
poster editing operations and the first milestone.

## First milestone

One vertical slice: the Gemini template poster rendered and editable end to
end, compared against TeX. It takes from the general designs what Gemini
uses: preamble execution with lengths and `ex`, the headline, block and
footline templates, Lato and Raleway, and `beamercolorbox`. Done means:

- the comparison harness passes for the poster's page, colour boxes, blocks
  and text lines;
- edit and undo work on the title, a block title and block text;
- layout and keystroke latency are measured at A0 against a stated budget.
  Missing the budget may require incremental layout within a frame before
  more work.

The effort for the rest is estimated after the slice. A first estimate of
8–11 weeks for the whole was judged optimistic by both reviews, by up to a
factor of two.

## Scope

[beamer-editor.md](beamer-editor.md) listed poster classes as a non-goal;
this design reverses that. Out of scope: tikzposter (a separate document
kind, not designed here), pgfplots (its own add-on, needed by 18 poster entry
points and 21 project trees regardless), `textpos`, CJK (`ctexbeamer`, 2
entries).

## Corpus

The corpus lives in the ignored `artifacts/beamerposter-corpus/`
(`README.md`, `index.json`). Reference PDFs: 36 local TeX Live 2026 builds
(one with bibliography errors) and 45 published PDFs. 25 entries do not build
locally (missing fonts, logos, legacy packages); 13 of them have a published
PDF.

Themes by distinct project:

| Theme | Projects |
|---|---:|
| Gemini and forks (Oxford, institutional variants) | 15 |
| confposter (Jacobs lineage) | 5 |
| LLT-poster | 5 |
| ZH | 3 |
| Stock Beamer themes (Berlin, default) | 4 |
| Inline templates in the poster preamble | 5 |
| One-off themes | about 30 |

Gemini is one author's theme, forked: there are eight byte-distinct copies of
`beamerthemegemini.sty`. The one-off themes are where the distinct authors
are, and evidence is weighed by distinct authors, not by files.

Package options: `size` 68, `scale` 68, `orientation` 55, `debug` 17,
`width`/`height` 16. beamerposter is loaded directly in 68 entries, through a
theme in 4, through a shared input file in 3 (ICML 2026, inside a macro with
an optional argument), through a local package in 2.

Engines: pdfLaTeX 42, LuaLaTeX 18, XeLaTeX 11, unrecorded 6.

Frames per entry file: one in 69, two in 2, four in 2, none in 4 (frames in
`\input` files).

Body content (projects): `columns` 59, `block` 49, `itemize` 48, `figure` 38,
booktabs 38, `tabular` 25, `alertblock` 22, `tikzpicture` 20, `minipage` 18,
pgfplots 18, tcolorbox 15 (mentioned anywhere in the project), `exampleblock`
13, `beamercolorbox` in the body 8, `multicols` 5. About 28 projects include
PDF or EPS graphics.

## The package

beamerposter 1.13 (`texmf-dist/tex/latex/beamerposter/beamerposter.sty`),
with behaviour confirmed by pdfLaTeX probes:

- **Size.** `size=a0b|a0|a1|a2|a3|a4|custom` selects the paper and a
  `fontscale` of (1/√2)^k relative to A0. `custom` takes `width` and `height`
  in cm; `width`/`height` without `size=custom` are ignored. Invalid values
  are ignored with a warning.
- **Orientation.** The portrait flag starts false. Omitting the option, or
  giving an invalid value (Liège's `lanscape`), gives landscape; a bare
  `orientation` gives portrait. The size table is landscape and portrait
  swaps width and height. `custom` is applied after the swap, so
  `orientation` has no effect on a custom size (5 corpus entries combine
  them).
- **Text area.** The package's table of text dimensions and its `\FPupn`
  custom-size arithmetic are overwritten by its later
  `\geometry{hmargin=1cm, vmargin=0cm, head=0.5cm, headsep=0pt, foot=0.5cm}`.
  The text width is the paper width minus 2 cm (A0 landscape: 3326.13 pt;
  custom 100 × 50: 98 cm). Beamer then derives the text height from its
  measured head and foot.
- **Precedence.** Later assignments to `\paperwidth`/`\paperheight` win.
  Berkeley requests A0 and then sets 48 × 36 in, which its PDF confirms.
  beamerposter after `aspectratio=169` (Helmholtz) wins over the aspect
  ratio.
- **Font scale.** `\myfontscale` = `scale` × `fontscale`, rounded to two
  decimals; each size is the A0 entry × `\myfontscale`, rounded to two
  decimals again (A1 at scale 1: 0.71, so `\normalsize` is 17.66 pt). A0
  entries: `\tiny` 12/14, `\scriptsize` 14.4/18, `\footnotesize` 17.28/22,
  `\small` 20.74/25, `\normalsize` 24.88/30, `\large` 29.86/37, `\Large`
  35.83/45, `\LARGE` 43/54, `\huge` 51.6/64, `\Huge` 61.92/77, and the new
  `\veryHuge` 74.3/93, `\VeryHuge` 89.16/112, `\VERYHuge` 107/134.
- **Size commands change size only.** Each is `\fontsize{…}{…}\selectfont`,
  so selecting a size does not apply the class's per-size display and list
  registers; those stay at their class-size values (at A0 from an 11 pt
  class, `\abovedisplayskip` is 11 pt). `beamer/theme/font-sizes.ts` models
  those resets for decks; the poster profile must not apply them.
- **`\normalfont`** is redefined as `\normalsize`. It no longer resets
  family, series or shape (`{\bfseries\normalfont …}` stays bold), which
  affects `\textnormal` and any template that uses it.
- **Lists.** `\leftmargini` 4em, `ii` 2.2em, `iii` 1.87em, `\labelwidth`
  1em, `\labelsep` 1em, each × `\myfontscale` (rounded), evaluated once at
  package load in the class's font, not the poster's. A0 from an 11 pt
  class: `\leftmargini` is 43.8 pt, under two ems of body text. The values
  depend on the class size option.
- **Bibliography item** template `beamerposterarticle`, a scaled article
  icon. The `debug` option only logs; `grid` draws Beamer's grid background.

In the engine, `beamer/geometry.ts` takes the page from the `aspectratio`
table today; a beamerposter document takes it from the package. The package
options are read through [preamble execution](beamer-preamble-and-templates.md#preamble-execution),
wherever the package is loaded.

## Body content

Posters lean on these, and decks use them too; they are built as general
features:

- `beamercolorbox` in the body (8 poster projects), sharing the template
  interpreter's box.
- `multicols` (5), nested `columns`, `columns[t]`, `\vfill` distributed down
  a full-height column, and `\separatorcolumn`-style user macros over
  lengths.
- Bibliographies: `thebibliography`, BibTeX output and biblatex, with the
  themes' `bibliography item` templates (26 poster theme files).
- PDF and EPS graphics (about 28 poster projects) on web and iPad.
- tcolorbox in the body.
- Overflow: posters routinely overfill the page. Overflowing content stays
  visible and marked rather than clipped. Decks overfill too.

## Poster editing

- **Page.** Size, orientation and scale in the document inspector, writing
  the beamerposter options (or the custom width and height).
- **Columns.** Resizing a column writes the length it uses
  (`\setlength{\colwidth}{0.3\paperwidth}`), changing every column that
  shares it, and gutters write `\sepwidth`. Today's column dragging
  (`beamer/deck-resize.ts`) needs a numeric source width; a width given by a
  register edits the register, and a computed width offers the source. This
  applies to decks with register widths as well.
- **Blocks.** Move a block within and between columns.
- **Logos.** Replace or resize a logo given through a theme macro.
- **Navigation.** Zoom to a column, and fit the page.

Deck features in a poster: a document with beamerposter and several frames is
a multi-page poster and keeps the slide strip; overlays, `\pause`, shrink and
`allowframebreaks` behave as in decks. A single-frame poster hides the strip.

## Verification

Poster entries join the corpus comparisons described in
[the template design](beamer-preamble-and-templates.md#verification).
Entries that do not build and have a published PDF compare at the PDF level
only. The package's geometry and font table get their own probes: each size,
both orientations, custom sizes with and without `orientation`, `scale`, and
the class size option.

## Not chosen

- **A Computer Modern theme as the first target** (confposter, ZH, I6pd2)
  would defer runtime fonts, but Gemini is the largest family and its fonts
  are needed anyway; the slice takes Gemini and brings Lato and Raleway with
  it.
- Hand-ported themes, geometry extracted from one TeX run, and TeX-rendered
  chrome: see [the template design](beamer-preamble-and-templates.md#not-chosen).

## tikzposter

tikzposter builds the poster as one `tikzpicture` whose blocks are placed by
measuring LaTeX content; it needs a third document kind
(`packages/core/src/document/kind.ts`) and is not designed here.
