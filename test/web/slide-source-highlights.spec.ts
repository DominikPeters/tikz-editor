/** @vitest-environment jsdom */
import { expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { editBeamerSlides, scanBeamerDocument } from "../../packages/core/src/beamer/index.js";
import { figureOverlayField, setFigureOverlay } from "../../packages/app/src/ui/source-panel/SourcePanel.js";

const source = String.raw`\documentclass{beamer}
\newcommand{\unit}{ms}
\begin{document}
\begin{frame}{Latency}
Response time: 12\unit
\end{frame}
\renewcommand{\unit}{s}
\begin{frame}{Results}
Summary.
\end{frame}
\end{document}`;

it.each([
  ["move", "ranges-first"], ["move", "source-first"],
  ["insert", "ranges-first"], ["insert", "source-first"]
] as const)("highlights exactly the active frame after %s when updates arrive %s", (kind, order) => {
  const moved = editBeamerSlides(source, kind === "move"
    ? { kind, frameIds: ["frame:1"], destination: { kind: "before", frameId: "frame:0" } }
    : { kind, destination: { kind: "after", frameId: "frame:0" } })!;
  const request = { source: moved.source, figures: scanBeamerDocument(moved.source).frames, activeRootId: moved.selectedFrameIds[0] };
  let state = EditorState.create({ doc: source, extensions: [figureOverlayField] });
  state = state.update({ effects: setFigureOverlay.of({ source, figures: scanBeamerDocument(source).frames, activeRootId: "frame:1" }) }).state;
  const changes = moved.patches.map(patch => ({ from: patch.oldSpan.from, to: patch.oldSpan.to, insert: patch.replacement }));
  if (order === "ranges-first") {
    state = state.update({ effects: setFigureOverlay.of(request) }).state;
    state = state.update({ changes }).state;
  } else {
    state = state.update({ changes }).state;
    state = state.update({ effects: setFigureOverlay.of(request) }).state;
  }
  const ranges: number[][] = [];
  state.field(figureOverlayField).decorations.between(0, state.doc.length, (from, to) => { ranges.push([from, to]); });
  const active = request.figures.find(frame => frame.id === request.activeRootId)!;
  expect(ranges).toEqual([[0, active.span.from], [active.span.to, moved.source.length]]);
});
