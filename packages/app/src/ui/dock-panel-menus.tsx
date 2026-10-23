import { useCallback, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Actions, DockLocation, Orientation, RowNode, TabNode, TabSetNode, type BorderNode, type ITabRenderValues, type ITabSetRenderValues, type Model } from "flexlayout-react";
import {
  RiArrowDownSLine,
  RiCodeSSlashLine,
  RiEqualizerLine,
  RiImageLine,
  RiLayoutGridLine,
  RiNodeTree,
  RiPaletteLine,
  RiSlideshowLine,
  RiSparklingLine,
  RiStackLine,
  RiStickyNoteLine
} from "@remixicon/react";
import type { DocumentKind } from "@tikz-editor/core/document/kind";
import { APP_MENU_COMMAND_IDS as IDS, type AppMenuCommandId, type AppMenuItem } from "../app-menu";
import { CANVAS_CONTEXT_MENU_DEFINITION } from "../context-menu";
import { getActiveEditorPlatform } from "../platform/current";
import { useSettingsStore } from "../settings/useSettingsStore";
import { CanvasContextMenu } from "./CanvasContextMenu";
import type { CommandBindings } from "./editor-command-runtime";

// ── Panel names and icons ─────────────────────────────────────────────────────

/** Ids of the dockable panels; DockLayout re-exports this as PANEL_IDS. */
export const DOCK_PANEL_IDS = {
  source: "source",
  canvas: "canvas",
  figureNavigator: "figure-navigator",
  inspector: "inspector",
  builds: "builds",
  notes: "notes",
  objects: "objects",
  styles: "styles",
  assistant: "assistant",
} as const;

const P = DOCK_PANEL_IDS;

export function panelTitle(panelId: string, kind: DocumentKind): string {
  const titles: Record<string, string> = {
    [P.source]: "Source",
    [P.canvas]: "Canvas",
    [P.figureNavigator]: kind === "beamer" ? "Slides" : "Figures",
    [P.inspector]: "Inspector",
    [P.builds]: "Overlays",
    [P.notes]: "Notes",
    [P.objects]: "Objects",
    [P.styles]: "Styles",
    [P.assistant]: "Assistant",
  };
  return titles[panelId] ?? panelId;
}

function panelIcon(panelId: string, kind: DocumentKind): ReactNode {
  const props = { size: 13, "aria-hidden": true, className: "dock-tab-icon" } as const;
  switch (panelId) {
    case P.source: return <RiCodeSSlashLine {...props} />;
    case P.canvas: return <RiImageLine {...props} />;
    case P.figureNavigator: return kind === "beamer" ? <RiSlideshowLine {...props} /> : <RiLayoutGridLine {...props} />;
    case P.inspector: return <RiEqualizerLine {...props} />;
    case P.builds: return <RiStackLine {...props} />;
    case P.notes: return <RiStickyNoteLine {...props} />;
    case P.objects: return <RiNodeTree {...props} />;
    case P.styles: return <RiPaletteLine {...props} />;
    case P.assistant: return <RiSparklingLine {...props} />;
    default: return null;
  }
}

const TOGGLE_COMMANDS: Record<string, AppMenuCommandId> = {
  [P.source]: IDS.TOGGLE_SOURCE_PANEL,
  [P.figureNavigator]: IDS.TOGGLE_FIGURES_PANEL,
  [P.inspector]: IDS.TOGGLE_INSPECTOR_PANEL,
  [P.builds]: IDS.TOGGLE_BUILDS_PANEL,
  [P.notes]: IDS.TOGGLE_NOTES_PANEL,
  [P.objects]: IDS.TOGGLE_OBJECTS_PANEL,
  [P.styles]: IDS.TOGGLE_STYLES_PANEL,
  [P.assistant]: IDS.TOGGLE_ASSISTANT_PANEL,
};

// ── Docks ─────────────────────────────────────────────────────────────────────

export type DockSide = "left" | "below-canvas" | "right";

const SIDE_TABSET_IDS: Record<Exclude<DockSide, "below-canvas">, string> = { left: "source-tabset", right: "right-tabset" };

/** Where each panel lives when it is shown from a menu. */
const PANEL_SIDES: Record<string, DockSide> = {
  [P.source]: "left",
  [P.figureNavigator]: "below-canvas",
  [P.notes]: "below-canvas",
  [P.inspector]: "right",
  [P.builds]: "right",
  [P.objects]: "right",
  [P.styles]: "right",
  [P.assistant]: "right",
};

