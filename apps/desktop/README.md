# Desktop Shell (Tauri v2)

This package hosts the desktop shell for TikZ Editor using Tauri v2.

## Scripts

- `npm run -w @tikz-editor/desktop dev` runs the Vite frontend on port 1420.
- `npm run -w @tikz-editor/desktop tauri:dev` runs the full Tauri desktop app.
- `npm run -w @tikz-editor/desktop tauri:build` creates desktop bundles.
- `npm run -w @tikz-editor/desktop test:e2e` runs real desktop e2e against a built binary (requires `tauri-driver` in PATH).

CI runs native desktop tests on Linux and Windows for pushes to `master` and pull
requests. The Windows job runs Rust tests, builds unsigned NSIS and MSI installers,
and runs the existing desktop WebDriver scenarios using a matching Microsoft Edge
Driver. Signing credentials are only used by the separate release workflows.

For local Windows e2e runs, install `tauri-driver` and put `msedgedriver.exe` in
PATH, or set `NATIVE_WEBDRIVER_PATH` to its full path. Its version must match the
installed WebView2 runtime. macOS is not supported by this test runner.
