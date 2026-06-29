export const APP_MENU_COMMAND_IDS = {
  NEW_DOCUMENT: "file.new-document",
  OPEN_DOCUMENT: "file.open-document",
  OPEN_FROM_ARXIV: "file.open-from-arxiv",
  IMPORT_IPE: "file.import-ipe",
  IMPORT_POWERPOINT: "file.import-powerpoint",
  IMPORT_SVG: "file.import-svg",
  SAVE_DOCUMENT: "file.save-document",
  SAVE_DOCUMENT_AS: "file.save-document-as",
  CLOSE_DOCUMENT: "file.close-document",
  CLOSE_ALL_DOCUMENTS: "file.close-all-documents",
  QUIT_APP: "file.quit-app",
  OPEN_EXAMPLE: "file.open-example",
  EXPORT_SVG_DOWNLOAD: "file.export-svg-download",
  EXPORT_STANDALONE_LATEX_DOWNLOAD: "file.export-standalone-latex-download",
  EXPORT_PDF_DOWNLOAD: "file.export-pdf-download",
  EXPORT_PNG_DOWNLOAD: "file.export-png-download",
  EXPORT_SVG_COPY: "file.export-svg-copy",
  UNDO: "edit.undo",
  REDO: "edit.redo",
  FORMAT_TIKZ: "edit.format-tikz",
  CUT: "edit.cut",
  COPY: "edit.copy",
  PASTE: "edit.paste",
  DELETE: "edit.delete",
  DUPLICATE: "edit.duplicate",
  REPEAT: "edit.repeat",
  FLATTEN_FOREACH: "edit.flatten-foreach",
  GROUP: "edit.group",
  UNGROUP: "edit.ungroup",
  ROTATE_LEFT_90: "edit.rotate-left-90",
  ROTATE_RIGHT_90: "edit.rotate-right-90",
  FLIP_HORIZONTAL: "edit.flip-horizontal",
  FLIP_VERTICAL: "edit.flip-vertical",
  SEND_TO_BACK: "edit.send-to-back",
  SEND_BACKWARD: "edit.send-backward",
  BRING_FORWARD: "edit.bring-forward",
  BRING_TO_FRONT: "edit.bring-to-front",
  ALIGN_LEFT: "edit.align-left",
  ALIGN_CENTER: "edit.align-center",
  ALIGN_RIGHT: "edit.align-right",
  ALIGN_TOP: "edit.align-top",
  ALIGN_MIDDLE: "edit.align-middle",
  ALIGN_BOTTOM: "edit.align-bottom",
  DISTRIBUTE_HORIZONTAL: "edit.distribute-horizontal",
  DISTRIBUTE_VERTICAL: "edit.distribute-vertical",
  PATH_SPLIT: "path.split",
  PATH_JOIN: "path.join",
  PATH_REVERSE: "path.reverse",
  PATH_CLOSE: "path.close",
  PATH_OPEN: "path.open",
  PATH_DELETE_POINT: "path.delete-point",
  PATH_POINT_CORNER: "path.point-corner",
  PATH_POINT_SMOOTH: "path.point-smooth",
  TREE_ADD_CHILD: "tree.add-child",
  TREE_ADD_SIBLING_BEFORE: "tree.add-sibling-before",
  TREE_ADD_SIBLING_AFTER: "tree.add-sibling-after",
  MATRIX_ADD_ROW_END: "matrix.add-row-end",
  MATRIX_ADD_COLUMN_END: "matrix.add-column-end",
  MATRIX_INSERT_ROW_ABOVE: "matrix.insert-row-above",
  MATRIX_INSERT_ROW_BELOW: "matrix.insert-row-below",
  MATRIX_INSERT_COLUMN_LEFT: "matrix.insert-column-left",
  MATRIX_INSERT_COLUMN_RIGHT: "matrix.insert-column-right",
  MATRIX_TRANSPOSE: "matrix.transpose",
  MATRIX_REMOVE_ROW: "matrix.remove-row",
  MATRIX_REMOVE_COLUMN: "matrix.remove-column",
  INSERT_NODE: "insert.node",
  INSERT_MATRIX: "insert.matrix",
  INSERT_SHAPE: "insert.shape",
  INSERT_PATH: "insert.path",
  INSERT_FREEHAND: "insert.freehand",
  INSERT_LINE: "insert.line",
  INSERT_ARROW: "insert.arrow",
  INSERT_BEZIER: "insert.bezier",
  INSERT_GRID: "insert.grid",
  INSERT_RECT: "insert.rect",
  INSERT_ELLIPSE: "insert.ellipse",
  INSERT_CIRCLE: "insert.circle",
  INSERT_EQUATION: "insert.equation",
  EDIT_EQUATION: "edit.equation",
  ADD_LABEL: "insert.add-label",
  ADD_PIN: "insert.add-pin",
  NODE_POSITION_RELATIVE_TO: "node.position-relative-to",
  NODE_CONVERT_TO_ABSOLUTE: "node.convert-to-absolute",
  FIT_TO_CONTENT: "view.fit-to-content",
  ZOOM_IN: "view.zoom-in",
  ZOOM_OUT: "view.zoom-out",
  TOGGLE_GRID: "view.toggle-grid",
  TOGGLE_TRANSPARENCY_GRID: "view.toggle-transparency-grid",
  TOGGLE_INFINITE_CANVAS: "view.toggle-infinite-canvas",
  TOGGLE_SNAP_GRID: "view.toggle-snap-grid",
  TOGGLE_SNAP_GUIDES: "view.toggle-snap-guides",
  TOGGLE_SNAP_OBJECT_POINTS: "view.toggle-snap-object-points",
  TOGGLE_SNAP_OBJECT_GAPS: "view.toggle-snap-object-gaps",
  TOGGLE_SNAP_HAPTICS: "view.toggle-snap-haptics",
  TOGGLE_RULERS: "view.toggle-rulers",
  TOGGLE_GUIDES: "view.toggle-guides",
  TOGGLE_SOURCE_PANEL: "view.toggle-source-panel",
  TOGGLE_INSPECTOR_PANEL: "view.toggle-inspector-panel",
  TOGGLE_OBJECTS_PANEL: "view.toggle-objects-panel",
  TOGGLE_STYLES_PANEL: "view.toggle-styles-panel",
  TOGGLE_FIGURES_PANEL: "view.toggle-figures-panel",
  TOGGLE_ASSISTANT_PANEL: "view.toggle-assistant-panel",
  TOGGLE_DEV_PANEL: "view.toggle-dev-panel",
  SAVE_WORKSPACE_AS: "view.save-workspace-as",
  MANAGE_WORKSPACES: "view.manage-workspaces",
  OPEN_PGF_TIKZ_MANUAL: "help.open-pgf-tikz-manual",
  OPEN_GITHUB_REPOSITORY: "help.open-github-repository",
  OPEN_GITHUB_ISSUES: "help.open-github-issues",
  CHECK_FOR_UPDATES: "help.check-for-updates",
  SHOW_ABOUT: "help.show-about",
  SHOW_COMPILED_PICTURE: "file.show-compiled-picture",
  OPEN_SETTINGS: "file.open-settings",
  CLEAR_RECENT_FILES: "file.clear-recent-files"
} as const;

