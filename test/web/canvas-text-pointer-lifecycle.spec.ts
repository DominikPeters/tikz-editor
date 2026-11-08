/** @vitest-environment jsdom */

import React, { act, type ClipboardEvent as ReactClipboardEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getKnuthPlassCaretFromPoint, type CaretHitResult } from "../../packages/core/src/text/knuth-plass";
import { documentSourceOffset } from "../../packages/core/src/text/source-coordinates";
import { makeEmptySnapshot } from "../../packages/app/src/compute";
import {
  useCanvasTextEditSession,
  type CanvasTextEditSessionController,
  type UseCanvasTextEditSessionArgs
} from "../../packages/app/src/ui/canvas-panel/useCanvasTextEditSession";
import type { EditableTextTarget } from "../../packages/app/src/ui/canvas-panel/types";

type HitRequest = () => Promise<CaretHitResult<"document">>;
const { caretFromPoint } = vi.hoisted(() => ({ caretFromPoint: vi.fn<HitRequest>() }));

vi.mock("../../packages/core/src/text/knuth-plass", async importOriginal => ({
  ...await importOriginal<typeof import("../../packages/core/src/text/knuth-plass")>(),
  getKnuthPlassCaretFromPoint: caretFromPoint
}));
// Hit-map requests are controlled below; overlay rendering is independent.
vi.mock("../../packages/app/src/ui/canvas-panel/useCanvasTextEditingEffects", () => ({
  useCanvasTextEditingEffects: () => {}
}));

function deferredHit() {
  let resolve!: (result: CaretHitResult<"document">) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<CaretHitResult<"document">>((finish, fail) => { resolve = finish; reject = fail; });
  return { promise, resolve: (offset: number) => resolve(hitResult(offset)), reject };
}

function hitResult(offset: number): CaretHitResult<"document"> {
  return { ok: true, offset: documentSourceOffset(offset), paragraphId: "paragraph", error: null, lineIndex: 0, kind: "text" };
}

