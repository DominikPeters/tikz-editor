import { isRecord } from "../validation";
import { Activity, Suspense, memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Layout, Model, Actions, DockLocation, type IJsonModel, type TabNode } from "flexlayout-react";
import { useEditorStore } from "../store/store";
import type { EditorAction } from "../store/types";
import { parseDocumentRootId } from "@tikz-editor/core/document/root-id";
import { getActiveEditorPlatform } from "../platform/current";
import { loadDockLayout, saveDockLayout } from "../store/workspace-storage";
import { SourcePanel } from "./source-panel/SourcePanel";
import { CanvasPanel } from "./canvas-panel/CanvasPanel";
import { RootNavigator } from "./RootNavigator";
import { InspectorPanel } from "./inspector-panel/InspectorPanel";
import { BuildsPanel } from "./builds-panel/BuildsPanel";
import { NotesPanel } from "./notes-panel/NotesPanel";
import { DeckInspectorPanel } from "./inspector-panel/DeckInspectorPanel";
import { ObjectsPanel } from "./objects-panel/ObjectsPanel";
import { StylesPanel } from "./StylesPanel";
import { AssistantPanel } from "./AssistantPanel";
import type { AssistantComposerImageAttachment } from "./assistant-image-attachments";
import type { SvgRenderModel } from "@tikz-editor/core/svg";
import "flexlayout-react/style/gray.css";
import "./DockLayout.css";
import { hasMultipleRoots, snapshotRoots } from "../root-inventory";
import { isDockLayoutJson } from "./dock-layout-validation";
import { DOCK_PANEL_IDS, panelTitle, useDockPanelMenus } from "./dock-panel-menus";
import type { DocumentKind } from "@tikz-editor/core/document/kind";

// ── Panel IDs ─────────────────────────────────────────────────────────────────

export const PANEL_IDS = DOCK_PANEL_IDS;

const HOME_TABSET_IDS = ["source-tabset", "canvas-tabset", "right-tabset"] as const;

type PanelHome = {
  tabsetId: string;
  dockLocation: DockLocation;
  edgeLocation: DockLocation;
};

const PANEL_HOMES: Record<string, PanelHome> = {
  [PANEL_IDS.source]: {
    tabsetId: "source-tabset",
    dockLocation: DockLocation.CENTER,
    edgeLocation: DockLocation.LEFT,
  },
  [PANEL_IDS.figureNavigator]: {
    tabsetId: "canvas-tabset",
    dockLocation: DockLocation.BOTTOM,
    edgeLocation: DockLocation.BOTTOM,
  },
  [PANEL_IDS.inspector]: {
    tabsetId: "right-tabset",
    dockLocation: DockLocation.CENTER,
    edgeLocation: DockLocation.RIGHT,
  },
  [PANEL_IDS.builds]: { tabsetId: "right-tabset", dockLocation: DockLocation.CENTER, edgeLocation: DockLocation.RIGHT },
  // Under the slide, as presentation software shows its notes.
  [PANEL_IDS.notes]: { tabsetId: "canvas-tabset", dockLocation: DockLocation.BOTTOM, edgeLocation: DockLocation.BOTTOM },
  [PANEL_IDS.objects]: {
    tabsetId: "right-tabset",
    dockLocation: DockLocation.CENTER,
    edgeLocation: DockLocation.RIGHT,
  },
  [PANEL_IDS.styles]: {
    tabsetId: "right-tabset",
    dockLocation: DockLocation.CENTER,
    edgeLocation: DockLocation.RIGHT,
  },
  [PANEL_IDS.assistant]: {
    tabsetId: "right-tabset",
    dockLocation: DockLocation.CENTER,
    edgeLocation: DockLocation.RIGHT,
  },
};

// ── Default layout ────────────────────────────────────────────────────────────

function isAssistantAvailable(): boolean {
  return typeof getActiveEditorPlatform().assistant?.startTurn === "function";
}

type FlexLayoutSelectionParent = {
  getSelectedNode(): { getId(): string } | null;
};

function isLayoutSelectionParent(value: unknown): value is FlexLayoutSelectionParent {
  return typeof value === "object" && value != null && "getSelectedNode" in value;
}

