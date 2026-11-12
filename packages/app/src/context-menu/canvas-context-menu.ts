import { APP_MENU_COMMAND_IDS, type AppMenuCommandId, type AppMenuItem } from "../app-menu/types.js";
import type { CanvasContextMenuDefinition } from "./types.js";

const REORDER_ITEMS: readonly AppMenuItem[] = [
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.SEND_TO_BACK,
    label: "Send to Back"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.SEND_BACKWARD,
    label: "Send Backward"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.BRING_FORWARD,
    label: "Bring Forward"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.BRING_TO_FRONT,
    label: "Bring to Front"
  }
];

const ALIGN_ITEMS: readonly AppMenuItem[] = [
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.ALIGN_LEFT,
    label: "Left"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.ALIGN_CENTER,
    label: "Center"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.ALIGN_RIGHT,
    label: "Right"
  },
  { kind: "separator" },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.ALIGN_TOP,
    label: "Top"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.ALIGN_MIDDLE,
    label: "Middle"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.ALIGN_BOTTOM,
    label: "Bottom"
  }
];

const DISTRIBUTE_ITEMS: readonly AppMenuItem[] = [
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.DISTRIBUTE_HORIZONTAL,
    label: "Horizontal"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.DISTRIBUTE_VERTICAL,
    label: "Vertical"
  }
];

const TRANSFORM_ITEMS: readonly AppMenuItem[] = [
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.ROTATE_LEFT_90,
    label: "Rotate Left 90°"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.ROTATE_RIGHT_90,
    label: "Rotate Right 90°"
  },
  { kind: "separator" },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.FLIP_HORIZONTAL,
    label: "Flip Horizontally"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.FLIP_VERTICAL,
    label: "Flip Vertically"
  }
];

const PATH_POINT_ITEMS: readonly AppMenuItem[] = [
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.PATH_DELETE_POINT,
    label: "Delete Point"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.PATH_POINT_CORNER,
    label: "Point to Corner"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.PATH_POINT_SMOOTH,
    label: "Point to Smooth"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.PATH_SPLIT,
    label: "Split at Point"
  }
];

const PATH_ITEMS: readonly AppMenuItem[] = [
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.PATH_SPLIT,
    label: "Split Path"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.PATH_JOIN,
    label: "Join Paths"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.PATH_REVERSE,
    label: "Reverse Path"
  },
  { kind: "separator" },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.PATH_CLOSE,
    label: "Close Path"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.PATH_OPEN,
    label: "Open Path"
  },
  { kind: "separator" },
  ...PATH_POINT_ITEMS
];

const SNAP_ITEMS: readonly AppMenuItem[] = [
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.TOGGLE_SNAP_GRID,
    label: "Snap to Grid"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.TOGGLE_SNAP_GUIDES,
    label: "Snap to Guides"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.TOGGLE_SNAP_OBJECT_POINTS,
    label: "Snap to Object Points"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.TOGGLE_SNAP_OBJECT_GAPS,
    label: "Snap to Object Gaps"
  }
];

const EDIT_EQUATION_ITEM: AppMenuItem = {
  kind: "command",
  commandId: APP_MENU_COMMAND_IDS.EDIT_EQUATION,
  label: "Edit Equation...",
  accelerator: "CmdOrCtrl+Shift+E"
};

const TREE_ITEMS: readonly AppMenuItem[] = [
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.TREE_ADD_CHILD,
    label: "Add Child"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.TREE_ADD_SIBLING_BEFORE,
    label: "Add Sibling Before"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.TREE_ADD_SIBLING_AFTER,
    label: "Add Sibling After"
  }
];

const MATRIX_STATEMENT_ITEMS: readonly AppMenuItem[] = [
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.MATRIX_ADD_ROW_END,
    label: "Add Row at End"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.MATRIX_ADD_COLUMN_END,
    label: "Add Column at End"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.MATRIX_TRANSPOSE,
    label: "Transpose Matrix"
  }
];

const MATRIX_CELL_ITEMS: readonly AppMenuItem[] = [
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.MATRIX_INSERT_ROW_ABOVE,
    label: "Insert Row Above"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.MATRIX_INSERT_ROW_BELOW,
    label: "Insert Row Below"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.MATRIX_REMOVE_ROW,
    label: "Remove Row"
  },
  {
    kind: "separator"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.MATRIX_INSERT_COLUMN_LEFT,
    label: "Insert Column Left"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.MATRIX_INSERT_COLUMN_RIGHT,
    label: "Insert Column Right"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.MATRIX_REMOVE_COLUMN,
    label: "Remove Column"
  }
];

