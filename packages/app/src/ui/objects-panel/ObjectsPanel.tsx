import {
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiBringForward,
  RiBringToFront,
  RiEyeLine,
  RiEyeOffLine,
  RiSendBackward,
  RiSendToBack
} from "@remixicon/react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent
} from "react";
import { getSharedEditAnalysisView } from "../../edit-analysis-manager";
import { useEditorStore } from "../../store/store";
import { SidePanel } from "../SidePanel";
import {
  actionAvailability,
  groupSelection,
  reorderSelection,
  ungroupSelection
} from "../editor-commands";
import { RenderedTooltip } from "../RenderedTooltip";
import { buildObjectsPanelModel, type ObjectsPanelNode } from "./model";
import css from "./ObjectsPanel.module.css";

type DropPlacement = "before" | "after";

type DropTarget = {
  id: string;
  placement: DropPlacement;
};

type FlatRow = {
  node: ObjectsPanelNode;
  depth: number;
};

type ObjectsAction = {
  id: "group" | "ungroup" | "sendToBack" | "sendBackward" | "bringForward" | "bringToFront";
  label: string;
  enabled: boolean;
  reason?: string | null;
  icon: () => ReactElement;
  run: () => void;
};

export function ObjectsPanel() {
  const activeDocumentId = useEditorStore((s) => s.activeDocumentId);
  const activeFigureId = useEditorStore((s) => s.activeFigureId);
  const activeHandleId = useEditorStore((s) => s.activeHandleId);
  const sourceRevision = useEditorStore((s) => s.sourceRevision);
  const source = useEditorStore((s) => s.source);
  const snapshot = useEditorStore((s) => s.snapshot);
  const selectedIds = useEditorStore((s) => s.selectedElementIds);
  const dispatch = useEditorStore((s) => s.dispatch);

  const analysisView = useMemo(
    () => getSharedEditAnalysisView({
      documentId: activeDocumentId,
      sourceRevision,
      source,
      activeFigureId,
      snapshot
    }),
    [activeDocumentId, activeFigureId, snapshot, source, sourceRevision]
  );
  const model = useMemo(
    () => buildObjectsPanelModel({ analysisView, scene: snapshot.scene, selectedIds }),
    [analysisView, selectedIds, snapshot.scene]
  );

  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [draggedIds, setDraggedIds] = useState<string[]>([]);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editingId) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editingId]);

  useEffect(() => {
    if (selectedIds.size === 1) {
      setSelectionAnchorId([...selectedIds][0] ?? null);
    }
  }, [selectedIds]);

  const rows = useMemo(() => flattenNodes(model.nodes, collapsedIds), [collapsedIds, model.nodes]);
  const visibleIds = useMemo(() => rows.map(({ node }) => node.id), [rows]);
  const siblingOrder = useMemo(() => buildSiblingOrder(model.byId), [model.byId]);
  const commandContext = useMemo<Parameters<typeof actionAvailability>[0]>(
    () => ({
      source,
      activeFigureId,
      parseOptions: {
        activeFigureId,
        analysisView
      },
      figureCount: snapshot.figures.length,
      snapshotSource: snapshot.source,
      scene: snapshot.scene,
      editHandles: snapshot.editHandles,
      selectedElementIds: selectedIds,
      activeHandleId,
      dispatch
    }),
    [
      activeFigureId,
      analysisView,
      activeHandleId,
      dispatch,
      selectedIds,
      snapshot.editHandles,
      snapshot.figures.length,
      snapshot.scene,
      snapshot.source,
      source
    ]
  );
  const availability = useMemo(() => actionAvailability(commandContext), [commandContext]);
  const groupActions = useMemo<readonly ObjectsAction[]>(() => [
    {
      id: "group",
      label: "Group selection",
      enabled: availability.group.enabled,
      reason: availability.group.reason,
      icon: ObjectsGroupIcon,
      run: () => {
        groupSelection(commandContext);
      }
    },
    {
      id: "ungroup",
      label: "Ungroup selection",
      enabled: availability.ungroup.enabled,
      reason: availability.ungroup.reason,
      icon: ObjectsUngroupIcon,
      run: () => {
        ungroupSelection(commandContext);
      }
    }
  ], [availability.group.enabled, availability.group.reason, availability.ungroup.enabled, availability.ungroup.reason, commandContext]);
  const reorderActions = useMemo<readonly ObjectsAction[]>(() => [
    {
      id: "sendToBack",
      label: "Send to back",
      enabled: availability["reorder-sendToBack"].enabled,
      reason: availability["reorder-sendToBack"].reason,
      icon: () => <RiSendToBack size={15} />,
      run: () => {
        reorderSelection(commandContext, "sendToBack");
      }
    },
    {
      id: "sendBackward",
      label: "Send backward",
      enabled: availability["reorder-sendBackward"].enabled,
      reason: availability["reorder-sendBackward"].reason,
      icon: () => <RiSendBackward size={15} />,
      run: () => {
        reorderSelection(commandContext, "sendBackward");
      }
    },
    {
      id: "bringForward",
      label: "Bring forward",
      enabled: availability["reorder-bringForward"].enabled,
      reason: availability["reorder-bringForward"].reason,
      icon: () => <RiBringForward size={15} />,
      run: () => {
        reorderSelection(commandContext, "bringForward");
      }
    },
    {
      id: "bringToFront",
      label: "Bring to front",
      enabled: availability["reorder-bringToFront"].enabled,
      reason: availability["reorder-bringToFront"].reason,
      icon: () => <RiBringToFront size={15} />,
      run: () => {
        reorderSelection(commandContext, "bringToFront");
      }
    }
  ], [availability, commandContext]);

  const startRename = (node: ObjectsPanelNode) => {
    if (!node.canRename) {
      return;
    }
    setEditingId(node.id);
    setEditingValue(node.explicitName ?? "");
  };

  const commitRename = () => {
    if (!editingId) {
      return;
    }
    dispatch({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "setProperty",
        elementId: model.byId.get(editingId)?.writeTargetId ?? editingId,
        level: "command",
        key: "name",
        value: editingValue.trim()
      }
    });
    setEditingId(null);
  };

  const toggleVisibility = (node: ObjectsPanelNode) => {
    if (!node.canToggleVisibility) {
      return;
    }
    dispatch({
      type: "APPLY_EDIT_ACTION",
      action: {
        kind: "setProperty",
        elementId: node.writeTargetId,
        level: "command",
        key: "transparent",
        value: node.hidden ? "" : "true"
      }
    });
  };

  const handleDrop = (targetNode: ObjectsPanelNode, placement: DropPlacement) => {
    const movePlan = resolveMovePlan(siblingOrder, draggedIds, targetNode, placement);
    if (!movePlan) {
      return;
    }
    const mergeKey = `objects-reorder:${draggedIds.join(",")}:${Date.now().toString(36)}`;
    let currentIds = draggedIds;
    for (let step = 0; step < movePlan.steps; step += 1) {
      dispatch({
        type: "APPLY_EDIT_ACTION",
        historyMergeKey: mergeKey,
        action: {
          kind: "reorderElements",
          elementIds: currentIds,
          direction: movePlan.direction
        }
      });
      currentIds = [...useEditorStore.getState().selectedElementIds];
    }
  };

  if (rows.length === 0) {
    return (
      <SidePanel className={css.panel}>
        <SidePanel.Header>Objects</SidePanel.Header>
        <SidePanel.Content className={css.content}>
          <div className={css.empty}>No scene objects in the current figure.</div>
        </SidePanel.Content>
      </SidePanel>
    );
  }

  return (
    <SidePanel className={css.panel} data-testid="objects-panel">
      <SidePanel.Header>Objects</SidePanel.Header>
      <SidePanel.Content className={css.content}>
        <div className={css.toolbar}>
          <div className={css.multiArrangeGroup} role="group" aria-label="Group selection actions">
            {groupActions.map((action) => renderActionButton(action))}
          </div>
          <div className={css.multiArrangeGroup} role="group" aria-label="Reorder selection actions">
            {reorderActions.map((action) => renderActionButton(action))}
          </div>
        </div>
        <div className={css.tree}>
          {rows.map(({ node, depth }) => {
            const isEditing = editingId === node.id;
            const rowClasses = [
              css.row,
              node.selected ? css.rowSelected : "",
              dropTarget?.id === node.id && dropTarget.placement === "before" ? css.dropBefore : "",
              dropTarget?.id === node.id && dropTarget.placement === "after" ? css.dropAfter : ""
            ].filter(Boolean).join(" ");
            return (
              <div
                key={node.id}
                className={rowClasses}
                draggable={node.canDragReorder}
                onClick={(event) => {
                  if (event.shiftKey) {
                    const anchorId = resolveRangeAnchor(selectionAnchorId, visibleIds, selectedIds);
                    if (anchorId) {
                      dispatch({
                        type: "SELECT_RANGE",
                        ids: resolveSelectionRange(visibleIds, anchorId, node.id)
                      });
                      return;
                    }
                  }
                  dispatch({
                    type: "SELECT",
                    id: node.id,
                    additive: event.metaKey || event.ctrlKey
                  });
                  setSelectionAnchorId(node.id);
                }}
                onDragStart={(event) => {
                  const nextDraggedIds = resolveDraggedIds(node, selectedIds, siblingOrder);
                  if (nextDraggedIds.length === 0) {
                    event.preventDefault();
                    return;
                  }
                  if (!hasSameSelection(nextDraggedIds, selectedIds)) {
                    dispatch({ type: "SELECT_RANGE", ids: nextDraggedIds });
                  }
                  setSelectionAnchorId(nextDraggedIds[0] ?? node.id);
                  setDraggedIds(nextDraggedIds);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", nextDraggedIds.join(","));
                }}
                onDragEnd={() => {
                  setDraggedIds([]);
                  setDropTarget(null);
                }}
                onDragOver={(event) => {
                  if (!canDropOnNode(siblingOrder, draggedIds, node)) {
                    setDropTarget(null);
                    return;
                  }
                  event.preventDefault();
                  setDropTarget({ id: node.id, placement: resolvePlacement(event) });
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const placement = dropTarget?.id === node.id ? dropTarget.placement : resolvePlacement(event);
                  handleDrop(node, placement);
                  setDraggedIds([]);
                  setDropTarget(null);
                }}
              >
                <div className={css.treeCell} style={{ paddingLeft: depth * 16 }}>
                  <RenderedTooltip content={collapsedIds.has(node.id) ? `Expand ${node.title}` : `Collapse ${node.title}`}>
                    <button
                      type="button"
                      className={node.childCount > 0 ? css.iconButton : [css.iconButton, css.iconButtonDisabled].join(" ")}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (node.childCount === 0) {
                          return;
                        }
                        setCollapsedIds((current) => {
                          const next = new Set(current);
                          if (next.has(node.id)) {
                            next.delete(node.id);
                          } else {
                            next.add(node.id);
                          }
                          return next;
                        });
                      }}
                      aria-label={collapsedIds.has(node.id) ? `Expand ${node.title}` : `Collapse ${node.title}`}
                    >
                      {node.childCount > 0 ? (
                        collapsedIds.has(node.id) ? <RiArrowRightSLine size={16} /> : <RiArrowDownSLine size={16} />
                      ) : null}
                    </button>
                  </RenderedTooltip>
                </div>
                <RenderedTooltip content={node.hidden ? `Show ${node.title}` : `Hide ${node.title}`}>
                  <button
                    type="button"
                    className={css.iconButton}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      toggleVisibility(node);
                    }}
                    aria-label={node.hidden ? `Show ${node.title}` : `Hide ${node.title}`}
                  >
                    {node.hidden ? <RiEyeOffLine size={16} /> : <RiEyeLine size={16} />}
                  </button>
                </RenderedTooltip>
                <div className={css.rowMain}>
                  {isEditing ? (
                    <input
                      ref={inputRef}
                      className={css.titleInput}
                      value={editingValue}
                      onChange={(event) => { setEditingValue(event.target.value); }}
                      onBlur={commitRename}
                      onClick={(event) => { event.stopPropagation(); }}
                      onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
                        if (event.key === "Enter") {
                          commitRename();
                        } else if (event.key === "Escape") {
                          setEditingId(null);
                        }
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className={[css.title, css.titleButton].join(" ")}
                      onDoubleClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
                        event.stopPropagation();
                        startRename(node);
                      }}
                    >
                      {node.title}
                      {node.title === node.label ? null : <span className={css.labelMeta}>{node.label}</span>}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </SidePanel.Content>
    </SidePanel>
  );
}

