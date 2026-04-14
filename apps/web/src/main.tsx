import { StrictMode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { setActiveEditorPlatform } from "@tikz-editor/app/src/platform/current";
import { createBrowserPlatformAdapter } from "./platform/browser-platform";

async function bootstrap() {
  setActiveEditorPlatform(createBrowserPlatformAdapter());
  const root = createRoot(document.getElementById("root")!);

  const params = new URLSearchParams(window.location.search);

  // Demo gallery: ?demos
  if (params.has("demos")) {
    await import("@tikz-editor/app/src/ui/DockLayout");
    const { DemoPlayer, ...demos } = await import("@tikz-editor/app/src/embed");
    const demoIds = listDemoIds(demos);
    const scripts = demoIds.map((id) => ({
      id,
      script: (demos as Record<string, unknown>)[demoScriptExportName(id)]
    }));
    root.render(
      <StrictMode>
        <DemoGallery demos={scripts as Array<{ id: string; script: any }>} DemoPlayer={DemoPlayer} />
      </StrictMode>
    );
    return;
  }

  // Single demo: ?demo=<id>
  const demoId = params.get("demo");
  if (demoId) {
    // Prime module-eval order to avoid a pre-existing circular import between
    // CanvasPanel → editor-command-runtime → DockLayout. Loading DockLayout
    // first matches the order used by the App entry path.
    await import("@tikz-editor/app/src/ui/DockLayout");
    const { DemoPlayer, ...demos } = await import("@tikz-editor/app/src/embed");
    const script = (demos as Record<string, unknown>)[demoScriptExportName(demoId)];
    if (!script) {
      root.render(<DemoNotFound demoId={demoId} available={listDemoIds(demos)} />);
      return;
    }
    root.render(
      <StrictMode>
        <div style={{ width: "100vw", height: "100vh", background: "#f5f5f5" }}>
          <DemoPlayer script={script as any} />
        </div>
      </StrictMode>
    );
    return;
  }

  const { App } = await import("@tikz-editor/app/src/ui/App");
  const { EditorStoreProvider, defaultEditorStore } = await import("@tikz-editor/app/src/store/store");

  root.render(
    <StrictMode>
      <EditorStoreProvider store={defaultEditorStore}>
        <App />
      </EditorStoreProvider>
    </StrictMode>
  );
}

function demoScriptExportName(demoId: string): string {
  // URL id -> camelCase export name, e.g. "drag-node" -> "dragNodeDemo"
  const camel = demoId.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
  return `${camel}Demo`;
}

function listDemoIds(demos: Record<string, unknown>): string[] {
  return Object.keys(demos)
    .filter((k) => k.endsWith("Demo"))
    .map((k) => k.replace(/Demo$/, "").replace(/([A-Z0-9])/g, "-$1").toLowerCase().replace(/^-/, ""));
}

// Wrapper that prevents the embedded canvas from capturing wheel events,
// allowing page scroll to work in the gallery view.
function DemoPreviewContainer({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      // Stop the event from reaching the canvas's wheel handler
      e.stopPropagation();
    };
    // Capture phase so we intercept before the canvas
    el.addEventListener("wheel", handler, { capture: true });
    return () => el.removeEventListener("wheel", handler, { capture: true });
  }, []);
  return (
    <div ref={ref} style={{ height: 280, background: "#f5f5f5", position: "relative" }}>
      {children}
    </div>
  );
}

function DemoNotFound({ demoId, available }: { demoId: string; available: string[] }) {
  return (
    <div style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>Demo &quot;{demoId}&quot; not found</h1>
      <p>Available demos:</p>
      <ul>
        {available.map((id) => (
          <li key={id}>
            <a href={`?demo=${id}`}>{id}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DemoGallery({
  demos,
  DemoPlayer
}: {
  demos: Array<{ id: string; script: any }>;
  DemoPlayer: React.ComponentType<{ script: any }>;
}) {
  // Neutralize body-level styles that the main editor sets.
  // - overflow: hidden is set in index.html for the main app
  // - drag cursor/select locks are set by CanvasPanel during drags
  // These break page scrolling when multiple demos run in the gallery.
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = `
      body {
        overflow: auto !important;
      }
      body.is-dragging-canvas-cursor-lock,
      body.is-dragging-canvas-cursor-lock *,
      body.is-scrubbing,
      body.is-scrubbing * {
        cursor: auto !important;
        user-select: auto !important;
      }
    `;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#1a1a1a",
        padding: 32,
        fontFamily: "system-ui",
        overflow: "auto"
      }}
    >
      <h1 style={{ color: "#fff", margin: "0 0 8px 0", fontSize: 28 }}>Demo Gallery</h1>
      <p style={{ color: "#888", margin: "0 0 24px 0" }}>
        {demos.length} demo{demos.length !== 1 ? "s" : ""} available.
        Click a card to view full-size.
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(400px, 1fr))",
          gap: 24
        }}
      >
        {demos.map(({ id, script }) => (
          <a
            key={id}
            href={`?demo=${id}`}
            style={{
              display: "block",
              background: "#fff",
              borderRadius: 8,
              overflow: "hidden",
              textDecoration: "none",
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
              transition: "transform 0.15s, box-shadow 0.15s"
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-2px)";
              e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,0.4)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "";
              e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.3)";
            }}
          >
            <DemoPreviewContainer>
              <DemoPlayer script={script} />
            </DemoPreviewContainer>
            <div style={{ padding: "12px 16px", borderTop: "1px solid #e0e0e0" }}>
              <div style={{ fontWeight: 600, color: "#333", fontSize: 14 }}>{id}</div>
              <div style={{ color: "#666", fontSize: 12, marginTop: 2 }}>
                {(script.duration / 1000).toFixed(1)}s loop
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

void bootstrap();
