# Add-On UI Contributions: Menus, Tools, Templates, Context Menus

## Purpose

Phase 2 of the add-on surface (deferred from `addon-architecture.md`,
"Templates, menus, commands"): let add-ons contribute **menu items**,
**toolbar tools**, **insertion templates**, and **context-menu actions**
so users can create and manipulate add-on content (an axis, a smiley, a
duck) without typing source by hand. The v1 add-on system (Phases A–D,
landed 2026-07-16) covers parsing, evaluation, editing, inspection,
completion, loading, and export; creation and per-element actions are
the missing quadrants of the editing loop.

Scope, in priority order:

1. **Insertion templates** — "insert this source snippet at a canvas
   position", the shared primitive menus and tools bottom out in.
2. **Menu contributions** — add-on entries in the Insert menu: a single
   item or a per-add-on submenu, the add-on chooses.
3. **Toolbar creation tools** — a click-to-place tool per contributed
   template, with add-on-supplied path-data icons.
4. **Context-menu actions** — add-on items when a claimed element is
   right-clicked.

Non-goals: add-on panels/modals, add-on keyboard shortcuts beyond what
menus give for free, arbitrary SVG/React icons across the API boundary,
and migrating core's own tools onto the new registries.

**Dropped constraint: worker safety.** The original architecture kept
engine entries worker-safe for a planned compute-worker migration. That
migration was tried and abandoned — snapshot transfer volume tanked
performance — and is not coming back. Worker transferability is no
longer a design input; contributions may live wherever is simplest.
(Plain-data payloads for parse/eval results remain required — they ride
inside snapshots and history — but "no functions on the ui entry
boundary" style rules are gone.)

## Current state (what the code actually looks like)

The audit of the closed dispatch points, with anchors:

- **Command ids are a closed union.** `AppMenuCommandId` derives from the
  `APP_MENU_COMMAND_IDS` const (`app-menu/types.ts:1-117`, ~108 ids,
  convention `"<section>.<kebab-action>"`). Everything downstream is
  exhaustively keyed on it: `CommandBindings = Record<AppMenuCommandId,
  CommandBinding>` (`editor-command-runtime.ts:81`), the native-menu
  `commandStates` record, and `getCommandState`. TypeScript enforces that
  `createEditorCommandRuntime` binds every id.
- **The menu is a pure data tree.** `APP_MENU_DEFINITION`
  (`app-menu/default-menu.ts`) is a const of sections/items with
  separators, submenus, and per-item `platforms` scoping; filtered per
  platform by `filterAppMenuDefinitionForTarget` (App.tsx); no behavior.
  Contributing items = producing a new definition value.
- **The desktop native menu caches by content.** `native-menu.ts` only
  rebuilds when `JSON.stringify(definition)` changes; command nodes carry
  the command id and round-trip through `dispatchCommand(id as
  AppMenuCommandId)`. Dynamic items work iff the definition value changes
  when add-ons change and contributed ids survive the cast boundary.
- **Tools are a parallel registry.** `TOOL_BUTTONS`
  (`ui/tool-config.tsx:174-190`) drives the toolbar; `ToolMode`
  (`store/types.ts:12-27`) is a closed union held in the store; creation
  tools funnel into the `addElement` edit action with an
  `ElementTemplate` (`core/src/edit/element-templates.ts:13-22`), whose
  `generateElementSource` emits a TikZ snippet and
  `insertElementIntoSource` splices it before `\end{tikzpicture}`.
- **The canvas context menu is target-keyed data.**
  `resolveCanvasContextMenuTarget` (`canvas-panel/context-menu-target.ts`)
  classifies the clicked element (it already parses the clicked
  statement via `parseTikzForEdit`) into a closed
  `CanvasContextMenuTarget` union; `buildCanvasContextMenuDefinition`
  (`context-menu/canvas-context-menu.ts`) maps each target to
  `AppMenuItem[]`. The desktop path serializes those items and
  dispatches back by command id
  (`native-menu.ts serializeDesktopContextMenuItems`).
- **Web keyboard shortcuts are hand-coded** in App.tsx's `onKeyDown`;
  menu `accelerator` strings are display-only on web.

## Design

### The shared primitive: add-on source templates

Everything creation-shaped lowers to one operation the host already
has: **insert a source snippet at a position** (`addElement` ≈ generate
+ splice). Rather than opening the geometry-specific `ElementTemplate`
union per add-on, add-ons contribute *source templates* on the **ui
entry** (with the worker constraint gone, all UI-facing contributions
live in one place; an add-on without a ui entry contributes no creation
UI):

```ts
// addon-api additions
export type AddonTemplate = {
  /** Namespaced id: "addon:<addonId>:<template>". */
  id: `addon:${string}`;
  label: string;                    // "Smiley", "Axis", "Duck"
  /**
   * SVG path data (a single `d` string, 24x24 viewBox, filled by the
   * host's icon styling). Not full SVG — no markup crosses the boundary.
   * Omitted: the host shows a generic add-on glyph.
   */
  iconPath?: string;
  /** The template receives the target point (world pt) and formats its own snippet. */
  generateSource(at: WorldPoint): string;
  /**
   * How the canvas tool places it. "click" inserts at the click point
   * and gets a toolbar button; "none" means menu-only (inserted at the
   * visible canvas center).
   */
  placement?: "click" | "none";
};

export type AddonUi = {
  // ...existing...
  templates?: AddonTemplate[];
};
```

Insertion reuses the `addElement` machinery via one new template kind in
core — the only core-union change this design needs:

```ts
// core edit/element-templates.ts
| { kind: "addonSource"; source: string }   // pre-generated snippet
```

`generateElementSource` returns `template.source` verbatim for this
kind; `insertElementIntoSource`, selection, and normalization apply
unchanged. The app calls the add-on's `generateSource(at)` at dispatch
time and wraps it as `{ kind: "addElement", template: { kind:
"addonSource", source }, at }`. No new edit action; undo/history/
incremental all come for free.

### Namespaced command ids

Widen the id type once, mirroring feature/property ids:

```ts
// app-menu/types.ts
export type AddonMenuCommandId = `addon:${string}`;           // "addon:smiley:insert-smiley"
export type AnyMenuCommandId = AppMenuCommandId | AddonMenuCommandId;
```

Everything exhaustively keyed stays exhaustive over `AppMenuCommandId`;
add-on ids ride in parallel structures:

- `CommandBindings` keeps its `Record<AppMenuCommandId, CommandBinding>`
  shape (TS still enforces core coverage); the runtime gains
  `addonBindings: ReadonlyMap<AddonMenuCommandId, CommandBinding>`,
  consulted by `runCommand`/`getCommandState` after the record.
- Menu item types widen: `AppMenuCommandItem.commandId:
  AnyMenuCommandId`; the native menu's dispatch cast widens too (the id
  is already just a string at that boundary).

