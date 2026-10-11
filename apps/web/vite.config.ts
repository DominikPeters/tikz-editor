import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const profilingBuild = process.env.TIKZ_PROFILE_BUILD === "1";

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/editor/web/" : "/",
  plugins: [react()],
  publicDir: path.resolve(__dirname, "../../packages/app/public"),
  define: {
    "import.meta.env.TIKZ_EDITOR_VERSION": JSON.stringify(process.env.npm_package_version ?? "0.1.0")
  },
  worker: {
    format: "es",
    rollupOptions: {
      // As Vite sets for the app: chunks both bundles share (font outlines)
      // then come out identical, so the browser downloads each once.
      output: { generatedCode: "es2015" }
    }
  },
  build: {
    rollupOptions: {
      // Only keynote-clipboard's file reader (its CLI) imports this; left as written, the
      // browser never runs it, and no stub module joins the app's chunk.
      external: ["node:fs/promises"],
      output: {
        // Font metrics change rarely; their own chunk stays cached across app releases.
        // (Glyph outlines are already a lazily loaded chunk per font.)
        manualChunks: (id) => (id.includes("/packages/core/src/text/tex/fonts/data/computer-modern-ot1.generated.") ? "tex-fonts" : undefined)
      }
    }
  },
  optimizeDeps: {
    exclude: ["mathlive"]
  },
  resolve: {
    alias: {
      "@tikz-editor/core": path.resolve(__dirname, "../../packages/core/src"),
      "@tikz-editor/lang-tikz": path.resolve(__dirname, "../../packages/lang-tikz/src/index.ts"),
      "@tikz-editor/lezer-tex": path.resolve(__dirname, "../../packages/lezer-tex/src/index.ts"),
      "@tikz-editor/lezer-tikz": path.resolve(__dirname, "../../packages/lezer-tikz/src/index.ts"),
    },
  },
  esbuild: profilingBuild
    ? { minifyIdentifiers: false, keepNames: true }
    : undefined,
  // Content-Security-Policy should be configured at the production web server level:
  //   Content-Security-Policy: script-src 'self'
  // This blocks any inline event handlers that could be embedded in TikZ-generated SVG.
  // It is not set here because Vite's dev server injects inline scripts for React Refresh.
}));
