# Beamer document inspector

Status: proposal (2026-10-25), agreed with Dominik in outline: no inspector
tabs; slide plus presentation sections when nothing is selected; theme
gallery in a popover; the theme is reachable only from the inspector with
nothing selected (no menu command). Work is phased UI-first (see Phasing).
Phases 1–3 are implemented (2026-10-25).

## Problem

In deck mode the inspector is underused. With nothing selected it shows four
frame options (alignment, fragile, plain, label); with an object selected it
shows a handful of fields for blocks, lists, items, columns, images and
embedded drawings (`packages/core/src/beamer/deck-inspector.ts`). There is no
UI at all for the document-level design of a deck: theme, colors, slide size,
title metadata. Users change these by editing the preamble in the source
panel.

Most of the data is already there. Preamble mining yields
`document.preamble.themes` (`BeamerThemeUseModel`, with name/options/command
spans), the metadata fields (`BeamerMetadataFieldModel`, including short
forms), class options (`aspectratio`, class font size), the resolved color
roles with their parent and mix chains, and recognized navigation-symbol
templates. What is missing is UI and document-scoped edit actions: every
`DeckEditAction` today targets one frame.

The corpus (`beamer-editor.md`) sets priorities. 16 of 22 decks use
`moloch` or `metropolis`, mostly with options (`progressbar=frametitle`,
`block=fill`); `\setbeamercolor` appears in 18/22 decks and `\definecolor` in
17/22; `\setbeamertemplate` is rare (4/22). The sample comes largely from one
community, so this is a ranking, not a mandate: theme options and color
overrides matter more than switching between the classic stock themes, but
the gallery is still what a new user reaches for first.

## Layout

No tabs. The inspector follows the Figma model: what it shows depends only on
the selection, and the two states never need to be visible together.

**Object selected**: the object's fields only, as today.

**Nothing selected**: one scrolling column with two scopes.

1. **This slide** (first; short; about what the user is looking at)
2. **Presentation** (below; everything that affects every slide)

The two scope headers must look different from ordinary section headers, so
that a color edit is never mistaken for a per-slide change. Within each scope
the groups are `SidePanel.Section`s and collapsible; collapsed state persists
per user (not per document), so someone who never touches title metadata
collapses it once.

The theme is out of reach while an object is selected; that is accepted.
Escape or a click on empty canvas brings it back. There is no **Theme…** menu
command.

## This slide

Current fields stay: alignment, fragile, plain, label. The frame title stays
off the inspector (it is canvas-editable, decided in Stage 3b).

Additions, all frame options the scanner already recognizes:

- **Shrink to fit**: a percentage; empty is off, a bare `shrink` reads as 0%
  (`frame-shrink.ts`).
- **Continue on more slides** (`allowframebreaks`).
- **Skip in frame numbering** (`noframenumbering`).

Metropolis's `standout` is not offered: the renderer does not draw it yet.

Order is logical, not alphabetical: layout (alignment, shrink, continue on
more slides), then the slide's chrome (plain, skip in numbering), then
technical options (fragile, label). Checkboxes carry their own label and
span both columns.

Read-only context, each a link where a panel owns the data:

- Section / subsection this slide belongs to.
- Step count, linking to the Builds panel.
- Note count, linking to the Notes panel.
- **Fidelity diagnostics** for this slide: which constructs the preview
  approximates or does not render. Diagnostics exist but have no deck-mode
  home today; this is a natural one.

## Presentation

### Theme

A compact card: a strip of the theme's characteristic colors, its name, its
Beamer group and the components it is built from (only those not named after
the theme itself), plus a **Change…** button that opens the gallery popover
(below). A rendering of the user's own title slide replaces the color strip
once phase 2 has theme-override rendering. Under the card, the active
theme's options as ordinary fields, from `theme/catalog.ts`:

| Themes | Options |
| --- | --- |
| metropolis, moloch | `progressbar` (none/head/frametitle/foot), `numbering` (counter/fraction/none), `background` (light/dark) |
| Madrid, Boadilla | `secheader` |
| Berlin, Ilmenau, Dresden, Singapore, Szeged | `compress` |
| Berkeley, PaloAlto, Goettingen, Marburg, Hannover, Rochester | `left`/`right`, `width`, `height`, `hideothersubsections`, `hideallsubsections` |