function renderActionButton(action: ObjectsAction) {
  const title = action.enabled || !action.reason ? action.label : `${action.label}\n${action.reason}`;
  const Icon = action.icon;
  return (
    <RenderedTooltip key={action.id} content={title}>
      <button
        type="button"
        className={css.multiArrangeIconButton}
        aria-label={action.label}
        disabled={!action.enabled}
        onClick={() => {
          action.run();
        }}
      >
        <Icon />
      </button>
    </RenderedTooltip>
  );
}

function ObjectsGroupIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7V5c0-1.1.9-2 2-2h2m10 0h2c1.1 0 2 .9 2 2v2m0 10v2c0 1.1-.9 2-2 2h-2M7 21H5c-1.1 0-2-.9-2-2v-2" />
      <rect width="7" height="5" x="7" y="7" rx="1" />
      <rect width="7" height="5" x="10" y="12" rx="1" />
    </svg>
  );
}

function ObjectsUngroupIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="8" height="6" x="5" y="4" rx="1" />
      <rect width="8" height="6" x="11" y="14" rx="1" />
    </svg>
  );
}

function flattenNodes(
  nodes: readonly ObjectsPanelNode[],
  collapsedIds: ReadonlySet<string>,
  depth = 0
): FlatRow[] {
  const rows: FlatRow[] = [];
  for (const node of nodes) {
    rows.push({ node, depth });
    if (!collapsedIds.has(node.id)) {
      rows.push(...flattenNodes(node.children, collapsedIds, depth + 1));
    }
  }
  return rows;
}