const SINGLE_NODE_TOP_ACTIONS: readonly AppMenuItem[] = [
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.ADD_LABEL,
    label: "Add Label"
  },
  {
    kind: "command",
    commandId: APP_MENU_COMMAND_IDS.ADD_PIN,
    label: "Add Pin"
  }
];

function buildNodePositioningItems(action: "position-relative" | "convert-absolute" | null | undefined): readonly AppMenuItem[] {
  if (action === "position-relative") {
    return [
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.NODE_POSITION_RELATIVE_TO,
        label: "Position Relative To..."
      }
    ];
  }
  if (action === "convert-absolute") {
    return [
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.NODE_CONVERT_TO_ABSOLUTE,
        label: "Convert to Absolute Position"
      }
    ];
  }
  return [];
}

function buildSelectionCommandItems(includeFlattenForeach: boolean): readonly AppMenuItem[] {
  const items: AppMenuItem[] = [
    {
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.UNDO,
      label: "Undo",
      accelerator: "CmdOrCtrl+Z"
    },
    {
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.REDO,
      label: "Redo",
      accelerator: "CmdOrCtrl+Shift+Z"
    },
    { kind: "separator" },
    {
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.CUT,
      label: "Cut",
      accelerator: "CmdOrCtrl+X"
    },
    {
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.COPY,
      label: "Copy",
      accelerator: "CmdOrCtrl+C"
    },
    {
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.PASTE,
      label: "Paste",
      accelerator: "CmdOrCtrl+V"
    },
    {
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.DELETE,
      label: "Delete",
      accelerator: "Delete"
    },
    {
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.DUPLICATE,
      label: "Duplicate",
      accelerator: "CmdOrCtrl+D"
    },
    { kind: "separator" },
    {
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.GROUP,
      label: "Group",
      accelerator: "CmdOrCtrl+G"
    },
    {
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.UNGROUP,
      label: "Ungroup",
      accelerator: "CmdOrCtrl+Shift+G"
    },
    { kind: "separator" },
    {
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.REPEAT,
      label: "Repeat..."
    }
  ];
  if (includeFlattenForeach) {
    items.push({
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.FLATTEN_FOREACH,
      label: "Flatten foreach"
    });
  }
  items.push({ kind: "separator" });
  return items;
}

const PATH_REORDER_TAIL_ITEMS: readonly AppMenuItem[] = [
  { kind: "separator" },
  {
    kind: "submenu",
    label: "Reorder",
    items: REORDER_ITEMS
  }
];

function buildSingleSelectionSubmenuItems(includePathSubmenu: boolean): readonly AppMenuItem[] {
  const items: AppMenuItem[] = [
    {
      kind: "submenu",
      label: "Transform",
      items: TRANSFORM_ITEMS
    }
  ];
  if (includePathSubmenu) {
    items.push(
      { kind: "separator" },
      {
        kind: "submenu",
        label: "Path",
        items: PATH_ITEMS
      }
    );
  }
  items.push(...PATH_REORDER_TAIL_ITEMS);
  return items;
}

const PATH_POINT_SELECTION_SUBMENU_ITEMS: readonly AppMenuItem[] = [
  {
    kind: "submenu",
    label: "Path",
    items: PATH_ITEMS
  },
  ...PATH_REORDER_TAIL_ITEMS
];

function buildPathPointSelectionItems(includeFlattenForeach: boolean): readonly AppMenuItem[] {
  return [
    ...PATH_POINT_ITEMS,
    { kind: "separator" },
    ...buildSelectionCommandItems(includeFlattenForeach),
    ...PATH_POINT_SELECTION_SUBMENU_ITEMS
  ];
}

function buildSingleSelectionItems(includeFlattenForeach: boolean, includePathSubmenu: boolean): readonly AppMenuItem[] {
  return [
    ...buildSelectionCommandItems(includeFlattenForeach),
    ...buildSingleSelectionSubmenuItems(includePathSubmenu)
  ];
}

const MULTI_SELECTION_SUBMENU_ITEMS: readonly AppMenuItem[] = [
  {
    kind: "submenu",
    label: "Align",
    items: ALIGN_ITEMS
  },
  {
    kind: "submenu",
    label: "Transform",
    items: TRANSFORM_ITEMS
  },
  {
    kind: "submenu",
    label: "Distribute",
    items: DISTRIBUTE_ITEMS
  },
  {
    kind: "submenu",
    label: "Reorder",
    items: REORDER_ITEMS
  }
];

function buildMultiSelectionItems(includeFlattenForeach: boolean): readonly AppMenuItem[] {
  return [
    ...buildSelectionCommandItems(includeFlattenForeach),
    ...MULTI_SELECTION_SUBMENU_ITEMS
  ];
}

