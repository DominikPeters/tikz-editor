# Desktop Shell (Tauri v2)

This package hosts the desktop shell for TikZ Editor using Tauri v2.

## Scripts

- `npm run -w @tikz-editor/desktop dev` runs the Vite frontend on port 1420.
- `npm run dev:desktop` (from the repository root) runs the full Tauri desktop app
  with an optimized Rust release build and Vite live refresh. The first launch
  compiles release dependencies; subsequent frontend edits still refresh immediately.
- `npm run -w @tikz-editor/desktop tauri:dev` runs the desktop app with a Rust
  debug build when native debugging is needed.
- `npm run -w @tikz-editor/desktop tauri:build` creates desktop bundles.
- `npm run -w @tikz-editor/desktop test:e2e` runs real desktop e2e against a built binary (requires `tauri-driver` in PATH).

CI runs native desktop tests on Linux and Windows for pushes to `master` and pull
requests. The Windows job runs Rust tests, builds unsigned NSIS and MSI installers,
and runs the existing desktop WebDriver scenarios using a matching Microsoft Edge
Driver. Signing credentials are only used by the separate release workflows.

For local Windows e2e runs, install `tauri-driver` and put `msedgedriver.exe` in
PATH, or set `NATIVE_WEBDRIVER_PATH` to its full path. Its version must match the
installed WebView2 runtime. macOS is not supported by this test runner.

## Portable Windows edition

On Windows x64, run:

```sh
npm run -w @tikz-editor/desktop tauri:build:portable
powershell -NoProfile -File apps/desktop/scripts/package-portable.ps1
```

The ZIP appears in `apps/desktop/src-tauri/target/portable/`. The build uses the
same `target/release/tikz-editor.exe` path as the installed edition; package it
before building another flavor. Release signing stages each flavor separately.

The portable identity and storage override are embedded in the executable via
`tauri.portable.conf.json`. No marker file or pre-existing data folder is needed.
The app creates `tikz-editor-data` beside itself and reports an error if that
folder is not writable. Tauri's directory override covers the WebView2 profile,
preferences, workspace/recovery storage, recent files, assistant caches and logs.
Portable update-check preferences use a JSON file in that folder rather than the
installed edition's Windows registry value. The distinct app identifier allows
installed and portable copies to run together with independent profiles.

Update checks use the normal release metadata, but the portable update dialog
opens the matching x64 portable ZIP in the browser. It never calls the installer
or relaunches the app to update. Users close the app, replace program files, and
keep `tikz-editor-data`; archives never contain user settings. Normal temporary
files may use the host's temporary directory. External TeX/Codex installations
remain optional host dependencies. The shared Evergreen WebView2 runtime is
required and is not included in the ZIP.

Push CI builds both flavors and tests the portable ZIP after extracting it to a
folder with spaces, including profile/preferences persistence after restarting.
It first launches the portable executable without WebDriver to verify that the
app creates its own profile beside the executable. The WebDriver sessions then
explicitly reuse that data folder: EdgeDriver otherwise overrides the app's
profile with a [temporary directory for every session](https://learn.microsoft.com/en-us/microsoft-edge/webdriver/capabilities-edge-options#webviewoptions-object).
The release and SignPath test workflows sign the portable executable separately
and include its ZIP alongside the installers. CI artifacts are unsigned.
