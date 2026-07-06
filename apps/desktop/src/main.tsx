import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { setActiveEditorPlatform } from "@tikz-editor/app/platform/current";
import { createDesktopPlatformAdapter } from "./platform/desktop-platform";

async function bootstrap() {
  setActiveEditorPlatform(createDesktopPlatformAdapter());
  const { App } = await import("@tikz-editor/app");

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

void bootstrap();
