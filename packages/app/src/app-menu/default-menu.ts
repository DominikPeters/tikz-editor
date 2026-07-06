import { APP_MENU_COMMAND_IDS, type AppMenuDefinition } from "./types.js";

export const APP_MENU_DEFINITION = [
  {
    id: "file",
    label: "File",
    items: [
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.NEW_DOCUMENT,
        label: "New",
        accelerator: "CmdOrCtrl+N"
      },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.OPEN_DOCUMENT,
        label: "Open..."
      },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.OPEN_FROM_ARXIV,
        label: "Open from arXiv...",
        platforms: ["desktop"]
      },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.OPEN_EXAMPLE,
        label: "Open Example..."
      },
      {
        kind: "recent-files",
        label: "Open Recent",
        platforms: ["desktop"]
      },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.SAVE_DOCUMENT,
        label: "Save",
        accelerator: "CmdOrCtrl+S"
      },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.SAVE_DOCUMENT_AS,
        label: "Save As..."
      },
      { kind: "separator" },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.CLOSE_DOCUMENT,
        label: "Close Tab",
        accelerator: "CmdOrCtrl+W"
      },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.CLOSE_ALL_DOCUMENTS,
        label: "Close All Tabs"
      },
      { kind: "separator" },
      {
        kind: "submenu",
        label: "Import",
        items: [
          {
            kind: "command",
            commandId: APP_MENU_COMMAND_IDS.IMPORT_IPE,
            label: "Ipe (.ipe)..."
          },
          {
            kind: "command",
            commandId: APP_MENU_COMMAND_IDS.IMPORT_POWERPOINT,
            label: "PowerPoint (.pptx)..."
          },
          {
            kind: "command",
            commandId: APP_MENU_COMMAND_IDS.IMPORT_SVG,
            label: "SVG..."
          }
        ]
      },
      {
        kind: "submenu",
        label: "Export",
        items: [
          {
            kind: "command",
            commandId: APP_MENU_COMMAND_IDS.EXPORT_SVG_DOWNLOAD,
            label: "SVG..."
          },
          {
            kind: "command",
            commandId: APP_MENU_COMMAND_IDS.EXPORT_STANDALONE_LATEX_DOWNLOAD,
            label: "Standalone LaTeX"
          },
          {
            kind: "command",
            commandId: APP_MENU_COMMAND_IDS.EXPORT_PDF_DOWNLOAD,
            label: "PDF..."
          },
          {
            kind: "command",
            commandId: APP_MENU_COMMAND_IDS.EXPORT_PNG_DOWNLOAD,
            label: "PNG..."
          }
        ]
      },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.EXPORT_SVG_COPY,
        label: "Copy as SVG"
      },
      { kind: "separator" },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.SHOW_COMPILED_PICTURE,
        label: "Show Compiled Picture..."
      },
      { kind: "separator" },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.OPEN_SETTINGS,
        label: "Settings...",
        accelerator: "CmdOrCtrl+,"
      },
      { kind: "separator", platforms: ["desktop-windows", "desktop-linux"] },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.QUIT_APP,
        label: "Quit",
        accelerator: "CmdOrCtrl+Q",
        platforms: ["desktop-windows", "desktop-linux"]
      }
    ]
  },
  {
    id: "edit",
    label: "Edit",
    items: [
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
        accelerator: "CmdOrCtrl+Shift+Z",
        platforms: ["web", "desktop", "desktop-macos"]
      },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.REDO,
        label: "Redo",
        accelerator: "CmdOrCtrl+Y",
        platforms: ["desktop-windows"]
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
      },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.FLATTEN_FOREACH,
        label: "Flatten foreach"
      },
      { kind: "separator" },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.FORMAT_TIKZ,
        label: "Format TikZ Code",
        accelerator: "CmdOrCtrl+Shift+F"
      },
      { kind: "separator" },
      {
        kind: "submenu",
        label: "Align",
        items: [
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
        ]
      },
      {
        kind: "submenu",
        label: "Transform",
        items: [
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
        ]
      },
      {
        kind: "submenu",
        label: "Distribute",
        items: [
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
        ]
      },
      {
        kind: "submenu",
        label: "Reorder",
        items: [
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
        ]
      }
    ]
  },
  {
    id: "path",
    label: "Path",
    items: [
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
      }
    ]
  },
  {
    id: "insert",
    label: "Insert",
    items: [
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.INSERT_NODE,
        label: "Node",
        accelerator: "N"
      },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.INSERT_SHAPE,
        label: "Shape",
        accelerator: "S"
      },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.INSERT_MATRIX,
        label: "Matrix"
      },
      { kind: "separator" },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.INSERT_LINE,
        label: "Line",
        accelerator: "L"
      },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.INSERT_ARROW,
        label: "Arrow",
        accelerator: "A"
      },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.INSERT_BEZIER,
        label: "Bezier",
        accelerator: "B"
      },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.INSERT_PATH,
        label: "Path",
        accelerator: "P"
      },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.INSERT_FREEHAND,
        label: "Freehand",
        accelerator: "F"
      },
      { kind: "separator" },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.INSERT_GRID,
        label: "Grid"
      },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.INSERT_RECT,
        label: "Rectangle",
        accelerator: "R"
      },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.INSERT_ELLIPSE,
        label: "Ellipse",
        accelerator: "E"
      },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.INSERT_CIRCLE,
        label: "Circle",
        accelerator: "C"
      },
      { kind: "separator" },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.INSERT_EQUATION,
        label: "Equation",
        accelerator: "CmdOrCtrl+Shift+E"
      }
    ]
  },
  {
    id: "view",
    label: "View",
    items: [
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.FIT_TO_CONTENT,
        label: "Fit to Content",
        accelerator: "CmdOrCtrl+0"
      },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.ZOOM_IN,
        label: "Zoom In",
        accelerator: "CmdOrCtrl+="
      },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.ZOOM_OUT,
        label: "Zoom Out",
        accelerator: "CmdOrCtrl+-"
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
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.TOGGLE_TRANSPARENCY_GRID,
        label: "Transparency Grid"
      },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.TOGGLE_INFINITE_CANVAS,
        label: "Infinite Canvas"
      },
      {
        kind: "submenu",
        label: "Snapping",
        items: [
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
          },
          {
            kind: "command",
            commandId: APP_MENU_COMMAND_IDS.TOGGLE_SNAP_HAPTICS,
            label: "Haptic Snap Feedback",
            platforms: ["desktop-macos"]
          }
        ]
      },
      { kind: "separator" },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.TOGGLE_SOURCE_PANEL,
        label: "Source Panel"
      },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.TOGGLE_INSPECTOR_PANEL,
        label: "Inspector Panel"
      },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.TOGGLE_OBJECTS_PANEL,
        label: "Objects Panel"
      },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.TOGGLE_STYLES_PANEL,
        label: "Styles Panel"
      },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.TOGGLE_FIGURES_PANEL,
        label: "Figures Panel"
      },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.TOGGLE_ASSISTANT_PANEL,
        label: "Assistant Panel",
        platforms: ["desktop"]
      },
      { kind: "separator" },
      {
        kind: "submenu",
        label: "Workspace",
        items: [
          { kind: "workspace-list" },
          { kind: "separator" },
          {
            kind: "command",
            commandId: APP_MENU_COMMAND_IDS.SAVE_WORKSPACE_AS,
            label: "Save Current Layout As..."
          },
          {
            kind: "command",
            commandId: APP_MENU_COMMAND_IDS.MANAGE_WORKSPACES,
            label: "Manage Workspaces..."
          }
        ]
      },
      { kind: "separator" },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.TOGGLE_DEV_PANEL,
        label: "Developer Panel",
        accelerator: "CmdOrCtrl+Shift+D"
      }
    ]
  },
  {
    id: "help",
    label: "Help",
    items: [
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.CHECK_FOR_UPDATES,
        label: "Check for Updates...",
        platforms: ["desktop-windows", "desktop-linux"]
      },
      { kind: "separator", platforms: ["desktop-windows", "desktop-linux"] },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.OPEN_PGF_TIKZ_MANUAL,
        label: "Open PGF/TikZ Manual"
      },
      { kind: "separator", platforms: ["web"] },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.SHOW_ABOUT,
        label: "About TikZ Editor Web",
        platforms: ["web"]
      },
      { kind: "separator" },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.OPEN_GITHUB_REPOSITORY,
        label: "GitHub Repository"
      },
      {
        kind: "command",
        commandId: APP_MENU_COMMAND_IDS.OPEN_GITHUB_ISSUES,
        label: "Report an Issue..."
      }
    ]
  }
] as const satisfies AppMenuDefinition;
