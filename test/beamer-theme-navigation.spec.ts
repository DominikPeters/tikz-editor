import { describe, expect, it } from "vitest";

import {
  createBeamerFrameNavigationSnapshot,
  createBeamerNavigationModel,
  scanBeamerDocument,
} from "../packages/core/src/beamer/index.js";

describe("Beamer theme navigation model", () => {
  const source = String.raw`
\documentclass{beamer}
\begin{document}
\begin{frame}{Preface}A\end{frame}
\section[Basics]{Foundations}
\begin{frame}{Section introduction}B\end{frame}
\subsection[Details]{Technical details}
\begin{frame}{First detail}C\end{frame}
\begin{frame}{Second detail}D\end{frame}
\section{Geometry}
\subsection{Diagram}
\begin{frame}{Drawing}E\end{frame}
\section{Empty future section}
\end{document}`;

  it("builds one immutable document model independent of outer themes", () => {
    const document = scanBeamerDocument(source);
    const navigation = createBeamerNavigationModel(document);

    expect(navigation.frames.map(({ frame }) => frame.title?.value)).toEqual([
      "Preface",
      "Section introduction",
      "First detail",
      "Second detail",
      "Drawing",
    ]);
    expect(navigation.unsectionedFrames.map(({ frameIndex }) => frameIndex))
      .toEqual([0]);
    expect(
      navigation.sections.map(({ title, frames, directFrames }) => ({
        title: title.value,
        frames: frames.map(({ frameIndex }) => frameIndex),
        directFrames: directFrames.map(({ frameIndex }) => frameIndex),
      }))
    ).toEqual([
      {
        title: "Basics",
        frames: [1, 2, 3],
        directFrames: [1],
      },
      {
        title: "Geometry",
        frames: [4],
        directFrames: [],
      },
      {
        title: "Empty future section",
        frames: [],
        directFrames: [],
      },
    ]);
    expect(
      navigation.sections[0]?.subsections.map(({ title, frames }) => ({
        title: title.value,
        frames: frames.map(({ frameIndex }) => frameIndex),
      }))
    ).toEqual([{ title: "Details", frames: [2, 3] }]);
    expect(Object.isFrozen(navigation)).toBe(true);
    expect(Object.isFrozen(navigation.sections)).toBe(true);
    expect(Object.isFrozen(navigation.sections[0]?.frames)).toBe(true);
  });

  it("selects the current section, subsection, and local frame ordinals", () => {
    const document = scanBeamerDocument(source);
    const model = createBeamerNavigationModel(document);
    const snapshot = createBeamerFrameNavigationSnapshot(document, 3, model);

    expect(snapshot.model).toBe(model);
    expect(snapshot.currentFrame.frame.title?.value).toBe("Second detail");
    expect(snapshot.currentSection?.title.value).toBe("Basics");
    expect(snapshot.currentSubsection?.title.value).toBe("Details");
    expect(snapshot.frameIndexInSection).toBe(2);
    expect(snapshot.frameIndexInSubsection).toBe(1);
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it("retains section-zero state for frames before the first section", () => {
    const document = scanBeamerDocument(source);
    const snapshot = createBeamerFrameNavigationSnapshot(document, 0);

    expect(snapshot.currentSection).toBeNull();
    expect(snapshot.currentSubsection).toBeNull();
    expect(snapshot.frameIndexInSection).toBeNull();
    expect(snapshot.frameIndexInSubsection).toBeNull();
  });
});
