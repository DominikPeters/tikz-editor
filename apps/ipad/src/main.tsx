import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { setActiveEditorPlatform } from "@tikz-editor/app/platform/current";
import { createIpadPlatformAdapter } from "./platform/ipad-platform";
import "./ipad.css";

async function bootstrap() {
  document.documentElement.dataset.editorPlatform = "ipad";
  document.documentElement.dataset.pointerProfile = "touch";
  setActiveEditorPlatform(createIpadPlatformAdapter());
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