/** The tabset stacked directly under the canvas, if the layout has one. */
function belowCanvasTabset(model: Model): TabSetNode | null {
  const canvas = model.getNodeById("canvas-tabset");
  const parent = canvas?.getParent();
  if (!canvas || !(parent instanceof RowNode) || parent.getOrientation() !== Orientation.VERT) return null;
  const siblings = parent.getChildren();
  const next = siblings[siblings.indexOf(canvas) + 1];
  return next instanceof TabSetNode ? next : null;
}

export function dockSideOf(model: Model, tabset: TabSetNode): DockSide | null {
  if (tabset.getId() === SIDE_TABSET_IDS.left) return "left";
  if (tabset.getId() === SIDE_TABSET_IDS.right) return "right";
  return belowCanvasTabset(model) === tabset ? "below-canvas" : null;
}

function canMoveTo(model: Model, side: DockSide): boolean {
  return side !== "below-canvas" || model.getNodeById("canvas-tabset") != null;
}

/** Moves a panel into the dock on one side, re-creating that dock if it is gone. */
export function movePanelToSide(model: Model, panelId: string, side: DockSide): void {
  if (side === "below-canvas") {
    const below = belowCanvasTabset(model);
    if (below) {
      model.doAction(Actions.moveNode(panelId, below.getId(), DockLocation.CENTER, -1));
      return;
    }
    model.doAction(Actions.moveNode(panelId, "canvas-tabset", DockLocation.BOTTOM, -1));
    const created = model.getNodeById(panelId)?.getParent();
    if (created) {
      model.doAction(Actions.updateNodeAttributes(created.getId(), { weight: 20 }));
      model.doAction(Actions.updateNodeAttributes("canvas-tabset", { weight: 80 }));
    }
    return;
  }
  const tabsetId = SIDE_TABSET_IDS[side];
  if (model.getNodeById(tabsetId)) {
    model.doAction(Actions.moveNode(panelId, tabsetId, DockLocation.CENTER, -1));
    return;
  }
  model.doAction(Actions.moveNode(panelId, model.getRoot().getId(), side === "left" ? DockLocation.LEFT : DockLocation.RIGHT, -1));
  const created = model.getNodeById(panelId)?.getParent();
  if (created && created.getId() !== tabsetId) {
    model.doAction(Actions.updateNodeAttributes(created.getId(), { id: tabsetId, enableDeleteWhenEmpty: false }));
  }
}

// ── Tab buttons ───────────────────────────────────────────────────────────────

// Tab labels are 11px semibold at UI scale 1; see .dock-tab-label in DockLayout.css.
const TAB_FONT = '600 11px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
const TAB_CHROME_PX = 16;     // horizontal padding plus the gap to the next tab
const TAB_CLOSE_PX = 13;      // close button, shown on hover and on the selected tab
const TAB_ICON_PX = 17;       // icon plus its gap to the label
const ICON_TAB_PX = 29;       // a tab collapsed to its icon (no close button), plus gap
const STRIP_CHROME_PX = 31;   // strip padding plus the ▾ button
const FIT_MARGIN_PX = 4;      // slack for label widths measured off-screen

let measureContext: CanvasRenderingContext2D | null | undefined;
const labelWidths = new Map<string, number>();

function labelWidth(label: string): number {
  const cached = labelWidths.get(label);
  if (cached !== undefined) return cached;
  if (measureContext === undefined) {
    measureContext = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
    if (measureContext) measureContext.font = TAB_FONT;
  }
  const width = measureContext ? measureContext.measureText(label).width : label.length * 6.5;
  labelWidths.set(label, width);
  return width;
}

function uiScale(): number {
  return useSettingsStore.getState().settings.general.uiFontSizePx / 11;
}

/**
 * How much of each tab a strip can show: every label, the selected tab's label
 * beside the others' icons, or icons only.
 *
 * Overflowing must be avoided rather than corrected: once flexlayout shows its
 * overflow button, the tabs have that much less room and the button stays
 * unless they fit beside it. So a strip whose width is not yet known (its
 * first render) shows icons only, and the modes are far enough apart that a
 * frame rendered with a stale width during a resize recovers on the next.
 */
function tabStripMode(tabset: TabSetNode): "labels" | "selectedLabel" | "icons" {
  const width = tabset.getRect().width / uiScale() - FIT_MARGIN_PX;
  if (!(width > 0)) return "icons";
  const tabs = tabset.getChildren().filter((child): child is TabNode => child instanceof TabNode);
  const labels = tabs.reduce((sum, tab) => sum + labelWidth(tab.getName()) + TAB_CHROME_PX + (tab.isEnableClose() ? TAB_CLOSE_PX : 0), STRIP_CHROME_PX);
  if (labels <= width) return "labels";
  const selected = tabset.getSelectedNode();
  const selectedLabel = selected instanceof TabNode
    ? STRIP_CHROME_PX + labelWidth(selected.getName()) + TAB_CHROME_PX + TAB_ICON_PX + TAB_CLOSE_PX + (tabs.length - 1) * ICON_TAB_PX
    : Infinity;
  return selectedLabel <= width ? "selectedLabel" : "icons";
}