export type AppMenuCommandId = (typeof APP_MENU_COMMAND_IDS)[keyof typeof APP_MENU_COMMAND_IDS];

export type AppMenuPlatformTarget = "web" | "desktop" | "desktop-macos" | "desktop-windows" | "desktop-linux";

type AppMenuPlatformScoped = {
  platforms?: readonly AppMenuPlatformTarget[];
};

export type AppMenuSeparatorItem = {
  kind: "separator";
} & AppMenuPlatformScoped;

export type AppMenuCommandItem = {
  kind: "command";
  commandId: AppMenuCommandId;
  label: string;
  accelerator?: string;
} & AppMenuPlatformScoped;

export type AppMenuSubmenuItem = {
  kind: "submenu";
  label: string;
  items: readonly AppMenuItem[];
} & AppMenuPlatformScoped;

export type AppMenuRecentFilesItem = {
  kind: "recent-files";
  label: string;
} & AppMenuPlatformScoped;

export type AppMenuWorkspaceListItem = {
  kind: "workspace-list";
} & AppMenuPlatformScoped;

export type AppMenuItem =
  | AppMenuSeparatorItem
  | AppMenuCommandItem
  | AppMenuSubmenuItem
  | AppMenuRecentFilesItem
  | AppMenuWorkspaceListItem;

export type AppMenuSectionId = "file" | "edit" | "path" | "insert" | "view" | "help";

export type AppMenuSection = {
  id: AppMenuSectionId;
  label: string;
  items: readonly AppMenuItem[];
} & AppMenuPlatformScoped;

export type AppMenuDefinition = readonly AppMenuSection[];
