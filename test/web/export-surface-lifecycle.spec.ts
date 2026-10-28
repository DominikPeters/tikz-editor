import { afterEach, expect, it, vi } from "vitest";
import { renderTikzToSvg } from "../../packages/core/src/render/index.js";
import { renderPngExport } from "../../packages/app/src/ui/export-commands.js";

afterEach(() => { vi.unstubAllGlobals(); });

it.each(["success", "context", "decode", "draw", "encode"] as const)("releases the PNG scratch surface after %s", async (phase) => {
  const svg = renderTikzToSvg(String.raw`\begin{tikzpicture}\draw (0,0) rectangle (4,3);\end{tikzpicture}`).svg;
  let encodedSize: number[] = [];
  const canvas = { width: 0, height: 0,
    getContext: () => phase === "context" ? null : {
      clearRect() {}, fillRect() {},
      drawImage() { if (phase === "draw") throw new Error("draw failed"); }
    },
    toBlob(callback: (blob: Blob | null) => void) {
      encodedSize = [canvas.width, canvas.height];
      callback(phase === "encode" ? null : new Blob(["PNG"], { type: "image/png" }));
    }
  };
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("document", { createElement: () => canvas });
  vi.stubGlobal("URL", { createObjectURL: () => "blob:scratch", revokeObjectURL });
  vi.stubGlobal("Image", class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) { queueMicrotask(() => phase === "decode" ? this.onerror?.() : this.onload?.()); }
  });

  if (phase === "success") {
    const result = await renderPngExport(svg, { dpi: 288 });
    expect(encodedSize).toEqual([result.pixelWidth, result.pixelHeight]);
    expect(result.blob.type).toBe("image/png");
    expect(result.pixelWidth).toBeGreaterThan(0);
  } else {
    await expect(renderPngExport(svg)).rejects.toThrow();
  }
  expect([canvas.width, canvas.height]).toEqual([0, 0]);
  expect(revokeObjectURL).toHaveBeenCalledTimes(phase === "context" ? 0 : 1);
});