/**
 * Tabs carry their label in a span whose ::after reserves the semibold width,
 * so selecting a tab does not shift its neighbours. In a narrow strip the
 * inactive tabs keep only their icon; the label stays in the DOM, visually
 * hidden, for screen readers and for tests that select tabs by name.
 */
export function renderDockTab(node: TabNode, values: ITabRenderValues, kind: DocumentKind, onLaidOut: (tabset: TabSetNode) => void): void {
  const name = node.getName();
  const parent = node.getParent();
  if (!(parent instanceof TabSetNode)) return;
  const stretch = parent.isEnableSingleTabStretch() && parent.getChildren().length === 1;
  const label = <span className="dock-tab-label" data-label={name}>{name}</span>;
  if (stretch) {
    values.content = label;
    return;
  }
  const icon = panelIcon(node.getComponent() ?? node.getId(), kind);
  const mode = tabStripMode(parent);
  onLaidOut(parent);
  if (mode === "labels" || icon == null) {
    values.content = label;
    return;
  }
  if (mode === "selectedLabel" && parent.getSelectedNode() === node) {
    values.content = <>{icon}{label}</>;
    return;
  }
  values.content = <span className="dock-tab-iconOnly" title={name}>{icon}<span className="dock-tab-label dock-tab-labelHidden">{name}</span></span>;
}

// ── Menus ─────────────────────────────────────────────────────────────────────

type OpenMenu = { anchor: { x: number; y: number }; container: HTMLElement; items: readonly AppMenuItem[]; bindings: CommandBindings };

type DockMenuHost = {
  getModel(): Model;
  /** Re-renders the layout's tab strips (flexlayout skips them on a parent render). */
  redraw(): void;
  togglePanel(panelId: string): void;
  persist(): void;
};

function panelAvailable(panelId: string, kind: DocumentKind): boolean {
  if (panelId === P.builds || panelId === P.notes) return kind === "beamer";
  if (panelId === P.assistant) return typeof getActiveEditorPlatform().assistant?.startTurn === "function";
  return true;
}

/** The panels a dock's ▾ menu offers: those docked there and those that live there when shown. */
function dockMenuPanels(model: Model, tabset: TabSetNode, kind: DocumentKind): string[] {
  const side = dockSideOf(model, tabset);
  const here = tabset.getChildren().map(child => child.getId()).filter(id => id !== P.canvas);
  const home = Object.keys(PANEL_SIDES).filter(id => side != null && PANEL_SIDES[id] === side && model.getNodeById(id) == null);
  return [...here, ...home].filter(id => TOGGLE_COMMANDS[id] !== undefined && panelAvailable(id, kind));
}