function resolvePlacement(event: ReactDragEvent<HTMLDivElement>): DropPlacement {
  const rect = event.currentTarget.getBoundingClientRect();
  return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
}

function buildSiblingOrder(byId: ReadonlyMap<string, ObjectsPanelNode>): Map<string, ObjectsPanelNode[]> {
  const groups = new Map<string, ObjectsPanelNode[]>();
  for (const node of byId.values()) {
    const siblings = groups.get(node.parentKey);
    if (siblings) {
      siblings.push(node);
    } else {
      groups.set(node.parentKey, [node]);
    }
  }
  for (const siblings of groups.values()) {
    siblings.sort((left, right) => left.index - right.index);
  }
  return groups;
}

function resolveRangeAnchor(
  selectionAnchorId: string | null,
  visibleIds: readonly string[],
  selectedIds: ReadonlySet<string>
): string | null {
  if (selectionAnchorId && visibleIds.includes(selectionAnchorId)) {
    return selectionAnchorId;
  }
  for (const id of visibleIds) {
    if (selectedIds.has(id)) {
      return id;
    }
  }
  return null;
}

function resolveSelectionRange(visibleIds: readonly string[], anchorId: string, targetId: string): string[] {
  const anchorIndex = visibleIds.indexOf(anchorId);
  const targetIndex = visibleIds.indexOf(targetId);
  if (anchorIndex < 0 || targetIndex < 0) {
    return [targetId];
  }
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return visibleIds.slice(start, end + 1);
}

