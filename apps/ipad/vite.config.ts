import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { harfbuzzWasm } from "../harfbuzz-wasm-plugin";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), harfbuzzWasm()],
  publicDir: path.resolve(__dirname, "../../packages/app/public"),
  define: {
    "import.meta.env.TIKZ_EDITOR_VERSION": JSON.stringify(process.env.npm_package_version ?? "0.1.0")
  },
  resolve: {
    alias: {
      "@tikz-editor/core": path.resolve(__dirname, "../../packages/core/src"),
      "@tikz-editor/lang-tikz": path.resolve(__dirname, "../../packages/lang-tikz/src/index.ts"),
      "@tikz-editor/lezer-tex": path.resolve(__dirname, "../../packages/lezer-tex/src/index.ts"),
      "@tikz-editor/lezer-tikz": path.resolve(__dirname, "../../packages/lezer-tikz/src/index.ts")
    }
  },
  clearScreen: false,
  server: {
    host: host || false,
    port: 1422,
    strictPort: true,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1423
        }
      : undefined
  },
  envPrefix: ["VITE_", "TAURI_"],
  worker: {
    format: "es",
    // Workers draw runtime-font outlines with harfbuzzjs, which needs the same rewrite as the app.
    plugins: () => [harfbuzzWasm()],
    // As Vite sets for the app, so chunks shared with workers (font outlines) are emitted once.
    rollupOptions: { output: { generatedCode: "es2015" } }
  },
  optimizeDeps: {
    exclude: ["mathlive"]
  },
  build: {
    target: "safari16",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG
  }
});