export function useDockPanelMenus(host: DockMenuHost, kind: DocumentKind) {
  const [menu, setMenu] = useState<OpenMenu | null>(null);

  const show = useCallback((event: MouseEvent<HTMLElement>, items: readonly AppMenuItem[], bindings: CommandBindings) => {
    event.preventDefault();
    event.stopPropagation();
    const platform = getActiveEditorPlatform();
    if (platform.menu?.usesNativeContextMenus && platform.menu.showNativeContextMenu) {
      void platform.menu.showNativeContextMenu({
        items,
        commandStates: bindings,
        onCommandRun: (id, origin) => { const binding = bindings[id]; if (binding?.enabled) void binding.run(origin); }
      });
      return;
    }
    const container = event.currentTarget.closest<HTMLElement>(".flexlayout__layout");
    if (!container) return;
    const box = container.getBoundingClientRect();
    const trigger = event.currentTarget.getBoundingClientRect();
    // A click on the ▾ button drops the menu below it; a right-click opens at the pointer.
    const anchor = event.type === "contextmenu"
      ? { x: event.clientX - box.left, y: event.clientY - box.top }
      : { x: trigger.right - box.left - 4, y: trigger.bottom - box.top + 2 };
    setMenu({ anchor, container, items, bindings });
  }, []);

  const onContextMenu = useCallback((node: TabNode | TabSetNode | BorderNode, event: MouseEvent<HTMLElement>) => {
    if (!(node instanceof TabNode) || node.getId() === P.canvas) return;
    const model = host.getModel();
    const parent = node.getParent();
    const current = parent instanceof TabSetNode ? dockSideOf(model, parent) : null;
    const panelId = node.getId();
    const move = (side: DockSide) => ({
      enabled: current !== side && canMoveTo(model, side),
      run: () => { movePanelToSide(host.getModel(), panelId, side); host.persist(); }
    });
    const bindings: CommandBindings = {
      [IDS.PANEL_CLOSE]: { enabled: node.isEnableClose(), run: () => { host.togglePanel(panelId); } },
      [IDS.PANEL_MOVE_LEFT]: move("left"),
      [IDS.PANEL_MOVE_BELOW_CANVAS]: move("below-canvas"),
      [IDS.PANEL_MOVE_RIGHT]: move("right"),
    };
    show(event, [
      { kind: "command", commandId: IDS.PANEL_CLOSE, label: `Close “${node.getName()}”` },
      { kind: "separator" },
      { kind: "command", commandId: IDS.PANEL_MOVE_LEFT, label: "Move to Left Side" },
      { kind: "command", commandId: IDS.PANEL_MOVE_BELOW_CANVAS, label: "Move Below Canvas" },
      { kind: "command", commandId: IDS.PANEL_MOVE_RIGHT, label: "Move to Right Side" },
    ], bindings);
  }, [host, show]);

  const onRenderTabSet = useCallback((node: TabSetNode | BorderNode, values: ITabSetRenderValues) => {
    if (!(node instanceof TabSetNode)) return;
    const panels = dockMenuPanels(host.getModel(), node, kind);
    if (panels.length < 2) return;
    values.stickyButtons.push(
      <button
        key="dock-menu"
        type="button"
        className="flexlayout__tab_toolbar_button dock-menu-button"
        title="Show or hide panels"
        aria-label="Show or hide panels"
        onPointerDown={(event) => { event.stopPropagation(); }}
        onClick={(event) => {
          const model = host.getModel();
          const bindings: CommandBindings = {};
          const items: AppMenuItem[] = [];
          for (const panelId of dockMenuPanels(model, node, kind)) {
            const commandId = TOGGLE_COMMANDS[panelId];
            if (commandId === undefined) continue;
            bindings[commandId] = { enabled: true, checked: model.getNodeById(panelId) != null, run: () => { host.togglePanel(panelId); } };
            items.push({ kind: "command", commandId, label: panelTitle(panelId, kind) });
          }
          show(event, items, bindings);
        }}
      >
        <RiArrowDownSLine size={13} aria-hidden="true" />
      </button>
    );
  }, [host, kind, show]);

  // flexlayout measures a strip after rendering its tabs and does not render
  // them again for that alone, so tabs can be laid out for a stale width: none
  // on the first render, the old one after a resize. Each strip remembers the
  // width it was laid out for and asks for one more render if that changed.
  const laidOutWidths = useRef(new WeakMap<TabSetNode, number>());
  const pendingCheck = useRef(new Set<TabSetNode>());
  const onLaidOut = useCallback((tabset: TabSetNode) => {
    laidOutWidths.current.set(tabset, tabset.getRect().width);
    if (pendingCheck.current.has(tabset)) return;
    pendingCheck.current.add(tabset);
    // A strip not yet measured gets a few more frames before the check gives up.
    const check = (framesLeft: number) => {
      const width = tabset.getRect().width;
      if (!(width > 0) && framesLeft > 0) {
        requestAnimationFrame(() => { check(framesLeft - 1); });
        return;
      }
      pendingCheck.current.delete(tabset);
      if (width > 0 && width !== laidOutWidths.current.get(tabset)) host.redraw();
    };
    requestAnimationFrame(() => { check(10); });
  }, [host]);
  const onRenderTab = useCallback((node: TabNode, values: ITabRenderValues) => { renderDockTab(node, values, kind, onLaidOut); }, [kind, onLaidOut]);

  const close = useCallback(() => { setMenu(null); }, []);
  const element = menu ? (
    <CanvasContextMenu
      open
      anchor={menu.anchor}
      target="selection-multi"
      containerRef={{ current: menu.container }}
      bindings={menu.bindings}
      definition={{ ...CANVAS_CONTEXT_MENU_DEFINITION, "selection-multi": menu.items }}
      onClose={close}
      onCommandRun={(id, origin) => { const binding = menu.bindings[id]; if (binding?.enabled) void binding.run(origin); }}
    />
  ) : null;

  return { onContextMenu, onRenderTabSet, onRenderTab, menu: element };
}