function buildDefaultLayout(): IJsonModel {
  const rightTabs: Array<{ type: "tab"; id: string; name: string; component: string; enableClose?: boolean }> = [
    { type: "tab", id: PANEL_IDS.inspector, name: "Inspector", component: "inspector" },
    { type: "tab", id: PANEL_IDS.objects, name: "Objects", component: "objects" },
    { type: "tab", id: PANEL_IDS.styles, name: "Styles", component: "styles" },
  ];
  if (isAssistantAvailable()) {
    rightTabs.push({ type: "tab", id: PANEL_IDS.assistant, name: "Assistant", component: "assistant" });
  }

  return {
    global: {
      tabEnableClose: true,
      tabEnableRename: false,
      tabEnablePopout: false,
      // A hairline with a 9px hit area.
      splitterSize: 1,
      splitterExtra: 4,
      tabSetEnableMaximize: false,
      tabSetEnableSingleTabStretch: true,
      tabSetMinWidth: 150,
      tabSetMinHeight: 100,
    },
    layout: {
      type: "row",
      children: [
        {
          type: "tabset",
          weight: 30,
          id: "source-tabset",
          enableDeleteWhenEmpty: false,
          children: [
            { type: "tab", id: PANEL_IDS.source, name: "Source", component: "source" },
          ],
        },
        {
          type: "tabset",
          weight: 50,
          id: "canvas-tabset",
          enableDeleteWhenEmpty: false,
          children: [
            { type: "tab", id: PANEL_IDS.canvas, name: "Canvas", component: "canvas", enableClose: false },
          ],
        },
        {
          type: "tabset",
          weight: 20,
          id: "right-tabset",
          enableDeleteWhenEmpty: false,
          children: rightTabs,
        },
      ],
    },
  };
}

/** Strip assistant tabs if assistant is not available on this platform,
 *  and ensure the home tabsets survive being empty. */
function sanitizeLayout(json: IJsonModel): IJsonModel {
  const normalizedGlobal = {
    ...json.global,
    tabSetEnableMaximize: false,
    // Layouts saved before the hairline splitters keep their 4px gutters otherwise.
    splitterSize: 1,
    splitterExtra: 4
  };
  const jsonWithNormalizedGlobal: IJsonModel = {
    ...json,
    global: normalizedGlobal
  };

  function transform(node: unknown): unknown {
    if (!isRecord(node)) return null;
    if (!isAssistantAvailable() && node.type === "tab" && node.component === "assistant") {
      return null;
    }
    let next = node.type === "tab" && node.component === "builds" ? { ...node, name: "Overlays" } : node;
    if (node.type === "tabset" && typeof node.id === "string" && (HOME_TABSET_IDS as readonly string[]).includes(node.id)) {
      next = { ...next, enableDeleteWhenEmpty: false };
    }
    if (Array.isArray(next.children)) {
      next = {
        ...next,
        children: next.children
          .map(transform)
          .filter((child) => child != null)
      };
    }
    return next;
  }

  const transformed: unknown = { ...jsonWithNormalizedGlobal, layout: transform(jsonWithNormalizedGlobal.layout) };
  if (!isDockLayoutJson(transformed)) throw new Error("Invalid sanitized dock layout");
  return transformed;
}

// ── Preset layouts ────────────────────────────────────────────────────────────

