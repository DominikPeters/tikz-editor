import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { setActiveEditorPlatform } from "@tikz-editor/app/platform/current";
import { createBrowserPlatformAdapter } from "./platform/browser-platform";

async function bootstrap() {
  setActiveEditorPlatform(createBrowserPlatformAdapter());
  const { App } = await import("@tikz-editor/app");

  const root = document.getElementById("root");
if (!root) throw new Error("Missing app root element");
createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

void bootstrap();
