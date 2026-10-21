/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArxivPaperSession } from "../../packages/app/src/arxiv-source";
import { setActiveEditorPlatform } from "../../packages/app/src/platform/current";
import type { ArxivSourcePayload } from "../../packages/app/src/platform/types";
import { OpenFromArxivModal } from "../../packages/app/src/ui/OpenFromArxivModal";

const preview = vi.hoisted(() => vi.fn(async () => ({
  parse: { diagnostics: [] }, semantic: { diagnostics: [] }, renderDiagnostics: [],
  svg: { svg: '<svg viewBox="0 0 10 10"><path d="M0 0L10 10" /></svg>' }
})));
vi.mock("@tikz-editor/core/render/index", () => ({ renderTikzToSvgAsync: preview }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}
const paper = (id: string): ArxivSourcePayload => ({ id, files: [] });
const initialSession = (input = "current-id"): ArxivPaperSession => ({ input, paper: null, selectedCandidateId: null });
type PendingPaper = ReturnType<typeof deferred<ArxivSourcePayload>>;

describe("arXiv load ownership in the actual modal", () => {
  let host: HTMLDivElement;
  let root: Root;
  let session: ArxivPaperSession;
  let strict: boolean;
  let changes: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;
  let open: ReturnType<typeof vi.fn>;
  let fetch: ReturnType<typeof vi.fn<(id: string) => Promise<ArxivSourcePayload>>>;

  function element() {
    const modal = React.createElement(OpenFromArxivModal, {
      session,
      onSessionChange: (next) => { session = next; changes(next); root.render(element()); },
      onClose: close,
      onOpenCandidate: open
    });
    return strict ? React.createElement(React.StrictMode, null, modal) : modal;
  }
  async function mount(nextSession = initialSession(), strictMode = false) {
    session = nextSession;
    strict = strictMode;
    await act(async () => { root.render(element()); });
  }
  async function submit(count = 1) {
    await act(async () => {
      for (let index = 0; index < count; index += 1) {
        host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      }
    });
  }
  async function settle(pending: PendingPaper, outcome: "success" | "failure", id = "obsolete-id") {
    await act(async () => {
      if (outcome === "success") pending.resolve(paper(id));
      else pending.reject(new Error("obsolete request failed"));
    });
  }
  function input() { return host.querySelector<HTMLInputElement>("input")!; }
  async function dismiss(route: "header" | "cancel" | "escape" | "backdrop") {
    await act(async () => {
      if (route === "header") host.querySelector<HTMLButtonElement>('button[aria-label="Close arXiv dialog"]')!.click();
      else if (route === "cancel") Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Cancel")!.click();
      else if (route === "escape") host.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true }));
      else host.querySelector("dialog")!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    HTMLDialogElement.prototype.close = function () { this.open = false; };
    preview.mockClear();
    changes = vi.fn(); close = vi.fn(); open = vi.fn();
    fetch = vi.fn(async (id: string) => paper(id));
    setActiveEditorPlatform({ id: "test", persistence: { load: () => null, save() {} }, files: { fetchArxivSource: fetch } });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    vi.unstubAllGlobals();
  });

  it("publishes a current trimmed request and retains preview and candidate-opening behavior", async () => {
    const source = String.raw`\begin{tikzpicture}\draw (0,0)--(1,0);\end{tikzpicture}`;
    const loaded = { id: "current-id", files: [{ path: "main.tex", source, size: source.length }] };
    fetch.mockResolvedValueOnce(loaded);
    await mount(initialSession("  current-id  "));
    await submit();
    expect(fetch).toHaveBeenCalledWith("current-id");
    expect(changes).toHaveBeenCalledTimes(1);
    expect(session).toMatchObject({ input: "current-id", paper: loaded, selectedCandidateId: null });
    expect(input().disabled).toBe(false);
    expect(preview).toHaveBeenCalledWith(source, expect.objectContaining({ parse: { recover: true, includeContextDefinitions: true } }));
    expect(host.querySelector("img")?.getAttribute("src")).toContain("data:image/svg+xml");
    await act(async () => { Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Open Picture")!.click(); });
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ source, contextualSource: source }));
    expect(session.selectedCandidateId).toBe("main.tex:1:1");
  });

  it("shows a current failure, releases loading and permits a successful retry", async () => {
    fetch.mockRejectedValueOnce(new Error("current request failed"));
    await mount({ ...initialSession(), paper: paper("existing-id") });
    await submit();
    expect(host.textContent).toContain("current request failed");
    expect(input().disabled).toBe(false);
    expect(session.paper?.id).toBe("existing-id");
    expect(changes).not.toHaveBeenCalled();
    await submit();
    expect(host.textContent).not.toContain("current request failed");
    expect(input().disabled).toBe(false);
    expect(session.paper?.id).toBe("current-id");
    expect(changes).toHaveBeenCalledTimes(1);
  });

  it.each(["success", "failure"] as const)("ignores superseded %s while the newer request remains pending", async (outcome) => {
    const older = deferred<ArxivSourcePayload>(); const newer = deferred<ArxivSourcePayload>();
    fetch.mockImplementationOnce(() => older.promise).mockImplementationOnce(() => newer.promise);
    await mount(); await submit(2);
    expect(fetch).toHaveBeenCalledTimes(2);
    await settle(older, outcome);
    expect(changes).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("obsolete request failed");
    expect(input().disabled).toBe(true);
    await settle(newer, "success", "newer-id");
    expect(changes).toHaveBeenCalledTimes(1);
    expect(session.paper?.id).toBe("newer-id");
    expect(input().disabled).toBe(false);
  });

  it.each(["success", "failure"] as const)("ignores superseded %s after the newer request has completed", async (outcome) => {
    const older = deferred<ArxivSourcePayload>(); const newer = deferred<ArxivSourcePayload>();
    fetch.mockImplementationOnce(() => older.promise).mockImplementationOnce(() => newer.promise);
    await mount(); await submit(2);
    await settle(newer, "success", "newer-id");
    await settle(older, outcome);
    expect(changes).toHaveBeenCalledTimes(1);
    expect(session.paper?.id).toBe("newer-id");
    expect(host.textContent).not.toContain("obsolete request failed");
    expect(input().disabled).toBe(false);
  });

  it.each(["success", "failure"] as const)("retains the newer error after superseded %s", async (outcome) => {
    const older = deferred<ArxivSourcePayload>(); const newer = deferred<ArxivSourcePayload>();
    fetch.mockImplementationOnce(() => older.promise).mockImplementationOnce(() => newer.promise);
    await mount(); await submit(2);
    await act(async () => { newer.reject(new Error("newer request failed")); });
    await settle(older, outcome);
    expect(changes).not.toHaveBeenCalled();
    expect(session.paper).toBeNull();
    expect(host.textContent).toContain("newer request failed");
    expect(host.textContent).not.toContain("obsolete request failed");
    expect(input().disabled).toBe(false);
  });

  for (const route of ["header", "cancel", "escape", "backdrop"] as const) {
    it.each(["success", "failure"] as const)(`retires ${route} dismissal before parent unmount on stale %s`, async (outcome) => {
      const pending = deferred<ArxivSourcePayload>();
      fetch.mockReturnValueOnce(pending.promise);
      close.mockImplementation(() => {
        if (outcome === "success") pending.resolve(paper("dismissed-id"));
        else pending.reject(new Error("obsolete request failed"));
      });
      await mount(); await submit(); await dismiss(route);
      expect(close).toHaveBeenCalledTimes(1);
      expect(host.querySelector("dialog")).not.toBeNull(); // Parent intentionally delays unmount.
      expect(changes).not.toHaveBeenCalled();
      expect(session.paper).toBeNull();
      expect(host.textContent).not.toContain("obsolete request failed");
      await submit();
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  }

  it.each(["success", "failure"] as const)("keeps a newer StrictMode session after an unmounted request's late %s", async (outcome) => {
    const old = deferred<ArxivSourcePayload>();
    fetch.mockReturnValueOnce(old.promise);
    await mount(initialSession("old-id"), true); await submit();
    await act(async () => { root.render(null); });
    await mount(initialSession("new-id"), true); await submit();
    await settle(old, outcome, "old-id");
    expect(changes).toHaveBeenCalledTimes(1);
    expect(session.paper?.id).toBe("new-id");
    expect(host.textContent).not.toContain("obsolete request failed");
    expect(input().disabled).toBe(false);
  });

  it("accepts current success and failure after StrictMode's effect replay", async () => {
    fetch.mockRejectedValueOnce(new Error("live strict failure"));
    await mount(initialSession(), true); await submit();
    expect(host.textContent).toContain("live strict failure");
    expect(input().disabled).toBe(false);
    await submit();
    expect(changes).toHaveBeenCalledTimes(1);
    expect(session.paper?.id).toBe("current-id");
    expect(host.textContent).not.toContain("live strict failure");
  });
});
