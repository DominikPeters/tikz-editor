import { describe, expect, it } from "vitest";

import {
  createBeamerFrameNavigationSnapshot,
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
    navigation: createBeamerFrameNavigationSnapshot(document, 0),
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

    expect(chrome.topInset).toBeCloseTo(30.422162, 6);
    expect(chrome.bottomInset).toBeCloseTo(12.658, 4);
    expect(
      chrome.primitives.find(
        (primitive) => primitive.id === "frame:0:frame-title:background"
      )?.bounds.height
    ).toBeCloseTo(27.684662, 6);
    expect(
      chrome.primitives.find(
        (primitive) => primitive.id ===
          "frame:0:footline:title:background"
      )?.bounds.height
    ).toBeCloseTo(8.658005, 6);
    expect(chrome.primitives.map((primitive) => primitive.kind)).toEqual([
      "vector",
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

  it("plans the Infolines headline from the current navigation snapshot", () => {
    const chrome = plan(String.raw`
\documentclass{beamer}
\useoutertheme{infolines}
\begin{document}
\section[Foundations]{Long foundations title}
\subsection[Overview]{Long overview title}
\begin{frame}{Frame}Body\end{frame}\end{document}`);

    expect(
      chrome.primitives.find(
        (primitive) =>
          primitive.id === "frame:0:headline:section:background"
      )?.bounds.height
    ).toBeCloseTo(11.055588, 6);
    expect(chrome.primitives).toContainEqual(
      expect.objectContaining({
        id: "frame:0:headline:section",
        kind: "text",
        fontRole: "section-in-head-foot",
        alignment: "right",
        source: expect.objectContaining({
          kind: "mapped",
          value: expect.objectContaining({ value: "Foundations" }),
        }),
      })
    );
    expect(chrome.primitives).toContainEqual(
      expect.objectContaining({
        id: "frame:0:headline:subsection",
        kind: "text",
        fontRole: "subsection-in-head-foot",
        alignment: "left",
        source: expect.objectContaining({
          kind: "mapped",
          value: expect.objectContaining({ value: "Overview" }),
        }),
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
