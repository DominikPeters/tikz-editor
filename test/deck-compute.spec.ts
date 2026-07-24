import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { computeSnapshot } from "../packages/app/src/compute.js";

const KKT_SOURCE = readFileSync(
  new URL("./fixtures/beamer/kkt_theorem_beamer.tex", import.meta.url),
  "utf8"
);
const OVERLAY_SOURCE = readFileSync(
  new URL("./fixtures/beamer/overlay_conformance_beamer.tex", import.meta.url),
  "utf8"
);

let requestCounter = 0;
function deckRequest(overrides: {
  source: string;
  activeRootId?: string | null;
  deckStep?: number | null;
}) {
  requestCounter += 1;
  return {
    id: `deck-req-${requestCounter}`,
    documentId: "deck-doc",
    source: overrides.source,
    activeRootId: overrides.activeRootId ?? null,
    deckStep: overrides.deckStep ?? null
  };
}

describe("deck compute path", () => {
  it("produces a kind-tagged deck snapshot with empty tikz fields", async () => {
    const response = await computeSnapshot(deckRequest({ source: KKT_SOURCE }));
    const snapshot = response.snapshot;
    expect(snapshot.deck).not.toBeNull();
    expect(snapshot.deck!.frames.length).toBe(20);
    expect(snapshot.deck!.frames[0]).toMatchObject({
      id: "frame:0",
      frameIndex: 0,
      stepCount: 1
    });
    expect(snapshot.figures).toEqual([]);
    expect(snapshot.scene).toBeNull();
    expect(snapshot.svg).toBeNull();
    expect(snapshot.editHandles).toEqual([]);

    const active = snapshot.deck!.activeFrame;
    expect(active).not.toBeNull();
    expect(active!.frameId).toBe("frame:0");
    expect(active!.step).toBe(1);
    expect(active!.svg).toContain("<svg");
    expect(active!.svgModel.parts.length).toBeGreaterThan(0);
    expect(snapshot.activeRootId).toBe("frame:0");
  });

  it("renders the requested frame and memoizes rendered pages", async () => {
    const first = await computeSnapshot(
      deckRequest({ source: KKT_SOURCE, activeRootId: "frame:2" })
    );
    expect(first.snapshot.deck!.activeFrame!.frameIndex).toBe(2);

    const second = await computeSnapshot(
      deckRequest({ source: KKT_SOURCE, activeRootId: "frame:2" })
    );
    // Same source revision — the rendered page comes from the memo, so the
    // model is reference-identical.
    expect(second.snapshot.deck!.activeFrame!.svgModel).toBe(
      first.snapshot.deck!.activeFrame!.svgModel
    );
  });

  it("selects and clamps overlay steps", async () => {
    const base = await computeSnapshot(deckRequest({ source: OVERLAY_SOURCE }));
    const multiStep = base.snapshot.deck!.frames.find(
      (frame) => frame.stepCount > 1
    );
    expect(multiStep).toBeDefined();

    const stepTwo = await computeSnapshot(
      deckRequest({
        source: OVERLAY_SOURCE,
        activeRootId: multiStep!.id,
        deckStep: 2
      })
    );
    expect(stepTwo.snapshot.deck!.activeFrame!.step).toBe(2);
    expect(stepTwo.snapshot.deck!.activeFrame!.stepCount).toBe(
      multiStep!.stepCount
    );

    const clamped = await computeSnapshot(
      deckRequest({
        source: OVERLAY_SOURCE,
        activeRootId: multiStep!.id,
        deckStep: 99
      })
    );
    expect(clamped.snapshot.deck!.activeFrame!.step).toBe(multiStep!.stepCount);

    const clampedLow = await computeSnapshot(
      deckRequest({
        source: OVERLAY_SOURCE,
        activeRootId: multiStep!.id,
        deckStep: 0
      })
    );
    expect(clampedLow.snapshot.deck!.activeFrame!.step).toBe(1);
  });

  it("falls back to the first frame for unknown selections", async () => {
    const response = await computeSnapshot(
      deckRequest({ source: KKT_SOURCE, activeRootId: "frame:99" })
    );
    expect(response.snapshot.deck!.activeFrame!.frameIndex).toBe(0);
  });

  it("keeps the tikz path for tikz documents", async () => {
    const response = await computeSnapshot(
      deckRequest({
        source: "\\begin{tikzpicture}\\draw (0,0) -- (1,1);\\end{tikzpicture}"
      })
    );
    expect(response.snapshot.deck).toBeNull();
    expect(response.snapshot.figures.length).toBe(1);
  });
});
