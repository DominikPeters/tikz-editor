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
    frame: document.frames[0],
    frameIndex: 0,
    totalFrames: document.frames.length,
    navigation: createBeamerFrameNavigationSnapshot(document, 0),
    step: 1,
    page,
    theme,
  });
}

const body = String.raw`
\title[Short title]{A Long Title for the Probe}
\author[Short Author]{Some Author}
\institute[Short Inst]{Some Institute}
\date{2026}
\begin{document}
\section{First section}
\subsection{First subsection}
\begin{frame}{Frame title}
  \begin{block}{Block title}
    Some text in the block.
  \end{block}
\end{frame}
\subsection{Second subsection}
\begin{frame}{Second}
  Second frame text.
\end{frame}
\section{Second section}
\begin{frame}{Third}
  Third frame text.
\end{frame}
\end{document}`;

const posterPreamble = String.raw`\documentclass{beamer}
\usepackage[orientation=portrait,size=a0,scale=1.4]{beamerposter}
`;
const poster = (use: string) => posterPreamble + use + body;
const deck = (use: string) => String.raw`\documentclass{beamer}
` + use + body;

const bounds = (chrome: ReturnType<typeof plan>, id: string) => {
  const primitive = chrome.primitives.find((candidate) => candidate.id === `frame:0:${id}`);
  if (!primitive) throw new Error(`Missing ${id}`);
  return primitive.bounds;
};

// Expected values are LuaLaTeX traces of these very sources (A0 portrait,
// scale 1.4, where the head/foot font is 16.8pt with ex 7.2407989pt; decks use
// the 6pt head/foot font with ex 2.6640015pt), compared with
// scripts/compare-beamer-frame.mjs. Heights are multiples of ex, so the same
// formulas serve both.
describe("outer-theme bars follow the head/foot font", () => {
  it("sizes Berlin's miniframes headline and footline on a poster", () => {
    const chrome = plan(poster(String.raw`\usetheme{Berlin}`));
    // 2.5ex+1.125ex+0.75ex... the navigation box hangs two mini-frame rows
    // (0.13cm each, plus 0.05cm) below its 2.5ex baseline.
    expect(bounds(chrome, "headline:section:background")).toMatchObject({ y: 0 });
    expect(bounds(chrome, "headline:section:background").height).toBeCloseTo(35.068604, 4);
    expect(bounds(chrome, "headline:subsection:background").y).toBeCloseTo(35.068604, 4);
    expect(bounds(chrome, "headline:subsection:background").height).toBeCloseTo(26.247879, 4);
    expect(bounds(chrome, "footline:author:background").y).toBeCloseTo(3330.536743, 3);
    expect(bounds(chrome, "footline:author:background").height).toBeCloseTo(26.247879, 4);
    expect(bounds(chrome, "footline:title:background").y).toBeCloseTo(3356.784622, 3);
  });

  it("keeps Berlin's deck headline, now also with several subsection rows", () => {
    const chrome = plan(deck(String.raw`\usetheme{Berlin}`));
    expect(bounds(chrome, "headline:section:background").height).toBeCloseTo(18.477722, 4);
    expect(bounds(chrome, "headline:subsection:background").height).toBeCloseTo(9.656998, 5);
    expect(bounds(chrome, "footline:author:background").y).toBeCloseTo(253.832626, 3);
  });

  it("sizes the tree theme's rows and hooks from ex on a poster", () => {
    const chrome = plan(poster(String.raw`\usetheme{default}\useoutertheme{tree}`));
    expect(bounds(chrome, "headline:section:hook-vertical").y).toBeCloseTo(28.873383, 4);
    expect(bounds(chrome, "headline:section:hook-vertical").height).toBeCloseTo(13.576492, 4);
    expect(bounds(chrome, "headline:section:hook-horizontal").y).toBeCloseTo(42.049881, 4);
    expect(bounds(chrome, "headline:subsection:hook-vertical").y).toBeCloseTo(55.121262, 4);
  });

  it("sizes split navigation from 2.4375ex per row on a poster", () => {
    const chrome = plan(poster(String.raw`\usetheme{Luebeck}`));
    expect(bounds(chrome, "headline:section:background").height).toBeCloseTo(48.513321, 4);
    expect(bounds(chrome, "footline:title:background").y).toBeCloseTo(3356.784622, 3);
    expect(bounds(chrome, "footline:title:background").height).toBeCloseTo(26.247879, 4);
  });

  it("sizes the sidebar head box from 2.5 baselineskips of the frame-title font", () => {
    const chrome = plan(poster(String.raw`\usetheme{Rochester}`));
    expect(bounds(chrome, "headline:sidebar:background").height).toBeCloseTo(157.5, 4);
    expect(bounds(plan(deck(String.raw`\usetheme{Rochester}`)), "headline:sidebar:background").height).toBeCloseTo(45, 4);
  });
});
