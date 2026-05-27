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