### Menu contributions

Add-ons declare their Insert-menu presence on the ui entry. **The add-on
chooses its shape**: exactly one inline action, or a labeled submenu —
nothing in between (an add-on with several actions must group them).

```ts
export type AddonMenuAction = {
  commandId: `addon:${string}`;
  label: string;
  /** v1: insert a declared template. Closed union, open by construction. */
  action: { kind: "insert-template"; templateId: `addon:${string}` };
};

export type AddonMenuContribution =
  | { kind: "item"; item: AddonMenuAction }
  | { kind: "submenu"; label: string; items: AddonMenuAction[] };

export type AddonUi = {
  // ...existing...
  insertMenu?: AddonMenuContribution;
};
```

The `action` field is data rather than a callback so menu dispatch stays
introspectable, serializable to the desktop native menu, and
enablement-checkable. A `{ kind: "command" }` escape hatch can be added
later without breaking anything.

Assembly: App.tsx's menu-definition memo gains the add-on runtime
revision as an input and becomes `buildMenuDefinition(APP_MENU_DEFINITION,
menuTarget, activeAddonContributions)`, appending to the Insert section
one separator plus each add-on's contribution (sorted by add-on id).
Because this produces a **new definition value**, the desktop native
menu's `JSON.stringify` cache key changes and it rebuilds — the existing
mechanism already handles dynamic definitions; enable/disable flows
through the same path.

Enablement: template-insert commands are enabled exactly when the
document has an active figure (same condition as core insert tools),
computed by the runtime, not the add-on.

### Toolbar tools

A single generic tool mode avoids opening the `ToolMode` union per
add-on:

```ts
// store/types.ts
| "addonTemplate"
// plus store state:
activeAddonTemplateId: `addon:${string}` | null;
```

`SET_TOOL_MODE` gains an optional `addonTemplateId` payload. The toolbar
renders one button per template with `placement: "click"`, using the
template's `iconPath` (rendered as `<svg viewBox="0 0 24 24"><path
d={iconPath}/></svg>` with the toolbar's fill styling) or a generic
add-on glyph when omitted. The button behaves like other creation
tools: click to arm, click on canvas to place — dispatching the same
`addElement`/`addonSource` action at the click point — then returns to
select mode (one-shot placement). `isCreationToolMode` includes
`"addonTemplate"`; snapping uses the plain point (no shape-specific
snap kinds in v1).

### Context-menu actions

When a claimed element is right-clicked, the add-on may contribute
actions for it. The hook mirrors the inspector provider: called at
menu-open time with the clicked statement in hand, returning items that
already carry their plain-data edits:

```ts
export type AddonContextMenuItem = {
  /** Namespaced per-open command id, e.g. "addon:smiley:make-sad". */
  commandId: `addon:${string}`;
  label: string;
  /** Plain-data edit dispatched through the engine's applyEdit on click. */
  edit: unknown;
};

