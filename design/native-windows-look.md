# Native Windows 11 look — implementation plan

Mockups: [TikZ Editor native mockups](https://claude.ai/artifact/MGjK9gsLWXu69hShJPgkCy),
row "Windows 11 adaptation": "Fluent main window, compact", "ContentDialog"
and "Settings page".

Follows `native-macos-look.md`. That plan made Option A the base look on
every platform, so Windows starts from the macOS-style tokens and controls
plus the old `[data-desktop-os="windows"]` block in `variables.css` (grey
accent, flat grey buttons). This pass replaces that block with a Fluent
variant.

## Where Windows stands today

- Native Win32 title bar (`decorations: true`) and the native Win32 menu bar
  (`usesNativeMenuBar: true` in `apps/desktop/src/platform/adapter.ts`).
  The menu bar is classic Win32: it doesn't follow dark mode and looks dated
  next to WebView2 content.
- Native context menus (`desktop_show_context_menu`), also classic Win32.
- Everything inside the window uses the macOS-style tokens: blue
  `--control-accent`, 0.5px rings, pop-ups with a chevron tile, AppKit-style
  segmented controls and checkboxes.
- `--font-ui` starts with `system-ui`, which resolves to Segoe UI.

## Decision 1 — title bar and menus

| | What | Cost and risk |
|---|---|---|
| A | Keep the native title bar and Win32 menu bar; restyle only inside the window. | S. The menu bar stays dated and light-only. |
| B | Keep the native title bar; drop the Win32 menu bar for the in-app `AppMenuBar` (as on web), merged with the toolbar into one Fluent command bar, as in the mockup's second row. | M. `AppMenuBar` needs keyboard access first (Alt, F10, Alt+letter, arrows, Esc) and recent files (it skips `recent-files` today). Dark mode works. |
| C | B plus a custom title bar: `decorations: false`, document tabs in the title bar, our own caption buttons, as in the mockup. | L. Drag regions, double-click to maximise and Aero Snap need care. The Snap Layouts flyout on the maximise button is lost unless a helper puts back a hit-test region (see below). Must be tested on real Windows 11. |

Decided (2026-10-24): C, in two steps. Phases 1–5 are the B work, which C
needs too; phase 6 then moves the tabs into a custom title bar. For Snap
Layouts, adapt [tauri-plugin-snap-layout](https://github.com/Hyph-M/tauri-plugin-snap-layout)
(MIT, about 15 KB of Rust: an invisible Win32 child window over our maximise
button answers `WM_NCHITTEST` with `HTMAXBUTTON`) into `apps/desktop/src-tauri`
rather than depending on it: it is new and has few users.

## Phase 1 — Fluent tokens and controls (S)

Under `:root[data-desktop-os="windows"]`, replacing today's block:

| Token | Light | Dark | Notes |
|---|---|---|---|
| `--control-accent` | `#005fb8` | `#60cdff` | Windows default accent; system accent in phase 5 |
| `--bg-window` | `#f3f3f3` | `#202020` | command bar, dock headers, status bar |
| `--bg-inspector` | `#f9f9f9` | `#272727` | |
| `--separator` | `#e5e5e5` | `#3a3a3a` | |
| `--label-secondary` | `#5f5f5f` | `#c5c5c5` | |
| `--control-bg` | `#ffffff` | `#2d2d2d` | |
| `--radius-field`, `--radius-popup` | `4px` | | |
| `--control-h`, `--row-min-h` | `24px` | | mockup rows are 24px at 12px text |

Control styles, scoped to Windows in `controls.module.css`:

- **Fields** get a 1px border, `#e5e5e5` with a darker bottom edge
  (`#8a8a8a`); the bottom edge turns accent and 2px when focused.
- **Combo boxes (pop-ups)** are white with a plain chevron at the right
  edge, no accent tile.
- **Segmented controls** become a Fluent toggle group: hairline-divided
  buttons, the selected one filled with the accent.
- **Checkboxes** are 14px with 3px corners, accent-filled when checked.
- **Sliders** get a 4px track and a 16px white knob with an accent dot.
- **Focus** uses the Fluent double ring (2px dark outer, 1px light inner) on
  `:focus-visible`.
- **Fonts**: `"Segoe UI Variable Text", "Segoe UI"` first in `--font-ui` on
  Windows; `"Cascadia Code", Consolas` first in `--font-mono`.

As built (phase 1, 2026-10-24): the tokens above are under
`:root[data-desktop-os="windows"]` with a dark twin, replacing the old grey
block; the `--accent` family (dialogs, toolbar) stays the shared blue until
phase 4. Strokes are inset shadows so control boxes keep their size. The
pop-up chevron is redrawn with the CSS `d` property, which Chromium (so
WebView2) supports. Interface text defaults to 12px in the Windows
desktop app (`platformDefaultSettings`), so `--control-h: 22px` comes out at
24px; settings saved earlier keep their size. Web stays at 11px: the e2e
suite runs with Playwright's "Desktop Chrome" device, whose user agent says
Windows. Checkboxes stay native: Chromium's already follow Fluent.
`?desktop-os=windows` previews it in a dev build.

## Phase 2 — Command bar and in-app menus (M)

- On Windows, `usesNativeMenuBar` becomes false. `AppMenuBar` sits at the
  left of the toolbar row, then a separator, then the tool groups.
- Keyboard access in `AppMenuBar`, which the web build gains too:
  - Alt or F10 focuses the bar and shows the access keys.
  - Alt+letter opens a menu.
  - Arrow keys move between and within menus; Enter runs an item; Esc
    closes.
  - Access keys come from the menu labels (File → F, …), with one letter per
    item in `default-menu.ts`.
- Show recent files in the in-app File menu.
- Menu flyouts take the Fluent look: 8px corners, a shadow, 28px items,
  shortcuts right-aligned in secondary text.
- Tool toggles: the selected tool gets a light fill, an accent icon and a
  short accent underline.
- Context menus stay native for now (Win32). Moving them in-app comes later
  and is not in this plan.

As built (phase 2, 2026-10-24): on Windows the desktop adapter reports
`usesNativeMenuBar: false`, skips `syncNativeMenu` (so no Win32 menu bar is
set) and offers `menu.recentFiles` for the in-app File › Open Recent. The
menu bar goes into the toolbar row (`Toolbar`'s `menuBar`) when the look is
Windows. Keyboard access, on any non-Mac platform (web included):

- Alt pressed and released alone, or F10, focuses File; Alt+letter opens a
  menu.
- The arrow keys, Home and End, Enter and Space, Escape and Tab work as in
  Win32 menus. Disabled items can be focused (`aria-disabled`, not
  `disabled`).
- Letters pick items.

Access keys are assigned automatically per menu (`menu-access-keys.ts`):
Windows conventions such as Cu**t**, E**x**it and Save **A**s first, then
first letters. They are underlined only after keyboard entry. Windows shows
Exit (Alt+F4) instead of Quit (Ctrl+Q). The active tool gets the Fluent
fill, accent icon and accent bar. Tests: `apps/web/e2e/menu-keyboard.spec.ts`
(claims a Windows `navigator.platform`), `test/menu-access-keys.spec.ts`,
`test/web/app-menu-bar-recent-files.spec.ts`.

## Phase 3 — Panels, tabs, inspector, status bar (M)

- **Dock tab strip:** pivot style. Text tabs with the selected one in
  semibold and a 3px accent bar under its centre (16px wide); no tab
  backgrounds. Single-panel docks keep a plain semibold title.
- **Document tabs** (with a native title bar): Edge-style. Rounded top
  corners on the selected tab, which joins the content below; a dot for
  unsaved changes.
- **Inspector:** semibold section headers, hairline separators, a 62px label
  column. Unchanged otherwise.
- **Status bar:** 24px, `--bg-window`, a Fluent slider for zoom.
- **Dark mode:** the same against the Windows dark tokens.

## Phase 4 — Dialogs (M)

Done together with the macOS dialogs: see `native-macos-look.md`, phase 8.

## Phase 5 — System integration (S–M)

- **System accent:** read it from Windows (`UISettings::GetColorValue`
  through the `windows` crate) and set `--control-accent`; update it on the
  `ColorValuesChanged` event. Check first whether WebView2 resolves the CSS
  `AccentColor` keyword; if it does, no Rust is needed.
- **Mica backdrop** for the title and command bar area (`windowEffects` on
  Windows 11), with a solid fallback on Windows 10.
- **Title bar colour** follows the app theme (Tauri `theme`), so a dark app
  doesn't sit under a light title bar.

## Phase 6 — Custom title bar (L)

- **Window:** `decorations: false` in `tauri.windows.conf.json`.
- **Title bar row:**
  - app icon, document tabs, a new-tab button, then a drag region
    (`data-tauri-drag-region`);
  - caption buttons 46×34px, with the close button turning red on hover.
- **Must keep working:**
  - double-click to maximise;
  - Aero Snap by drag;
  - Win+arrows;
  - the system menu on Alt+Space;
  - the Snap Layouts flyout (the adapted plugin from Decision 1).

## As built: phases 3 and 6 (2026-10-25)

Done together, since the custom title bar decides where the document tabs go.

- **`WindowsTitleBar`** (app package): the app mark, the `TabStrip`, a drag
  region (`data-tauri-drag-region`) and 46px caption buttons. It replaces
  the tab row on the Windows look, above the command bar.
- **Tabs:** fixed-width tabs with rounded tops on `--bg-titlebar`. The
  active one has `--bg-commandbar`, so it joins the command bar. The unsaved
  dot leads, and the close button trails.
- **Window controls:** `PlatformWindowApi.frame` (desktop adapter,
  `window-frame.ts`) minimises, maximises and closes through Tauri. Close
  raises `CloseRequested`, so the unsaved-changes guard runs as for Alt+F4.
- **Snap Layouts:** `snap_layout.rs` is adapted from
  tauri-plugin-snap-layout (MIT; notice in the file). The page reports the
  maximise button's box, and a transparent `STATIC` child window over it
  answers `HTMAXBUTTON`, maximises or restores on click, and sends hover
  back as `desktop-maximize-button-hover`.
- **Config:** `tauri.windows.conf.json` sets `decorations: false` and
  `shadow: true`. The `windows-frame` capability allows the window calls.
- **Dock tabs:** pivots, with the selected tab semibold over a 3px accent
  bar. The status bar needed nothing: its tokens already give the Fluent
  look.
- **Checked on CI (2026-10-25):** the `Windows screenshots` workflow builds
  the portable app on `windows-2025` and uploads screenshots of the window,
  the File menu, Settings, Snap Layouts and the maximised window, light and
  dark (`apps/desktop/scripts/windows-screenshots.ps1`). The Rust code
  compiled the first time. With real mouse input the Snap Layouts flyout
  opens on our maximise button, the button shows its hover, and a click on
  it maximises. The script logs the window's children and hit-tests the
  caption, and Notepad's flyout serves as a control. `SetCursorPos` alone
  does not open the flyout.
- **Open: flyout theme.** On the runner our flyout is dark in both themes,
  while Notepad's is light. It is not the frame: the script logs
  `DWMWA_USE_IMMERSIVE_DARK_MODE`, which is 0 in the light run and 1 in the
  dark one, as tao reads `AppsUseLightTheme`. The shell seems not to pick up
  the script's registry switch (the taskbar stays light in the dark run,
  even after broadcasting `ImmersiveColorSet`), so check this on a real
  machine before chasing it.
- **Runner limits:** no rounded corners or window shadow, since the VM has
  only the basic display adapter. Both need a real Windows 11 check.

## As built: phase 5, accent only (2026-10-25)

- `windows_accent.rs` reads `Explorer\Accent\AccentPalette` (eight RGBA
  shades), and `frame.accentPalette` passes it on. `WindowsTitleBar` sets
  `--system-accent-light3` … `--system-accent-dark3` on the root, at start and
  whenever the window regains focus.
- The Windows tokens use dark 1 (light theme) and light 2 (dark theme), as
  WinUI does, falling back to the default blue.
- Mica is not done: it needs a transparent window and webview with every
  surface above it transparent where Mica should show, which wants a check
  on a real Windows 11 machine first. The title bar keeps a solid
  `--bg-titlebar`.

## Verification

- Now: the web build in Chromium, the engine WebView2 uses. In a dev build
  `?desktop-os=windows` sets `data-desktop-os="windows"` on web, so the
  Windows styles apply. This checks layout, tokens, light/dark and keyboard
  behaviour; not Segoe UI metrics, the title bar, Mica or the system accent.
- CI: the `Windows screenshots` workflow (see phase 6 above). Runners are
  Windows Server 2025, which shares the Windows 11 24H2 shell, Snap Layouts
  included, but has no GPU.
- Still to check on a real machine (or a short-lived VM with a GPU): rounded
  corners and the shadow, the Snap Layouts flyout's theme, dragging and
  double-clicking the title bar, Alt+Space, Mica.
- Tests: e2e for menu keyboard access, plus the existing suites (see
  `native-macos-look.md`, "Verification per phase").
