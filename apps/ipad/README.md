# TikZ Editor for iPad

This workspace contains the Tauri iOS/iPadOS shell for TikZ Editor.

The frontend reuses `@tikz-editor/app`; platform-specific code lives under
`apps/ipad/src` and native Tauri setup lives under `apps/ipad/src-tauri`.

Useful commands:

```sh
npm run -w @tikz-editor/ipad tauri:ios:init -- --ci --skip-targets-install
npm run -w @tikz-editor/ipad tauri:ios:dev
npm run -w @tikz-editor/ipad tauri:ios:dev:open
npm run -w @tikz-editor/ipad tauri:ios:build
```

For physical iPad development, Tauri sets `TAURI_DEV_HOST`; `vite.config.ts`
uses that value for the dev server host and HMR configuration.

## App Store packaging

The iPad Cargo manifest patches Wry 0.55.1 with a vendored copy. Its only source
change omits the private WKPreferences PiP key on iOS; see
`src-tauri/vendor/wry/LOCAL-PATCH.md`. PiP is not needed by this editor. Keep
release devtools, fullscreen, and transparent Wry features disabled unless audited.

`src-tauri/ios-project.yml` is the Tauri CLI 2.12.3 iOS template with
`TARGETED_DEVICE_FAMILY: "2"` added. `bundle.iOS.template` selects it so that
`tauri ios init` preserves iPad-only support. Keep it in sync when upgrading the
CLI. The checked-in generated Xcode project has the same setting.

The shared app's public/vendor/tikzjax directory contains the pinned complete
TikZJax runtime, including its worker, compressed WebAssembly/core, TeX packages,
and fonts. Its loader respects the shell's Vite base URL. See VENDORED.md there
for the package hash, source revision, update procedure, and GPL licensing caveat.

### Privacy manifest rationale

The checked-in `src-tauri/gen/apple/tikz-editor-ipad_iOS/PrivacyInfo.xcprivacy`
is copied into the app's resources by Xcode. It declares no tracking, tracking
domains, or collected data. Documents, preferences, bookmarks, and preview caches
stay on-device; exporting a document is an explicit user action.

File timestamp reasons:

- `C617.1`: filesystem metadata within the app's sandbox (including temporary
  save placeholders).
- `3B52.1`: metadata for documents the user grants access to through Files.
  The filesystem plugin's read/write paths can call stat/fstat on these files.

No UserDefaults or SystemBootTime category is added merely because the debug
archive contains those names. They are present in generated objc2 Foundation
bindings, but neither reference remains in the optimized iOS release library.
Its timer imports use clock_gettime, not mach_absolute_time/systemUptime. Re-audit
when native dependencies change; add only reasons matching actual API use.

Apple's categories and reasons:
https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype

Validation commands:

```sh
npm run -w @tikz-editor/ipad typecheck
npm run -w @tikz-editor/ipad build
npm run -w @tikz-editor/web test:e2e -- tikzjax-offline.spec.ts --workers=1
npm run -w @tikz-editor/ipad tauri -- ios build --target aarch64-sim --no-sign --archive-only --ci
```

Before submission, inspect a signed device archive too: UIDeviceFamily must be
`[2]`, the privacy manifest must be present, and the main executable must contain
no private PiP/devtools/fullscreen preference keys.