function buildSelectionSingleNodeItems(
  includeEditEquationForSingleNode: boolean,
  nodePositioningAction: "position-relative" | "convert-absolute" | null | undefined,
  includeFlattenForeach: boolean
): readonly AppMenuItem[] {
  const topItems = includeEditEquationForSingleNode
    ? [EDIT_EQUATION_ITEM, ...SINGLE_NODE_TOP_ACTIONS]
    : SINGLE_NODE_TOP_ACTIONS;
  const positioningItems = buildNodePositioningItems(nodePositioningAction);

  return [
    ...topItems,
    { kind: "separator" },
    ...(positioningItems.length > 0 ? [...positioningItems, { kind: "separator" } as const] : []),
    ...buildSelectionCommandItems(includeFlattenForeach),
    ...buildSingleSelectionSubmenuItems(false)
  ];
}

function withPrependedItems(items: readonly AppMenuItem[], prefixItems: readonly AppMenuItem[]): readonly AppMenuItem[] {
  return [
    ...prefixItems,
    { kind: "separator" },
    ...items
  ];
}

function withTreeItems(items: readonly AppMenuItem[]): readonly AppMenuItem[] {
  return withPrependedItems(items, TREE_ITEMS);
}

function withMatrixStatementItems(items: readonly AppMenuItem[]): readonly AppMenuItem[] {
  return withPrependedItems(items, MATRIX_STATEMENT_ITEMS);
}

function withMatrixCellItems(items: readonly AppMenuItem[]): readonly AppMenuItem[] {
  return withPrependedItems(items, MATRIX_CELL_ITEMS);
}

/** What a canvas context menu offers beyond its target's fixed items, decided when it opens. */
export type CanvasContextMenuOptions = {
  includeEditEquationForSingleNode?: boolean;
  nodePositioningAction?: "position-relative" | "convert-absolute" | null;
  includePathSubmenuForSingleSelection?: boolean;
  includeFlattenForeach?: boolean;
  includeMatrixMultiRemoveRow?: boolean;
  includeMatrixMultiRemoveColumn?: boolean;
  includeMatrixMultiInsertRowAbove?: boolean;
  includeMatrixMultiInsertRowBelow?: boolean;
  includeMatrixMultiInsertColumnLeft?: boolean;
  includeMatrixMultiInsertColumnRight?: boolean;
  /** For one shape in a slide picture: what its overlay rule allows. */
  shapeOverlay?: OverlayMenuTarget | null;
};

/** What the Overlays submenu can do for an object on a slide, on the step shown. */
export type OverlayMenuTarget = {
  step: number;
  /** Its own rule can be set or changed here. */
  canSet: boolean;
  /** It has a rule, or stands under one, that the Overlays panel can show. */
  hasRule: boolean;
  canRemove: boolean;
};

/** The Overlays submenu's items: timing for the step shown, then the rule itself. */
export function overlayMenuItems(target: OverlayMenuTarget): AppMenuItem[] {
  const command = (commandId: AppMenuCommandId, label: string): AppMenuItem => ({ kind: "command", commandId, label });
  const items: AppMenuItem[] = [];
  if (target.canSet) items.push(
    command(APP_MENU_COMMAND_IDS.OVERLAY_NEXT, `Appear on next step (${target.step + 1})`),
    command(APP_MENU_COMMAND_IDS.OVERLAY_FROM, `Show from step ${target.step}`),
    command(APP_MENU_COMMAND_IDS.OVERLAY_ONLY, `Only on step ${target.step}`),
    command(APP_MENU_COMMAND_IDS.OVERLAY_THROUGH, `Show through step ${target.step}`),
  );
  if (target.hasRule || target.canRemove) {
    if (items.length) items.push({ kind: "separator" });
    if (target.hasRule) items.push(command(APP_MENU_COMMAND_IDS.OVERLAY_EDIT, "Edit in Overlays"));
    if (target.canRemove) items.push(command(APP_MENU_COMMAND_IDS.OVERLAY_REMOVE, "Remove overlay rule"));
  }
  return items;
}

function withOverlayItems(items: readonly AppMenuItem[], target: OverlayMenuTarget | null | undefined): readonly AppMenuItem[] {
  const overlay = target ? overlayMenuItems(target) : [];
  return overlay.length ? [...items, { kind: "separator" }, { kind: "submenu", label: "Overlays", items: overlay }] : items;
}

