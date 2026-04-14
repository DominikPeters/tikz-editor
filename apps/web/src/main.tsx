import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { setActiveEditorPlatform } from "@tikz-editor/app/src/platform/current";
import { createBrowserPlatformAdapter } from "./platform/browser-platform";

async function bootstrap() {
  setActiveEditorPlatform(createBrowserPlatformAdapter());
  const { App } = await import("@tikz-editor/app/src/ui/App");
  const { EditorStoreProvider, defaultEditorStore } = await import("@tikz-editor/app/src/store/store");

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <EditorStoreProvider store={defaultEditorStore}>
        <App />
      </EditorStoreProvider>
    </StrictMode>
  );
}

void bootstrap();
