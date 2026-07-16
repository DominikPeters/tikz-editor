import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { setActiveEditorPlatform } from "@tikz-editor/app/platform/current";
import { createBrowserPlatformAdapter } from "./platform/browser-platform";

async function bootstrap() {
  setActiveEditorPlatform(createBrowserPlatformAdapter());
  const { App } = await import("@tikz-editor/app");

  // Test builds (VITE_TEST_ADDONS=1, set by the e2e web server) statically
  // register the in-repo smiley test add-on so e2e can exercise the add-on
  // pipeline. Dead-code-eliminated from ordinary builds.
  const addons =
    import.meta.env.VITE_TEST_ADDONS === "1"
      ? [(await import("../../../test/helpers/smiley-addon")).createSmileyAddon()]
      : undefined;

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App addons={addons} />
    </StrictMode>
  );
}

void bootstrap();