function buildSourceOnTopLayout(): IJsonModel {
  const rightTabs: Array<{ type: "tab"; id: string; name: string; component: string; enableClose?: boolean }> = [
    { type: "tab", id: PANEL_IDS.inspector, name: "Inspector", component: "inspector" },
    { type: "tab", id: PANEL_IDS.objects, name: "Objects", component: "objects" },
    { type: "tab", id: PANEL_IDS.styles, name: "Styles", component: "styles" },
  ];
  if (isAssistantAvailable()) {
    rightTabs.push({ type: "tab", id: PANEL_IDS.assistant, name: "Assistant", component: "assistant" });
  }

  return {
    ...((buildDefaultLayout().global) === undefined ? {} : { global: buildDefaultLayout().global }),
    layout: {
      type: "row",
      children: [
        {
          type: "row",
          weight: 75,
          children: [
            {
              type: "tabset",
              weight: 40,
              id: "source-tabset",
              enableDeleteWhenEmpty: false,
              children: [
                { type: "tab", id: PANEL_IDS.source, name: "Source", component: "source" },
              ],
            },
            {
              type: "tabset",
              weight: 60,
              id: "canvas-tabset",
              enableDeleteWhenEmpty: false,
              children: [
                { type: "tab", id: PANEL_IDS.canvas, name: "Canvas", component: "canvas", enableClose: false },
                { type: "tab", id: PANEL_IDS.figureNavigator, name: "Figures", component: "figure-navigator" },
              ],
            },
          ],
        },
        {
          type: "tabset",
          weight: 25,
          id: "right-tabset",
          enableDeleteWhenEmpty: false,
          children: rightTabs,
        },
      ],
    },
  };
}

function buildCanvasOnlyLayout(): IJsonModel {
  return {
    ...((buildDefaultLayout().global) === undefined ? {} : { global: buildDefaultLayout().global }),
    layout: {
      type: "row",
      children: [
        {
          type: "tabset",
          weight: 100,
          id: "canvas-tabset",
          enableDeleteWhenEmpty: false,
          children: [
            { type: "tab", id: PANEL_IDS.canvas, name: "Canvas", component: "canvas", enableClose: false },
          ],
        },
      ],
    },
  };
}

function buildWideInspectorLayout(): IJsonModel {
  const rightTabs: Array<{ type: "tab"; id: string; name: string; component: string; enableClose?: boolean }> = [
    { type: "tab", id: PANEL_IDS.inspector, name: "Inspector", component: "inspector" },
    { type: "tab", id: PANEL_IDS.objects, name: "Objects", component: "objects" },
    { type: "tab", id: PANEL_IDS.styles, name: "Styles", component: "styles" },
  ];
  if (isAssistantAvailable()) {
    rightTabs.push({ type: "tab", id: PANEL_IDS.assistant, name: "Assistant", component: "assistant" });
  }

  return {
    ...((buildDefaultLayout().global) === undefined ? {} : { global: buildDefaultLayout().global }),
    layout: {
      type: "row",
      children: [
        {
          type: "tabset",
          weight: 50,
          id: "canvas-tabset",
          enableDeleteWhenEmpty: false,
          children: [
            { type: "tab", id: PANEL_IDS.canvas, name: "Canvas", component: "canvas", enableClose: false },
            { type: "tab", id: PANEL_IDS.source, name: "Source", component: "source" },
            { type: "tab", id: PANEL_IDS.figureNavigator, name: "Figures", component: "figure-navigator" },
          ],
        },
        {
          type: "tabset",
          weight: 50,
          id: "right-tabset",
          enableDeleteWhenEmpty: false,
          children: rightTabs,
        },
      ],
    },
  };
}

export const LAYOUT_PRESETS = {
  default: buildDefaultLayout,
  sourceOnTop: buildSourceOnTopLayout,
  canvasOnly: buildCanvasOnlyLayout,
  wideInspector: buildWideInspectorLayout,
} as const;

export type BuiltInWorkspaceId = keyof typeof LAYOUT_PRESETS;

export type BuiltInWorkspace = {
  id: BuiltInWorkspaceId;
  name: string;
  build: () => IJsonModel;
};

export const BUILT_IN_WORKSPACES: readonly BuiltInWorkspace[] = [
  { id: "default",        name: "Default",         build: buildDefaultLayout },
  { id: "sourceOnTop",    name: "Source on Top",   build: buildSourceOnTopLayout },
  { id: "canvasOnly",     name: "Canvas Only",     build: buildCanvasOnlyLayout },
  { id: "wideInspector",  name: "Wide Inspector",  build: buildWideInspectorLayout },
];

// ── Sync helpers ──────────────────────────────────────────────────────────────

