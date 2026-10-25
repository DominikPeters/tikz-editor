# Beamer document inspector

Status: proposal (2026-10-25), agreed with Dominik in outline: no inspector
tabs; slide plus presentation sections when nothing is selected; theme
gallery in a popover.

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

The cost of this layout is that the theme is out of reach while an object is
selected. A menu command **Theme…** opens the gallery popover regardless of
selection. There is no Format menu today (File, Edit, Path, Insert, View,
Present, Help); placing it under View or introducing Format is an open
question.

## This slide

Current fields stay: alignment, fragile, plain, label. The frame title stays
off the inspector (it is canvas-editable, decided in Stage 3b).

Additions, all frame options the scanner already recognizes:

- **Shrink**: off / on / value (`shrink`, `shrink=20`), from `frame-shrink.ts`.
- **Allow frame breaks** (`allowframebreaks`).
- **No frame numbering** (`noframenumbering`).
- **Standout**: only shown when the active theme is metropolis or moloch.

Read-only context, each a link where a panel owns the data:

- Section / subsection this slide belongs to.
- Step count, linking to the Builds panel.
- Note count, linking to the Notes panel.
- **Fidelity diagnostics** for this slide: which constructs the preview
  approximates or does not render. Diagnostics exist but have no deck-mode
  home today; this is a natural one.

## Presentation

### Theme

A compact card: the current theme's name and a small rendering of the
user's own title slide, plus a **Change…** button that opens the gallery
popover (below). Under the card, the active theme's options as ordinary
fields. The resolver already reads these option keys; each theme exposes only
its own:

| Theme family | Options |
| --- | --- |
| metropolis, moloch | `progressbar` (none/head/frametitle/foot), `numbering`, `block` (transparent/fill), `sectionpage`, `background` |
| Madrid and other infolines themes | `secheader` |
| miniframes / smooth themes | `compress`, `subsection` |
| sidebar themes | `width`, `height`, `hideothersubsections`, `hideallsubsections` |
| shadow outer theme | `shadow` |

The option schema per theme lives next to its applier in
`theme/resolve.ts`, so the inspector and the resolver cannot drift: an option
the resolver does not read is not offered.

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

### Title info

Title, subtitle, author, institute, date, title graphic. Each text field has
its **short form** (`\author[short]{long}`) next to it. The long forms are
editable on the title slide, but short forms only appear in footlines and
headlines, so the inspector is their only reasonable home. Spans come from
`BeamerMetadataFieldModel`. Long forms with structure beyond plain text
(`\and`, `\inst{}`, line breaks) show the source text and edit it as source;
the inspector does not try to model author lists.

## Theme gallery popover

Opened from **Change…** on the theme card or from the **Theme…** menu
command. Wide enough for a grid of thumbnails; the inspector is too narrow.

- Each tile renders **the user's own deck**, the title slide and the current
  slide, under that theme. Generic sample slides would not show how the
  user's long title or three-level itemize looks.
- Tiles are grouped as in Beamer's theme matrix: no navigation, tree,
  sidebar, mini frames, section/subsection tables, plus the modern themes.
- Hovering a tile previews it on the canvas through `SET_SOURCE_TRANSIENT`,
  the path label scrubs already use; leaving restores the source. Clicking
  commits one undoable action.
- Rendering runs in the thumbnail worker against a substituted source (the
  same document with its theme lines rewritten). Cache by theme id plus a
  hash of the preamble and the two frames. Roughly 30 themes × 2 frames;
  render visible tiles first.
- Switching an aggregate theme keeps the user's color overrides and keeps
  options only where the new theme reads the same key.

## Object fields to add

Independent of the document work, the gaps visible in `deck-inspector.ts`:

- **List**: "Reveal one by one" toggle (`[<+->]` on the environment; listed in
  `beamer-editor.md` but not built), enumerate label style.
- **Columns** container (no fields today): `t`/`c`/`b` alignment,
  `onlytextwidth`, `totalwidth`.
- **Image**: file path with **Replace…**, `keepaspectratio`, `angle`,
  trim/clip.
- **Drawing**: **Edit drawing** button entering the embedded TikZ editing
  session.
- **Overlay spec** on every object kind that carries one, not only items and
  blocks.
- **Unsupported content**: the reason, the source excerpt and **Show in
  source**, instead of "no editable properties yet".
- Later: text-run selection (size commands, `\alert`, color). This needs a
  text-run node in the object index first.

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

## Open questions

- Menu placement of **Theme…**: View, or a new Format menu that could also
  hold text formatting later.
- Whether the gallery popover should also offer color themes as a second
  row of swatches, or leave them to Advanced.
- Whether title info belongs under Presentation or should appear in the
  object inspector when the title slide's title block is selected.
