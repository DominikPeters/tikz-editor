/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserPlatformAdapter } from "../apps/web/src/platform/browser-platform";

const storage = { getItem: () => null, setItem() {} };

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

for (const kind of ["openText", "openBinary"] as const) {
  describe(`browser ${kind} picker lifecycle`, () => {
    const open = () => createBrowserPlatformAdapter({ storage, fsApi: {} }).files![kind]!();

    it("settles repeated cancellations and removes each input", async () => {
      const inputs: HTMLInputElement[] = [];
      vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) {
        inputs.push(this);
        this.dispatchEvent(new Event("cancel"));
        this.dispatchEvent(new Event("change"));
      });
      for (let i = 0; i < 3; i += 1) {
        expect(await open()).toBeNull();
      }
      expect(inputs).toHaveLength(3);
      expect(inputs.every((input) => !input.isConnected)).toBe(true);
      expect(document.querySelector('input[type="file"]')).toBeNull();
    });

    it("settles an empty change", async () => {
      vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) {
        this.dispatchEvent(new Event("change"));
      });
      expect(await open()).toBeNull();
      expect(document.querySelector('input[type="file"]')).toBeNull();
    });

    it("reads a selection once and ignores later cancel/change events", async () => {
      const bytes = new Uint8Array([1, 2, 3]).buffer;
      const text = vi.fn(async () => "selected source");
      const arrayBuffer = vi.fn(async () => bytes);
      vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) {
        Object.defineProperty(this, "files", { value: [{ name: "selected.dat", text, arrayBuffer }] });
        this.dispatchEvent(new Event("change"));
        this.dispatchEvent(new Event("change"));
        this.dispatchEvent(new Event("cancel"));
        expect(this.isConnected).toBe(false);
      });
      expect(await open()).toEqual({
        ...(kind === "openText" ? { source: "selected source" } : { bytes }),
        fileRef: { kind: "file", name: "selected.dat", provider: "download" }
      });
      expect(kind === "openText" ? text : arrayBuffer).toHaveBeenCalledOnce();
      expect(kind === "openText" ? arrayBuffer : text).not.toHaveBeenCalled();
    });

    it("settles a rejected file read and removes the input", async () => {
      const read = vi.fn(async () => { throw new Error("Cannot read selected file"); });
      const info = vi.spyOn(console, "info").mockImplementation(() => {});
      vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) {
        Object.defineProperty(this, "files", { value: [{ name: "broken.dat", text: read, arrayBuffer: read }] });
        this.dispatchEvent(new Event("change"));
      });
      expect(await open()).toBeNull();
      expect(read).toHaveBeenCalledOnce();
      expect(document.querySelector('input[type="file"]')).toBeNull();
      expect(info).toHaveBeenCalledWith("[tikz-editor] Browser file input read failed.", expect.any(Error));
    });

    it("settles a picker activation failure and removes the input", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => { throw new Error("Picker unavailable"); });
      expect(await open()).toBeNull();
      expect(document.querySelector('input[type="file"]')).toBeNull();
    });

    it("keeps FSA cancellation quiet without opening a second picker", async () => {
      const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
      const info = vi.spyOn(console, "info").mockImplementation(() => {});
      const adapter = createBrowserPlatformAdapter({ storage, fsApi: {
        showOpenFilePicker: async () => { throw new DOMException("Cancelled", "AbortError"); }
      } });
      expect(await adapter.files![kind]!()).toBeNull();
      expect(click).not.toHaveBeenCalled();
      expect(info).not.toHaveBeenCalled();
    });

    it("does not re-prompt for an empty FSA selection", async () => {
      const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
      const adapter = createBrowserPlatformAdapter({ storage, fsApi: { showOpenFilePicker: async () => [] } });
      expect(await adapter.files![kind]!()).toBeNull();
      expect(click).not.toHaveBeenCalled();
    });

    it("preserves the input fallback for an unsupported FSA call", async () => {
      vi.spyOn(console, "info").mockImplementation(() => {});
      const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) {
        this.dispatchEvent(new Event("cancel"));
      });
      const adapter = createBrowserPlatformAdapter({ storage, fsApi: {
        showOpenFilePicker: async () => { throw new DOMException("Unsupported", "NotSupportedError"); }
      } });
      expect(await adapter.files![kind]!()).toBeNull();
      expect(click).toHaveBeenCalledOnce();
    });

    it("uses the FSA selection without opening an input", async () => {
      const bytes = new Uint8Array([4, 5]).buffer;
      const handle = { name: "fsa.dat", getFile: async () => ({ text: async () => "FSA source", arrayBuffer: async () => bytes }) };
      const savedHandle = vi.fn(async () => {});
      const click = vi.spyOn(HTMLInputElement.prototype, "click");
      const adapter = createBrowserPlatformAdapter({ storage, fsApi: {
        showOpenFilePicker: async () => [handle]
      }, fsHandleStore: { load: async () => null, save: savedHandle } });
      const result = await adapter.files![kind]!();
      expect(result).toMatchObject({
        ...(kind === "openText" ? { source: "FSA source" } : { bytes }),
        fileRef: { name: "fsa.dat", provider: kind === "openText" ? "browser-fsa" : "download" }
      });
      expect(click).not.toHaveBeenCalled();
      expect(savedHandle).toHaveBeenCalledTimes(kind === "openText" ? 1 : 0);
    });
  });
}
