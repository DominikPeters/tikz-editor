import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/editor/" : "/",
  plugins: [react()],
  resolve: {
    alias: {
      "@tikz-editor/app/landing-assets": new URL("../../packages/app/src/landing-assets.ts", import.meta.url).pathname,
      "@tikz-editor/app": new URL("../../packages/app/src/index.ts", import.meta.url).pathname,
      "@tikz-editor/lang-tikz": new URL("../../packages/lang-tikz/src/index.ts", import.meta.url).pathname,
      "@tikz-editor/lezer-tikz": new URL("../../packages/lezer-tikz/src/index.ts", import.meta.url).pathname,
      "tikz-editor": new URL("../../packages/core/src", import.meta.url).pathname
    }
  }
}));
