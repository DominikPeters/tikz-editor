# Add-On UI Contributions: Menus, Tools, Templates

## Purpose

Phase 2 of the add-on surface (deferred from `addon-architecture.md`,
"Templates, menus, commands"): let add-ons contribute **menu items**,
**toolbar tools**, and **insertion templates** so users can create add-on
content (an axis, a smiley, a duck) without typing `\begin{axis}` by hand.
The v1 add-on system (Phases A–D, landed 2026-07-16) covers parsing,
evaluation, editing, inspection, completion, loading, and export; creation
is the missing quadrant of the editing loop.

Scope for this design, in priority order:

1. **Menu commands** — add-on items in the Insert menu (and, sparingly,
   other sections), dispatching add-on-defined actions.
2. **Insertion templates** — "insert this source snippet at a canvas
   position", the shared primitive both menus and tools bottom out in.
3. **Toolbar creation tools** — a click-to-place tool mode per contributed
   template (drag-to-size deferred).

Non-goals: add-on panels/modals, context-menu contributions, add-on
keyboard shortcuts beyond what menus give for free, and migrating core's
own tools onto the new registry (design-for, don't-do, as usual).

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
  separators, submenus, and per-item `platforms` scoping; it is filtered
  per platform by `filterAppMenuDefinitionForTarget` (App.tsx) and carries
  no behavior. Good news for injection: contributing items = producing a
  new definition value.
- **The desktop native menu caches by content.** `native-menu.ts` only
  rebuilds when `JSON.stringify(definition)` changes; command nodes carry
  the command id and round-trip through `dispatchCommand(id as
  AppMenuCommandId)`. Dynamic items therefore work iff (a) the definition
  value changes when add-ons change and (b) contributed ids survive the
  cast boundary.
- **Tools are a parallel registry.** `TOOL_BUTTONS`
  (`ui/tool-config.tsx:174-190`) drives the toolbar; `ToolMode`
  (`store/types.ts:12-27`) is a closed union held in the store; creation
  tools funnel into the `addElement` edit action with an
  `ElementTemplate` (`core/src/edit/element-templates.ts:13-22`), whose
  `generateElementSource` emits a TikZ snippet and
  `insertElementIntoSource` splices it before `\end{tikzpicture}`.
- **Web keyboard shortcuts are hand-coded** in App.tsx's `onKeyDown`;
  menu `accelerator` strings are display-only on web. Single-letter tool
  shortcuts come from `TOOL_BUTTONS[].shortcut` via
  `toolModeFromShortcut`.

## Design

### The shared primitive: add-on source templates

Everything in this phase lowers to one operation the host already has:
**insert a source snippet at a position** (`addElement` ≈ generate +
splice). Rather than opening the `ElementTemplate` union (whose kinds are
geometry-specific), add-ons contribute *source templates*:

```ts
// addon-api additions (engine entry — worker-safe, plain data + one pure fn)
export type AddonTemplate = {
  /** Namespaced id: "addon:<addonId>:<template>". */
  id: `addon:${string}`;
  label: string;                    // "Smiley", "Axis", "Duck"
  /** Where creation is anchored: the template receives the target point. */
  generateSource(at: WorldPoint): string;
  /**
   * How the canvas tool places it. "click" inserts at the click point;
   * "none" means menu-only (inserted at the visible canvas center).
   */
  placement?: "click" | "none";
};
```

`generateSource` is a pure function of the target point — the add-on
formats its own snippet (`\smiley (1.2,0.8);`,
`\begin{axis}...\end{axis}`). It lives on the **engine** entry (pure,
worker-safe, no DOM) so the same template list can later power a worker
or CLI. Templates are declared on the engine:

```ts
export type AddonEngine = {
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

`generateElementSource` returns `template.source` verbatim for this kind;
`insertElementIntoSource` and the selection/normalization behavior of
`addElement` apply unchanged. The app builds the snippet by calling the
add-on's `generateSource(at)` at dispatch time and wraps it as
`{ kind: "addElement", template: { kind: "addonSource", source }, at }`.
No new edit action; undo/history/incremental all come for free.

### Namespaced command ids

Widen the id type once, mirroring feature/property ids:

```ts
// app-menu/types.ts
export type AddonMenuCommandId = `addon:${string}`;           // "addon:smiley:insert-smiley"
export type AnyMenuCommandId = AppMenuCommandId | AddonMenuCommandId;
```

Everything that is exhaustively keyed stays exhaustive over
`AppMenuCommandId`; add-on ids ride in parallel structures:

- `CommandBindings` keeps its `Record<AppMenuCommandId, CommandBinding>`
  shape (so TS still enforces core coverage) and the runtime gains
  `addonBindings: ReadonlyMap<AddonMenuCommandId, CommandBinding>`.
  `runCommand` and `getCommandState` accept `AnyMenuCommandId` and consult
  the map after the record. This keeps the "every core id has a binding"
  compile-time guarantee while opening the runtime.
- Menu item types widen: `AppMenuCommandItem.commandId: AnyMenuCommandId`.
  The native menu's `dispatchCommand(id)` cast widens to
  `AnyMenuCommandId` — the id is already just a string at that boundary.

### Menu contributions

Add-ons declare menu items on the **ui entry** (main-thread, may carry
functions):

```ts
export type AddonMenuContribution = {
  commandId: `addon:${string}`;
  label: string;
  /** Only "insert" in v1; the item lands in a dedicated add-on group. */
  section: "insert";
  /** What the command does. v1: insert a declared template. */
  action: { kind: "insert-template"; templateId: `addon:${string}` };
};

export type AddonUi = {
  // ...existing...
  menus?: AddonMenuContribution[];
};
```

The `action` field is a closed union rather than a callback: v1 has
exactly one behavior (insert a template), and a data description keeps
menu dispatch introspectable, serializable to the desktop native menu,
and trivially enablement-checkable. A `{ kind: "command"; run() }`
escape hatch can be added later without breaking anything — the union is
open by construction.

Assembly: App.tsx currently memoizes
`filterAppMenuDefinitionForTarget(APP_MENU_DEFINITION, menuTarget)`.
That memo gains the add-on runtime revision as an input and becomes:

```ts
buildMenuDefinition(APP_MENU_DEFINITION, menuTarget, activeAddonMenus)
```

which appends, to the Insert section, one separator plus the contributed
items (grouped per add-on, sorted by add-on id then declaration order).
Because this produces a **new definition value**, the desktop native
menu's `JSON.stringify` cache key changes and it rebuilds — the existing
mechanism already handles dynamic definitions correctly; enable/disable
of an add-on flows through the same path.

Enablement: template-insert commands are enabled exactly when the
document has an active figure (same condition as core insert tools);
computed by the runtime, not the add-on. Disabled add-ons contribute
nothing (the loader already rebuilds the runtime on settings changes).

### Toolbar tools

A single generic tool mode avoids opening the `ToolMode` union per
add-on:

```ts
// store/types.ts
| { /* existing literals */ }
| "addonTemplate"
// plus store state:
activeAddonTemplateId: `addon:${string}` | null;
```

`SET_TOOL_MODE` gains an optional `addonTemplateId` payload. The toolbar
renders one button per template with `placement: "click"`, using a
generic puzzle-piece icon (add-on-supplied SVG icons are deferred —
icons are the only part of this design that would carry markup across
the boundary, and v1 does not need to solve that). The button behaves
like other creation tools: click to arm, click on canvas to place, which
dispatches the same `addElement`/`addonSource` action at the click
point, then returns to select mode (matching one-shot placement).

The canvas controller change is small: `isCreationToolMode` includes
`"addonTemplate"`, and the placement handler looks up the active
template, calls `generateSource(clickWorld)`, and dispatches. Snapping
uses the plain point (no shape-specific snap kinds in v1).

### Keyboard shortcuts

None in v1. Contributed menu items get no accelerators (web shortcuts
are hand-coded in App.tsx and the letter namespace is crowded). The menu
item itself is the discoverable path; shortcuts can follow if a real
need appears.

### Settings, loading, workers

No changes. Menus/tools derive from the active runtime, which the loader
already rebuilds on enablement changes; the runtime revision signal
already re-renders the toolbar/menu. Templates live on the engine entry
(worker-safe by construction); menu contributions live on the ui entry
and never cross a worker boundary.

### apiVersion

Additive: templates and menu contributions are optional fields, so this
ships as addon-api **0.2.0** (minor bump), with hosts that implement it
accepting `^0.1.0` manifests unchanged (feature-detect: add-ons declaring
templates simply contribute nothing on a 0.1 host — but since the host
version only moves forward, the practical rule is: add-ons requiring
menus/tools declare `apiVersion: "^0.2.0"`).

## Litmus test

Every hook above is describable without naming any concrete add-on:
"engines may declare source templates; uis may declare Insert-menu items
that insert a declared template; the toolbar shows a button per
click-placeable template." pgfplots ("Insert axis"), tikzducks ("Insert
duck"), and the smiley test add-on are all instances.

## Implementation plan

Each step lands independently, validated by the smiley add-on + tests.

1. **Core template kind.** `{ kind: "addonSource"; source: string }` in
   `ElementTemplate` + `generateElementSource` case. Unit test: insert
   via `applyEditAction addElement`.
2. **addon-api 0.2.0.** `AddonTemplate`, `AddonEngine.templates`,
   `AddonMenuContribution`, `AddonUi.menus`; bump
   `HOST_ADDON_API_VERSION`. Smiley declares an "Insert smiley" template
   + menu item.
3. **Command runtime opening.** `AnyMenuCommandId`, `addonBindings` map
   built from the active runtime (templates → insert commands),
   `runCommand`/`getCommandState`/`AppMenuBar`/native-menu id widening.
   Unit test: `runCommand("addon:smiley:insert-smiley")` inserts at the
   canvas center and the statement renders.
4. **Menu assembly.** `buildMenuDefinition` with the add-on group in
   Insert; runtime-revision dependency in App.tsx. e2e: menu shows
   "Insert smiley", clicking it adds a smiley to the document.
5. **Toolbar tool.** `"addonTemplate"` mode + `activeAddonTemplateId`,
   toolbar button, canvas click placement. e2e: arm the tool, click the
   canvas, smiley appears at the click point.

Steps 1–3 are core/app plumbing with unit coverage; 4–5 are the visible
payoff with e2e coverage riding the `VITE_TEST_ADDONS` harness.

## Open questions

- **Add-on tool icons:** generic icon in v1; if add-ons should supply
  icons later, prefer a small curated glyph set or path-data-only icons
  over arbitrary SVG/React across the boundary.
- **Insert-menu growth:** with many add-ons enabled the Insert section
  gets long; a per-add-on submenu ("Smiley ▸ Insert smiley") is the
  likely shape once any add-on contributes more than ~2 items. Defer
  until real add-ons show the shape.
- **Drag-to-size placement:** pgfplots' axis wants a drag-defined
  rectangle eventually (`placement: "drag-rect"` receiving two corners).
  The template signature accommodates it (add a second optional point)
  but the canvas interaction is deferred.