An option the resolver does not read is not offered, even when Beamer
declares it. Not offered today for that reason: metropolis/moloch `block`
and `sectionpage` (recorded on the template, not drawn: `block=fill` is in
many corpus decks, so this is a fidelity gap worth closing), and the stock
themes' `shadow`, `subsection` and `hooks`. A test checks the catalog
against the resolver's component registry.

**Advanced** (disclosure, closed by default): color theme, font theme, inner
theme and outer theme as dropdowns. Color themes are grouped as Beamer groups
them: complete (beaver, dove, spruce, wolverine), inner (rose, orchid) and
outer (whale, seahorse, dolphin). Only components the resolver knows are
offered; albatross, beetle, crane, fly, lily, monarca and seagull ship with
Beamer but are not resolved yet. The full list:

- color: default, dove, wolverine, rose, dolphin, beaver, spruce, whale,
  orchid, seahorse, metropolis, moloch
- font: default, professionalfonts, serif, metropolis, moloch
- inner: default, rectangles, circles, inmargin, rounded, metropolis, moloch
- outer: default, tree, split, miniframes, smoothbars, smoothtree, shadow,
  sidebar, infolines, metropolis, moloch

An aggregate `\usetheme` stays a `\usetheme` line; these dropdowns add or
edit separate `\use*theme` lines after it, which is how Beamer composes them.

A theme the resolver does not know (a local `.sty`) is shown read-only, with
the existing `beamer-unknown-theme-component` diagnostic explained in plain
words: the preview uses default chrome.

### Colors

Swatches for the roles that drive most of a theme:

- `structure`, `alerted text`, `example text`
- `palette primary` … `palette quaternary`
- `background canvas`, `normal text`

Each swatch shows the effective color and its origin: the theme, or a
preamble override (with a jump to its line). Editing writes or rewrites a
`\setbeamercolor{role}{fg=…}` / `bg=…`; **Reset** removes the override.
Named colors from `\definecolor` / `\colorlet` appear in the picker as the
deck's palette, and picking one writes the name, not its RGB value.

Because roles inherit (`structure` feeds many others through `parent` and
deferred mixes), the swatch for a role that has no override shows the
inherited value, and changing `structure` visibly updates the dependent
swatches. Overrides are written after the last theme command, since a later
`\usecolortheme` would otherwise win.

### Page

- **Aspect ratio**: the `aspectratio` class option (43, 169, 1610, 149, 54,
  32, 141; the table in `geometry.ts`).
- **Base font size**: the class font size option (8pt–20pt; the profiles in
  `theme/font-sizes.ts`).
- **Navigation symbols**: a checkbox writing
  `\setbeamertemplate{navigation symbols}{}` or removing it. Metropolis and
  moloch already hide them; the checkbox reflects the resolved state.

### Header & Footer

Decided with Dominik after the first screenshots, replacing a "Title info"
list of every metadata field with its short form under it.

The long forms (`\title{…}`, `\author{…}`, …) belong to the title slide and
are edited there, on the canvas; the inspector does not repeat them, and
subtitle and title graphic, which only the title page prints, do not appear.

Short forms are exactly the text a theme prints in its headline, footline or
sidebar: every such template prints `short ?? long`. So this section lists
only the fields the active theme's chrome prints
(`theme/chrome-metadata.ts`: infolines prints title, author, institute and
date; split prints author and title; the miniframes footline what its style
names; tree headlines the title; a visible sidebar title and author), and is
absent for themes that print none (default, metropolis, moloch, Bergen,
Darmstadt, …). Each field holds the short form; when there is none, its
placeholder shows the long form it falls back to, in italics, as the
inspector shows inherited values. That makes the common problem visible: a
long form with `\LARGE` or `\large` for the title page is printed in the
footer at that size too, which is why authors set short forms. A test renders
every catalog theme and checks the mapping against the chrome's text spans.

## Theme gallery popover

Opened from **Change…** on the theme card
(`packages/app/src/ui/theme-gallery/`).