function resolveDraggedIds(
  node: ObjectsPanelNode,
  selectedIds: ReadonlySet<string>,
  siblingOrder: ReadonlyMap<string, readonly ObjectsPanelNode[]>
): string[] {
  if (!node.canDragReorder) {
    return [];
  }
  if (!selectedIds.has(node.id)) {
    return [node.id];
  }
  const siblings = siblingOrder.get(node.parentKey) ?? [];
  const selectedSiblingIds = siblings
    .filter((sibling) => selectedIds.has(sibling.id) && sibling.canDragReorder)
    .map((sibling) => sibling.id);
  if (selectedSiblingIds.length <= 1) {
    return [node.id];
  }
  if (!isContiguousSelection(siblings, new Set(selectedSiblingIds))) {
    return [node.id];
  }
  return selectedSiblingIds;
}

function hasSameSelection(ids: readonly string[], selectedIds: ReadonlySet<string>): boolean {
  if (ids.length !== selectedIds.size) {
    return false;
  }
  return ids.every((id) => selectedIds.has(id));
}

function canDropOnNode(
  siblingOrder: ReadonlyMap<string, readonly ObjectsPanelNode[]>,
  draggedIds: readonly string[],
  targetNode: ObjectsPanelNode
): boolean {
  if (draggedIds.length === 0 || draggedIds.includes(targetNode.id)) {
    return false;
  }
  const siblings = siblingOrder.get(targetNode.parentKey) ?? [];
  if (siblings.length === 0) {
    return false;
  }
  const draggedSet = new Set(draggedIds);
  if (!draggedIds.every((id) => siblings.some((node) => node.id === id))) {
    return false;
  }
  return isContiguousSelection(siblings, draggedSet);
}

