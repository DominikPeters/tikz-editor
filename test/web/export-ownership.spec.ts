/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmitSvgResult } from "../../packages/core/src/svg/types.js";

const commands = vi.hoisted(() => ({
  serializeSvgForExport: vi.fn(), preloadSvgOptimizer: vi.fn(), transformSvgMarkup: vi.fn(),
  copySvgText: vi.fn(), downloadSvgMarkup: vi.fn(), exportPngDownload: vi.fn(), renderPngExport: vi.fn()
}));
vi.mock("../../packages/app/src/ui/export-commands", () => ({ ...commands,
  validateSvgMarkup: () => ({ valid: true }), normalizePngExportDpi: (dpi: number | undefined) => dpi ?? 144
}));
vi.mock("../../packages/app/src/ui/SvgCodeEditor", async () => {
  const { createElement } = await import("react");
  return { SvgCodeEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) =>
    createElement("div", null, createElement("textarea", { "aria-label": "SVG code", value, readOnly: true }),
      createElement("button", { onClick: () => onChange("<svg>manual edit</svg>") }, "Edit markup")) };
});

import { SvgExportModal } from "../../packages/app/src/ui/SvgExportModal";
import { PngExportModal } from "../../packages/app/src/ui/PngExportModal";

const svg = (text: string): EmitSvgResult => ({ svg: `<svg>${text}</svg>`, diagnostics: [],
  viewBox: { x: 0, y: 0, width: 10, height: 10 },
  model: { viewBox: { x: 0, y: 0, width: 10, height: 10 }, defs: [], defsFingerprint: "empty", parts: [], diagnostics: [] }
});
const png = () => ({ blob: new Blob(["png"]), pixelWidth: 20, pixelHeight: 20, dpi: 144 });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};

describe("export async ownership", () => {
  let root: Root;
  let host: HTMLDivElement;
  const descriptors = ["showModal", "close"].map(name => [name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)] as const);
  beforeEach(() => {
    for (const mock of Object.values(commands)) mock.mockReset();
    commands.serializeSvgForExport.mockImplementation(async (value: EmitSvgResult) => value.svg);
    commands.preloadSvgOptimizer.mockResolvedValue(undefined);
    commands.renderPngExport.mockImplementation(async () => png());
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let nextUrl = 0;
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => `blob:preview-${++nextUrl}`), revokeObjectURL: vi.fn() });
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value(this: HTMLDialogElement) { this.open = true; } });
    Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value(this: HTMLDialogElement) { this.open = false; } });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
      else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
    }
    vi.unstubAllGlobals();
  });
  const render = async (component: typeof SvgExportModal | typeof PngExportModal, value: EmitSvgResult, onClose = vi.fn()) => {
    await act(async () => { root.render(createElement(component, { svgResult: value, onClose })); });
  };
  const click = async (selector: string) => {
    await act(async () => { host.querySelector<HTMLButtonElement>(selector)!.click(); });
  };

  it.each(["new render", "manual edit"])("discards an old SVG transform after a %s", async change => {
    const pending = deferred<string>();
    commands.transformSvgMarkup.mockReturnValue(pending.promise);
    await render(SvgExportModal, svg("original"));
    await act(async () => { [...host.querySelectorAll("button")].find(button => button.textContent === "Beautify")!.click(); });
    if (change === "new render") await render(SvgExportModal, svg("new render"));
    else await act(async () => { [...host.querySelectorAll("button")].find(button => button.textContent === "Edit markup")!.click(); });
    await act(async () => { pending.resolve("<svg>old transform</svg>"); });
    expect(host.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe(`<svg>${change}</svg>`);
    expect(host.querySelector<HTMLButtonElement>('[data-testid="svg-export-download"]')!.disabled).toBe(false);
  });

  it.each([["SVG", SvgExportModal, "svg", commands.downloadSvgMarkup], ["PNG", PngExportModal, "png", commands.exportPngDownload]] as const)(
    "does not close a reopened %s export when the old download completes", async (_, component, id, download) => {
      const pending = deferred<boolean>();
      download.mockReturnValue(pending.promise);
      const onClose = vi.fn();
      await render(component, svg("old"), onClose);
      await click(`[data-testid="${id}-export-download"]`);
      await act(async () => { root.render(null); });
      await render(component, svg("new"), onClose);
      await act(async () => { pending.resolve(true); });
      expect(onClose).not.toHaveBeenCalled();
    }
  );

  it.each([["SVG", SvgExportModal, "svg", commands.downloadSvgMarkup], ["PNG", PngExportModal, "png", commands.exportPngDownload]] as const)(
    "keeps a newer %s download pending when an obsolete one finishes", async (_, component, id, download) => {
      const old = deferred<boolean>();
      const current = deferred<boolean>();
      download.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
      const onClose = vi.fn();
      await render(component, svg("old"), onClose);
      await click(`[data-testid="${id}-export-download"]`);
      await render(component, svg("new"), onClose);
      await click(`[data-testid="${id}-export-download"]`);
      expect(download).toHaveBeenCalledTimes(2);
      await act(async () => { old.resolve(true); });
      expect(onClose).not.toHaveBeenCalled();
      expect(host.querySelector<HTMLButtonElement>(`[data-testid="${id}-export-download"]`)!.disabled).toBe(true);
      await act(async () => { current.resolve(true); });
      expect(onClose).toHaveBeenCalledOnce();
    }
  );

  it("keeps the previous PNG preview URL alive until its replacement is displayed", async () => {
    const pending = deferred<ReturnType<typeof png>>();
    commands.renderPngExport.mockImplementationOnce(async () => png()).mockReturnValueOnce(pending.promise);
    await render(PngExportModal, svg("old"));
    const oldUrl = host.querySelector("img")!.src;
    await render(PngExportModal, svg("new"));
    expect(host.querySelector("img")!.src).toBe(oldUrl);
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(oldUrl);
    await act(async () => { pending.resolve(png()); });
    const newUrl = host.querySelector("img")!.src;
    expect(newUrl).not.toBe(oldUrl);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(oldUrl);
    await act(async () => { root.render(null); });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(newUrl);
  });
});
