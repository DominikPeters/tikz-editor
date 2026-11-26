# Preamble execution and template interpretation

Status: design, 2026-11-26. Nothing implemented yet. Split out of the
[beamerposter design](beamerposter.md) after two reviews (Fable with TeX
probes; codex `gpt-6.2-sol`); posters are the first target, decks with local
or inline themes the second.

Beamer documents get their look from theme code: local `beamertheme*.sty`
files, shared preamble files and inline `\setbeamertemplate` bodies. Today
the engine runs stock themes through hand-written planners
(`beamer/theme/resolve.ts`) and interprets literal colour and font
declarations, but does not execute template bodies or local theme files.
This design runs the preamble in TeX's order and lays out template bodies as
LaTeX content over a measured vocabulary, with defined fallbacks.

Stock themes keep their planners and are not re-derived through the
interpreter.

## Evidence

- **Posters.** 63 projects in `artifacts/beamerposter-corpus`: about 30
  one-off themes, Gemini in 15 projects as eight byte-distinct forks. See
  [beamerposter.md](beamerposter.md#corpus).
- **Decks.** In `artifacts/beamer-sources`, 4 of 8 projects override a
  headline, footline, frame title, title page or block begin with code of
  their own. The sample is small, but it contradicts the "rare" in
  [beamer-editor.md](beamer-editor.md)'s original non-goal.

Templates overridden in poster theme files: headline 35, block begin/end 31,
footline 29, bibliography item 26, navigation symbols 22, caption 20, itemize
item 19, block alerted 13, enumerate item 8, title page 6, frametitle 4,
background (canvas) 4. The deck corpus is counted the same way before the
vocabulary is fixed, so that it is not shaped by poster themes alone.

## Preamble execution

The template interpreter depends on the preamble running in TeX's order.

- **Files.** Resolve `\usetheme`, `\usecolortheme`, `\usefonttheme`,
  `\useinnertheme`, `\useoutertheme`, `\usepackage` and `\input` against
  project files, so that a local theme, a shared preset file and a local
  package execute. Provenance is file-aware: an edit to a value defined in
  another file edits that file.
- **Order.** Run the preamble and the loaded theme files as one ordered
  stream. Package options are read wherever a package is loaded, including
  inside a macro (ICML 2026: `\PosterWorkshop[0.9]` expands to a
  `\usepackage[…]{beamerposter}`) or a theme's `\RequirePackage`.
- **Lengths.** `\newlength`, `\setlength`, `\addtolength`, `\settowidth`
  (and height and depth); factors on registers (`0.3\paperwidth`), `calc`
  infix expressions, `\dimexpr`, `\maxof`/`\minof`; with TeX grouping. A
  register takes its value at assignment, in the active scope: a register
  set from `\linewidth` before a column keeps that value inside the column.
  `\settowidth` measures through the text engine (Gemini centres its title
  between logos this way). Registers serve frame bodies too:
  `\begin{column}{\colwidth}` is common in decks and posters alike.
- **Units.** `ex` is the x-height of the current font, not `em`.
  `beamer/deck-spacing.ts` currently treats the two alike; 49 poster theme
  files size with `ex`.
- **Macros.** Theme code relies on `\def` and `\newcommand` with arguments,
  `\newif`, `\ifx` against `\@empty` and expanded macros, `\csname`, and
  `\makeatletter` internals (`\beamer@shortauthor`, `\insertinstitute`,
  Mito's `\blockbegin@ibadai@default`). The macro expander
  (`macros/expand.ts`, `beamer/local-macros.ts`) keeps source mapping through
  expansion so that inserted values stay editable.

TikZ documents use the same file resolution and lengths for `\input`
preambles and `\newlength` in figures.

## Template interpreter

A `\setbeamertemplate{role}{body}` (and `\defbeamertemplate` plus a later
selection) whose body uses only supported vocabulary is laid out by the
frame-body engine as LaTeX content, after macro expansion, reusing the
vertical-list engine's glue and interline handling. The same layout result
serves measurement and painting.

### Vocabulary

Admitted by measurement, not command frequency alone: for each role, the
share of template bodies that run with nothing outside the vocabulary, after
expanding theme-defined macros. The counting rules (byte-distinct files,
which macros count as theme-defined) are recorded with the counts. Coverage
is checked on held-out themes (Gemini forks, one-off poster themes, deck
themes), not on the files the vocabulary was drawn from.

A first scan of byte-distinct poster template bodies: 32 of 46 headlines, 27
of 45 block begins and 14 of 41 footlines use only the list below. Footlines
fail mostly on `\href`, `\insertframenumber` and `\today`. The acceptance
criterion is a stated coverage per role; the first target is headline, block
and footline together.

- **Boxes.** `beamercolorbox` with `wd`, `ht`, `dp`, `sep`, `colsep`,
  `colsep*`, `leftskip`, `rightskip`, `left`/`center`/`right`, `vmode`,
  `rounded`, `shadow`; `columns`/`column`; `minipage`; `parbox`; `center`,
  `flushleft`, `flushright`; `adjustwidth`; `\hbox`, `\vbox`, `\mbox`,
  `\raise`, `\raisebox`, `\strut`.
- **Colour and font.** `\usebeamercolor[fg|bg]`, `\usebeamerfont`, `\color`,
  `\ifbeamercolorempty`, size commands, `\fontsize…\selectfont`,
  `\bfseries`, `\textbf` and kin, `\MakeUppercase`.
- **Spacing.** `\vskip`, `\vspace(*)` including `\fill`, `\hskip`, `\hspace`,
  `\hfill`, `\vfill`, `\\[len]`, `\par`, `\nointerlineskip`, `\leavevmode`,
  `\smallskip`/`\medskip`/`\bigskip` and their `…amount` registers,
  `\parskip`.
- **Alignment.** `\centering`, `\raggedleft`, `\raggedright`, `\justifying`,
  `\justify`.
- **Rules, images, links.** `\rule`, `\vrule`, `\hrule`, `\includegraphics`,
  `\href` (drawn as its text).
- **Logic.** `\ifx … \empty`, `\ifdefined`, `\else`, `\fi`, theme-defined
  `\newif` flags and package flags (Helsinki branches on beamerposter's
  portrait flag); `\the`; lengths.
- **Symbols.** Inline math for item markers (`$\blacktriangleright$`, 7
  itemize templates), through the native math engine.
- **Inserts.** `\inserttitle`, `\insertsubtitle`, `\insertauthor`,
  `\insertinstitute`, `\insertdate`, `\today`, `\insertblocktitle`,
  `\insertframetitle`, `\insertframesubtitle`, `\insertlogo`,
  `\inserttitlegraphic`, `\insertframenumber`, `\inserttotalframenumber`,
  `\insertsection`, the enumerate labels, the caption parts and
  `\beamer@shortauthor`.

`beamercolorbox` in frame bodies (8 poster projects) uses the same box.

### Fallbacks

A template that uses something outside the vocabulary is not half-run. What
replaces it depends on the role, and it reports one diagnostic naming the
command:

- **Headline and title page.** The stock default headline is empty, so
  falling back to it would erase a poster's title. A fallback headline in a
  document whose theme puts the title there draws title, author and
  institute centred in the headline colours and fonts, editable as usual. A
  template that is empty by intent (or `[default]`) draws nothing; only a
  failed one gets the fallback.
- **Frame title.** The stock frame title in the theme's colours and fonts.
- **Blocks.** `block begin` and `block end` are validated as a pair around a
  typed body slot. If either half fails, both fall back to the stock block in
  the theme's colours and fonts. The body is never discarded.
- **Footline, items, captions, bibliography.** The stock template for the
  role, in the theme's colours and fonts.

### Blocks

A theme's `block begin` may open a box that its `block end` closes (Gemini
opens the body `beamercolorbox`). The interpreter splices begin, the body
slot and end into one stream and lays it out together. For interpreted
themes this replaces the parametric `planBeamerBlockTemplate`
(`beamer/theme/blocks.ts`); the same applies to the alerted and example
variants. Block templates interact with scoped theme changes, `plain`
frames, overlays and frame breaks; each is specified and tested.

### Editing

- `\inserttitle` and its kin bind to the argument spans of `\title{…}` and
  the others, through mapped template text (`BeamerTemplateTextSource` in
  `beamer/theme/types.ts`). Mapped text today is one delimited value; values
  transformed (`\MakeUppercase`), repeated, or stored by a theme macro in
  another file need edits that reach the right file and span. Where no
  faithful edit exists, the canvas offers the source instead.
- Which metadata fields a theme shows is derived from the inserts the
  interpreter evaluated. `beamer/theme/chrome-metadata.ts` switches on stock
  template ids today.
- Text written in the template itself (Helsinki's "UNIVERSITY OF HELSINKI")
  is drawn but not editable.
- Theme indirections keep their mapping: Gemini's `\logoleft{…}` and
  `\footercontent{…}`, Helsinki's title built from `\inserttitlestart` and
  `\inserttitleend`.

### Fidelity

Template bodies depend on TeX switching between vertical and horizontal mode:
stray newlines become spaces, `\hspace` in vertical mode starts a paragraph,
`{\parskip0pt\par}` ends one with a local register, and negative `\vskip`
pulls the next box up. Gemini's block template is mostly such constructs.
Errors are small but add up down a page, so the comparison harness ships
with the interpreter and admits constructs to the vocabulary.

## TikZ in templates

Of 49 poster theme files with structural templates, about 14 draw with TikZ:
a `remember picture, overlay` picture with a shaded rectangle (confposter),
or nodes and lines (Inria, Helmholtz, TUINF, uvt, hria). Deck themes draw
headline bars and backgrounds the same way. These pictures go to the TikZ
renderer with `current page` bound to the page, local origins and dimensions
from the template's box, and the theme's TikZ styles. UVT puts the title
inside TikZ nodes, so source mapping crosses into node text. tcolorbox in
templates stays outside the vocabulary.

## Verification

- Corpus comparisons on top of `scripts/compare-beamer-frame.mjs`: page
  size, `beamercolorbox` rectangles, block title and body boxes, and text
  lines against TeX traces, for poster entries and for deck frames with
  interpreted templates. Unpainted boxes need instrumentation in the traced
  document.
- The probe (`scripts/lib/beamer-frame-oracle.mjs`) runs LuaLaTeX with Lua
  hooks. pdfLaTeX documents have different font metrics; tracing them needs
  separate instrumentation, or PDF-level criteria (page size, filled
  rectangles, glyph positions) where that is enough. Which applies is
  recorded per entry, with its tolerance. This benefits every deck
  comparison, not only themes.
- Regression fixtures reduce corpus cases to the construct under test,
  written independently rather than copied from one theme.

## Risks

- **Vertical drift** from mode-machine differences. The vocabulary grows only
  with harness evidence.
- **Reimplementing TeX by accretion.** Measured vocabulary per role and
  role-specific fallback are the guard; additions need counts across distinct
  authors.
- **Preamble execution** is new infrastructure that everything else rests
  on; its provenance rules decide which edits are possible.

## Not chosen

- **Hand-porting popular themes.** A Gemini port already needs colour boxes,
  columns in the headline, measurement and conditionals. Written as an
  interpreter, the same code covers the forks, one-off poster themes and
  local deck themes.
- **Extracting geometry from one TeX run.** Gemini's headline depends on the
  number of title lines, whether an institute is set and the measured logo
  widths, so one trace is one sample. TeX traces are the test oracle instead.
- **TeX-rendered chrome as images.** It needs TeX at edit time (25 poster
  corpus entries do not build locally), does not work on web or iPad, makes
  the title uneditable on canvas, and cannot apply to block templates, which
  wrap editable content.