function syncLayoutStateToStore(model: Model, dispatch: (action: EditorAction) => void) {
  const sourceVisible = model.getNodeById(PANEL_IDS.source) != null;
  const inspectorVisible = model.getNodeById(PANEL_IDS.inspector) != null;
  const objectsVisible = model.getNodeById(PANEL_IDS.objects) != null;
  const stylesVisible = model.getNodeById(PANEL_IDS.styles) != null;
  const buildsVisible = model.getNodeById(PANEL_IDS.builds) != null;
  const notesVisible = model.getNodeById(PANEL_IDS.notes) != null;
  const figuresVisible = model.getNodeById(PANEL_IDS.figureNavigator) != null;
  const assistantVisible = model.getNodeById(PANEL_IDS.assistant) != null;

  // Determine active right sidebar tab
  let activeRightTab: "inspector" | "objects" | "styles" | "assistant" | "builds" = "inspector";
  const rightPanelIds = ["inspector", "objects", "styles", "assistant", "builds"] as const;
  for (const id of rightPanelIds) {
    const node = model.getNodeById(id);
    const parent = node?.getParent();
    if (parent) {
      if (isLayoutSelectionParent(parent)) {
        const selected = parent.getSelectedNode();
        if (selected?.getId() === id) {
          activeRightTab = id;
          break;
        }
      }
    }
  }

  dispatch({
    type: "SYNC_LAYOUT_STATE",
    sourceVisible,
    inspectorVisible,
    objectsVisible,
    stylesVisible,
    figuresVisible,
    buildsVisible,
    notesVisible,
    assistantVisible,
    activeRightTab,
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export type DockLayoutProps = {
  repeatPreviewModel: SvgRenderModel | null;
  onSubmitPrompt: (
    prompt: string,
    model: string | null,
    attachments: AssistantComposerImageAttachment[]
  ) => Promise<void>;
  onInterruptTurn: () => Promise<void>;
  onNewChat: () => void;
};

/** Ref handle exposed to allow external code to manipulate the layout model. */
export type DockLayoutHandle = {
  getModel(): Model;
  getCurrentJson(): IJsonModel;
  togglePanel(panelId: string): void;
  applyPreset(preset: keyof typeof LAYOUT_PRESETS): void;
  applyLayoutJson(json: IJsonModel): void;
  resetLayout(): void;
};

// Module-level ref so editor commands can access the handle without prop drilling.
let activeDockHandle: DockLayoutHandle | null = null;

/**
 * flexlayout keeps a tab mounted once shown. While another tab of its set is
 * selected, the panel keeps its state but stops following the store (its
 * subscriptions are effects, which a hidden Activity cleans up); it catches up
 * when shown again.
 *
 * A tab shows exactly when it is selected here (maximizing is off and there are
 * no border docks), so the event only prompts a read of the selection: its
 * payload can be stale. flexlayout's Tab marks itself visible while rendering,
 * and an unmounting Tab's cleanup can mark it hidden again afterwards, which
 * left a panel blank the first time it was opened. The event also fires during
 * that render, so the update waits for a microtask.
 */
function WhileTabVisible({ node, children }: { node: TabNode; children: ReactNode }) {
  const [visible, setVisible] = useState(() => node.isSelected());
  useEffect(() => {
    let live = true;
    node.setEventListener("visibility", () => {
      queueMicrotask(() => { if (live) setVisible(node.isSelected()); });
    });
    setVisible(node.isSelected());
    return () => {
      live = false;
      node.removeEventListener("visibility");
    };
  }, [node]);
  return <Activity mode={visible ? "visible" : "hidden"}>{children}</Activity>;
}

const MemoSourcePanel = memo(SourcePanel);
const MemoCanvasPanel = memo(CanvasPanel);
const MemoRootNavigator = memo(RootNavigator);
const MemoInspectorPanel = memo(InspectorPanel);
const MemoDeckInspectorPanel = memo(DeckInspectorPanel);
const MemoBuildsPanel = memo(BuildsPanel);
const MemoNotesPanel = memo(NotesPanel);

/**
 * Deck mode gets the deck object/frame inspector, tikz the full one.
 * Mode is a function of (document kind, active root): a beamer document
 * editing a nested tikzpicture root behaves as a tikz editor.
 */
function InspectorPanelSwitch() {
  const documentKind = useEditorStore((s) => s.documentKind);
  const nestedFigureActive = useEditorStore(
    (s) => parseDocumentRootId(s.activeRootId ?? "")?.kind === "beamer-frame-tikz" ||
      (s.snapshot.overlayLayer != null && (s.selectedElementIds.size > 0 || (s.toolMode !== "select" && s.toolMode !== "magnify")))
  );
  return documentKind === "beamer" && !nestedFigureActive
    ? <MemoDeckInspectorPanel />
    : <MemoInspectorPanel />;
}
const MemoObjectsPanel = memo(ObjectsPanel);
const MemoStylesPanel = memo(StylesPanel);
const MemoAssistantPanel = memo(AssistantPanel);

export function getDockLayoutHandle(): DockLayoutHandle | null {
  return activeDockHandle;
}

function defaultLayoutForKind(kind: DocumentKind): IJsonModel {
  const model = Model.fromJson(buildDefaultLayout());
  if (kind === "beamer") {
    model.doAction(Actions.addNode({ type: "tab", id: PANEL_IDS.builds, name: "Overlays", component: "builds" }, "right-tabset", DockLocation.CENTER, -1, false));
    model.doAction(Actions.addNode({ type: "tab", id: PANEL_IDS.figureNavigator, name: "Slides", component: "figure-navigator" }, "canvas-tabset", DockLocation.BOTTOM, -1, false));
    const navigatorHome = model.getNodeById(PANEL_IDS.figureNavigator)?.getParent();
    if (navigatorHome) model.doAction(Actions.updateNodeAttributes(navigatorHome.getId(), { weight: 15 }));
    model.doAction(Actions.updateNodeAttributes("canvas-tabset", { weight: 85 }));
  }
  return model.toJson();
}

function createLayoutModel(json: unknown, kind: DocumentKind = "tikz"): { model: Model; recovered: boolean } {
  try {
    if (!isDockLayoutJson(json)) throw new Error("Invalid dock layout structure.");
    return { model: Model.fromJson(sanitizeLayout(json)), recovered: false };
  } catch (error) {
    console.info("[tikz-editor] Failed to apply dock layout; using the default layout.", error);
    return { model: Model.fromJson(defaultLayoutForKind(kind)), recovered: true };
  }
}

function createInitialModel(kind: DocumentKind): Model {
  const persisted = loadDockLayout(kind);
  const { model, recovered } = persisted
    ? createLayoutModel(persisted, kind)
    : { model: Model.fromJson(defaultLayoutForKind(kind)), recovered: true };
  // Replace rejected payloads too, so a writable store does not retry them on every mount.
  if (recovered) saveDockLayout(model.toJson(), kind);
  return model;
}

// Memoized: the app re-renders on each edit, and re-rendering the dock makes
// flexlayout measure every panel (a forced layout) though none has moved.
export const DockLayout = memo(function DockLayout(props: DockLayoutProps) {
  const kind = useEditorStore(s => s.documentKind);
  // A nested TikZ picture keeps its parent deck's panel arrangement.
  return <DocumentDockLayout key={kind} {...props} kind={kind} />;
});

function DocumentDockLayout({ repeatPreviewModel, onSubmitPrompt, onInterruptTurn, onNewChat, kind }: DockLayoutProps & { kind: DocumentKind }) {
  const dispatch = useEditorStore((s) => s.dispatch);
  const [model, setModel] = useState(() => createInitialModel(kind));

  // Factory — renders panel content for each tab
  const factory = useCallback(
    (node: TabNode) => {
      const component = node.getComponent();
      switch (component) {
        case "source":
          return (
            <Suspense fallback={<div style={{ display: "grid", placeItems: "center", height: "100%" }}>Loading source editor…</div>}>
              <MemoSourcePanel />
            </Suspense>
          );
        case "canvas":
          return (
            <Suspense fallback={<div style={{ display: "grid", placeItems: "center", height: "100%" }}>Loading canvas…</div>}>
              <MemoCanvasPanel repeatPreviewModel={repeatPreviewModel} />
            </Suspense>
          );
        case "figure-navigator":
          return (
            <WhileTabVisible node={node}>
              <Suspense fallback={null}>
                <MemoRootNavigator />
              </Suspense>
            </WhileTabVisible>
          );
        case "inspector":
          return <WhileTabVisible node={node}><InspectorPanelSwitch /></WhileTabVisible>;
        case "builds":
          return <WhileTabVisible node={node}><MemoBuildsPanel /></WhileTabVisible>;
        case "notes":
          return <WhileTabVisible node={node}><MemoNotesPanel /></WhileTabVisible>;
        case "objects":
          return <WhileTabVisible node={node}><MemoObjectsPanel /></WhileTabVisible>;
        case "styles":
          return <WhileTabVisible node={node}><MemoStylesPanel /></WhileTabVisible>;
        case "assistant":
          return <MemoAssistantPanel onSubmitPrompt={onSubmitPrompt} onInterruptTurn={onInterruptTurn} onNewChat={onNewChat} />;
        case undefined:
          return <div>Unknown panel</div>;
        default:
          return <div>Unknown panel: {component}</div>;
      }
    },
    [repeatPreviewModel, onSubmitPrompt, onInterruptTurn, onNewChat]
  );

  // On model change: persist + sync to Zustand
  const onModelChange = useCallback(
    (_model: Model) => {
      saveDockLayout(_model.toJson(), kind);
      syncLayoutStateToStore(_model, dispatch);
    },
    [dispatch, kind]
  );

  // Expose handle. We use a ref to always point to the latest model via closure,
  // so that handle identity stays stable but always operates on current model.
  const modelRef = useRef(model);
  modelRef.current = model;

  const setModelRef = useRef(setModel);
  setModelRef.current = setModel;

  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  const handle = useMemo<DockLayoutHandle>(() => ({
    getModel: () => modelRef.current,
    getCurrentJson: () => modelRef.current.toJson(),
    togglePanel(panelId: string) {
      const m = modelRef.current;
      const existing = m.getNodeById(panelId);
      if (existing) {
        m.doAction(Actions.deleteTab(panelId));
      } else {
        const home = PANEL_HOMES[panelId];
        const tabJson = { type: "tab", id: panelId, name: panelTitle(panelId, useEditorStore.getState().documentKind), component: panelId };

        const homeTabset = home ? m.getNodeById(home.tabsetId) : null;
        if (home && homeTabset) {
          // Home tabset exists — add into it at the normal dock location.
          m.doAction(Actions.addNode(tabJson, home.tabsetId, home.dockLocation, -1));
        } else if (home) {
          // Home tabset is gone — re-establish it at the expected edge of the root.
          const rootId = m.getRoot().getId();
          m.doAction(Actions.addNode(tabJson, rootId, home.edgeLocation, -1));
          const newTabset = m.getNodeById(panelId)?.getParent();
          if (newTabset && newTabset.getId() !== home.tabsetId) {
            m.doAction(Actions.updateNodeAttributes(newTabset.getId(), {
              id: home.tabsetId,
              enableDeleteWhenEmpty: false,
            }));
          }
        } else {
          // Unknown panel — dock to the first tabset as a safety net.
          m.doAction(Actions.addNode(tabJson, m.getFirstTabSet().getId(), DockLocation.CENTER, -1));
        }

        // Panels docked below the canvas take a small part of its height.
        const belowCanvasWeight = { [PANEL_IDS.figureNavigator]: 15, [PANEL_IDS.notes]: 20 }[panelId];
        if (belowCanvasWeight !== undefined) {
          const belowTabset = m.getNodeById(panelId)?.getParent();
          if (belowTabset) {
            m.doAction(Actions.updateNodeAttributes(belowTabset.getId(), { weight: belowCanvasWeight }));
            const canvasTs = m.getNodeById("canvas-tabset");
            if (canvasTs) m.doAction(Actions.updateNodeAttributes("canvas-tabset", { weight: 100 - belowCanvasWeight }));
          }
        }
      }
      saveDockLayout(m.toJson(), kind);
      syncLayoutStateToStore(m, dispatchRef.current);
    },
    applyPreset(preset: keyof typeof LAYOUT_PRESETS) {
      const builder = LAYOUT_PRESETS[preset];
      this.applyLayoutJson(builder());
    },
    applyLayoutJson(json: IJsonModel) {
      const { model: newModel } = createLayoutModel(json, kind);
      saveDockLayout(newModel.toJson(), kind);
      syncLayoutStateToStore(newModel, dispatchRef.current);
      setModelRef.current(newModel);
    },
    resetLayout() {
      this.applyLayoutJson(defaultLayoutForKind(kind));
    },
  }), [kind]);

  useEffect(() => {
    activeDockHandle = handle;
    syncLayoutStateToStore(model, dispatch);
    return () => {
      if (activeDockHandle === handle) activeDockHandle = null;
    };
  }, [handle, model, dispatch]);

  const deckMode = kind === "beamer";

  // Auto-show/hide RootNavigator based on figure count
  const figureCount = useEditorStore((s) => snapshotRoots(s.snapshot).length);
  // From none, as at startup: a layout mounted for a multi-figure document opens the list too.
  const prevFigureCountRef = useRef(0);
  useEffect(() => {
    const prev = prevFigureCountRef.current;
    prevFigureCountRef.current = figureCount;
    const m = modelRef.current;
    const figTabExists = m.getNodeById(PANEL_IDS.figureNavigator) != null;

    if (!figTabExists && !deckMode && hasMultipleRoots(figureCount) && !hasMultipleRoots(prev)) {
      // Multi-figure document — auto-open below canvas with small height
      const canvasTabset = m.getNodeById("canvas-tabset");
      const firstTabSetId = m.getFirstTabSet().getId();
      const target = canvasTabset ? "canvas-tabset" : firstTabSetId;
      const added = Boolean(m.doAction(
        Actions.addNode(
          { type: "tab", id: PANEL_IDS.figureNavigator, name: "Figures", component: "figure-navigator" },
          target,
          DockLocation.BOTTOM,
          -1
        )
      ));
      // Shrink the new tabset so it doesn't take half the space
      if (added) {
        const figTabset = m.getNodeById(PANEL_IDS.figureNavigator)?.getParent();
        if (figTabset) {
          m.doAction(Actions.updateNodeAttributes(figTabset.getId(), { weight: 15 }));
          // Also bump the canvas tabset weight to keep it dominant
          if (canvasTabset) {
            m.doAction(Actions.updateNodeAttributes("canvas-tabset", { weight: 85 }));
          }
        }
      }
      saveDockLayout(m.toJson(), kind);
      syncLayoutStateToStore(m, dispatchRef.current);
    } else if (!deckMode && !hasMultipleRoots(figureCount) && figTabExists) {
      // Single-figure — auto-close, including startup with a persisted/open figures tab
      m.doAction(Actions.deleteTab(PANEL_IDS.figureNavigator));
      saveDockLayout(m.toJson(), kind);
      syncLayoutStateToStore(m, dispatchRef.current);
    }
    const tab = m.getNodeById(PANEL_IDS.figureNavigator);
    if (tab) m.doAction(Actions.renameTab(PANEL_IDS.figureNavigator, deckMode ? "Slides" : "Figures"));
  }, [figureCount, deckMode, model, kind]);

  const layoutRef = useRef<Layout>(null);
  const menuHost = useMemo(() => ({
    getModel: () => modelRef.current,
    redraw: () => { layoutRef.current?.redraw(); },
    togglePanel: (panelId: string) => { handle.togglePanel(panelId); },
    persist: () => {
      saveDockLayout(modelRef.current.toJson(), kind);
      syncLayoutStateToStore(modelRef.current, dispatchRef.current);
    },
  }), [handle, kind]);
  const { onContextMenu, onRenderTab, onRenderTabSet, menu } = useDockPanelMenus(menuHost, kind);

  return (
    <>
      <Layout
        ref={layoutRef}
        model={model}
        factory={factory}
        onModelChange={onModelChange}
        onContextMenu={onContextMenu}
        onRenderTab={onRenderTab}
        onRenderTabSet={onRenderTabSet}
        realtimeResize
      />
      {menu}
    </>
  );
}
