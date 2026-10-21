import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { setActiveEditorPlatform } from "@tikz-editor/app/platform/current";
import { createDesktopPlatformAdapter } from "./platform/desktop-platform";
import { createDesktopPresentationWindowPlatform } from "./platform/presentation";

async function bootstrap() {
  const role = new URLSearchParams(window.location.search).get("presentation");
  const identify = new URLSearchParams(window.location.search).has("identify-display");
  setActiveEditorPlatform(role === "audience" || role === "presenter" || identify ? createDesktopPresentationWindowPlatform() : createDesktopPlatformAdapter());
  const { App } = await import("@tikz-editor/app");

  const root = document.getElementById("root");
if (!root) throw new Error("Missing app root element");
createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

void bootstrap().catch((error: unknown) => {
  console.error("[tikz-editor] App startup failed", error);
  const root = document.getElementById("root");
  if (!root) return;
  const message = document.createElement("main");
  message.setAttribute("role", "alert");
  message.style.cssText = "padding:24px;font:14px system-ui";
  const heading = document.createElement("h1");
  heading.textContent = "The editor couldn’t start";
  const detail = document.createElement("p");
  detail.textContent = error instanceof Error ? error.message : String(error);
  const reload = document.createElement("button");
  reload.textContent = "Reload";
  reload.addEventListener("click", () => { location.reload(); });
  message.append(heading, detail, reload);
  root.replaceChildren(message);
});
