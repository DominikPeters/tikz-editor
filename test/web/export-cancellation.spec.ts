/** @vitest-environment jsdom */
import { Blob as NodeBlob } from "node:buffer";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("jspdf", () => ({ jsPDF: class {
  async svg() {}
  output() { return new Blob(["PDF"], { type: "application/pdf" }); }
} }));
vi.mock("svg2pdf.js", () => ({}));
vi.mock("../../packages/app/src/ui/SvgCodeEditor", () => ({ SvgCodeEditor: () => null }));

import { createDesktopPlatformAdapter } from "../../apps/desktop/src/platform/adapter";
import type { DesktopBridge } from "../../apps/desktop/src/platform/bridge";
import { getActiveEditorPlatform, setActiveEditorPlatform } from "../../packages/app/src/platform/current";
import { renderTikzToSvg } from "../../packages/core/src/render/index";
import { downloadSvgMarkup, exportSvgDownload, exportPngDownload, exportPdfDownload, exportStandaloneLatexDownload } from "../../packages/app/src/ui/export-commands";
import { dismissUiNotification, getUiNotificationSnapshot } from "../../packages/app/src/ui/ui-notifications";
import { SvgExportModal } from "../../packages/app/src/ui/SvgExportModal";
import { PngExportModal } from "../../packages/app/src/ui/PngExportModal";

const SOURCE = String.raw`\begin{tikzpicture}\draw (0,0) -- (1,1);\end{tikzpicture}`;
const svg = renderTikzToSvg(SOURCE).svg;
let previousPlatform: ReturnType<typeof getActiveEditorPlatform>;
let root: Root | undefined;
let click: ReturnType<typeof vi.spyOn>;
const originalDialogMethods = ["showModal", "close"].map((name) => [name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)] as const);

beforeEach(() => {
  previousPlatform = getActiveEditorPlatform();
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:export"), revokeObjectURL: vi.fn() });
  vi.stubGlobal("Image", class {
    onload: (() => void) | null = null;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    clearRect() {}, fillRect() {}, drawImage() {}
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob(["PNG"], { type: "image/png" })));
  click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.open = false; } });
  dismissUiNotification();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  setActiveEditorPlatform(previousPlatform);
  dismissUiNotification();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const [name, descriptor] of originalDialogMethods) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
  document.body.replaceChildren();
});

function installNativeExport(saved: boolean, failure?: Error) {
  const exportFile = vi.fn(async () => {
    if (failure) throw failure;
    return saved;
  });
  setActiveEditorPlatform(createDesktopPlatformAdapter({ storage: { getItem: () => null, setItem() {} },
    bridge: {
      exportFile,
      onWindowCloseRequest: async () => () => {},
      onContextMenuCommand: async () => () => {},
      onPendingOpenRequestsChanged: async () => () => {},
      takePendingOpenRequests: async () => [],
      takePendingOpenFailures: async () => []
    } as unknown as DesktopBridge }));
  return exportFile;
}

const commands = [
  ["SVG", () => downloadSvgMarkup(svg.svg)],
  ["PNG", () => exportPngDownload(svg)],
  ["PDF", () => exportPdfDownload(svg)],
  ["LaTeX", () => exportStandaloneLatexDownload(SOURCE, null)]
] as const;

describe("platform export results", () => {
  for (const [name, exportCommand] of commands) {
    it(`keeps native ${name} cancellation quiet and returns false`, async () => {
      const native = installNativeExport(false);
      expect(await exportCommand()).toBe(false);
      expect(native).toHaveBeenCalledOnce();
      expect(click).not.toHaveBeenCalled();
      expect(getUiNotificationSnapshot()).toBeNull();
    });

    it(`returns native ${name} success without a second download`, async () => {
      const native = installNativeExport(true);
      expect(await exportCommand()).toBe(true);
      expect(native).toHaveBeenCalledOnce();
      expect(click).not.toHaveBeenCalled();
    });

    it(`retains the browser ${name} download when no exporter exists`, async () => {
      setActiveEditorPlatform({ id: "fallback", persistence: { load: () => null, save() {} } });
      expect(await exportCommand()).toBe(true);
      expect(click).toHaveBeenCalledOnce();
    });

    it(`reports native ${name} failures without a second download`, async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const native = installNativeExport(false, new Error("Disk full"));
      expect(await exportCommand()).toBe(false);
      expect(native).toHaveBeenCalledOnce();
      expect(click).not.toHaveBeenCalled();
      expect(getUiNotificationSnapshot()).toMatchObject({ kind: "error" });
    });
  }

  it("routes rendered SVG to the native exporter even without browser URL support", async () => {
    const native = installNativeExport(false);
    vi.stubGlobal("URL", {});
    expect(await exportSvgDownload(svg)).toBe(false);
    expect(native).toHaveBeenCalledOnce();
    expect(click).not.toHaveBeenCalled();
    expect(getUiNotificationSnapshot()).toBeNull();
  });
});

describe("export modal completion contract", () => {
  for (const [name, component] of [["svg", SvgExportModal], ["png", PngExportModal]] as const) {
    for (const saved of [false, true]) {
      it(`${name} modal closes ${saved ? "on success" : "only on success, retaining cancellation"}`, async () => {
        const native = installNativeExport(saved);
        const onClose = vi.fn();
        const host = document.createElement("div");
        document.body.appendChild(host);
        root = createRoot(host);
        await act(async () => {
          root!.render(createElement(component, { svgResult: svg, onClose }));
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
        const button = host.querySelector<HTMLButtonElement>(`[data-testid="${name}-export-download"]`)!;
        expect(button.disabled).toBe(false);
        await act(async () => {
          button.click();
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(native).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalledTimes(saved ? 1 : 0);
        expect(button.disabled).toBe(false);
        expect(click).not.toHaveBeenCalled();
        expect(getUiNotificationSnapshot()).toBeNull();
      });
    }
  }
});
