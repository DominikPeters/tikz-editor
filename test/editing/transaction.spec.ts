import { describe, expect, it } from "vitest";
import {
  applyPatches,
  applyTransaction,
  mapOffset,
  replacementPatches,
} from "../../packages/core/src/editing/transaction/index.js";
import {
  createIntentScheduler,
  intentFromBeforeInput,
  interpretKeyDown,
  type Intent,
  type KeyStroke,
} from "../../packages/core/src/editing/input/index.js";

describe("transaction patches", () => {
  const patches = [
    { from: 1, to: 3, insert: "XYZ" },
    { from: 5, to: 5, insert: "!" },
  ];

  it("apply in pre-edit coordinates", () => {
    expect(applyPatches("abcdefg", patches)).toBe("aXYZde!fg");
  });

  it("reject overlapping or unsorted patches", () => {
    expect(() => applyPatches("abcdef", [{ from: 2, to: 4, insert: "" }, { from: 3, to: 5, insert: "" }])).toThrow();
    expect(() => applyPatches("abcdef", [{ from: 4, to: 5, insert: "" }, { from: 1, to: 2, insert: "" }])).toThrow();
    expect(() => applyPatches("abc", [{ from: 2, to: 9, insert: "" }])).toThrow();
  });

  it("map positions with affinity", () => {
    // Before, after and between patches.
    expect(mapOffset(patches, 0, 1)).toBe(0);
    expect(mapOffset(patches, 4, -1)).toBe(5);
    expect(mapOffset(patches, 7, -1)).toBe(9);
    // Range edges: the start stays before the replacement, the end after it.
    expect(mapOffset(patches, 1, 1)).toBe(1);
    expect(mapOffset(patches, 3, -1)).toBe(4);
    // Inside a replaced range, and at a pure insertion point, assoc decides.
    expect(mapOffset(patches, 2, -1)).toBe(1);
    expect(mapOffset(patches, 2, 1)).toBe(4);
    expect(mapOffset(patches, 5, -1)).toBe(6);
    expect(mapOffset(patches, 5, 1)).toBe(7);
  });

  it("resolve mapped selections after applying", () => {
    const applied = applyTransaction("abc", {
      baseRevision: 0,
      patches: [{ from: 1, to: 1, insert: "xy" }],
      selection: { kind: "mapped", anchor: { offset: 1, assoc: 1 }, focus: { offset: 1, assoc: 1 } },
      undo: { group: "typing-run", run: "insert" },
    });
    expect(applied).toEqual({ text: "axybc", anchor: 3, focus: 3 });
  });

  it("express a whole-buffer replacement as its minimal patch", () => {
    expect(replacementPatches("hello world", "hello brave world")).toEqual([{ from: 6, to: 6, insert: "brave " }]);
    expect(replacementPatches("same", "same")).toEqual([]);
  });
});

describe("intent scheduler", () => {
  const typed = (text: string): Intent => ({ type: "insertText", text, origin: "keyboard", repeat: false });
  const enter: Intent = { type: "enter", soft: false, origin: "keyboard", repeat: false };

  function setup() {
    const ran: string[] = [];
    let fresh = true;
    const scheduler = createIntentScheduler({
      needsFreshLayout: (intent) => intent.type === "enter",
      isLayoutFresh: () => fresh,
      run: (intent) => {
        ran.push(intent.type === "insertText" ? intent.text : intent.type);
        // Every edit makes the layout stale until the next render.
        fresh = false;
      },
    });
    return { scheduler, ran, render: () => { fresh = true; scheduler.layoutChanged(); } };
  }

  it("holds layout-reading intents, and everything after them, until layout catches up", () => {
    const { scheduler, ran, render } = setup();
    scheduler.submit(typed("a"));
    scheduler.submit(enter);
    scheduler.submit(typed("b"));
    expect(ran).toEqual(["a"]);
    expect(scheduler.pending).toBe(2);
    render();
    expect(ran).toEqual(["a", "enter", "b"]);
    expect(scheduler.pending).toBe(0);
  });

  it("runs everything on flush, then stops waiting until layout is fresh again", () => {
    const { scheduler, ran, render } = setup();
    scheduler.submit(typed("a"));
    scheduler.submit(enter);
    scheduler.flush();
    expect(ran).toEqual(["a", "enter"]);
    scheduler.submit(enter);
    expect(ran).toEqual(["a", "enter", "enter"]);
    render();
    scheduler.submit(typed("c"));
    scheduler.submit(enter);
    expect(ran).toEqual(["a", "enter", "enter", "c"]);
  });
});

describe("input adapter", () => {
  const stroke = (key: string, mods: Partial<KeyStroke> = {}): KeyStroke => ({
    key, shift: false, primary: false, alt: false, repeat: false, composing: false, ...mods,
  });

  it("claims canvas keys and carries auto-repeat", () => {
    expect(interpretKeyDown(stroke("Backspace", { repeat: true }), "canvas")).toEqual({
      kind: "intent",
      intent: { type: "deleteBackward", unit: "item", origin: "keyboard", repeat: true },
    });
    expect(interpretKeyDown(stroke("ArrowRight", { primary: true, shift: true }), "canvas")).toEqual({
      kind: "intent",
      intent: { type: "move", dir: "right", unit: "edge", extend: true, origin: "keyboard", repeat: false },
    });
    expect(interpretKeyDown(stroke("Tab", { alt: true }), "canvas")).toEqual({ kind: "block" });
  });

  it("leaves text, modified deletes and word motion to the browser", () => {
    expect(interpretKeyDown(stroke("a"), "canvas")).toEqual({ kind: "native" });
    expect(interpretKeyDown(stroke("Backspace", { alt: true }), "canvas")).toEqual({ kind: "native" });
    expect(interpretKeyDown(stroke("ArrowLeft", { alt: true }), "canvas")).toEqual({ kind: "native" });
  });

  it("claims nothing during an IME composition", () => {
    expect(interpretKeyDown(stroke("Enter", { composing: true }), "canvas")).toEqual({ kind: "native" });
    expect(interpretKeyDown(stroke("Escape", { composing: true }), "bar")).toEqual({ kind: "native" });
  });

  it("keeps the bar a plain textarea apart from session shortcuts", () => {
    expect(interpretKeyDown(stroke("Enter"), "bar")).toEqual({ kind: "native" });
    expect(interpretKeyDown(stroke("ArrowUp"), "bar")).toEqual({ kind: "native" });
    expect(interpretKeyDown(stroke("e", { primary: true }), "bar")).toEqual({ kind: "block" });
    expect(interpretKeyDown(stroke("e", { primary: true }), "canvas")).toEqual({ kind: "focusBar" });
    expect(interpretKeyDown(stroke("z", { primary: true, shift: true }), "bar")).toMatchObject({
      kind: "intent",
      intent: { type: "redo" },
    });
  });

  it("maps beforeinput types to intents with their origin", () => {
    expect(intentFromBeforeInput("insertFromPaste", "x")).toMatchObject({ type: "insertText", origin: "paste" });
    expect(intentFromBeforeInput("insertCompositionText", "か")).toMatchObject({ type: "compose", commit: false, origin: "composition" });
    expect(intentFromBeforeInput("deleteWordBackward", null)).toMatchObject({ type: "deleteBackward", unit: "word" });
    expect(intentFromBeforeInput("formatBold", null)).toBeNull();
  });
});
