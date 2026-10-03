import { Suspense, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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

// ── Panel IDs ─────────────────────────────────────────────────────────────────

export const PANEL_IDS = {
  source: "source",
  canvas: "canvas",
  figureNavigator: "figure-navigator",
  inspector: "inspector",
  builds: "builds",
  objects: "objects",
  styles: "styles",
  assistant: "assistant",
} as const;

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

type LayoutJsonNode = {
  type: string;
  component?: string;
  children?: LayoutJsonNode[];
  [key: string]: unknown;
};

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
      splitterSize: 4,
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
    tabSetEnableMaximize: false
  };
  const jsonWithNormalizedGlobal: IJsonModel = {
    ...json,
    global: normalizedGlobal
  };

  function transform(node: LayoutJsonNode | null): LayoutJsonNode | null {
    if (!node) return null;
    if (!isAssistantAvailable() && node.type === "tab" && node.component === "assistant") {
      return null;
    }
    let next = node.type === "tab" && node.component === "builds" ? { ...node, name: "Overlays" } : node;
    if (node.type === "tabset" && typeof node.id === "string" && (HOME_TABSET_IDS as readonly string[]).includes(node.id)) {
      next = { ...next, enableDeleteWhenEmpty: false };
    }
    if (next.children) {
      next = {
        ...next,
        children: next.children
          .map(transform)
          .filter((child): child is LayoutJsonNode => child != null)
      };
    }
    return next;
  }

  return {
    ...jsonWithNormalizedGlobal,
    layout: transform(jsonWithNormalizedGlobal.layout as LayoutJsonNode) as IJsonModel["layout"]
  };
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
    global: buildDefaultLayout().global,
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
    global: buildDefaultLayout().global,
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
    global: buildDefaultLayout().global,
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
  const figuresVisible = model.getNodeById(PANEL_IDS.figureNavigator) != null;
  const assistantVisible = model.getNodeById(PANEL_IDS.assistant) != null;

  // Determine active right sidebar tab
  let activeRightTab: "inspector" | "objects" | "styles" | "assistant" | "builds" = "inspector";
  const rightPanelIds = ["inspector", "objects", "styles", "assistant", "builds"] as const;
  for (const id of rightPanelIds) {
    const node = model.getNodeById(id);
    if (node?.getParent()) {
      const parent = node.getParent()!;
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

const MemoSourcePanel = memo(SourcePanel);
const MemoCanvasPanel = memo(CanvasPanel);
const MemoRootNavigator = memo(RootNavigator);
const MemoInspectorPanel = memo(InspectorPanel);
const MemoDeckInspectorPanel = memo(DeckInspectorPanel);
const MemoBuildsPanel = memo(BuildsPanel);

/**
 * Deck mode gets the deck object/frame inspector, tikz the full one.
 * Mode is a function of (document kind, active root): a beamer document
 * editing a nested tikzpicture root behaves as a tikz editor.
 */
function InspectorPanelSwitch() {
  const documentKind = useEditorStore((s) => s.documentKind);
  const nestedFigureActive = useEditorStore(
    (s) => parseDocumentRootId(s.activeRootId ?? "")?.kind === "beamer-frame-tikz"
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

function createLayoutModel(json: unknown): { model: Model; recovered: boolean } {
  try {
    if (!isDockLayoutJson(json)) throw new Error("Invalid dock layout structure.");
    return { model: Model.fromJson(sanitizeLayout(json)), recovered: false };
  } catch (error) {
    console.info("[tikz-editor] Failed to apply dock layout; using the default layout.", error);
    return { model: Model.fromJson(buildDefaultLayout()), recovered: true };
  }
}

function createInitialModel(): Model {
  const persisted = loadDockLayout();
  const { model, recovered } = persisted
    ? createLayoutModel(persisted)
    : { model: Model.fromJson(buildDefaultLayout()), recovered: true };
  // Replace rejected payloads too, so a writable store does not retry them on every mount.
  if (recovered) saveDockLayout(model.toJson());
  return model;
}

export function DockLayout({ repeatPreviewModel, onSubmitPrompt, onInterruptTurn, onNewChat }: DockLayoutProps) {
  const dispatch = useEditorStore((s) => s.dispatch);
  const [model, setModel] = useState(createInitialModel);

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
            <Suspense fallback={null}>
              <MemoRootNavigator />
            </Suspense>
          );
        case "inspector":
          return <InspectorPanelSwitch />;
        case "builds":
          return <MemoBuildsPanel />;
        case "objects":
          return <MemoObjectsPanel />;
        case "styles":
          return <MemoStylesPanel />;
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
      saveDockLayout(_model.toJson());
      syncLayoutStateToStore(_model, dispatch);
    },
    [dispatch]
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
        const nameMap: Record<string, string> = {
          source: "Source",
          canvas: "Canvas",
          "figure-navigator": useEditorStore.getState().documentKind === "beamer" ? "Slides" : "Figures",
          inspector: "Inspector",
          builds: "Overlays",
          objects: "Objects",
          styles: "Styles",
          assistant: "Assistant",
        };
        const tabJson = { type: "tab", id: panelId, name: nameMap[panelId] ?? panelId, component: panelId };

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

        // For figure-navigator docked below canvas, use a small weight
        if (panelId === PANEL_IDS.figureNavigator) {
          const figTabset = m.getNodeById(PANEL_IDS.figureNavigator)?.getParent();
          if (figTabset) {
            m.doAction(Actions.updateNodeAttributes(figTabset.getId(), { weight: 15 }));
            const canvasTs = m.getNodeById("canvas-tabset");
            if (canvasTs) m.doAction(Actions.updateNodeAttributes("canvas-tabset", { weight: 85 }));
          }
        }
      }
      saveDockLayout(m.toJson());
      syncLayoutStateToStore(m, dispatchRef.current);
    },
    applyPreset(preset: keyof typeof LAYOUT_PRESETS) {
      const builder = LAYOUT_PRESETS[preset];
      this.applyLayoutJson(builder());
    },
    applyLayoutJson(json: IJsonModel) {
      const { model: newModel } = createLayoutModel(json);
      saveDockLayout(newModel.toJson());
      syncLayoutStateToStore(newModel, dispatchRef.current);
      setModelRef.current(newModel);
    },
    resetLayout() {
      this.applyPreset("default");
    },
  }), []); // stable — uses refs internally

  useEffect(() => {
    activeDockHandle = handle;
    syncLayoutStateToStore(model, dispatch);
    return () => {
      if (activeDockHandle === handle) activeDockHandle = null;
    };
  }, [handle, model, dispatch]);

  // Builds belongs to the slide surface. Keep it available for one-slide
  // decks, and remove it when entering a nested TikZ drawing or another file.
  const deckMode = useEditorStore((s) => s.documentKind === "beamer" &&
    parseDocumentRootId(s.activeRootId ?? "")?.kind !== "beamer-frame-tikz");
  useEffect(() => {
    const m = modelRef.current;
    const exists = m.getNodeById(PANEL_IDS.builds) != null;
    if (deckMode && !exists) {
      const target = m.getNodeById("right-tabset") ? "right-tabset" : m.getFirstTabSet().getId();
      m.doAction(Actions.addNode({ type: "tab", id: PANEL_IDS.builds, name: "Overlays", component: "builds" }, target, DockLocation.CENTER, -1, false));
      syncLayoutStateToStore(m, dispatchRef.current);
    } else if (!deckMode && exists) {
      m.doAction(Actions.deleteTab(PANEL_IDS.builds));
      syncLayoutStateToStore(m, dispatchRef.current);
    }
  }, [deckMode, model]);

  // Auto-show/hide RootNavigator based on figure count
  const figureCount = useEditorStore((s) => snapshotRoots(s.snapshot).length);
  const prevFigureCountRef = useRef(figureCount);
  const prevDeckModeRef = useRef(false);
  useEffect(() => {
    const prev = prevFigureCountRef.current;
    prevFigureCountRef.current = figureCount;
    const wasDeck = prevDeckModeRef.current;
    prevDeckModeRef.current = deckMode;
    const m = modelRef.current;
    const figTabExists = m.getNodeById(PANEL_IDS.figureNavigator) != null;

    if (!figTabExists && ((deckMode && !wasDeck) || (!deckMode && hasMultipleRoots(figureCount) && !hasMultipleRoots(prev)))) {
      // Multi-figure document — auto-open below canvas with small height
      const canvasTabset = m.getNodeById("canvas-tabset");
      const firstTabSetId = m.getFirstTabSet().getId();
      const target = canvasTabset ? "canvas-tabset" : firstTabSetId;
      const added = Boolean(m.doAction(
        Actions.addNode(
          { type: "tab", id: PANEL_IDS.figureNavigator, name: deckMode ? "Slides" : "Figures", component: "figure-navigator" },
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
      saveDockLayout(m.toJson());
      syncLayoutStateToStore(m, dispatchRef.current);
    } else if (!deckMode && !hasMultipleRoots(figureCount) && figTabExists) {
      // Single-figure — auto-close, including startup with a persisted/open figures tab
      m.doAction(Actions.deleteTab(PANEL_IDS.figureNavigator));
      saveDockLayout(m.toJson());
      syncLayoutStateToStore(m, dispatchRef.current);
    }
    const tab = m.getNodeById(PANEL_IDS.figureNavigator);
    if (tab) m.doAction(Actions.renameTab(PANEL_IDS.figureNavigator, deckMode ? "Slides" : "Figures"));
  }, [figureCount, deckMode, model]);

  return (
    <Layout
      model={model}
      factory={factory}
      onModelChange={onModelChange}
      realtimeResize
    />
  );
}
