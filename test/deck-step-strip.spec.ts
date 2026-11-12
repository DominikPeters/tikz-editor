import { describe, expect, it } from "vitest";
import { deckStepStripItems } from "../packages/app/src/ui/canvas-panel/deck-step-strip";
import { DECK_LAST_STEP, deckStepRootKey, requestedDeckStep } from "../packages/app/src/root-key";
import { formatDocumentRootId } from "@tikz-editor/core/document/root-id";

const shown = (current: number, count: number) =>
  deckStepStripItems(current, count).map((item) => item.kind === "step" ? String(item.step) : "…").join(" ");

describe("deck step strip", () => {
  it("shows every step of a short build", () => {
    expect(shown(1, 2)).toBe("1 2");
    expect(shown(4, 9)).toBe("1 2 3 4 5 6 7 8 9");
  });

  it("shows the ends and the steps around the current one of a long build", () => {
    expect(shown(1, 20)).toBe("1 2 3 4 5 … 20");
    expect(shown(10, 20)).toBe("1 … 8 9 10 11 12 … 20");
    expect(shown(20, 20)).toBe("1 … 16 17 18 19 20");
  });

  it("shows a single hidden step in place of a gap", () => {
    expect(shown(4, 20)).toBe("1 2 3 4 5 6 … 20");
    expect(shown(17, 20)).toBe("1 … 15 16 17 18 19 20");
  });

  it("always includes the current step", () => {
    for (let count = 1; count <= 40; count++) for (let current = 1; current <= count; current++) {
      expect(deckStepStripItems(current, count)).toContainEqual({ kind: "step", step: current });
    }
  });
});

describe("requested deck step", () => {
  it("is the last step for a slide not stepped through, else the step last looked at", () => {
    const frame = formatDocumentRootId({ kind: "beamer-frame", index: 2 });
    const picture = formatDocumentRootId({ kind: "beamer-frame-tikz", frameIndex: 2, index: 0 });
    expect(requestedDeckStep({}, "doc", frame)).toBe(DECK_LAST_STEP);
    const steps = { [deckStepRootKey("doc", frame)]: 3 };
    expect(requestedDeckStep(steps, "doc", frame)).toBe(3);
    // A picture is edited on its slide's step.
    expect(requestedDeckStep(steps, "doc", picture)).toBe(3);
    expect(requestedDeckStep(steps, "other", frame)).toBe(DECK_LAST_STEP);
  });
});
