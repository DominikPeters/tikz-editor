import { describe, expect, it } from "vitest";

import {
  planBeamerFrameChrome,
  resolveBeamerPageGeometry,
  resolveBeamerTheme,
  scanBeamerDocument,
} from "../packages/core/src/beamer/index.js";

function plan(source: string) {
  const document = scanBeamerDocument(source);
  const theme = resolveBeamerTheme(document);
  const page = resolveBeamerPageGeometry(document, theme);
  return planBeamerFrameChrome({
    document,
    frame: document.frames[0]!,
    frameIndex: 0,
    totalFrames: document.frames.length,
    step: 1,
    page,
    theme,
  });
}

describe("Beamer structural theme templates", () => {
  it("plans Madrid/Infolines chrome without embedding SVG", () => {
    const chrome = plan(String.raw`
\documentclass[aspectratio=169]{beamer}
\usetheme{Madrid}
\usecolortheme{seahorse}
\title{Deck}
\begin{document}\begin{frame}{Frame}Body\end{frame}\end{document}`);

    expect(chrome.topInset).toBe(30.5);
    expect(chrome.bottomInset).toBeCloseTo(12.658, 4);
    expect(chrome.primitives.map((primitive) => primitive.kind)).toEqual([
      "fill",
      "text",
      "fill",
      "fill",
      "fill",
      "text",
      "text",
    ]);
    expect(chrome.primitives).toContainEqual(
      expect.objectContaining({
        id: "frame:0:footline:title",
        fontRole: "footline",
        colorRole: "title in head/foot",
      })
    );
  });

  it.each(["metropolis", "moloch"])(
    "plans %s progress chrome through registered templates",
    (name) => {
      const chrome = plan(String.raw`
\documentclass[aspectratio=169]{beamer}
\usetheme[progressbar=frametitle]{${name}}
\begin{document}\begin{frame}{Frame}Body\end{frame}\end{document}`);

      expect(chrome.primitives).toContainEqual(
        expect.objectContaining({
          id: "frame:0:frame-title:progress",
          kind: "fill",
          colorRole: "progress bar",
        })
      );
      expect(chrome.bottomInset).toBeGreaterThan(0);
    }
  );
});