- It covers the inspector column, full height, two tiles to a row, rather
  than opening wide over the canvas: the canvas is where the hover preview
  is drawn, so it has to stay in view. (The first draft wanted a wide
  popover; building the preview showed why not.)
- Each tile renders **the user's own deck**: the title slide (the first
  frame with `\titlepage` or `\maketitle`, else the first frame), with the
  current slide inset at its current step. Generic sample slides would not
  show how the user's long title or three-level itemize looks.
- Tiles are grouped as in Beamer's theme matrix, modern themes first: modern,
  no navigation bar, tree, sidebar, mini frames, section tables. The current
  theme has an accent ring and gets focus on opening.
- Pointing at a tile, or focusing it with the arrow keys, draws its render of
  the current slide over the canvas page (an image in the canvas's world
  stage, above the real render and below the interaction layer). Moving out
  of the popover, Escape or closing removes it. It previews on pointer
  *move*, not enter: the popover opens under the pointer, and the tile that
  lands there must not preview by accident. Clicking applies the theme as
  one undoable `deckSetPresentationTheme`.
- Previews never touch the source. `prepareBeamerDocument` takes a
  `presentationTheme` option; only the theme resolution sees the switched
  theme uses (`theme-switch.ts`), the rest of the deck keeps its real spans.
  The preview and the action come from one plan, and a test checks that a
  preview renders identically to the applied edit.
- Thumbnails render in the thumbnail worker, which keeps a prepared document
  for the previewed theme beside the slide sorter's, so the gallery does not
  evict it. Renders are cached by source fingerprint, graphics bundle, theme,
  frame and step; the current theme renders first. On this dev machine the
  60 renders of a small deck take under a second.
- Switching keeps the user's later color, font, inner and outer theme
  commands, and keeps an option only where the new theme reads it
  (`[right,width=2cm]{Berkeley}` → `{PaloAlto}` keeps both; moloch's
  `progressbar` is dropped for Madrid, along with the empty bracket).

## Object fields

Built in phase 3 (`deck-inspector.ts`). "Live" fields write now; the others
show their real value, disabled, until phase 4.

- **List**: type (live); **Reveal** — all at once, one by one (`<+->`), one
  by one highlighted (`<+-| alert@+>`), or the authored spec; and for
  enumerate the **Labels** template (`[(a)]`). Both read the list's optional
  arguments after `\begin{…}`; writing them waits for phase 4 (the two
  optional arguments interact).
- **Columns**: **Alignment** (center, top `T`, first baseline `t`, bottom),
  **Total width**, **Only text width** — all live. **Column**: width (live)
  and alignment, with "Same as columns" for none (live). Alignment flags are
  exclusive and case-sensitive (`T` is not `t`), so option lists now keep the
  authored key spelling beside the lowercased one.
- **Image**: **File** (read-only), width, height, scale, **Page** for PDFs,
  **Keep aspect ratio**, **Trim**, **Clip to trim** — all live but the file.
  Not offered because the preview does not draw them: `angle`, and an overlay
  spec (`\includegraphics<2->` currently makes the image disappear from the
  preview; a fidelity gap). **Replace…** waits for phase 4.
- **Drawing**: scale (live) and **Edit Drawing**, which enters the picture
  as Enter/F2 on the canvas does.
- **Unsupported content**: the renderer's reason as a warning, the source
  excerpt, and **Show in Source**, which opens the source panel at it.
- Later: text-run selection (size commands, `\alert`, color). This needs a
  text-run node in the object index first.

An inspector edit can rename the object it edits: an image's id ends in its
text range, so a longer option list gives it a new id, and the selection
used to drop (true of the existing width field too). The panel now remembers
the edited object's kind and start (an object edit never moves its start) and
reselects it once the edited frame has rendered.

## Core: document-scoped edit actions

New members of the deck action family, pure
`(source, document model, action) → EditActionResult` like the existing ones,
but without a frame id:

- `deckSetTheme { kind: BeamerThemeKind; name: string | null; options }`
  (`null` removes the line)