export function buildCanvasContextMenuDefinition(options: CanvasContextMenuOptions = {}) {
  const includeFlattenForeach = options.includeFlattenForeach === true;
  const includePathSubmenuForSingleSelection = options.includePathSubmenuForSingleSelection === true;
  const selectionSingleItems = buildSingleSelectionItems(includeFlattenForeach, includePathSubmenuForSingleSelection);
  const selectionSingleNodeItems = buildSelectionSingleNodeItems(
    options.includeEditEquationForSingleNode === true,
    options.nodePositioningAction,
    includeFlattenForeach
  );
  const pathPointSelectionItems = buildPathPointSelectionItems(includeFlattenForeach);
  const selectionMultiItems = withMatrixMultiItems(buildMultiSelectionItems(includeFlattenForeach), options);
  const singleMatrixItems = buildSingleSelectionItems(includeFlattenForeach, false);
  const single = (items: readonly AppMenuItem[]) => withOverlayItems(items, options.shapeOverlay);

  return {
    "canvas-empty": [
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.UNDO,
        label: "Undo",
        accelerator: "CmdOrCtrl+Z"
      },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.REDO,
        label: "Redo",
        accelerator: "CmdOrCtrl+Shift+Z"
      },
      { kind: "separator" },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.PASTE,
        label: "Paste",
        accelerator: "CmdOrCtrl+V"
      },
      { kind: "separator" },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.FIT_TO_CONTENT,
        label: "Fit to Content"
      },
      { kind: "separator" },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.TOGGLE_GRID,
        label: "Grid"
      },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.TOGGLE_RULERS,
        label: "Rulers"
      },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.TOGGLE_GUIDES,
        label: "Guide Lines"
      },
      {
        kind: "submenu",
        label: "Snapping",
        items: SNAP_ITEMS
      }
    ],
    "selection-single": [...single(selectionSingleItems)],
    "selection-single-tree": [...single(withTreeItems(selectionSingleItems))],
    "selection-single-path-point": [...single(pathPointSelectionItems)],
    "selection-single-path-point-tree": [...single(withTreeItems(pathPointSelectionItems))],
    "selection-single-node": [...single(selectionSingleNodeItems)],
    "selection-single-node-tree": [...single(withTreeItems(selectionSingleNodeItems))],
    "selection-single-matrix": [...single(withMatrixStatementItems(singleMatrixItems))],
    "selection-single-matrix-cell": [...withMatrixCellItems(selectionSingleNodeItems)],
    "selection-multi": [...selectionMultiItems]
  } as const satisfies CanvasContextMenuDefinition;
}

export const CANVAS_CONTEXT_MENU_DEFINITION = buildCanvasContextMenuDefinition();

function withMatrixMultiItems(
  items: readonly AppMenuItem[],
  options: {
    includeMatrixMultiRemoveRow?: boolean;
    includeMatrixMultiRemoveColumn?: boolean;
    includeMatrixMultiInsertRowAbove?: boolean;
    includeMatrixMultiInsertRowBelow?: boolean;
    includeMatrixMultiInsertColumnLeft?: boolean;
    includeMatrixMultiInsertColumnRight?: boolean;
  }
): readonly AppMenuItem[] {
  const topItems: AppMenuItem[] = [];
  if (options.includeMatrixMultiInsertRowAbove) {
    topItems.push({
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.MATRIX_INSERT_ROW_ABOVE,
      label: "Insert Row Above"
    });
  }
  if (options.includeMatrixMultiInsertRowBelow) {
    topItems.push({
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.MATRIX_INSERT_ROW_BELOW,
      label: "Insert Row Below"
    });
  }
  if (options.includeMatrixMultiRemoveRow) {
    topItems.push({
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.MATRIX_REMOVE_ROW,
      label: "Remove Row"
    });
  }
  const hasRowItems = topItems.length > 0;
  if (hasRowItems && (options.includeMatrixMultiInsertColumnLeft || options.includeMatrixMultiInsertColumnRight || options.includeMatrixMultiRemoveColumn)) {
    topItems.push({ kind: "separator" });
  }
  if (options.includeMatrixMultiInsertColumnLeft) {
    topItems.push({
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.MATRIX_INSERT_COLUMN_LEFT,
      label: "Insert Column Left"
    });
  }
  if (options.includeMatrixMultiInsertColumnRight) {
    topItems.push({
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.MATRIX_INSERT_COLUMN_RIGHT,
      label: "Insert Column Right"
    });
  }
  if (options.includeMatrixMultiRemoveColumn) {
    topItems.push({
      kind: "command",
      commandId: APP_MENU_COMMAND_IDS.MATRIX_REMOVE_COLUMN,
      label: "Remove Column"
    });
  }
  if (topItems.length === 0) {
    return items;
  }
  return [...topItems, { kind: "separator" }, ...items];
}
