import { describe, expect, it } from "vitest";

import {
  createBeamerFrameNavigationSnapshot,
  planBeamerFrameChrome,
  resolveBeamerPageGeometry,
  resolveBeamerTheme,
  scanBeamerDocument,
} from "../packages/core/src/beamer/index.js";

function plan(source: string, frameIndex = 0) {
  const document = scanBeamerDocument(source);
  const theme = resolveBeamerTheme(document);
  const page = resolveBeamerPageGeometry(document, theme);
  return planBeamerFrameChrome({
    document,
    frame: document.frames[frameIndex]!,
    frameIndex,
    totalFrames: document.frames.length,
    navigation: createBeamerFrameNavigationSnapshot(document, frameIndex),
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

  it("plans the tree headline as three shared rows with source-colored hooks", () => {
    const chrome = plan(String.raw`
\documentclass{beamer}
\usetheme{Antibes}
\title{Tree deck}
\begin{document}
\section{Foundations}
\subsection{Overview}
\begin{frame}{Frame}Body\end{frame}
\end{document}`);

    expect(chrome.topInset).toBeCloseTo(59.393155, 5);
    expect(chrome.primitives).toContainEqual(expect.objectContaining({
      id: "frame:0:headline:title",
      kind: "text",
      colorRole: "title in head/foot",
    }));
    expect(chrome.primitives).toContainEqual(expect.objectContaining({
      id: "frame:0:headline:section:hook-vertical",
      kind: "fill",
      paint: "foreground",
      bounds: expect.objectContaining({ width: 0.4, height: 4.995 }),
    }));
    expect(chrome.primitives).toContainEqual(expect.objectContaining({
      id: "frame:0:headline:subsection:hook-horizontal",
      kind: "fill",
      paint: "foreground",
      bounds: expect.objectContaining({ width: 5, height: 0.4 }),
    }));
  });

  it("plans split navigation and its symmetric metadata footline", () => {
    const chrome = plan(String.raw`
\documentclass{beamer}
\usetheme{Luebeck}
\title{Split deck}
\author{Author}
\begin{document}
\section{Foundations}
\subsection{Overview}
\begin{frame}{Frame}Body\end{frame}
\section{Geometry}
\begin{frame}{Other}Body\end{frame}
\end{document}`);

    expect(chrome.topInset).toBeCloseTo(48.270947, 5);
    expect(chrome.bottomInset).toBeCloseTo(13.656998, 5);
    expect(chrome.primitives).toContainEqual(expect.objectContaining({
      id: "frame:0:headline:section-0",
      kind: "text",
      alignment: "right",
      colorRole: "section in head/foot",
    }));
    expect(chrome.primitives).toContainEqual(expect.objectContaining({
      id: "frame:0:headline:section-1",
      colorRole: "section in head/foot shaded",
    }));
    expect(chrome.primitives).toContainEqual(expect.objectContaining({
      id: "frame:0:footline:author",
      alignment: "right",
    }));
    expect(chrome.primitives).toContainEqual(expect.objectContaining({
      id: "frame:0:footline:title",
      alignment: "left",
    }));
  });

  it("plans mini-frame states from the shared document navigation tree", () => {
    const chrome = plan(String.raw`
\documentclass{beamer}
\usetheme{Berlin}
\title{Mini deck}
\author{Author}
\institute{Institute}
\begin{document}
\section{Foundations}
\subsection{Overview}
\begin{frame}{First}Body\end{frame}
\begin{frame}{Second}Body\end{frame}
\section{Geometry}
\subsection{Shapes}
\begin{frame}{Third}Body\end{frame}
\end{document}`, 1);

    const miniFrames = chrome.primitives.find(
      (primitive) => primitive.id === "frame:1:headline:mini-frames"
    );
    expect(miniFrames).toEqual(expect.objectContaining({
      kind: "vector",
      layoutKind: "mini-frame-navigation",
      templateId: "beamer/mini-frames/default",
    }));
    if (miniFrames?.kind !== "vector") {
      throw new Error("Expected the mini-frame vector primitive.");
    }
    expect(miniFrames.shapes).toHaveLength(3);
    expect(miniFrames.shapes.filter((shape) => "fillColorRole" in shape))
      .toHaveLength(1);
    expect(chrome.primitives).toContainEqual(expect.objectContaining({
      id: "frame:1:footline:author",
      alignment: "left",
    }));
    expect(chrome.primitives).toContainEqual(expect.objectContaining({
      id: "frame:1:footline:institute",
      alignment: "right",
    }));
  });

  it("plans Singapore's fade as decoration without changing the head inset", () => {
    const chrome = plan(String.raw`
\documentclass{beamer}
\usetheme{Singapore}
\begin{document}
\section{Foundations}
\begin{frame}{Frame}Body\end{frame}
\end{document}`);

    const fade = chrome.primitives.find(
      (primitive) => primitive.id === "frame:0:headline:fade"
    );
    expect(fade).toEqual(expect.objectContaining({
      kind: "vector",
      layoutKind: "headline-decoration",
      bounds: expect.objectContaining({ height: expect.closeTo(35.565945, 5) }),
    }));
    if (fade?.kind !== "vector") {
      throw new Error("Expected the Singapore fade vector primitive.");
    }
    expect(fade.shapes).toHaveLength(96);
    expect(chrome.topInset).toBeCloseTo(37.664975, 5);
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