- `deckSetThemeOption { kind; key; value | null }`
- `deckSetClassOption { key; value | null }`
- `deckSetMetadata { field: BeamerMetadataFieldName; short?; long? }`
- `deckSetBeamerColor { role; fg?; bg? }` and `deckResetBeamerColor { role }`
- `deckSetNavigationSymbols { visible }`

Insertion and ordering rules:

- Beamer composes theme commands in source order, so an edit targets the
  **last** command of that kind. If an earlier command is shadowed by a later
  one, the inspector says so instead of editing a line with no effect.
- Missing commands are inserted after the last `\use*theme` line, or after
  `\documentclass` (and its `\usepackage` block) if there is none.
- Commands inside macro definitions, groups or `\AtBeginDocument` are read
  but never rewritten; the field shows as read-only with the reason. This
  matches how `template-declarations.ts` already treats grouped templates.

## App

- `DeckInspectorPanel` renders three section groups depending on selection.
  The presentation sections do not depend on the active frame, so they skip
  the per-frame freshness guard that currently disables the whole fieldset
  while the active frame is re-rendering.
- Field models come from core builders (`buildDeckDocumentInspector`
  alongside `buildDeckFrameInspector`), reading values from the same spans the
  actions rewrite, as Stage 3b established.
- A color field kind joins `enum` / `text` / `number` / `boolean`, with an
  origin (theme or override) and a reset.

## Non-goals

- Editing arbitrary `\setbeamertemplate` code or structural templates.
- Authoring or exporting custom themes.
- Offering themes the native renderer cannot resolve.

## Phasing

UI design work comes first, while it is cheap to change; source rewriting
comes last. Each UI phase ends with light and dark screenshots for review
before the next one starts. Until phase 4, a control whose write does not
exist yet is shown disabled with its real current value, so the layout is
judged with real decks rather than placeholder data.

**Phase 1: inspector layout and read path.** Implemented 2026-10-25.
`buildDeckDocumentInspector` and `buildDeckSlideContext`
(`packages/core/src/beamer/deck-document-inspector.ts`) read current values
from the scanned deck and its resolved theme: theme card and options,
component themes, color roles with their origin, aspect ratio, class font
size, navigation symbols, header and footer text. The panel
(`DeckInspectorPanel`, `DeckDocumentSections`, `deck-fields.tsx`) has the
pinned scope headers, collapsible sections with persisted state, the theme
card, and the color row (a swatch, or an "Aa" sample of text on fill drawn
over the slide background when the role has no fill; the value as authored,
or in italics when it comes from the theme). Shrink, continue on more slides
and skip in numbering are writable through `deckSetFrameOption`; everything
in Presentation is disabled with its real value. Read-only values use the
secondary label color: the shared disabled pop-up text is too faint to read
in dark mode (an app-wide issue of `controls.module.css`, not fixed here).

**Phase 2: theme gallery popover.** Implemented 2026-10-25, as described
under Theme gallery popover. Click-to-apply is the narrow write: rename the
last executing `\usetheme` (commands inside macro definitions are skipped)
or insert one after the `\documentclass` line. `deckSetPresentationTheme` is
the first document-scoped deck action; it ignores the rendered frame. Phase 4
adds the shadowing diagnostics and the other component kinds.

**Phase 3: object field UI.** Implemented 2026-10-25, as described under
Object fields. The live writes are existing actions widened: image options
take flags, environment options reach `columns` and `column` with exclusive,
case-sensitive flags. An e2e test covers the writes, Edit Drawing and Show
in Source.

**Phase 4: source writes.** The document-scoped actions above with their
insertion, shadowing and guard rules; theme options, component themes, class
options, color overrides, navigation symbols, metadata short forms; the
remaining object-field writes. Round-trip tests per action, and the actions
added to the edit-action fuzzer.

## Open questions

- Whether the gallery popover should also offer color themes as a second
  row of swatches, or leave them to Advanced.
- Whether the theme override for previews should also carry color overrides
  (previewing a picked color before committing), or whether colors commit
  immediately. Color events are read from source spans, so overriding them
  at the model level is harder than overriding theme uses.
- Whether the color row should get a reset affordance now (disabled) or only
  with phase 4's writes.