describe("canvas text pointer request ownership", () => {
  let root: Root, controller: CanvasTextEditSessionController, surface: SVGSVGElement;
  let args: UseCanvasTextEditSessionArgs;
  const capture = vi.fn();
  const target = {
    sourceId: "node:0", sceneTextId: "text:0", sourceSpan: { from: 0, to: 6 }, text: "abcdef",
    renderSourceText: "abcdef", usesTex: true, paragraphId: "paragraph", layoutKind: "explicit-multiline",
    style: { fontSize: 12, fontStyle: "normal", fontWeight: "normal", fontFamily: "serif", textAlign: "left" },
    totalWidth: 60,
    region: { key: "region", shape: "rect", sourceId: "node:0", targetId: "node:0", sceneTextId: "text:0",
      interactionMode: "text", x: 0, y: 0, width: 60, height: 20, cx: 30, cy: 10,
      rotation: 0, contentWidth: 60, contentHeight: 20, transform: null }
  } as unknown as EditableTextTarget;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    caretFromPoint.mockReset().mockResolvedValue(hitResult(0)); capture.mockReset();
    const host = document.createElement("div");
    host.innerHTML = '<svg><g data-paragraph-id="paragraph"></g></svg>';
    surface = host.querySelector("svg")!;
    Object.defineProperty(surface, "setPointerCapture", { value: capture });
    document.body.append(host);
    args = {
      contextKey: "document:root", source: "abcdef", sourceRevision: 0, snapshot: makeEmptySnapshot("abcdef"),
      toolMode: "select", selectedElementIds: new Set([target.sourceId]),
      canvasTransform: { scale: 1, translateX: 0, translateY: 0 }, svgResult: null,
      viewportSize: { width: 800, height: 600 }, sourceBoundsSvg: new Map(),
      viewportRef: { current: host }, interactionSvgRef: { current: surface }, svgLayerHostRef: { current: host },
      suppressNextBackgroundClickRef: { current: false }, resolveEditableTextTargetById: () => target,
      resolveDeckCaretDomain: () => null, deckCaretLayout: {}, textLayoutContext: {}, textEditPlacement: "popup",
      dispatch: () => {}
    };
    function Harness() { controller = useCanvasTextEditSession(args); return null; }
    root = createRoot(host.appendChild(document.createElement("div")));
    act(() => { root.render(React.createElement(Harness)); });
  });
  afterEach(() => {
    act(() => { root.unmount(); }); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  });

  function down() {
    controller.beginCanvasTextInteraction({
      shiftKey: false, ctrlKey: false, metaKey: false, button: 0, detail: 1, pointerId: 1,
      clientX: 0, clientY: 0, currentTarget: surface, preventDefault() {}
    } as unknown as ReactPointerEvent<SVGElement>, target);
  }
  function pointer(type: string) {
    const event = new Event(type);
    Object.assign(event, { pointerId: 1, pointerType: "mouse", buttons: type === "pointerup" ? 0 : 1, clientX: 20, clientY: 0 });
    window.dispatchEvent(event);
  }

  it("keeps the newest drag sample if hit maps resolve out of order", async () => {
    const start = deferredHit(), older = deferredHit(), newer = deferredHit();
    caretFromPoint.mockReturnValueOnce(start.promise).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    await act(async () => { down(); start.resolve(1); });
    act(() => { pointer("pointermove"); pointer("pointermove"); });
    await act(async () => { newer.resolve(5); });
    expect(controller.textEditingSession?.selectionEnd).toBe(5);
    await act(async () => { older.resolve(3); });
    expect(controller.textEditingSession?.selectionEnd).toBe(5);
  });

  it.each([
    [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]
  ])("keeps the last requested position for hit-map completion order %i, %i, %i", async (a, b, c) => {
    const start = deferredHit(), moves = [deferredHit(), deferredHit(), deferredHit()];
    caretFromPoint.mockReturnValueOnce(start.promise);
    for (const move of moves) caretFromPoint.mockReturnValueOnce(move.promise);
    await act(async () => { down(); start.resolve(1); });
    act(() => { pointer("pointermove"); pointer("pointermove"); pointer("pointermove"); });
    for (const index of [a, b, c]) await act(async () => { moves[index].resolve(index + 3); });
    expect(controller.textEditingSession?.selectionStart).toBe(1);
    expect(controller.textEditingSession?.selectionEnd).toBe(5);
  });

  it("uses the resolved click anchor when a released drag's hit map finishes first", async () => {
    const start = deferredHit(), move = deferredHit();
    caretFromPoint.mockReturnValueOnce(start.promise).mockReturnValueOnce(move.promise);
    act(() => { down(); pointer("pointermove"); pointer("pointerup"); });
    await act(async () => { move.resolve(5); });
    await act(async () => { start.resolve(2); });
    expect(controller.textEditingSession?.selectionStart).toBe(2);
    expect(controller.textEditingSession?.selectionEnd).toBe(5);
    expect(capture).not.toHaveBeenCalled();
  });

  it("drops outstanding hits on pointer cancellation", async () => {
    const start = deferredHit(), move = deferredHit();
    caretFromPoint.mockReturnValueOnce(start.promise).mockReturnValueOnce(move.promise);
    act(() => { down(); pointer("pointermove"); pointer("pointercancel"); });
    await act(async () => { move.resolve(5); start.resolve(2); });
    expect(controller.textEditingSession?.selectionStart).toBe(0);
    expect(controller.textEditingSession?.selectionEnd).toBe(0);
    expect(capture).not.toHaveBeenCalled();
  });

  it("uses the current revision for two pointer starts before React renders", async () => {
    const older = deferredHit(), newer = deferredHit();
    caretFromPoint.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    act(() => { down(); down(); });
    await act(async () => { newer.resolve(4); older.resolve(2); });
    expect(controller.textEditingSession?.selectionStart).toBe(4);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it.each(["click", "drag"])("keeps the session usable after a rejected %s hit map", async kind => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const hit = deferredHit();
    if (kind === "click") {
      caretFromPoint.mockReturnValueOnce(hit.promise);
      act(() => { down(); });
    } else {
      await act(async () => { down(); });
      caretFromPoint.mockReturnValueOnce(hit.promise);
      act(() => { pointer("pointermove"); });
    }
    await act(async () => { hit.reject(new Error("Hit map failed")); });
    expect(controller.textEditingSession?.selectionStart).toBe(0);
    const next = deferredHit();
    caretFromPoint.mockReturnValueOnce(next.promise);
    await act(async () => { down(); next.resolve(3); });
    expect(controller.textEditingSession?.selectionStart).toBe(3);
  });

  it("does not let an old click rebind a newer gesture with the same pointer ID", async () => {
    const older = deferredHit(), newer = deferredHit(), move = deferredHit();
    caretFromPoint.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise).mockReturnValueOnce(move.promise);
    act(() => { down(); pointer("pointerup"); });
    await act(async () => { down(); newer.resolve(2); });
    await act(async () => { older.resolve(5); });
    await act(async () => { pointer("pointermove"); move.resolve(6); });
    expect(controller.textEditingSession?.selectionStart).toBe(2);
    expect(controller.textEditingSession?.selectionEnd).toBe(6);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("resolves a released click without recapturing its pointer", async () => {
    const hit = deferredHit();
    caretFromPoint.mockReturnValueOnce(hit.promise);
    act(() => { down(); pointer("pointerup"); });
    await act(async () => { hit.resolve(2); });
    expect(controller.textEditingSession?.selectionStart).toBe(2);
    expect(capture).not.toHaveBeenCalled();
  });

  it("retires pointer work when the session closes and is reopened programmatically", async () => {
    const old = deferredHit();
    caretFromPoint.mockReturnValueOnce(old.promise);
    act(() => { down(); });
    act(() => { controller.closeTextEditingSession(); controller.startTextEditingSession(target, 4, 4); });
    await act(async () => { old.resolve(2); });
    act(() => { pointer("pointermove"); });
    expect(getKnuthPlassCaretFromPoint).toHaveBeenCalledTimes(1);
    expect(controller.textEditingSession?.selectionStart).toBe(4);
    expect(capture).not.toHaveBeenCalled();
  });

  it.each(["close-and-reopen", "new-session", "pointer-start"])("drops queued edits across a %s boundary", async boundary => {
    const scopedTarget = { ...target, scopeParagraphs: [] };
    args.resolveDeckCaretDomain = () => ({ source: "stale layout", rows: [], offsets: [], atomSpans: [], lists: [], mathSpans: [], paragraphs: [] });
    act(() => { controller.startTextEditingSession(scopedTarget, 0, 0); });
    const input = document.createElement("textarea");
    const canvas = controller.view.canvasFocusInput!;
    act(() => {
      canvas.onKeyDown({
        nativeEvent: { isComposing: false }, currentTarget: input, key: "ArrowDown", repeat: false,
        shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, preventDefault() {}, stopPropagation() {}
      } as ReactKeyboardEvent<HTMLTextAreaElement>);
      canvas.onPaste({
        currentTarget: input, clipboardData: { getData: type => type === "text/plain" ? "QUEUED" : "" },
        preventDefault() {}, stopPropagation() {}
      } as ReactClipboardEvent<HTMLTextAreaElement>);
    });
    expect(controller.textEditingSession?.text).toBe("abcdef");
    await act(async () => {
      if (boundary === "close-and-reopen") controller.closeTextEditingSession();
      if (boundary === "pointer-start") down();
      else controller.startTextEditingSession(target, 4, 4);
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 250)); });
    expect(controller.textEditingSession?.text).toBe("abcdef");
  });
});
