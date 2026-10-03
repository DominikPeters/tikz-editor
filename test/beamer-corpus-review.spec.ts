import { describe, expect, it } from "vitest";
import { prepareBeamerDocument, scanBeamerDocument } from "../packages/core/src/beamer/index.js";
import { createBeamerSyntaxContext } from "../packages/core/src/beamer/syntax.js";
import { featuresForFrame, reviewedFrameKey, selectDiverseFrames } from "../scripts/shortlist-beamer-corpus.mjs";
import { beamerReviewSignals } from "../scripts/lib/beamer-review-signals.mjs";

describe("Beamer corpus manual-review shortlisting", () => {
  it("detects frame options without confusing title words or commented syntax with usage", () => {
    const source = String.raw`\documentclass{beamer}\begin{document}
\begin{frame}{Why shrink bandwidth?}
% \begin{columns} \pause
Alpha
\end{frame}
\begin{frame}[shrink=20]{Beta}Gamma\end{frame}
\begin{frame}[allowframebreaks]{Delta}Epsilon\end{frame}
\end{document}`;
    const document = scanBeamerDocument(source);
    const features = document.frames.map(frame => featuresForFrame(createBeamerSyntaxContext(source), frame).features);
    expect(features[0]).not.toContain("frame-sizing-breaks");
    expect(features[0]).not.toContain("columns");
    expect(features[0]).not.toContain("overlays");
    expect(features[1]).toContain("frame-sizing-breaks");
    expect(features[2]).toContain("frame-sizing-breaks");
  });

  it("excludes reviewed identities while retaining other frames and repository diversity", () => {
    const frames = [
      { repository: "author/a", path: "slides.tex", frame: 1, deckId: "a", complete: true, features: ["tables"], sourceBytes: 50 },
      { repository: "author/a", path: "slides.tex", frame: 2, deckId: "a", complete: true, features: ["tables"], sourceBytes: 50 },
      { repository: "author/b", path: "slides.tex", frame: 1, deckId: "b", complete: true, features: ["tables"], sourceBytes: 50 },
      { repository: "author/b", path: "slides.tex", frame: 2, deckId: "b", complete: false, features: ["math-alignment"], sourceBytes: 50 },
    ];
    const selected = selectDiverseFrames(frames, 3, 2, 2, new Set([reviewedFrameKey(frames[0])]));
    expect(selected.map(reviewedFrameKey)).toEqual([reviewedFrameKey(frames[1]), reviewedFrameKey(frames[2])]);
    expect(frames.every(frame => !("selected" in frame))).toBe(true);
  });

  it("shortlists a silent display-math fallback even when paragraph literals and diagnostics are empty", async () => {
    const source = String.raw`\documentclass{beamer}\begin{document}
\begin{frame}\[\CorpusReviewUnknownMacro{x}=y\]\end{frame}\end{document}`;
    const render = await prepareBeamerDocument(source).renderFrame({ frameIndex: 0, step: 1 });
    const signals = beamerReviewSignals(render);
    expect(signals.literalSegments).toBe(0);
    expect(signals.paintedFallbacks).toContainEqual(expect.objectContaining({ reason: "display-math-unsupported" }));
    expect(signals.flags).toContain("painted-literal-fallback");
    expect(signals.flags).toContain("paint-fallback-without-diagnostic");
    const clean = await prepareBeamerDocument(source.replaceAll("\\CorpusReviewUnknownMacro", "\\boldsymbol")).renderFrame({ frameIndex: 0, step: 1 });
    expect(beamerReviewSignals(clean).paintedFallbacks).toEqual([]);
    expect(beamerReviewSignals(clean).flags).not.toContain("painted-literal-fallback");
  });
});
