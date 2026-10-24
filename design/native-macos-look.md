# Native macOS look (Option A) — implementation plan

Mockups: [TikZ Editor native mockups](https://claude.ai/artifact/MGjK9gsLWXu69hShJPgkCy),
boards "A · Sequoia AppKit, denser (revised)" and "A · Panel system".

## Scope

In scope:

- The main window in the Option A style: compact unified toolbar, native-style
  document tabs, an inspector with label-left rows and hairline-separated
  sections, macOS pop-up buttons, fields and segmented controls, and a slimmer
  status bar.
- The new dock tab strip: small rounded tabs, icon collapse when narrow,
  plain titles for single-panel docks, a ▾ menu, a tab context menu and
  restyled drop zones.
- View › Panels: shortcuts and grouping.
- Dark-mode tokens (from Option C's palette).

Out of scope, follow-ups:

- Dialogs (attached sheet, NSAlert, Settings as its own window). These are
  independent of this work and can be done in either order.
- The compact Windows 11 variant. After phase 1 it is mostly a token swap
  under `[data-desktop-os="windows"]` plus a few overrides.
- Option B (Tahoe glass), which would change the layout itself.

Ground rules:

- Option A becomes the base look for every platform, web included. Today's
  tokens are already "neutral/macOS", and Windows keeps its existing
  `[data-desktop-os="windows"]` overrides until its own pass.
- This is presentation work. No edit semantics change, except the optional
  Stroke/Fill header checkbox in phase 7.
- Keep flexlayout-react (0.8.19). Restyle it and use its render hooks
  (`onRenderTab`, `onRenderTabSet`, `onContextMenu`, `onShowOverflowMenu`,
  `icons`, `splitterExtra`), not a fork.
- Keep `.flexlayout__tab_button_content` holding the panel name as text. The
  e2e specs `view-and-panels`, `document-file`, `presentation` and
  `beamer-builds` select on it.
- Every size still scales with `--app-ui-scale`.

Each phase below is one commit that can ship on its own. They are in
dependency order: 1 → 2 → 3 is the critical path, and 4–6 can be reordered.

## Phase 1 — Tokens and shared control styles (S)

**`packages/app/src/ui/variables.css`.** Add tokens; keep the existing ones
so nothing changes visually until later phases use them:

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg-window` | `#f6f6f6` | `#2b2b2d` | toolbar, tab bar, status bar |
| `--bg-inspector` | `#f5f5f5` | `#262628` | side-panel background |
| `--separator` | `#dedede` | `#3a3a3c` | section hairlines |
| `--label-secondary` | `#636366` | `#a1a1a6` | row labels (≥4.5:1 on `--bg-inspector`) |
| `--control-bg` | `#ffffff` | `#1c1c1e` (fields) / `#48484b` (pop-ups) | |
| `--control-ring` | `rgba(0,0,0,.22)` | `rgba(255,255,255,.16)` | 0.5px ring via box-shadow |
| `--control-shadow` | `0 1px 1.5px rgba(0,0,0,.1)` | `inset 0 .5px 0 rgba(255,255,255,.12)` | pop-ups, steppers |
| `--control-accent` | `#007aff` | `#0a84ff` | pop-up chevron tile, checkboxes, selected segment in dark |
| `--segment-track` | `rgba(0,0,0,.07)` | `#1c1c1e` | segmented-control track |
| `--tab-selected-bg` | `rgba(0,0,0,.09)` | `rgba(255,255,255,.12)` | dock tabs, toolbar "on" state |
| `--control-h` | `19px` | — | small control height (scaled) |
| `--row-min-h` | `20px` | — | inspector row height |
| `--inspector-label-w` | `62px` | — | label column |
| `--radius-field` / `--radius-popup` | `4px` / `5px` | — | |

Leave `--accent` as it is: the canvas uses it and `--accent-dark` for
selection and guides (`CanvasPanel.module.css`), and that is a separate
decision. Later, on desktop macOS only, try `--control-accent:
-apple-system-control-accent` so the controls follow the user's system
accent colour in WKWebView.

**New `packages/app/src/ui/controls.module.css`.** Shared building blocks that
other modules pull in with `composes:`:

- `.popUp`: white body, ring and shadow, radius 5, `--control-h`; trailing
  `.popUpIndicator` is a 15px `--control-accent` tile with up/down chevrons.
- `.field`: number/text field with radius 4, ring, numbers right-aligned and
  `.fieldUnit` inside the field.
- `.segmented`, `.segment`, `.segmentOn`: track plus a white raised thumb.
- `.checkbox`: `accent-color: var(--control-accent)` at 12px.
- `.recessedTab`, `.recessedTabOn`: used by the dock strip in phase 3 and the
  toolbar "on" state in phase 4.

## Phase 2 — Inspector and SidePanel (M)

This is the biggest visible change and mostly CSS.

**`SidePanel.module.css`:**

- `.section`: remove the border box and `--bg-diagnostics` fill; use
  `border-bottom: 1px solid var(--separator)` and padding `4px 12px 6px`.
- `.sectionHeader`: sentence case, no `text-transform` and no letter-spacing,
  11px bold, 18px tall, no background, trailing chevron slot.
- `.sectionBody`: `gap: 3px`, no padding (the section owns it).
- `.content`: padding 0, background `var(--bg-inspector)`.
- `.header`: becomes the selection header described below.
- Delete the macOS-only `background: transparent` overrides on `.panel`,
  `.header` and `.sectionHeader`. The inspector should be an opaque
  `--bg-inspector`, not see-through vibrancy.

**`SidePanel.tsx`.** Make `SidePanel.Section` collapsible:

- Add `collapsible` and `defaultOpen` props, plus an optional
  `headerAccessory` (used for "Show More" and, in phase 7, the checkbox).
- Store each section's open/closed state by section id in the existing
  settings/workspace store, so it survives reloads.

**`inspector-panel/InspectorPanel.tsx` and `InspectorSections.tsx`:**

- Replace the uppercase `SidePanel.Header` (`PATH`, `NODE`, `tikzpicture`)
  with a selection header: "Node (a)" in 12px semibold, with "line 3" on the
  right as a button that reveals the source line. When nothing is selected,
  "tikzpicture" uses the same header.
- Turn the "more options…" toggles into a hover-revealed "Show More" / "Show
  Less" button in the section header, the way the Finder sidebar does it.
  The auto-show logic in `shouldAutoShow*MoreOptions` stays.
- Replace "+ gradient / + pattern" with a Solid | Gradient | Pattern
  segmented control. It is bound to the existing `fillMode` property and the
  `onEnable{Gradient,Pattern}FillSingle` callbacks. Check that a write path
  back to Solid exists before relying on it.

**`inspector-panel/InspectorPanel.module.css`:**

- `.property`: `display: grid; grid-template-columns:
  var(--inspector-label-w) minmax(0,1fr); align-items: center; min-height:
  var(--row-min-h); column-gap: 6px`.
- Keep a stacked variant for wide controls: sliders, the colour-picker
  palette and text areas.
- `.propertyLabel`: 11px, `--label-secondary`. Keep
  `.propertyLabelScrubbable` (ew-resize drag on the label), which still works
  on the left-hand label.
- `.numberInput`, `.textInput`, `.unitLabel`: `composes: field` and
  `fieldUnit`. The unit moves inside the field wrapper.
- `.nodeFontButtonGroup`, `.multiArrangeGroup`, the text-align buttons:
  `composes: segmented`.
- `.compactNumberPair`: one row label followed by two fields with 9.5px
  captions underneath (X/Y, Width/Height).

**`inspector-panel/panel-helpers.tsx`.** `COMPACT_PAIR_IDS` becomes a map with
the row label and the captions:

```ts
"xshift:yshift" → { label: "Shift", captions: ["X", "Y"] }
"xscale:yscale" → { label: "Scale", captions: ["X", "Y"] }
"node-minimum-width:node-minimum-height" → { label: "Min size", captions: ["Width", "Height"] }
"grid-xstep:grid-ystep", "shadow-xshift:shadow-yshift" → likewise
"node-text-align:node-text-width" → keep today's layout (mixed kinds)
```

`renderSingleNumberPair`/`renderSingleLengthPair` and their
`multi-property-renderer` equivalents read the map. Each field's
`aria-label` keeps the full property label, e.g. "X shift".

**`CustomDropdown.module.css`.** `.trigger` gets `composes: popUp`, and
`.triggerCaret` becomes the accent tile. This also restyles the dropdowns in
Styles, Assistant and the deck inspector, which is intended.

**`ColorPicker.module.css`.** `.triggerButton` gets the same pop-up style,
with the swatch as a 20×11 rounded rectangle.

**`renderers/single-property-renderer.tsx`, `multi-property-renderer.tsx`.**
Small markup changes only: wrap the unit inside the field, and pass the pair
label and captions through.

**Checks:**

- Multi-selection, read-only properties (`.globalNote`, provenance
  tooltips), the deck inspector, tool hints (`.toolHint`) and the
  path-morphing sub-properties (`.subProperty` indent) all still render.
- The inspector stays usable at its minimum dock width.
- UI scale works at 11, 12 and 13px.

## Phase 3 — Dock tab strip (M)

**`DockLayout.css`.** Rewrite the tab-bar block:

- `.flexlayout__tabset_tabbar_outer`: 26px, background `--bg-inspector`,
  bottom hairline `--separator`.
- `.flexlayout__tab_button`: `composes` cannot reach global classes, so copy
  the recessed-tab rules. 19px tall, radius 5, no borders or
  `margin-bottom` trick. Selected uses `--tab-selected-bg` and weight 600.
  Reserve the bold width with a hidden `::after { content: attr(data-label);
  font-weight: 600 }` so tabs don't jump when selected.
- Close buttons (`.flexlayout__tab_button_trailing`) appear only on hover or
  when the tab is selected.
- `.flexlayout__tab_button_stretch` (single-tab docks, already enabled with
  `tabSetEnableSingleTabStretch`): render as a plain 11px semibold title.
- Splitters:
  - set `splitterSize: 1` and `splitterExtra: 4` in `global`, giving a
    hairline with a 9px hit area;
  - hover and drag use `--separator` darkened, not the accent colour.
- Drop zones (`.flexlayout__outline_rect`, `.flexlayout__edge_rect`): fill
  with 13% `--control-accent`, a 2px inset ring, radius 7.
- Restyle `.flexlayout__popup_menu` (the overflow and ▾ menus on web) as a
  macOS menu: radius 8, 5px padding, 22px items, accent highlight.

**`DockLayout.tsx`:**

- `PANEL_ICONS: Record<PanelId, ReactNode>`, inline SVGs for Inspector,
  Objects, Styles, Overlays, Notes, Figures/Slides, Assistant and Source.
- `onRenderTab(node, values)`:
  - Set `data-label` for the bold-width trick.
  - Decide whether the strip is narrow from
    `node.getParent().getRect().width` against the summed label widths. Widths
    come from one cached `canvas.measureText` pass at the current UI font.
  - When narrow, inactive tabs show only the icon (`values.leading`), and the
    label moves into a visually-hidden span inside `values.content`, so
    `.flexlayout__tab_button_content` still contains the name for e2e and
    screen readers. Add `title` for the tooltip.
  - The active tab always shows icon plus label when narrow, and label only
    when wide, as in the mockup.
- `onRenderTabSet`: add a ▾ button to `stickyButtons`. Its menu lists the
  panels docked here and panels whose home (`PANEL_HOMES`) is here but are
  closed (as "Show X"), then Move to….
- `onContextMenu` on a tab: Close "X", then Move to Left Side / Below Canvas
  / Right Side, each disabled when it is the current dock. Implement with
  `Actions.moveNode` into the home tabset of that edge, reusing the
  re-create-home logic from `togglePanel`.
- `onShowOverflowMenu`: on desktop, route to a native context menu through
  the platform adapter; on web, keep flexlayout's menu restyled.
- Delete the in-panel `<SidePanel.Header>Objects</SidePanel.Header>` and its
  equivalents in Styles, Builds and Assistant, which repeat the tab name.
  Check `ObjectsPanel.tsx`, `StylesPanel.tsx`, `builds-panel/BuildsPanel.tsx`
  and `AssistantPanel.tsx`.

**Persistence.** Saved layouts in `workspace-storage` carry `global`. Bump the
`splitterSize` default through `createLayoutModel`'s normalisation (where
`normalizedGlobal` is built) instead of migrating stored JSON.

**Checks:**

- All four built-in workspaces, plus the Beamer layout with Slides, Overlays
  and Notes.
- Dragging tabs between docks, auto-opening Figures with multiple roots, and
  a narrow right dock at 220px.
- Run `npm run test:e2e`.

**As built (differences from the above):**

- The tab code lives in `dock-panel-menus.tsx`; `PANEL_IDS` moved there
  (re-exported from `DockLayout.tsx`) to avoid a circular import.
- `onRenderTab` cannot set attributes on the tab element, so the label is a
  `span.dock-tab-label[data-label]` inside the content. In icon mode the icon
  sits inside the content too, which keeps `.flexlayout__tab_button_content`
  visible and clickable for the e2e specs. Icon-only tabs drop their close
  button; their context menu still has Close.
- A strip has three modes: all labels, the selected tab's label beside the
  others' icons, and icons only. Overflowing must be avoided rather than
  corrected, because flexlayout's overflow button takes room and stays
  unless the tabs fit beside it. So a strip whose width is not yet known
  (its first render) shows icons only, then calls `Layout.redraw()` once
  measured; a parent re-render does not reach the tab strips.
- Hairline splitters made the default canvas about 6px wider, enough to give
  the e2e rectangle side resize handles. That exposed a bug: the rotate
  handle's stem was drawn over the top-middle resize handle, so pressing it
  rotated. The rotate handle is now drawn first.
- The ▾ menu lists the panels docked there and those whose home dock it is,
  as checkable Show/Hide items reusing the `view.toggle-*-panel` commands. It
  has no Move to… items; those are in the tab context menu, which uses new
  context-only commands `panel.close` and `panel.move-{left,below-canvas,right}`.
- The overflow menu stays flexlayout's (restyled) on desktop too: native
  context menus take command ids, not arbitrary tabs, and icon collapse makes
  overflow rare.
- In-panel headers removed: Objects, Overlays (now a "Steps" header only when
  paging is needed) and Assistant (the New chat button stays). Styles keeps its
  header because it names the selection, not the panel.
- Fixed in passing: `CanvasContextMenu` reset its position to the raw anchor
  after mount, undoing the edge clamp, so menus opened near the right or
  bottom edge ran off-screen.

## Phase 4 — Window chrome: toolbar, document tabs, status bar (S–M)

**`Toolbar.module.css`:**

- `.toolbar`: `min-height: 38px`, padding `0 8px`, no bottom border on macOS
  (the tab bar draws the line).
- `.toolbarDesktop`: 38px; check that `padding-left` clears the traffic
  lights (about 76px).
- `.btn`: 28×24 and radius 5; `.btnActive` uses `--tab-selected-bg`.
- `.separator`: replace the 1px rules with 10px gaps between groups.
- `.title`: one line, "Untitled 1 — Edited", with the qualifier in
  `--label-secondary` (`.titleQualifier` already exists).
- Keep the fill split button (bucket with a colour bar) and only restyle it.
  Zoom stays in the status bar only, as today.

**`apps/desktop/src-tauri/tauri.macos.conf.json`.** Move
`trafficLightPosition` from `{x:18, y:21}` so the lights are vertically
centred in 38px (around `y: 13`; tune on a real window). Also check
fullscreen, where the toolbar should lose its left inset.

**`TabStrip.module.css`.** Native document tabs:

- 24px tall; equal-width tabs (`flex: 1 1 0` with a 120px minimum, scrolling
  beyond that).
- Bar background `#dedede` / dark `#1c1c1e`; the active tab uses
  `--bg-window`.
- Separators are full height; drop the rounded-top look.
- The close button sits on the left and shows on hover; the dirty dot is in
  the same spot when not hovered.

**`StatusBar.module.css`.** 22px tall, background `--bg-window`, remove the
`.cell` right borders and use `gap: 14px`. The zoom slider is already
custom-styled; only change its colours to the new tokens.

**`App.module.css`.** No layout change. Confirm the transparent macOS
background still looks right behind the now-opaque panels.

**As built (differences from the above):**

- The toolbar title is unchanged: it only appears on web ("TikZ Editor Web"),
  where the browser shows the document name.
- `trafficLightPosition` is `{x:16, y:17}`, not 13: the old y of 21 centred
  the lights in the 46px toolbar, so the same offset gives 17 for 38px. Not
  yet checked on a real window; `test:desktop:e2e` needs tauri-driver, which
  does not run on macOS.
- Full screen sets `html[data-fullscreen]` from a window-covers-screen test in
  `App.tsx` (a zoomed window stops at the menu bar); the toolbar then drops
  its traffic-light inset.
- The tab bar needs its own divider colour, `--tabbar-divider`: `--separator`
  equals `--bg-tabbar` in light mode, which made the inactive tabs one bar.
- The dirty dot sits on the tab's leading edge and gives way to the close
  button on hover; the "changed on disk" triangle stays beside the title.

## Phase 5 — View › Panels menu (S)

Checked states already work: `editor-command-runtime.ts` sets `checked`, and
`native-menu.ts` creates `CheckMenuItem`s.

**`packages/app/src/app-menu/default-menu.ts`:**

- Rename "Source Panel" to "Source" and so on; the Panels context makes the
  suffix redundant.
- Group the items by home dock with separators: Left (Source); Below Canvas
  (Figures/Slides, Notes); Right (Inspector, Objects, Styles, Overlays,
  Assistant). Native menus have no section headers before macOS 14, and
  Tauri doesn't expose them, so separators are enough.
- Give them `accelerator`s `Alt+CmdOrCtrl+1` to `8`. Check them against
  existing accelerators and CodeMirror keymaps first.
- Add "Reset Panel Layout", wired to `DockLayoutHandle.resetLayout()`.

**As built (differences from the above):**

- The shortcuts are macOS only. On Windows and Linux, Ctrl+Alt is how AltGr
  arrives, and AltGr+7/8 type `{` and `[` on German and other layouts, so
  Ctrl+Alt+digit would hijack typing in the source editor. `panelItem()` in
  `default-menu.ts` emits a macOS-desktop item with the accelerator and a
  plain item for the other targets.
- On web, `App.tsx` handles Option-Command-digit (by `event.code`, since
  Option changes `event.key`) when there is no native menu bar.
- Order: Source 1; Figures/Slides 2, Notes 3; Inspector 4, Objects 5,
  Styles 6, Overlays 7, Assistant 8.

## Phase 6 — Other panels and dark mode (M)

**Audit the modules that inherit the new SidePanel look,** and align their own
rows to 20px with the new tokens:

- `objects-panel/ObjectsPanel.module.css`: macOS outline-view rows. The
  selection is `--control-accent` with white text when the panel has focus,
  and grey `--tab-selected-bg` when it doesn't.
- `StylesPanel.module.css`, `builds-panel/BuildsPanel.module.css`,
  `notes-panel/NotesPanel.module.css`, `RootNavigator.module.css`,
  `AssistantPanel.module.css`, `source-panel/SourcePanel.module.css` (its own
  header/toolbar), `DevPanel.module.css`.

**Dark mode.** Fill in the dark column of the phase 1 tokens using Option C,
then run a contrast pass on labels, captions and disabled states.

**As built (differences from the above):**

- The dark tokens were already filled in during phase 1. `--label-secondary`
  is about 5.6:1 on `--bg-inspector` in light mode and 6.9:1 in dark mode.
  Disabled text (`--text-dim`) stays low-contrast, which WCAG allows.
- The Objects outline is focusable (`tabIndex={-1}`), so clicking a row
  focuses it even in WebKit, which does not focus buttons on click.
- Overlays timeline rows are 20px with 18px cells; the selected row is grey
  (`--tab-selected-bg`); there is no focus state to switch it to accent.
- Styles stays a dense monospaced cascade view; it only takes the field,
  ring and label tokens and 20px declaration rows.
- DevPanel is untouched (developer only).
- The Source panel lost its `border-right`, which doubled the splitter
  hairline. Assistant hovers used an undefined `--bg-hover`.
- Fixed in passing: a dock panel was blank the first time its tab was
  opened. `WhileTabVisible` trusted the payload of flexlayout's
  `visibility` event, which can be stale (an unmounting Tab marks the node
  hidden after the new one marked it visible). It now reads
  `node.isSelected()` in a microtask.

## Phase 7 — Optional refinements

- **Stroke/Fill header checkbox.** This is a semantic change: unchecking
  removes `draw` or `fill` (and handles `\filldraw` / `\fill` / `\draw`
  commands and `fill=none`). Design it with the core edit actions, check the
  PGF manual for the option semantics, and add fuzzer coverage. Until then,
  the header shows no checkbox, and colour "none" covers the case.
- Stepper buttons next to number fields. Today's label scrubbing and arrow
  keys already cover this, so steppers are cosmetic.
- A rotation knob next to Rotate.
- `-apple-system-control-accent` for `--control-accent` on desktop macOS.

As built (accent only, 2026-10-24): on desktop macOS, `--control-accent` is
`-apple-system-control-accent` and the new `--control-selection` (focused list
rows in Objects) is `-apple-system-selected-content-background`, inside
`@supports` under `:root[data-desktop-os="macos"]`. Web and Windows keep
#007aff / #0a84ff and #0063e1 / #0058d0. Checked in a WKWebView against the
built CSS, light and dark; WebKit resolves the keywords in the web content
process, which reads the System Settings accent. The older `--accent` family
(dialogs, toolbar toggles) is unchanged. Steppers and the rotation knob are
dropped.

As built (Stroke/Fill checkbox, 2026-10-24): the checkbox means "this paint
off", not "remove `draw`/`fill`". Core (`edit/inspector/paint-toggle.ts`) gives
each Stroke and Fill section a `toggle` with three write lists: `disable`
(`draw=none` / `fill=none`, plus `shade=none` when shading outlives the local
options), `restore` (the paint as it was) and `enable` (plain `draw` / `fill`,
the PGF default). The property-write planner then folds the `none` away or
rewrites the command wherever that renders the same: `\filldraw[fill=red]`
with Fill off becomes `\draw`, `\shadedraw` becomes `\draw` or `\shade`, and
`none` stays only where a style or scope would paint again. The planner now
knows what each command paints by itself (`\filldraw`, `\shade`, `\shadedraw`)
and compares nodes by what they draw.

- Off hides the section's rows, as Keynote does; a multi-selection shows a
  mixed checkbox, and clicking it switches every element on.
- Switching back on right away patches back the exact earlier source. After
  other edits it replays the remembered writes; an option a later style
  overrode cannot be put back in place, so such a style keeps deciding.
- Two evaluator fixes came out of it: a bare `fill` uses the current colour
  (`\path[red, fill]` fills red) and keeps a pattern, as in PGF.
- A focused checkbox or slider no longer blocks app shortcuts such as Undo.
- A bare colour also colours the nodes, edges and pics on the path, so there
  it stays when a paint goes (`\draw[red] … node {x}` → `\path[red] …`), and
  draw / fill colours are written as their own keys.
- Review round: edges are now paths of their own, as in PGF: they keep the
  path's colours and settings but not its draw / fill mode, so
  `\path[draw=none] (a) edge (b)` draws the edge and `\path[fill=red]` does
  not fill it. A restore after a partial batch replays only those elements'
  writes, and remembered paint is kept per document.
- Known gaps: the editor lets a pattern switch shading off, which PGF does
  not. It cannot keep a stroke colour while drawing is off, so an edge drawn
  in its path's `draw=blue` turns to the current colour when the path's
  stroke goes (PGF keeps blue).

Tests: `test/edit-inspector-paint-toggle.spec.ts` (round trips),
`test/paint-toggle-fuzz.spec.ts` (random paths, nodes and edges; seed and
size via `PAINT_TOGGLE_FUZZ_SEED` / `PAINT_TOGGLE_FUZZ_CASES`),
`test/semantic-edge-paint.spec.ts`, `test/web/inspector-paint-toggle.spec.ts`
(remembered paint in the store) and
`apps/web/e2e/inspector-paint-toggles.spec.ts`.

## Verification per phase

- `npm run typecheck`, `npm run lint:prod`, `npm test`.
- `npm run test:e2e` after phases 2, 3 and 5. Phase 3 touches the
  flexlayout DOM the specs select on.
- `npm run test:desktop:e2e` after phases 4 and 5 (traffic lights, native
  menu).
- In the browser pane: light and dark mode, UI font size at 11/12/13,
  inspector at minimum and wide widths, a Beamer document, keyboard focus
  rings (`:focus-visible` on every new control), and screenshots against the
  mockup boards.

## Review round (2026-10-24)

Changes after the first look at phases 1–6:

- Toolbar: back to the earlier, taller toolbar with dividers between tool
  groups (and the original traffic-light position); only the full-screen
  inset fix stays. The tab bar no longer draws a top border, since the
  toolbar has one.
- Inspector side spacing: SidePanel's `.content` padding (6px) was leaking
  into the inspector, adding to the 12px section padding; the inspector's
  own `padding: 0` lost on load order. The label column is now
  `minmax(56px, 72px)`.
- Deck (frame) inspector: its fields sat in a bare `SectionBody` with no
  `Section`, and its number fields skipped the width cap.
- X/Y pairs: the row label centres on the fields, not on fields plus
  captions; numeric fields have no spin arrows.
- Segmented controls and button groups no longer carry the provenance
  tooltip.
- Sliders: one shared style (`controls.module.css` `.slider`), with the
  track filled up to the knob via `--fill` (`range-fill.ts`).
- Styles panel: the delete button overlays the right padding instead of
  reserving a column; editable keys read as plain text until hovered.
- Objects: a 12px disclosure column and 12px indentation per level; the
  visibility toggle moved to the right end and shows on hover or while
  hidden.
- Dock tab strips: the overflow button overlays the strip end instead of
  taking room, and a strip re-renders whenever it was laid out for a stale
  width, which fixes stuck overflow buttons and stale modes after resizes.