export type AddonUi = {
  // ...existing...
  /** Items for a right-clicked claimed statement; empty/omitted = no contribution. */
  contextMenu?(statement: AddonStatement, context: { world: WorldPoint }): AddonContextMenuItem[];
};
```

Wiring:

- `resolveCanvasContextMenuTarget` already parses the clicked statement;
  when the clicked source id belongs to a claimed statement (directly,
  or via `findAddonStatement` for nested claims), the app calls
  `ui.contextMenu(statement, { world })` and appends the returned items
  (separator-prefixed) to the resolved target's item list. Targets stay
  closed; add-on items are an append, not a new target.
- Items are built **per open**: the app keeps a `commandId -> edit` map
  for the open menu instance. The web menu dispatches
  `{ kind: "addonEdit", addonId, edit }` directly; the desktop native
  context menu serializes labels+ids as today and the dispatch callback
  looks the edit up in the per-open map (ids round-trip as strings, as
  they already do).
- Building items at open time lets the add-on tailor them to the
  statement (an axis offers different actions than an `\addplot`) and
  to the click position (the `world` point can be baked into the edit —
  e.g. "add data point here").

Because every item bottoms out in `addonEdit`, undo/history/incremental
behavior is identical to inspector writes; no new dispatch machinery.

### Keyboard shortcuts

None in v1. Contributed menu items get no accelerators (web shortcuts
are hand-coded in App.tsx and the letter namespace is crowded). Menu and
context-menu items are the discoverable paths.

### Settings and loading

No changes. Menus/tools/context items derive from the active runtime,
which the loader already rebuilds on enablement changes; the runtime
revision signal already re-renders the affected components.

### apiVersion

Additive: all new fields are optional, so this ships as addon-api
**0.2.0** (minor bump). Add-ons requiring menus/tools declare
`apiVersion: "^0.2.0"`.

## Litmus test

Every hook is describable without naming a concrete add-on: "uis may
declare source templates with path-data icons; an Insert-menu item or
submenu that inserts declared templates; a toolbar button per
click-placeable template; and context-menu items for right-clicked
claimed statements." pgfplots ("Insert axis", "Add data point here"),
tikzducks ("Insert duck"), and the smiley test add-on are all instances.

## Implementation plan

Each step lands independently, validated by the smiley add-on + tests.

1. **Core template kind.** `{ kind: "addonSource"; source: string }` in
   `ElementTemplate` + `generateElementSource` case. Unit test: insert
   via `applyEditAction addElement`.
2. **addon-api 0.2.0.** `AddonTemplate`, `AddonMenuAction`/
   `AddonMenuContribution`, `AddonContextMenuItem`, the three `AddonUi`
   fields; bump `HOST_ADDON_API_VERSION`. Smiley declares an "Insert
   smiley" template (with a smiley-face `iconPath`) and a context item
   ("Grow smiley" → radius edit).
3. **Command runtime opening.** `AnyMenuCommandId`, `addonBindings` map
   built from the active runtime, `runCommand`/`getCommandState`/
   `AppMenuBar`/native-menu id widening. Unit test:
   `runCommand("addon:smiley:insert-smiley")` inserts at the canvas
   center and the statement renders.
4. **Menu assembly.** `buildMenuDefinition` with the add-on group in
   Insert (item vs submenu per contribution shape); runtime-revision
   dependency in App.tsx. e2e: menu shows "Insert smiley", clicking it
   adds a smiley to the document.
5. **Toolbar tool.** `"addonTemplate"` mode + `activeAddonTemplateId`,
   toolbar button with `iconPath`, canvas click placement. e2e: arm the
   tool, click the canvas, smiley appears at the click point.
6. **Context menu.** Claimed-statement detection in the target resolver,
   per-open item map, append + dispatch on web and desktop-serialized
   paths. e2e: right-click a smiley, "Grow smiley" appears and applying
   it rewrites the radius in source.

Steps 1–3 are plumbing with unit coverage; 4–6 are the visible payoff
with e2e coverage riding the `VITE_TEST_ADDONS` harness.

## Open questions

- **Icon guidelines:** path data implies a single-color glyph; if
  add-ons want two-tone icons the host would need a fill+stroke
  convention or a second path. Start strict (one path, one color).
- **Drag-to-size placement:** pgfplots' axis wants a drag-defined
  rectangle eventually (`placement: "drag-rect"` receiving two corners).
  The template signature accommodates it (add a second optional point)
  but the canvas interaction is deferred.
- **Context items on multi-selection:** v1 contributes only for a
  single claimed statement; batch actions ("normalize all axes") would
  need a multi-statement hook — defer until a real use appears.
