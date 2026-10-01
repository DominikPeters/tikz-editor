import { useCallback, useState, type MouseEvent, type RefObject } from "react";
import { Actions } from "flexlayout-react";
import { clientPoint, px } from "@tikz-editor/core/coords/index";
import { beamerObjectOverlayTarget, beamerBuildStateAt, buildBeamerBuildModel, type BeamerObjectIndex, type BeamerObjectNode } from "@tikz-editor/core/beamer/index";
import type { SourcePatch } from "@tikz-editor/core/edit/types";
import type { SvgViewBox } from "@tikz-editor/core/svg/types";
import { APP_MENU_COMMAND_IDS as IDS, type AppMenuCommandId, type AppMenuItem } from "../../app-menu";
import { CANVAS_CONTEXT_MENU_DEFINITION } from "../../context-menu";
import { getActiveEditorPlatform } from "../../platform/current";
import { useEditorStore } from "../../store/store";
import { rootKey } from "../../root-key";
import { CanvasContextMenu } from "../CanvasContextMenu";
import { getDockLayoutHandle } from "../DockLayout";
import type { CommandBindings } from "../editor-command-runtime";
import { clientToSvgPoint } from "./geometry";
import type { HitRegion } from "./hit-regions";

export function useDeckOverlayContextMenu({ index, selected, frame, viewportRef, svgRef, bindings, closeText, editObject }: {
  index: BeamerObjectIndex | null;
  selected: BeamerObjectNode | null;
  frame: { frameId: string; step: number; viewBox: SvgViewBox } | null;
  viewportRef: RefObject<HTMLDivElement | null>;
  svgRef: RefObject<SVGSVGElement | null>;
  bindings: CommandBindings;
  closeText: () => void;
  editObject: (operation: "delete" | "duplicate", node: BeamerObjectNode) => void;
}) {
  const source = useEditorStore((s) => s.source);
  const revision = useEditorStore((s) => s.sourceRevision);
  const documentId = useEditorStore((s) => s.activeDocumentId);
  const rootId = useEditorStore((s) => s.activeRootId);
  const locked = useEditorStore((s) => s.documents[s.activeDocumentId]?.assistantLockReason != null);
  const platform = getActiveEditorPlatform();
  const [menu, setMenu] = useState<{
    documentId: string; frameId: string; revision: number; step: number;
    anchor: { x: number; y: number }; items: readonly AppMenuItem[]; bindings: CommandBindings;
  } | null>(null);
  const close = useCallback(() => { setMenu(null); }, []);

  const openForObject = (node: BeamerObjectNode, x: number, y: number) => {
    const initial = useEditorStore.getState();
    if (!frame || initial.snapshot.source !== source || locked) return;
    closeText();
    // Committing the text session may change the source and invalidate this hit.
    if (useEditorStore.getState().sourceRevision !== revision) return;
    const model = buildBeamerBuildModel(source, frame.frameId);
    if (!model) return;
    const target = beamerObjectOverlayTarget(model, node);
    initial.dispatch({ type: "SET_DECK_OBJECT_SELECTION", frameId: frame.frameId, objectId: node.id });
    const current = () => {
      const state = useEditorStore.getState();
      return state.activeDocumentId === documentId && state.activeRootId === frame.frameId && state.sourceRevision === revision &&
        state.source === source && !state.activeCanvasTextEditSourceId && !state.documents[documentId]?.assistantLockReason &&
        Math.min(state.deckStepByRootKey[rootKey(documentId, frame.frameId)] ?? 1, model.stepCount) === frame.step;
    };
    const revealRule = (rowId: string, nextSource: string, step: number, openPanel: boolean) => {
      if (openPanel) {
        const dock = getDockLayoutHandle();
        if (dock) {
          if (!dock.getModel().getNodeById("builds")) dock.togglePanel("builds");
          dock.getModel().doAction(Actions.selectTab("builds"));
        }
      }
      const nextModel = buildBeamerBuildModel(nextSource, frame.frameId);
      const row = nextModel?.rows.find((candidate) => candidate.id === rowId);
      if (!nextModel || !row) return;
      const state = useEditorStore.getState();
      state.dispatch({ type: "SET_DECK_BUILD_SELECTION", selection: {
        documentId, frameId: frame.frameId, sourceRevision: state.sourceRevision, rowId: row.id,
        step, sourceSpan: row.sourceSpan, contentSpans: beamerBuildStateAt(nextModel, row, step).contentSpans, revealSource: false,
      } });
    };
    const apply = (patches: readonly SourcePatch[], nextStep = frame.step) => {
      if (!current() || !patches.length) return;
      const { dispatch } = useEditorStore.getState();
      dispatch({ type: "APPLY_SOURCE_PATCHES", documentId, baseRevision: revision, patches: [...patches], changedSourceIds: [] });
      const state = useEditorStore.getState();
      if (state.source === source) return;
      dispatch({ type: "SET_DECK_STEP", rootId: frame.frameId, step: nextStep });
      const row = buildBeamerBuildModel(state.source, frame.frameId)?.rows.find((candidate) =>
        candidate.sourceSpan.from === (target.row?.sourceSpan.from ?? node.sourceSpan.from) && candidate.kind === "content");
      if (row) revealRule(row.id, state.source, nextStep, false);
      else dispatch({ type: "SET_DECK_OBJECT_SELECTION", frameId: frame.frameId, objectId: null });
    };
    const set = (spec: string, step = frame.step) => {
      const patch = target.setSpec(spec);
      if (patch) apply([patch], step);
    };
    const menuBindings: CommandBindings = {
      ...bindings,
      [IDS.OVERLAY_NEXT]: { enabled: target.canSet, run: () => { set(`${frame.step + 1}-`, frame.step + 1); } },
      [IDS.OVERLAY_FROM]: { enabled: target.canSet, run: () => { set(`${frame.step}-`); } },
      [IDS.OVERLAY_ONLY]: { enabled: target.canSet, run: () => { set(String(frame.step)); } },
      [IDS.OVERLAY_THROUGH]: { enabled: target.canSet, run: () => { set(`-${frame.step}`); } },
      [IDS.OVERLAY_REMOVE]: { enabled: target.removePatches.length > 0, run: () => { apply(target.removePatches); } },
      [IDS.OVERLAY_EDIT]: { enabled: target.row != null, run: () => { if (current() && target.row) revealRule(target.row.id, source, frame.step, true); } },
      [IDS.DELETE]: { enabled: true, run: () => { if (current()) editObject("delete", node); } },
      [IDS.DUPLICATE]: { enabled: true, run: () => { if (current()) editObject("duplicate", node); } },
    };
    const command = (commandId: AppMenuCommandId, label: string): AppMenuItem => ({ kind: "command", commandId, label });
    const overlayItems: AppMenuItem[] = [];
    if (target.canSet) overlayItems.push(
      command(IDS.OVERLAY_NEXT, `Appear on next step (${frame.step + 1})`),
      command(IDS.OVERLAY_FROM, `Show from step ${frame.step}`),
      command(IDS.OVERLAY_ONLY, `Only on step ${frame.step}`),
      command(IDS.OVERLAY_THROUGH, `Show through step ${frame.step}`),
    );
    if (target.row || target.removePatches.length) {
      if (overlayItems.length) overlayItems.push({ kind: "separator" });
      if (target.row) overlayItems.push(command(IDS.OVERLAY_EDIT, "Edit in Overlays"));
      if (target.removePatches.length) overlayItems.push(command(IDS.OVERLAY_REMOVE, "Remove overlay rule"));
    }
    const items: AppMenuItem[] = [command(IDS.UNDO, "Undo"), command(IDS.REDO, "Redo"), { kind: "separator" },
      command(IDS.DUPLICATE, "Duplicate"), command(IDS.DELETE, "Delete")];
    if (overlayItems.length) items.push({ kind: "separator" }, { kind: "submenu", label: "Overlays", items: overlayItems });
    const rect = viewportRef.current?.getBoundingClientRect();
    const next = { documentId, frameId: frame.frameId, revision, step: frame.step, items, bindings: menuBindings,
      anchor: { x: x - (rect?.left ?? 0), y: y - (rect?.top ?? 0) } };
    if (platform.menu?.usesNativeContextMenus && platform.menu.showNativeContextMenu) {
      void platform.menu.showNativeContextMenu({ items, commandStates: menuBindings,
        onCommandRun: (id, origin) => { if (current() && menuBindings[id].enabled) void menuBindings[id].run(origin); } });
    } else setMenu(next);
  };

  const onContextMenu = (event: MouseEvent<SVGElement | HTMLDivElement>, region?: HitRegion): boolean => {
    if (!frame || !index) return false;
    const point = clientToSvgPoint(clientPoint(px(event.clientX), px(event.clientY)), svgRef.current);
    const includes = (node: BeamerObjectNode) => point && point.x >= node.bounds.x && point.x <= node.bounds.x + node.bounds.width && point.y >= node.bounds.y && point.y <= node.bounds.y + node.bounds.height;
    const explicit = region?.shape === "rect" && region.deckObjectId ? index.byId.get(region.deckObjectId) : null;
    const node = selected && includes(selected) ? selected : explicit ?? index.nodes.filter(includes)
      .sort((a, b) => (a.sourceSpan.to - a.sourceSpan.from) - (b.sourceSpan.to - b.sourceSpan.from))[0];
    if (!node) return false;
    event.preventDefault(); event.stopPropagation();
    openForObject(node, event.clientX, event.clientY);
    return true;
  };
  const valid = menu && !locked && menu.documentId === documentId && menu.frameId === rootId && menu.revision === revision && menu.step === frame?.step;
  return { onContextMenu, openForObject,
    menu: valid ? <CanvasContextMenu open anchor={menu.anchor} target="selection-single" bindings={menu.bindings}
      containerRef={viewportRef} onClose={close} onCommandRun={(id, origin) => { if (menu.bindings[id].enabled) void menu.bindings[id].run(origin); }}
      definition={{ ...CANVAS_CONTEXT_MENU_DEFINITION, "selection-single": menu.items }} /> : null,
  };
}
