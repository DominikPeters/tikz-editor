import { describe, expect, it } from "vitest";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";
import { parseTikz } from "../packages/core/src/parser/index.js";
import {
  buildMatrixInspectorDescriptor,
  buildTreeInspectorDescriptor,
  getInspectorDescriptor,
  TIKZPICTURE_GLOBAL_TARGET_ID
} from "../packages/core/src/edit/inspector.js";
import {
  makeForeachTemplateTargetId,
  makePicTemplateTargetId,
  makeStyleSourceTargetId,
  resolveFigurePropertyTargetFromParseResult,
  resolvePropertyTarget,
  resolvePropertyTargetFromParseResult
} from "../packages/core/src/edit/property-target.js";

describe("resolvePropertyTarget – matrix cells", () => {
  it("resolves style-source and global targets across standalone style syntaxes", () => {
    expect(resolvePropertyTarget(String.raw`\tikz { \draw (0,0); }`, "   ")).toMatchObject({
      kind: "not-found",
      reason: "Missing element id"
    });

    const global = resolvePropertyTarget(String.raw`\tikz[scale=2] \draw (0,0);`, TIKZPICTURE_GLOBAL_TARGET_ID);
    expect(global.kind).toBe("found");
    if (global.kind !== "found") {
      throw new Error("Expected inline tikzpicture target");
    }
    expect(global.target.kind).toBe("figure");
    expect(global.target.insertOffset).toBeGreaterThan(0);

    const inlineSource = String.raw`\tikz[scale=2] \draw (0,0);`;
    expect(resolvePropertyTargetFromParseResult(
      inlineSource,
      parseTikz(inlineSource, { recover: true }),
      TIKZPICTURE_GLOBAL_TARGET_ID
    )).toMatchObject({ kind: "found", target: { kind: "figure" } });

    const source = String.raw`\tikzset{foo/.style={draw, fill=red}}
\pgfkeys{/tikz/bar/.style=[rounded corners, blue]}
\tikzstyle{legacy}=[dashed, line width=1pt]
\tikzstyle{legacy bare}=dashed, line width=1pt
foo/.append style={solid, fill=blue}
foo/.prefix style=[very thick]
empty/.style=
bare/.style=draw,green
broken`;
    const styleSnippets = [
      String.raw`\tikzset{foo/.style={draw, fill=red}}`,
      String.raw`\pgfkeys{/tikz/bar/.style=[rounded corners, blue]}`,
      String.raw`\tikzstyle{legacy}=[dashed, line width=1pt]`,
      String.raw`\tikzstyle{legacy bare}=dashed, line width=1pt`,
      String.raw`foo/.append style={solid, fill=blue}`,
      String.raw`foo/.prefix style=[very thick]`,
      String.raw`empty/.style=`,
      String.raw`bare/.style=draw,green`
    ];

    for (const snippet of styleSnippets) {
      const from = source.indexOf(snippet);
      const targetId = makeStyleSourceTargetId({ from, to: from + snippet.length });
      const resolved = resolvePropertyTarget(source, targetId);
      expect(resolved.kind).toBe("found");
      if (resolved.kind !== "found") {
        throw new Error(`Expected style source target for ${snippet}`);
      }
      expect(resolved.target.kind).toBe("style-source");
      expect(resolved.target.optionsSpan).toBeDefined();
      expect(resolved.target.insertOffset).toBeGreaterThanOrEqual(resolved.target.optionsSpan?.from ?? 0);
    }

    const parseResult = parseTikz(source, { recover: true });
    const firstStyleFrom = source.indexOf(styleSnippets[0]);
    expect(resolvePropertyTargetFromParseResult(
      source,
      parseResult,
      makeStyleSourceTargetId({ from: firstStyleFrom, to: firstStyleFrom + styleSnippets[0].length })
    )).toMatchObject({ kind: "found", target: { kind: "style-source" } });

    expect(resolvePropertyTarget(source, "__style_source__:bad:4").kind).toBe("not-found");
    expect(resolvePropertyTarget(source, makeStyleSourceTargetId({ from: -1, to: 3 })).kind).toBe("not-found");
    const brokenFrom = source.indexOf("broken");
    expect(resolvePropertyTarget(source, makeStyleSourceTargetId({ from: brokenFrom, to: brokenFrom + "broken".length }))).toMatchObject({
      kind: "not-found"
    });
  });

  it("resolves parse-result, operation, nested node, adornment, scope, and foreach-template targets", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}[xshift=1cm]
    \draw[blue] (0,0) to[bend left] node[above, label={[red]north:L}] {T} (1,0)
      edge[red] node[below] {E} (2,0)
      coordinate[pos=.5] (M)
      svg[scale=1] {M 0 0 L 1 1}
      child { node[draw] {C} };
  \end{scope}
  \foreach \x in {1,2} {
    \node[draw] (N\x) at (\x,0) {N\x};
    \foreach \y in {1,2} { \node[fill=red] (N\x-\y) at (\x,\y) {N}; }
  }
  \tikzset{tick/.pic={\draw[blue] (0,0) -- (1,0);}}
  \pic at (0,0) {tick};
\end{tikzpicture}`;
    const parseResult = parseTikz(source, { recover: true });
    expect(resolvePropertyTargetFromParseResult(source, parseResult, "")).toMatchObject({ kind: "not-found" });

    const scope = parseResult.figure.body.find((statement) => statement.kind === "Scope");
    if (!scope || scope.kind !== "Scope") {
      throw new Error("Expected scope");
    }
    const path = scope.body.find((statement) => statement.kind === "Path");
    if (!path || path.kind !== "Path") {
      throw new Error("Expected path");
    }

    expect(resolvePropertyTargetFromParseResult(source, parseResult, scope.id)).toMatchObject({
      kind: "found",
      target: { kind: "style-source" }
    });
    expect(resolvePropertyTargetFromParseResult(source, parseResult, path.id)).toMatchObject({
      kind: "found",
      target: { kind: "path-statement", pathCommand: "draw" }
    });

    const to = path.items.find((item) => item.kind === "ToOperation");
    const edge = path.items.find((item) => item.kind === "EdgeOperation");
    const coordinate = path.items.find((item) => item.kind === "CoordinateOperation");
    const svg = path.items.find((item) => item.kind === "SvgOperation");
    const child = path.items.find((item) => item.kind === "ChildOperation");
    if (!to || to.kind !== "ToOperation" || !edge || edge.kind !== "EdgeOperation" || !coordinate || coordinate.kind !== "CoordinateOperation" || !svg || svg.kind !== "SvgOperation" || !child || child.kind !== "ChildOperation") {
      throw new Error("Expected rich path operations");
    }

    expect(resolvePropertyTargetFromParseResult(source, parseResult, to.id)).toMatchObject({ kind: "found", target: { kind: "to-operation" } });
    expect(resolvePropertyTargetFromParseResult(source, parseResult, edge.id)).toMatchObject({ kind: "found", target: { kind: "edge-operation" } });
    expect(resolvePropertyTargetFromParseResult(source, parseResult, coordinate.id)).toMatchObject({ kind: "found", target: { kind: "coordinate-operation" } });
    expect(resolvePropertyTargetFromParseResult(source, parseResult, svg.id)).toMatchObject({ kind: "found", target: { kind: "svg-operation" } });

    const nestedToNode = to.nodes?.[0];
    const nestedEdgeNode = edge.nodes?.[0];
    if (!nestedToNode || !nestedEdgeNode) {
      throw new Error("Expected operation nodes");
    }
    expect(resolvePropertyTargetFromParseResult(source, parseResult, nestedToNode.id)).toMatchObject({ kind: "found", target: { kind: "node-item" } });
    expect(resolvePropertyTargetFromParseResult(source, parseResult, nestedEdgeNode.id)).toMatchObject({ kind: "found", target: { kind: "node-item" } });
    expect(resolvePropertyTargetFromParseResult(source, parseResult, `node-adornment:${nestedToNode.id}:label:0`)).toMatchObject({
      kind: "found",
      target: { kind: "node-adornment", adornmentKind: "label" }
    });

    const foreach = parseResult.figure.body.find((statement) => statement.kind === "Foreach");
    if (!foreach || foreach.kind !== "Foreach") {
      throw new Error("Expected foreach");
    }
    const foreachTarget = resolvePropertyTarget(source, makeForeachTemplateTargetId(foreach.id, "path:0"));
    expect(foreachTarget).toMatchObject({
      kind: "found",
      target: { kind: "foreach-template", foreachLocalTargetId: "path:0" }
    });
    expect(resolvePropertyTargetFromParseResult(
      source,
      parseResult,
      makeForeachTemplateTargetId(foreach.id, "path:0")
    )).toMatchObject({
      kind: "found",
      target: { kind: "foreach-template", foreachLocalTargetId: "path:0" }
    });

    const nestedForeachTarget = resolvePropertyTarget(source, makeForeachTemplateTargetId(foreach.id, "path:0", ["foreach:0"]));
    expect(nestedForeachTarget).toMatchObject({
      kind: "not-found"
    });

    expect(resolvePropertyTarget(source, "__foreach_template__:::")).toMatchObject({ kind: "not-found" });
    expect(resolvePropertyTarget(source, makeForeachTemplateTargetId(foreach.id, "missing"))).toMatchObject({ kind: "not-found" });

    const picCode = String.raw`\draw[blue] (0,0) -- (1,0);`;
    const picCodeFrom = source.indexOf(picCode);
    const picTemplateId = makePicTemplateTargetId({ from: picCodeFrom, to: picCodeFrom + picCode.length }, "path:0");
    expect(resolvePropertyTarget(source, picTemplateId)).toMatchObject({
      kind: "found",
      target: { kind: "pic-template", picLocalTargetId: "path:0" }
    });
    expect(resolvePropertyTargetFromParseResult(source, parseResult, picTemplateId)).toMatchObject({
      kind: "found",
      target: { kind: "pic-template", picLocalTargetId: "path:0" }
    });
    expect(resolvePropertyTarget(source, makePicTemplateTargetId({ from: picCodeFrom, to: picCodeFrom + picCode.length }, "missing"))).toMatchObject({
      kind: "not-found"
    });
  });

  it("covers defensive property-target resolution failures and delegated analysis views", () => {
    const delegated = resolvePropertyTarget("same", "delegated-id", {
      activeFigureId: "fig",
      analysisView: {
        source: "same",
        activeFigureId: "fig",
        resolvePropertyTarget: (id: string) => ({ kind: "not-found", reason: `delegated:${id}` })
      }
    } as never);
    expect(delegated).toEqual({ kind: "not-found", reason: "delegated:delegated-id" });

    expect(resolveFigurePropertyTargetFromParseResult("", {
      figure: { span: { from: 0, to: 0 } }
    } as never)).toMatchObject({ kind: "not-found" });
    expect(resolveFigurePropertyTargetFromParseResult("\\draw (0,0);", {
      figure: { span: { from: 0, to: "\\draw (0,0);".length } }
    } as never)).toMatchObject({ kind: "not-found" });

    const styleSource = String.raw`\tikzset
\tikzset{unterminated
\tikzstyle{missing}
\tikzstyle{empty}= ;
not a style/.unknown={draw}`;
    for (const snippet of [
      String.raw`\tikzset`,
      String.raw`\tikzset{unterminated`,
      String.raw`\tikzstyle{missing}`,
      String.raw`\tikzstyle{empty}= ;`,
      String.raw`not a style/.unknown={draw}`
    ]) {
      const from = styleSource.indexOf(snippet);
      const resolved = resolvePropertyTarget(styleSource, makeStyleSourceTargetId({ from, to: from + snippet.length }));
      expect(resolved.kind).toBe("not-found");
    }

    const matrixSource = String.raw`\begin{tikzpicture}
  \begin{scope}
    \matrix[matrix] { A & B \\ };
    \node {plain};
  \end{scope}
\end{tikzpicture}`;
    expect(resolvePropertyTarget(matrixSource, "node:0:0:matrix-cell:0:1")).toMatchObject({ kind: "not-found" });
    expect(resolvePropertyTarget(matrixSource, "missing:matrix-cell:1:1")).toMatchObject({ kind: "not-found" });
    expect(resolvePropertyTarget(matrixSource, "node:0:1:matrix-cell:1:1")).toMatchObject({ kind: "not-found" });
    expect(resolvePropertyTarget(matrixSource, "node:0:0:matrix-cell:10:1")).toMatchObject({ kind: "not-found" });

    const treeSource = String.raw`\begin{tikzpicture}
  \path node {root} child { edge from parent node {edge} node {after edge} };
\end{tikzpicture}`;
    for (const id of [
      ":tree-child:1:child:0",
      "path:0:tree-child:",
      "path:0:tree-child:x:child:0",
      "path:0:tree-child:1:",
      "missing:tree-child:1:child:0",
      "path:0:tree-child:2:child:0"
    ]) {
      expect(resolvePropertyTarget(treeSource, id)).toMatchObject({ kind: "not-found" });
    }
  });

  it("resolves matrix statement ids to matrix-statement targets", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes,row sep=2mm,column sep=3mm] {
    A & B \\
  };
\end{tikzpicture}`;

    const resolved = resolvePropertyTarget(source, "path:0");
    expect(resolved.kind).toBe("found");
    if (resolved.kind !== "found") {
      throw new Error("Expected matrix statement target");
    }

    expect(resolved.target.kind).toBe("matrix-statement");
    expect(resolved.target.optionsSpan).toBeDefined();
    expect(resolved.target.matrixKind).toBe("nodes");
    expect(resolved.target.matrixTextMode).toBe("text");
  });

  it("builds matrix descriptors with transform, spacing, and paint controls", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[xshift=1pt,yshift=2pt,rotate=15,matrix of nodes,row sep=1pt,column sep=3pt,draw=red,fill=blue] {
    A & B \\
  };
\end{tikzpicture}`;
    const descriptor = buildMatrixInspectorDescriptor(source, "path:0");
    expect(descriptor).toBeDefined();
    if (!descriptor) {
      throw new Error("Expected matrix descriptor");
    }
    expect(descriptor.sections.find((section) => section.id === "transform")?.properties.map((property) => property.id)).toEqual([
      "xshift",
      "yshift",
      "xscale",
      "yscale",
      "rotate"
    ]);
    const matrixSection = descriptor.sections.find((section) => section.id === "matrix");
    expect(matrixSection).toBeDefined();
    if (!matrixSection) {
      throw new Error("Expected matrix section");
    }
    expect(matrixSection.properties.find((property) => property.id === "matrix-row-sep")).toMatchObject({ value: 1 });
    expect(matrixSection.properties.find((property) => property.id === "matrix-column-sep")).toMatchObject({ value: 3 });
    expect(matrixSection.properties.find((property) => property.id === "matrix-draw")).toMatchObject({ value: "red" });
    expect(matrixSection.properties.find((property) => property.id === "matrix-fill")).toMatchObject({ value: "blue" });
    expect(buildMatrixInspectorDescriptor(source, "missing")).toBeNull();
    expect(buildMatrixInspectorDescriptor(String.raw`\begin{tikzpicture}\draw (0,0);\end{tikzpicture}`, "path:0")).toBeNull();
  });

  it("normalizes sparse and malformed matrix inspector options", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes,row sep={1pt,bad,2pt},column sep=bad,draw,fill=] {
    A \\
  };
\end{tikzpicture}`;
    const descriptor = buildMatrixInspectorDescriptor(source, "path:0");
    expect(descriptor).toBeDefined();
    if (!descriptor) {
      throw new Error("Expected matrix descriptor");
    }

    const matrixSection = descriptor.sections.find((section) => section.id === "matrix");
    expect(matrixSection).toBeDefined();
    if (!matrixSection) {
      throw new Error("Expected matrix section");
    }
    expect(matrixSection.properties.find((property) => property.id === "matrix-row-sep")).toMatchObject({ value: 0 });
    expect(matrixSection.properties.find((property) => property.id === "matrix-column-sep")).toMatchObject({ value: 0 });
    expect(matrixSection.properties.find((property) => property.id === "matrix-draw")).toMatchObject({ value: null });
    expect(matrixSection.properties.find((property) => property.id === "matrix-fill")).toMatchObject({ value: null });
  });

  it("resolves matrix-cell synthetic ids to cell text spans", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] {
    A & |[draw,fill=yellow]| BC \\
  };
\end{tikzpicture}`;

    const resolved = resolvePropertyTarget(source, "node:0:0:matrix-cell:1:2");
    expect(resolved.kind).toBe("found");
    if (resolved.kind !== "found") {
      throw new Error("Expected matrix-cell target");
    }

    expect(resolved.target.kind).toBe("matrix-cell");
    expect(resolved.target.matrixSourceId).toBe("path:0");
    expect(resolved.target.row).toBe(1);
    expect(resolved.target.column).toBe(2);
    expect(resolved.target.textSpan).toBeDefined();
    expect(resolved.target.optionSpan).toBeDefined();
    if (resolved.target.textSpan) {
      expect(source.slice(resolved.target.textSpan.from, resolved.target.textSpan.to)).toBe("BC");
    }
    if (resolved.target.optionSpan) {
      expect(source.slice(resolved.target.optionSpan.from, resolved.target.optionSpan.to)).toBe("[draw,fill=yellow]");
    }
  });

  it("allows supported matrix-cell inspector writes for matrix of nodes", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes,nodes={draw}] {
    A & B \\
  };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const matrixCellText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.matrixCell?.cellSourceId === "node:0:0:matrix-cell:1:1"
    );
    expect(matrixCellText).toBeDefined();
    if (!matrixCellText) {
      throw new Error("Expected matrix cell text element");
    }

    const descriptor = getInspectorDescriptor(matrixCellText, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    expect(descriptor.sections.some((section) => section.id === "transform")).toBe(false);

    const strokeSection = descriptor.sections.find((section) => section.id === "stroke");
    expect(strokeSection).toBeDefined();
    if (!strokeSection) {
      throw new Error("Expected stroke section");
    }
    const strokeColor = strokeSection.properties.find((property) => property.kind === "color");
    expect(strokeColor).toBeDefined();
    if (!strokeColor || strokeColor.kind !== "color") {
      throw new Error("Expected stroke color property");
    }
    expect(strokeColor.write.writable).toBe(true);
    const lineWidth = strokeSection.properties.find((property) => property.kind === "lineWidth");
    expect(lineWidth).toBeDefined();
    if (!lineWidth || lineWidth.kind !== "lineWidth") {
      throw new Error("Expected stroke line width property");
    }
    expect(lineWidth.write.writable).toBe(true);
  });

  it("allows supported matrix-cell inspector writes for matrix of math nodes", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of math nodes,nodes={draw}] {
    x^2 & y^2 \\
  };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const matrixCellText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.matrixCell?.cellSourceId === "node:0:0:matrix-cell:1:1"
    );
    expect(matrixCellText).toBeDefined();
    if (!matrixCellText) {
      throw new Error("Expected matrix cell text element");
    }

    const descriptor = getInspectorDescriptor(matrixCellText, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    expect(descriptor.sections.some((section) => section.id === "transform")).toBe(false);
    const strokeSection = descriptor.sections.find((section) => section.id === "stroke");
    expect(strokeSection).toBeDefined();
    if (!strokeSection) {
      throw new Error("Expected stroke section");
    }
    const strokeColor = strokeSection.properties.find((property) => property.kind === "color");
    expect(strokeColor).toBeDefined();
    if (!strokeColor || strokeColor.kind !== "color") {
      throw new Error("Expected stroke color property");
    }
    expect(strokeColor.write.writable).toBe(true);
    const lineWidth = strokeSection.properties.find((property) => property.kind === "lineWidth");
    expect(lineWidth).toBeDefined();
    if (!lineWidth || lineWidth.kind !== "lineWidth") {
      throw new Error("Expected stroke line width property");
    }
    expect(lineWidth.write.writable).toBe(true);
  });

  it("keeps plain matrix-cell inspector writes read-only", () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix {
    A & B \\
  };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const matrixCellText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.matrixCell?.cellSourceId === "node:0:0:matrix-cell:1:1"
    );
    expect(matrixCellText).toBeDefined();
    if (!matrixCellText) {
      throw new Error("Expected matrix cell text element");
    }

    const descriptor = getInspectorDescriptor(matrixCellText, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    expect(descriptor.sections.some((section) => section.id === "transform")).toBe(false);
    const strokeSection = descriptor.sections.find((section) => section.id === "stroke");
    expect(strokeSection).toBeDefined();
    if (!strokeSection) {
      throw new Error("Expected stroke section");
    }
    const strokeColor = strokeSection.properties.find((property) => property.kind === "color");
    expect(strokeColor).toBeDefined();
    if (!strokeColor || strokeColor.kind !== "color") {
      throw new Error("Expected stroke color property");
    }
    expect(strokeColor.write.writable).toBe(false);
    const lineWidth = strokeSection.properties.find((property) => property.kind === "lineWidth");
    expect(lineWidth).toBeDefined();
    if (!lineWidth || lineWidth.kind !== "lineWidth") {
      throw new Error("Expected stroke line width property");
    }
    expect(lineWidth.write.writable).toBe(false);
  });
});

describe("resolvePropertyTarget – tree children", () => {
  it("resolves synthetic tree-child ids with child/node spans", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child[level distance=4mm] { node[draw,fill=yellow] {left} }
    child { node {right} };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const leftText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "left"
    );
    expect(leftText?.kind).toBe("Text");
    if (!leftText || leftText.kind !== "Text" || !leftText.treeChild) {
      throw new Error("Expected a tree child text element");
    }

    const resolved = resolvePropertyTarget(source, leftText.treeChild.childSourceId);
    expect(resolved.kind).toBe("found");
    if (resolved.kind !== "found") {
      throw new Error("Expected tree-child property target");
    }
    expect(resolved.target.kind).toBe("tree-child");
    expect(resolvePropertyTargetFromParseResult(
      source,
      parseTikz(source, { recover: true }),
      leftText.treeChild.childSourceId
    )).toMatchObject({ kind: "found", target: { kind: "tree-child" } });
    expect(resolved.target.childOperationId).toBe(leftText.treeChild.childOperationId);
    expect(resolved.target.treeChildForeach).toBe(false);
    expect(resolved.target.treeChildOptionsSpan).toBeDefined();
    expect(resolved.target.treeNodeOptionsSpan).toBeDefined();
    expect(resolved.target.textSpan).toBeDefined();
    if (resolved.target.treeChildOptionsSpan) {
      expect(source.slice(resolved.target.treeChildOptionsSpan.from, resolved.target.treeChildOptionsSpan.to)).toBe("[level distance=4mm]");
    }
    if (resolved.target.treeNodeOptionsSpan) {
      expect(source.slice(resolved.target.treeNodeOptionsSpan.from, resolved.target.treeNodeOptionsSpan.to)).toBe("[draw,fill=yellow]");
    }
    if (resolved.target.textSpan) {
      expect(source.slice(resolved.target.textSpan.from, resolved.target.textSpan.to)).toBe("left");
    }
  });

  it("marks child foreach tree children as read-only targets", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child foreach \x in {A,B} { node {\x} };
\end{tikzpicture}`;
    const parsed = parseTikz(source, { recover: true });
    const path = parsed.figure.body.find((statement) => statement.kind === "Path");
    if (!path || path.kind !== "Path") {
      throw new Error("Expected path statement");
    }
    const childOperation = path.items.find((item) => item.kind === "ChildOperation");
    if (!childOperation || childOperation.kind !== "ChildOperation") {
      throw new Error("Expected child operation");
    }
    const syntheticChildId = `${path.id}:tree-child:1:${childOperation.id}`;
    const resolved = resolvePropertyTarget(source, syntheticChildId);
    expect(resolved.kind).toBe("found");
    if (resolved.kind !== "found") {
      throw new Error("Expected tree-child property target");
    }
    expect(resolved.target.kind).toBe("tree-child");
    expect(resolved.target.treeChildForeach).toBe(true);
  });

  it("builds tree-child descriptors with node controls and without Transform/Child Layout", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child[level distance=3mm,sibling distance=7mm] { node[draw,fill=yellow] {left} };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const leftText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "left"
    );
    expect(leftText?.kind).toBe("Text");
    if (!leftText || leftText.kind !== "Text") {
      throw new Error("Expected tree child text element");
    }

    const descriptor = getInspectorDescriptor(leftText, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    expect(descriptor.sections.some((section) => section.id === "transform")).toBe(false);
    expect(descriptor.sections.some((section) => section.id === "tree-child-layout")).toBe(false);
    expect(descriptor.sections.some((section) => section.id === "node")).toBe(true);
    const lineWidth = descriptor.sections
      .flatMap((section) => section.properties)
      .find((property) => property.kind === "lineWidth");
    expect(lineWidth?.kind).toBe("lineWidth");
    if (!lineWidth || lineWidth.kind !== "lineWidth") {
      throw new Error("Expected lineWidth property");
    }
    expect(lineWidth.write.writable).toBe(true);
  });

  it("keeps tree-child write targeting on the synthetic child id when style-chain command points at root path", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node[draw] {root}
    child { node[draw,fill=yellow] {left} };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const leftText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "left"
    );
    expect(leftText?.kind).toBe("Text");
    if (!leftText || leftText.kind !== "Text" || !leftText.treeChild) {
      throw new Error("Expected tree child text element");
    }

    const rootText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "root"
    );
    expect(rootText?.kind).toBe("Text");
    if (!rootText || rootText.kind !== "Text") {
      throw new Error("Expected root text element");
    }
    const syntheticStyleChainElement = {
      ...leftText,
      styleChain: rootText.styleChain
    };

    const descriptor = getInspectorDescriptor(syntheticStyleChainElement, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    expect(descriptor.writeTargetId).toBe(leftText.treeChild.childSourceId);
    const writableFillProperty = descriptor.sections
      .flatMap((section) => section.properties)
      .find((property) => property.kind === "color" && property.write.key === "fill");
    expect(writableFillProperty).toBeDefined();
    if (!writableFillProperty || writableFillProperty.kind !== "color") {
      throw new Error("Expected fill color property");
    }
    expect(writableFillProperty.write.elementId).toBe(leftText.treeChild.childSourceId);
    expect(writableFillProperty.write.writable).toBe(true);
  });

  it("keeps tree-child descriptors read-only for child foreach expansions", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node {root}
    child foreach \x in {A,B} { node[draw] {\x} };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const rootText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "root"
    );
    if (!rootText || rootText.kind !== "Text") {
      throw new Error("Expected root text element");
    }

    const parsed = parseTikz(source, { recover: true });
    const path = parsed.figure.body.find((statement) => statement.kind === "Path");
    if (!path || path.kind !== "Path") {
      throw new Error("Expected path statement");
    }
    const childOperation = path.items.find((item) => item.kind === "ChildOperation");
    if (!childOperation || childOperation.kind !== "ChildOperation") {
      throw new Error("Expected child operation");
    }
    const syntheticChildId = `${path.id}:tree-child:1:${childOperation.id}`;
    const fakeTreeChildElement = {
      ...rootText,
      styleChain: [],
      sourceRef: {
        ...rootText.sourceRef,
        sourceId: syntheticChildId
      }
    };

    const descriptor = getInspectorDescriptor(fakeTreeChildElement, {
      source,
      editHandles: rendered.semantic.editHandles
    });
    expect(descriptor.readOnlyReason).toContain("child foreach");
    expect(descriptor.sections.some((section) => section.id === "tree-child-layout")).toBe(false);
    expect(descriptor.sections.some((section) => section.id === "node")).toBe(true);
  });

  it("builds root tree descriptor with transform, layout, and node controls", () => {
    const source = String.raw`\begin{tikzpicture}
  \path[grow=right,level distance=6mm] node[draw] {root}
    child[sibling distance=5mm] { node[fill=yellow] {left} };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const rootText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "root"
    );
    expect(rootText?.kind).toBe("Text");
    if (!rootText) {
      throw new Error("Expected root tree text element");
    }

    const descriptor = buildTreeInspectorDescriptor(source, "path:0", rootText, {});
    expect(descriptor).toBeDefined();
    if (!descriptor) {
      throw new Error("Expected tree root descriptor");
    }
    expect(descriptor.sections.some((section) => section.id === "transform")).toBe(true);
    expect(descriptor.sections.some((section) => section.id === "tree-layout")).toBe(true);
    expect(descriptor.sections.some((section) => section.id === "node")).toBe(true);
  });

  it("chooses root layout write targets by existing key site with path fallback", () => {
    const source = String.raw`\begin{tikzpicture}
  \path[level distance=4mm] node[sibling distance=3mm] {root}
    child { node {left} };
\end{tikzpicture}`;
    const rendered = renderTikzToSvg(source);
    const rootText = rendered.semantic.scene.elements.find(
      (entry) => entry.kind === "Text" && entry.text === "root"
    );
    expect(rootText?.kind).toBe("Text");
    if (!rootText) {
      throw new Error("Expected root tree text element");
    }

    const descriptor = buildTreeInspectorDescriptor(source, "path:0", rootText, {});
    if (!descriptor) {
      throw new Error("Expected tree root descriptor");
    }
    const treeLayout = descriptor.sections.find((section) => section.id === "tree-layout");
    expect(treeLayout).toBeDefined();
    if (!treeLayout) {
      throw new Error("Expected tree layout section");
    }
    const levelDistance = treeLayout.properties.find((property) => property.id === "tree-level-distance");
    const siblingDistance = treeLayout.properties.find((property) => property.id === "tree-sibling-distance");
    const grow = treeLayout.properties.find((property) => property.id === "tree-grow");
    expect(levelDistance?.kind).toBe("length");
    expect(siblingDistance?.kind).toBe("length");
    expect(grow?.kind).toBe("enum");
    if (!levelDistance || levelDistance.kind !== "length" || !siblingDistance || siblingDistance.kind !== "length" || !grow || grow.kind !== "enum") {
      throw new Error("Expected tree layout properties");
    }
    const nodeSection = descriptor.sections.find((section) => section.id === "node");
    expect(nodeSection).toBeDefined();
    if (!nodeSection) {
      throw new Error("Expected node section");
    }
    const nodeShape = nodeSection.properties.find((property) => property.id === "node-shape");
    expect(nodeShape?.kind).toBe("nodeShape");
    if (!nodeShape || nodeShape.kind !== "nodeShape") {
      throw new Error("Expected node shape write target");
    }

    expect(levelDistance.write.elementId).toBe("path:0");
    expect(siblingDistance.write.elementId).toBe(nodeShape.write.elementId);
    expect(grow.write.elementId).toBe("path:0");
  });

  it("builds root tree layout without a node descriptor and tolerates malformed node layout", () => {
    const source = String.raw`\begin{tikzpicture}
  \path node[grow=,level distance=bad,sibling distance=3mm] {root}
    child { node {left} };
\end{tikzpicture}`;

    const descriptor = buildTreeInspectorDescriptor(source, "path:0", null, {});
    expect(descriptor).toBeDefined();
    if (!descriptor) {
      throw new Error("Expected tree root descriptor");
    }
    expect(descriptor.sections.some((section) => section.id === "node")).toBe(false);

    const treeLayout = descriptor.sections.find((section) => section.id === "tree-layout");
    expect(treeLayout).toBeDefined();
    if (!treeLayout) {
      throw new Error("Expected tree layout section");
    }
    const grow = treeLayout.properties.find((property) => property.id === "tree-grow");
    const levelDistance = treeLayout.properties.find((property) => property.id === "tree-level-distance");
    const siblingDistance = treeLayout.properties.find((property) => property.id === "tree-sibling-distance");
    expect(grow).toMatchObject({ kind: "enum", value: "down" });
    expect(levelDistance).toMatchObject({ kind: "length", value: 0 });
    expect(siblingDistance?.kind).toBe("length");
    if (!siblingDistance || siblingDistance.kind !== "length") {
      throw new Error("Expected sibling distance length");
    }
    expect(siblingDistance.value).toBeCloseTo(8.535827, 5);
    expect(siblingDistance.write.elementId).not.toBe("path:0");
  });
});
