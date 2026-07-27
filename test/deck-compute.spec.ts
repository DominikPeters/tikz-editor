import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { computeSnapshot, type ComputeRequest } from "../packages/app/src/compute.js";

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
} & Partial<Pick<
  ComputeRequest,
  "sourceRevision" | "patches" | "patchBaseRevision" | "textEditMaskSpan"
>>) {
  requestCounter += 1;
  return {
    id: `deck-req-${requestCounter}`,
    documentId: "deck-doc",
    source: overrides.source,
    ...(Object.prototype.hasOwnProperty.call(overrides, "activeRootId")
      ? { activeRootId: overrides.activeRootId }
      : {}),
    deckStep: overrides.deckStep ?? null,
    sourceRevision: overrides.sourceRevision,
    patches: overrides.patches,
    patchBaseRevision: overrides.patchBaseRevision,
    textEditMaskSpan: overrides.textEditMaskSpan
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
    expect(active!.layout.frameId).toBe("frame:0");
    expect(active!.layout.paragraphs.length).toBeGreaterThan(0);
    expect(structuredClone(active!.layout)).toEqual(active!.layout);
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

  it("preserves explicit or invalid no-root selections", async () => {
    const explicitNone = await computeSnapshot(
      deckRequest({ source: KKT_SOURCE, activeRootId: null })
    );
    expect(explicitNone.snapshot.deck!.activeFrame).toBeNull();
    expect(explicitNone.snapshot.activeRootId).toBeNull();

    const unknown = await computeSnapshot(
      deckRequest({ source: KKT_SOURCE, activeRootId: "frame:99" })
    );
    expect(unknown.snapshot.deck!.activeFrame).toBeNull();
    expect(unknown.snapshot.activeRootId).toBeNull();
  });

  it("increments the Beamer syntax tree only from the matching base revision", async () => {
    const source = String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}{Title}
Hello
\end{frame}
\begin{frame}{Later}
World
\end{frame}
\end{document}`;
    const base = await computeSnapshot(deckRequest({
      source,
      sourceRevision: 10
    }));
    const from = source.indexOf("Hello");
    const edited = `${source.slice(0, from)}Hello!${source.slice(from + 5)}`;
    const patch = {
      oldSpan: { from, to: from + 5 },
      newSpan: { from, to: from + 6 },
      replacement: "Hello!"
    };
    const masked = await computeSnapshot(deckRequest({
      source: edited,
      sourceRevision: 11,
      patches: [patch],
      patchBaseRevision: 10,
      textEditMaskSpan: patch.newSpan
    }));
    expect(masked.snapshot.deck!.frames).toHaveLength(2);
    expect(masked.snapshot.deck!.activeFrame!.step).toBe(1);

    const unmasked = await computeSnapshot(deckRequest({
      source: edited,
      sourceRevision: 11,
      patches: [patch],
      patchBaseRevision: 10
    }));
    expect(unmasked.snapshot.deck!.frames.map((frame) => frame.title)).toEqual([
      "Title",
      "Later"
    ]);
    expect(unmasked.snapshot.deck!.activeFrame!.layout.paragraphs
      .flatMap((paragraph) => paragraph.editableTextSpans)
      .some((editable) =>
        edited.slice(editable.span.from, editable.span.to).includes("Hello!")
      )).toBe(true);
    expect(base.snapshot.deck!.frames).toHaveLength(2);
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