function isContiguousSelection(
  siblings: readonly ObjectsPanelNode[],
  selectedIds: ReadonlySet<string>
): boolean {
  const selectedIndexes = siblings
    .map((sibling, index) => (selectedIds.has(sibling.id) ? index : -1))
    .filter((index) => index >= 0);
  if (selectedIndexes.length === 0) {
    return false;
  }
  const first = selectedIndexes[0] ?? 0;
  const last = selectedIndexes[selectedIndexes.length - 1] ?? first;
  return last - first + 1 === selectedIndexes.length;
}

function resolveMovePlan(
  siblingOrder: ReadonlyMap<string, readonly ObjectsPanelNode[]>,
  draggedIds: readonly string[],
  targetNode: ObjectsPanelNode,
  placement: DropPlacement
): { direction: "bringForward" | "sendBackward"; steps: number } | null {
  if (!canDropOnNode(siblingOrder, draggedIds, targetNode)) {
    return null;
  }
  const siblings = siblingOrder.get(targetNode.parentKey) ?? [];
  const draggedSet = new Set(draggedIds);
  const draggedBlock = siblings.filter((node) => draggedSet.has(node.id));
  const remaining = siblings.filter((node) => !draggedSet.has(node.id));
  const currentStart = siblings.findIndex((node) => node.id === draggedIds[0]);
  const targetIndex = remaining.findIndex((node) => node.id === targetNode.id);
  if (draggedBlock.length === 0 || currentStart < 0 || targetIndex < 0) {
    return null;
  }
  const insertionIndex = placement === "before" ? targetIndex : targetIndex + 1;
  const reordered = [
    ...remaining.slice(0, insertionIndex),
    ...draggedBlock,
    ...remaining.slice(insertionIndex)
  ];
  const nextStart = reordered.findIndex((node) => node.id === draggedBlock[0]?.id);
  const delta = nextStart - currentStart;
  if (delta === 0) {
    return null;
  }
  return {
    direction: delta > 0 ? "bringForward" : "sendBackward",
    steps: Math.abs(delta)
  };
}
