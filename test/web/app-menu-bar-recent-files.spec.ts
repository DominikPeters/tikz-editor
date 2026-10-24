/** @vitest-environment jsdom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AppMenuDefinition } from "../../packages/app/src/app-menu";
import { APP_MENU_COMMAND_IDS } from "../../packages/app/src/app-menu";
import { AppMenuBar } from "../../packages/app/src/ui/AppMenuBar";

// The in-app menu bar (Windows desktop) builds File › Open Recent from the
// platform's recent files, as the native menu does elsewhere.
const DEFINITION: AppMenuDefinition = [{
  id: "file",
  label: "File",
  items: [
    { kind: "command", commandId: APP_MENU_COMMAND_IDS.NEW_DOCUMENT, label: "New" },
    { kind: "recent-files", label: "Open Recent" }
  ]
}];

let root: Root;
let container: HTMLDivElement;

function button(text: string): HTMLElement {
  const match = Array.from(container.querySelectorAll<HTMLElement>("[data-menu-item], [data-menu-trigger]"))
    .find((element) => element.textContent?.includes(text));
  if (!match) throw new Error(`No menu entry "${text}"`);
  return match;
}

async function render(recentFiles: { list: () => Promise<readonly string[]>; open: (path: string) => void; clear: () => Promise<void> }) {
  await act(async () => {
    root.render(React.createElement(AppMenuBar, {
      definition: DEFINITION,
      bindings: { [APP_MENU_COMMAND_IDS.NEW_DOCUMENT]: { enabled: true, run: () => undefined } },
      recentFiles,
      keyboardAccess: true
    }));
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.unstubAllGlobals();
});

it("lists recent files by name, opens one and clears the list", async () => {
  let files = ["C:\\Users\\me\\figures\\cube.tikz", "/home/me/graph.tex"];
  const open = vi.fn();
  const clear = vi.fn(async () => { files = []; });
  await render({ list: async () => files, open, clear });

  await act(async () => { button("File").click(); });
  expect(button("cube.tikz")).toBeTruthy();
  expect(button("graph.tex")).toBeTruthy();

  await act(async () => { button("cube.tikz").click(); });
  expect(open).toHaveBeenCalledWith("C:\\Users\\me\\figures\\cube.tikz");
  expect(container.querySelector("[data-menu-popup]")).toBeNull();

  await act(async () => { button("File").click(); });
  await act(async () => { button("Clear Open Recent").click(); });
  expect(clear).toHaveBeenCalledOnce();

  await act(async () => { button("File").click(); });
  expect(button("No Recent Files").getAttribute("aria-disabled")).toBe("true");
});
