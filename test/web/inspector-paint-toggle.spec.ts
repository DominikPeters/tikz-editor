/** @vitest-environment jsdom */

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { renderTikzToSvg } from "../../packages/core/src/render/index";
import { getInspectorDescriptor, type InspectorPaintToggle } from "../../packages/core/src/edit/inspector";
import { makeEmptySnapshot } from "../../packages/app/src/compute";
import { makeInitialState } from "../../packages/app/src/store/reducer";
import { useEditorStore } from "../../packages/app/src/store/store";
import { useInspectorMutations } from "../../packages/app/src/ui/inspector-panel/useInspectorMutations";

let root: Root;
let api: ReturnType<typeof useInspectorMutations>;
const dispatch = useEditorStore.getState().dispatch;
type Paint = InspectorPaintToggle["paint"];

function picture(...statements: string[]): string {
  return `\\begin{tikzpicture}\n${statements.join("\n")}\n\\end{tikzpicture}`;
}

function ready(): void {
  const source = useEditorStore.getState().source;
  const rendered = renderTikzToSvg(source);
  dispatch({ type: "COMPUTE_REQUESTED", requestId: "ready" });
  dispatch({ type: "SNAPSHOT_READY", requestId: "ready", snapshot: {
    ...makeEmptySnapshot(source), parseResult: rendered.parse, semanticResult: rendered.semantic,
    activeRootId: rendered.parse.activeFigureId, figures: rendered.parse.figures, scene: rendered.semantic.scene,
    editHandles: rendered.semantic.editHandles, svg: rendered.svg
  } });
}

function toggles(paint: Paint): InspectorPaintToggle[] {
  const source = useEditorStore.getState().source;
  const rendered = renderTikzToSvg(source);
  return rendered.semantic.scene.elements.filter(element => element.kind === "Path").map(element => {
    const toggle = getInspectorDescriptor(element, { source, editHandles: rendered.semantic.editHandles })
      .sections.find(section => section.id === paint)?.toggle;
    if (!toggle) throw new Error(`Missing ${paint} toggle`);
    return toggle;
  });
}

function firstPathStyle() {
  const element = renderTikzToSvg(useEditorStore.getState().source).semantic.scene.elements.find(element => element.kind === "Path");
  if (!element) throw new Error("Missing path");
  return element.style;
}

function Harness() {
  api = useInspectorMutations(dispatch);
  return null;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useEditorStore.setState(makeInitialState());
  root = createRoot(document.createElement("div"));
  await act(async () => { root.render(React.createElement(Harness)); });
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

const TWO_PATHS = picture(
  String.raw`\filldraw[red] (0,0) rectangle (1,1);`,
  String.raw`\filldraw[blue] (2,0) rectangle (3,1);`
);

it.each(["stroke", "fill"] as const)("restores only the selected %s from an earlier batch", paint => {
  dispatch({ type: "CODE_EDITED", source: TWO_PATHS });
  ready();
  api.applyPaintToggle(toggles(paint), false);
  ready();
  expect(toggles(paint).map(toggle => toggle.enabled)).toEqual([false, false]);

  api.applyPaintToggle(toggles(paint).slice(0, 1), true);
  ready();
  expect(toggles(paint).map(toggle => toggle.enabled)).toEqual([true, false]);

  // The other member still remembers its own paint after a partial restore.
  api.applyPaintToggle(toggles(paint).slice(1), true);
  expect(toggles(paint).map(toggle => toggle.enabled)).toEqual([true, true]);
  const styles = renderTikzToSvg(useEditorStore.getState().source).semantic.scene.elements.map(element => element.style);
  expect(styles.map(style => paint === "stroke" ? style.stroke : style.fill)).toEqual(["#ff0000", "#0000ff"]);
});

it("restores the exact source for a complete batch, with one-step undo and redo", () => {
  dispatch({ type: "CODE_EDITED", source: TWO_PATHS });
  ready();
  api.applyPaintToggle(toggles("fill"), false);
  ready();
  const off = useEditorStore.getState().source;
  api.applyPaintToggle(toggles("fill").reverse(), true);
  expect(useEditorStore.getState().source).toBe(TWO_PATHS);
  dispatch({ type: "UNDO" });
  expect(useEditorStore.getState().source).toBe(off);
  dispatch({ type: "REDO" });
  expect(useEditorStore.getState().source).toBe(TWO_PATHS);
});

it.each(["stroke", "fill"] as const)("keeps remembered %s scoped to its document", paint => {
  const source = picture(String.raw`\filldraw[red] (0,0) rectangle (1,1);`);
  dispatch({ type: "CODE_EDITED", source });
  ready();
  const originalDocumentId = useEditorStore.getState().activeDocumentId;
  api.applyPaintToggle(toggles(paint), false);
  const originalOffSource = useEditorStore.getState().source;

  const otherCommand = paint === "fill" ? String.raw`\draw` : String.raw`\fill`;
  dispatch({ type: "NEW_DOCUMENT", source: picture(`${otherCommand}[blue] (0,0) rectangle (1,1);`) });
  ready();
  api.applyPaintToggle(toggles(paint), true);
  expect(paint === "fill" ? firstPathStyle().fill : firstPathStyle().stroke).toBe("#0000ff");
  expect(useEditorStore.getState().documents[originalDocumentId]?.source).toBe(originalOffSource);

  dispatch({ type: "SWITCH_DOCUMENT", documentId: originalDocumentId });
  ready();
  api.applyPaintToggle(toggles(paint), true);
  expect(useEditorStore.getState().source).toBe(source);
});

it("restores an inherited gradient after a coordinate edit", () => {
  const source = String.raw`\begin{tikzpicture}[s/.style={left color=red, right color=blue}]
\draw[s] (0,0) rectangle (1,1);
\end{tikzpicture}`;
  dispatch({ type: "CODE_EDITED", source });
  ready();
  const originalStyle = firstPathStyle();
  api.applyPaintToggle(toggles("fill"), false);
  expect(firstPathStyle().shadeEnabled).toBe(false);
  dispatch({ type: "CODE_EDITED", source: useEditorStore.getState().source.replace("(1,1)", "(2,1)") });
  ready();
  api.applyPaintToggle(toggles("fill"), true);
  expect(firstPathStyle()).toEqual(originalStyle);
  expect(useEditorStore.getState().source).toBe(source.replace("(1,1)", "(2,1)"));
});
