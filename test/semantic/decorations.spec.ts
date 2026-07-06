import { describe, expect, it } from "vitest";

import { worldPoint } from "../../packages/core/src/coords/points.js";
import { pt } from "../../packages/core/src/coords/scalars.js";
import { applyDecorationToPath, isDecorationDeferred } from "../../packages/core/src/semantic/decorations/index.js";
import { decoratePathElements, markDecorationFeature } from "../../packages/core/src/semantic/path/decorate.js";
import { createPgfRandom } from "../../packages/core/src/semantic/pgfmath/rng.js";
import { defaultStyle } from "../../packages/core/src/semantic/style/defaults.js";
import type { DecorationStyle, SceneElement, ScenePath, ScenePathCommand } from "../../packages/core/src/semantic/types.js";
import {
  evaluateSemantic,
  firstElementOfKind
} from "./helpers.js";

const SOURCE_REF = { sourceId: "test:path", sourceSpan: { from: 0, to: 0 }, sourceFingerprint: "" };

function makeDecoration(name: string | null, params: Record<string, string> = {}): DecorationStyle {
  return {
    enabled: name != null && name !== "none",
    name,
    raise: 0,
    mirror: false,
    transformRaw: null,
    pre: "lineto",
    preLength: 0,
    post: "lineto",
    postLength: 0,
    params
  };
}

function makePath(commands: ScenePathCommand[], decoration: DecorationStyle): ScenePath {
  const style = defaultStyle();
  return {
    kind: "Path",
    id: "test:path",
    runtimeId: "test:path",
    layer: "main",
    sourceRef: SOURCE_REF,
    style: {
      ...style,
      drawExplicit: true,
      decoration,
      decorationPreActions: [{ ...makeDecoration("zigzag"), params: { amplitude: "1pt" } }],
      decorationPostActions: [{ ...makeDecoration("ticks"), params: { amplitude: "1pt" } }]
    },
    styleChain: [],
    commands
  };
}

function linePath(decoration: DecorationStyle): ScenePath {
  return makePath([
    { kind: "M", to: worldPoint(pt(0), pt(0)) },
    { kind: "L", to: worldPoint(pt(80), pt(0)) }
  ], decoration);
}

describe("semantic evaluator / decorations", () => {
    it("supports decorate option and decoration key without generic unsupported diagnostics", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[decorate,decoration=zigzag] (0,0) -- (2,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:decoration")).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-flag:decorate")).toBe(false);
      expect(result.featureUsage.decorate_option).toBe("used-supported");
    });

    it("treats decorate path operation and decorate option as equivalent for basic paths", () => {
      const operationSource = String.raw`\begin{tikzpicture}
    \draw decorate[decoration=zigzag] {(0,0) -- (2,0)};
  \end{tikzpicture}`;
      const optionSource = String.raw`\begin{tikzpicture}
    \draw[decorate,decoration=zigzag] (0,0) -- (2,0);
  \end{tikzpicture}`;
  
      const opResult = evaluateSemantic(operationSource);
      const optionResult = evaluateSemantic(optionSource);
      const opPath = firstElementOfKind(opResult.scene.elements, "Path");
      const optionPath = firstElementOfKind(optionResult.scene.elements, "Path");
  
      expect(opPath?.kind).toBe("Path");
      expect(optionPath?.kind).toBe("Path");
      if (opPath?.kind === "Path" && optionPath?.kind === "Path") {
        expect(opPath.commands.length).toBe(optionPath.commands.length);
      }
      expect(opResult.featureUsage.decorate_operation).toBe("used-supported");
    });

    it("supports core decoration families without unsupported decoration-name diagnostics", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[decorate,decoration=snake] (0,0) -- (2,0);
    \draw[decorate,decoration=brace] (0,-0.5) -- (2,-0.5);
    \draw[decorate,decoration={ticks,segment length=8pt}] (0,-1) -- (2,-1);
    \draw[decorate,decoration={crosses,shape size=4pt}] (0,-1.5) -- (2,-1.5);
    \draw[decorate,decoration={Koch snowflake}] (0,-2) -- (2,-2);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const unsupportedDecorationDiagnostics = result.diagnostics.filter((diagnostic) =>
        (diagnostic.code ?? "").startsWith("unsupported-decoration-name:")
      );
      expect(unsupportedDecorationDiagnostics).toHaveLength(0);
      expect(result.featureUsage.decoration_pathmorphing).toBe("used-supported");
      expect(result.featureUsage.decoration_pathreplacing).toBe("used-supported");
      expect(result.featureUsage.decoration_shape_marks).toBe("used-supported");
      expect(result.featureUsage.decoration_fractals).toBe("used-supported");
    });

    it("does not decorate node borders from statement-level decorate", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw decorate [decoration={name=zigzag}]
      { (0,0) -- (2,2) node [left,draw=red] {Hi!} };
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const nodeBorder = result.scene.elements.find(
        (element) => element.kind === "Path" && element.id.startsWith("scene-node-box:") && element.style.stroke === "#ff0000"
      );
      expect(nodeBorder?.kind).toBe("Path");
      if (nodeBorder?.kind === "Path") {
        expect(nodeBorder.commands.some((command) => command.kind === "Z")).toBe(true);
        expect(nodeBorder.commands.length).toBeLessThanOrEqual(6);
      }
    });

    it("decorates node outlines when decorate is set on the node options", () => {
      const source = String.raw`\begin{tikzpicture}
    \node[fill=red!20,draw,decorate,decoration={bumps,mirror},minimum height=1cm]{Bumpy};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const decoratedNodeOutline = result.scene.elements.find(
        (element) => element.kind === "Path" && element.style.fill === "#ffcccc" && element.id.includes(":decorated:")
      );
      expect(decoratedNodeOutline?.kind).toBe("Path");
      if (decoratedNodeOutline?.kind === "Path") {
        expect(decoratedNodeOutline.commands.length).toBeGreaterThan(20);
      }
      expect(result.diagnostics.some((diagnostic) => (diagnostic.code ?? "").startsWith("unsupported-decoration-name:"))).toBe(false);
    });

    it("applies transform={shift only} for crosses without tangent rotation", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[red,very thick] decorate [decoration={crosses,transform={shift only},shape size=2mm}] {(0,0) -- (1,1)};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
      const path = result.scene.elements.find((element) => element.kind === "Path" && element.style.stroke === "#ff0000");
  
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        expect(path.commands.length).toBeGreaterThanOrEqual(4);
        const m1 = path.commands[0];
        const l1 = path.commands[1];
        const m2 = path.commands[2];
        const l2 = path.commands[3];
        expect(m1?.kind).toBe("M");
        expect(l1?.kind).toBe("L");
        expect(m2?.kind).toBe("M");
        expect(l2?.kind).toBe("L");
        if (m1?.kind === "M" && l1?.kind === "L" && m2?.kind === "M" && l2?.kind === "L") {
          const slope1 = (l1.to.y - m1.to.y) / (l1.to.x - m1.to.x);
          const slope2 = (l2.to.y - m2.to.y) / (l2.to.x - m2.to.x);
          expect(Math.abs(Math.abs(slope1) - 1)).toBeLessThan(0.2);
          expect(Math.abs(Math.abs(slope2) - 1)).toBeLessThan(0.2);
        }
      }
    });

    it("decorates ellipse node borders when decorate is set on the node", () => {
      const source = String.raw`\begin{tikzpicture}[decoration=zigzag]
    \node at (1.5,2.5) [fill=red!20,decorate,ellipse] {Ellipse};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const decoratedEllipse = result.scene.elements.find(
        (element) => element.kind === "Path" && element.style.fill === "#ffcccc" && element.id.includes(":decorated:")
      );
      expect(decoratedEllipse?.kind).toBe("Path");
      if (decoratedEllipse?.kind === "Path") {
        expect(decoratedEllipse.commands.length).toBeGreaterThan(20);
      }
    });

    it("renders text along path as text elements and consumes the decorated path", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[decorate,decoration={text along path,text={ABC},raise=4pt}] (0,0) -- (3,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-decoration-name:text along path")).toBe(false);
      expect(result.featureUsage.decoration_pathreplacing).toBe("used-supported");
      const textElements = result.scene.elements.filter((element) => element.kind === "Text");
      expect(textElements).toHaveLength(3);
      expect(textElements.map((element) => (element.kind === "Text" ? element.text : ""))).toEqual(["A", "B", "C"]);
      expect(result.scene.elements.some((element) => element.kind === "Path")).toBe(false);
      const first = textElements[0];
      expect(first?.kind).toBe("Text");
      if (first?.kind === "Text") {
        expect(first.position.y).toBeGreaterThan(2);
      }
    });

    it("supports reverse path for text along path", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[decorate,decoration={text along path,text={ABC},reverse path}] (0,0) -- (3,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
      const textElements = result.scene.elements.filter((element) => element.kind === "Text");
      expect(textElements).toHaveLength(3);

      const positions = textElements.map((element) => (element.kind === "Text" ? element.position.x : Number.NaN));
      expect(positions[0]).toBeGreaterThan(positions[1] ?? Number.POSITIVE_INFINITY);
      expect(positions[1]).toBeGreaterThan(positions[2] ?? Number.POSITIVE_INFINITY);
    });

    it("supports text align and indents for text along path", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[decorate,decoration={text along path,text={LL},text color=red,text align={align=left,left indent=1cm,right indent=1cm}}] (0,0) -- (4,0);
    \draw[decorate,decoration={text along path,text={CC},text color=blue,text align={align=center,left indent=1cm,right indent=1cm}}] (0,-0.5) -- (4,-0.5);
    \draw[decorate,decoration={text along path,text={RR},text color=green,text align={align=right,left indent=1cm,right indent=1cm}}] (0,-1) -- (4,-1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const left = result.scene.elements.filter((element) => element.kind === "Text" && element.style.textColor === "#ff0000");
      const center = result.scene.elements.filter((element) => element.kind === "Text" && element.style.textColor === "#0000ff");
      const right = result.scene.elements.filter((element) => element.kind === "Text" && element.style.textColor === "#00ff00");
      expect(left).toHaveLength(2);
      expect(center).toHaveLength(2);
      expect(right).toHaveLength(2);

      const leftStart = left[0];
      const centerStart = center[0];
      const rightStart = right[0];
      expect(leftStart?.kind).toBe("Text");
      expect(centerStart?.kind).toBe("Text");
      expect(rightStart?.kind).toBe("Text");
      if (leftStart?.kind === "Text" && centerStart?.kind === "Text" && rightStart?.kind === "Text") {
        expect(leftStart.position.x).toBeGreaterThan(20);
        expect(leftStart.position.x).toBeLessThan(centerStart.position.x);
        expect(centerStart.position.x).toBeLessThan(rightStart.position.x);
      }
    });

    it("handles text-along-path edge cases for empty text, raw alignment, and short paths", () => {
      const empty = applyDecorationToPath(
        linePath(makeDecoration("text along path", { text: "   " })),
        makeDecoration("text along path", { text: "   " }),
        "seed:text-empty"
      );
      expect(empty).toMatchObject({ kind: "decorated", elements: [] });

      const style = {
        ...defaultStyle(),
        stroke: "#123456",
        textColor: null,
        decoration: makeDecoration("text along path", {
          text: String.raw`i,. A\space!z`,
          "text color": ".",
          "reverse path": "off",
          "text align": "right"
        }),
        decorationPreActions: [],
        decorationPostActions: []
      };
      const result = applyDecorationToPath(
        {
          ...linePath(style.decoration),
          style
        },
        style.decoration,
        "seed:text-options"
      );
      expect(result.kind).toBe("decorated");
      const textElements = result.elements.filter((element) => element.kind === "Text");
      expect(textElements.length).toBeGreaterThan(3);
      expect(textElements[0]?.kind).toBe("Text");
      if (textElements[0]?.kind === "Text") {
        expect(textElements[0].style.textColor).toBe("#123456");
      }

      const tooLong = applyDecorationToPath(
        makePath([
          { kind: "M", to: worldPoint(pt(0), pt(0)) },
          { kind: "L", to: worldPoint(pt(6), pt(0)) }
        ], makeDecoration("text along path", { text: "too long for path", "text align": "{align=diagonal,left indent=bad,right indent=bad}" })),
        makeDecoration("text along path", { text: "too long for path", "text align": "{align=diagonal,left indent=bad,right indent=bad}" }),
        "seed:text-short"
      );
      expect(tooLong.kind).toBe("decorated");
      expect(tooLong.elements.length).toBeLessThan("too long for path".length);
    });

    it("keeps the original path for postaction text-along-path decorations", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[postaction={decorate,decoration={text along path,text={AB}}}] (0,0) -- (3,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      expect(result.scene.elements.some((element) => element.kind === "Path")).toBe(true);
      const textElements = result.scene.elements.filter((element) => element.kind === "Text");
      expect(textElements).toHaveLength(2);
    });

    it("keeps random-steps decoration reproducible with pgfmath seed", () => {
      const source = String.raw`\begin{tikzpicture}
    \pgfmathsetseed{23};
    \draw[decorate,decoration={random steps,segment length=8pt,amplitude=3pt}] (0,0) -- (3,0);
  \end{tikzpicture}`;
      const first = evaluateSemantic(source);
      const second = evaluateSemantic(source);

      const firstPath = first.scene.elements.find((element) => element.kind === "Path");
      const secondPath = second.scene.elements.find((element) => element.kind === "Path");
      expect(firstPath?.kind).toBe("Path");
      expect(secondPath?.kind).toBe("Path");
      if (firstPath?.kind === "Path" && secondPath?.kind === "Path") {
        expect(firstPath.commands).toEqual(secondPath.commands);
      }
    });

    it("clones undecorated paths for none, deferred, and unknown decorations without sharing mutable style state", () => {
      const disabled = makeDecoration(null);
      const disabledResult = applyDecorationToPath(linePath(disabled), disabled, "seed:disabled");
      expect(disabledResult.kind).toBe("decorated");

      const none = makeDecoration("none");
      const nonePath = linePath(none);
      const noneResult = applyDecorationToPath(nonePath, none, "seed:none");
      expect(noneResult.kind).toBe("decorated");
      const clonedPath = noneResult.elements[0];
      expect(clonedPath?.kind).toBe("Path");
      if (clonedPath?.kind === "Path") {
        expect(clonedPath).not.toBe(nonePath);
        clonedPath.style.decoration.params.changed = "yes";
        clonedPath.style.decorationPreActions[0].params.changed = "yes";
        expect(nonePath.style.decoration.params.changed).toBeUndefined();
        expect(nonePath.style.decorationPreActions[0].params.changed).toBeUndefined();
      }

      const deferred = makeDecoration("markings");
      const deferredResult = applyDecorationToPath(linePath(deferred), deferred, "seed:deferred");
      expect(deferredResult).toMatchObject({ kind: "unsupported", reason: "deferred", name: "markings" });
      expect(isDecorationDeferred(" name=markings ")).toBe(true);

      const unknown = makeDecoration("not a decoration");
      const unknownResult = applyDecorationToPath(linePath(unknown), unknown, "seed:unknown");
      expect(unknownResult).toMatchObject({ kind: "unsupported", reason: "unknown", name: "not a decoration" });
      expect(isDecorationDeferred("not a decoration")).toBe(false);
    });

    it("applies pre/post decoration ranges and direct shape-mark variants", () => {
      const decoration = makeDecoration("shape backgrounds", {
        "shape": "rectangle",
        "shape width": "6pt",
        "shape height": "3pt",
        "shape sep": "bad, 4pt",
        "segment length": "8pt"
      });
      decoration.pre = "moveto";
      decoration.preLength = 12;
      decoration.post = "cantor set";
      decoration.postLength = 18;
      decoration.transformRaw = "{xshift=1pt,yshift=2pt,shift={(0.1cm,0.2cm)},scale=1.1,xscale=0.8,yscale=1.2,rotate=15}";

      const result = applyDecorationToPath(linePath(decoration), decoration, "seed:ranges");
      expect(result.kind).toBe("decorated");
      const path = result.elements[0];
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        expect(path.id).toContain("shape-backgrounds");
        expect(path.undecoratedCommands).toHaveLength(2);
        expect(path.style.decoration.enabled).toBe(false);
        expect(path.commands.length).toBeGreaterThan(20);
        expect(path.commands.some((command) => command.kind === "M")).toBe(true);
      }
    });

    it("falls back to lineto for blank pre/post decorations and keeps closed full-path replacements closed", () => {
      const squareCommands: ScenePathCommand[] = [
        { kind: "M", to: worldPoint(pt(0), pt(0)) },
        { kind: "L", to: worldPoint(pt(40), pt(0)) },
        { kind: "L", to: worldPoint(pt(40), pt(40)) },
        { kind: "Z" }
      ];
      const fullDecoration = makeDecoration("lineto", { "segment length": "12pt" });
      const fullResult = applyDecorationToPath(makePath(squareCommands, fullDecoration), fullDecoration, "seed:closed-full");
      expect(fullResult.kind).toBe("decorated");
      const closedPath = fullResult.elements[0];
      expect(closedPath?.kind).toBe("Path");
      if (closedPath?.kind === "Path") {
        expect(closedPath.commands.at(-1)?.kind).toBe("Z");
      }

      const rangedDecoration = makeDecoration("zigzag", { "segment length": "10pt", amplitude: "2pt" });
      rangedDecoration.pre = "";
      rangedDecoration.preLength = 8;
      rangedDecoration.post = "name=";
      rangedDecoration.postLength = 8;
      rangedDecoration.transformRaw = "{shift only=0,shift={(bad,1pt)},xscale=2,yscale=0.5,rotate=90}";
      const rangedResult = applyDecorationToPath(linePath(rangedDecoration), rangedDecoration, "seed:blank-ranges");
      expect(rangedResult.kind).toBe("decorated");
      const rangedPath = rangedResult.elements[0];
      expect(rangedPath?.kind).toBe("Path");
      if (rangedPath?.kind === "Path") {
        expect(rangedPath.commands.length).toBeGreaterThan(8);
      }
    });

    it("handles exhausted text-path ranges, boolean variants, and current-color fallbacks", () => {
      const zeroLengthDecoration = makeDecoration("text along path", { text: "A" });
      const zeroLength = applyDecorationToPath(
        makePath([
          { kind: "M", to: worldPoint(pt(0), pt(0)) },
          { kind: "L", to: worldPoint(pt(0), pt(0)) }
        ], zeroLengthDecoration),
        zeroLengthDecoration,
        "seed:text-zero-length"
      );
      expect(zeroLength).toMatchObject({ kind: "decorated", elements: [] });

      const exhaustedDecoration = makeDecoration("text along path", {
        text: "A",
        "text align": "{align=left,left indent=80pt,right indent=2pt}"
      });
      const exhausted = applyDecorationToPath(linePath(exhaustedDecoration), exhaustedDecoration, "seed:text-exhausted");
      expect(exhausted).toMatchObject({ kind: "decorated", elements: [] });

      const fillFallbackDecoration = makeDecoration("text along path", {
        text: "`;Il A",
        "text color": ".",
        "reverse path": "0",
        "text align": "center"
      });
      const fillFallbackStyle = {
        ...defaultStyle(),
        stroke: null,
        fill: "#abcdef",
        textColor: null,
        decoration: fillFallbackDecoration,
        decorationPreActions: [],
        decorationPostActions: []
      };
      const fillFallback = applyDecorationToPath(
        { ...linePath(fillFallbackDecoration), style: fillFallbackStyle },
        fillFallbackDecoration,
        "seed:text-fill-fallback"
      );
      expect(fillFallback.kind).toBe("decorated");
      const fillText = fillFallback.elements.find((element) => element.kind === "Text");
      expect(fillText?.kind).toBe("Text");
      if (fillText?.kind === "Text") {
        expect(fillText.style.textColor).toBe("#abcdef");
      }

      const blackFallbackDecoration = makeDecoration("text along path", {
        text: "Z",
        "text color": ".",
        "reverse path": "yes"
      });
      const blackFallbackStyle = {
        ...defaultStyle(),
        stroke: null,
        fill: null,
        textColor: null,
        decoration: blackFallbackDecoration,
        decorationPreActions: [],
        decorationPostActions: []
      };
      const blackFallback = applyDecorationToPath(
        { ...linePath(blackFallbackDecoration), style: blackFallbackStyle },
        blackFallbackDecoration,
        "seed:text-black-fallback"
      );
      expect(blackFallback.kind).toBe("decorated");
      const blackText = blackFallback.elements.find((element) => element.kind === "Text");
      expect(blackText?.kind).toBe("Text");
      if (blackText?.kind === "Text") {
        expect(blackText.style.textColor).toBe("#000000");
      }
    });

    it("covers direct text-align keys, fallback booleans, unknown pre-actions, and short straight zigzags", () => {
      const directAlignDecoration = makeDecoration("text along path", {
        text: "AB",
        "reverse path": "maybe",
        "text align/align": "center",
        "text align/left indent": "4pt",
        "text align/right indent": "4pt",
        "text align": "}"
      });
      const directAlign = applyDecorationToPath(linePath(directAlignDecoration), directAlignDecoration, "seed:direct-align");
      expect(directAlign.kind).toBe("decorated");
      expect(directAlign.elements.filter((element) => element.kind === "Text")).toHaveLength(2);

      const unknownPre = makeDecoration("zigzag", { "segment length": "8pt" });
      unknownPre.pre = "not a pre-decoration";
      unknownPre.preLength = 10;
      const unknownPreResult = applyDecorationToPath(linePath(unknownPre), unknownPre, "seed:unknown-pre");
      expect(unknownPreResult.kind).toBe("decorated");
      const unknownPrePath = unknownPreResult.elements[0];
      expect(unknownPrePath?.kind).toBe("Path");
      if (unknownPrePath?.kind === "Path") {
        expect(unknownPrePath.commands.length).toBeGreaterThan(4);
      }

      const shortStraight = makeDecoration("straight zigzag", { "segment length": "40pt" });
      const shortStraightResult = applyDecorationToPath(
        makePath([
          { kind: "M", to: worldPoint(pt(0), pt(0)) },
          { kind: "L", to: worldPoint(pt(10), pt(0)) }
        ], shortStraight),
        shortStraight,
        "seed:short-straight"
      );
      expect(shortStraightResult.kind).toBe("decorated");
      const shortStraightPath = shortStraightResult.elements[0];
      expect(shortStraightPath?.kind).toBe("Path");
      if (shortStraightPath?.kind === "Path") {
        expect(shortStraightPath.commands).toHaveLength(2);
      }
    });

    it("renders less common path morphing and shape decorations through the engine", () => {
      const cases: Array<{ name: string; params?: Record<string, string> }> = [
        { name: "straight zigzag", params: { "segment length": "6pt", amplitude: "2pt" } },
        { name: "saw", params: { "segment length": "7pt", amplitude: "3pt" } },
        { name: "bent", params: { aspect: "0.25", amplitude: "5pt" } },
        { name: "waves", params: { "segment length": "10pt", "start radius": "2pt" } },
        { name: "coil", params: { "segment length": "10pt", amplitude: "2pt" } },
        { name: "expanding waves", params: { "segment length": "10pt", "start radius": "2pt" } },
        { name: "border", params: { angle: "30", amplitude: "3pt", "segment length": "8pt" } },
        { name: "random steps", params: { amplitude: "3pt", "segment length": "8pt" } },
        { name: "triangles", params: { "shape size": "5pt", "shape sep": "9pt" } },
        { name: "footprints", params: { "shape width": "6pt", "shape height": "3pt", "shape sep": "9pt" } },
        { name: "shape backgrounds", params: { shape: "triangle", "shape size": "5pt", "shape sep": "9pt" } },
        { name: "shape backgrounds", params: { shape: "circle", "shape width": "6pt", "shape height": "4pt", "shape sep": "9pt" } },
        { name: "koch curve type 1", params: { "segment length": "20pt" } },
        { name: "koch curve type 2", params: { "segment length": "20pt" } },
        { name: "curveto", params: { "segment length": "20pt" } }
      ];

      for (const testCase of cases) {
        const decoration = makeDecoration(testCase.name, testCase.params ?? {});
        const result = applyDecorationToPath(linePath(decoration), decoration, `seed:${testCase.name}`);
        expect(result.kind).toBe("decorated");
        const path = result.elements[0];
        expect(path?.kind).toBe("Path");
        if (path?.kind === "Path") {
          expect(path.commands.length, testCase.name).toBeGreaterThan(1);
        }
      }
    });

    it("falls back cleanly for degenerate decoration geometry and sparse transform options", () => {
      const degenerateCommands: ScenePathCommand[] = [
        { kind: "M", to: worldPoint(pt(0), pt(0)) },
        { kind: "L", to: worldPoint(pt(0), pt(0)) }
      ];
      for (const name of ["moveto", "brace", "bent", "waves", "bumps"]) {
        const decoration = makeDecoration(name, { "segment length": "bad", amplitude: "bad" });
        decoration.transformRaw = "{shift only=true, xshift=bad, shift=bad, scale=bad, rotate=bad}";
        const result = applyDecorationToPath(makePath(degenerateCommands, decoration), decoration, `seed:degenerate:${name}`);
        expect(result.kind).toBe("decorated");
        const path = result.elements[0];
        expect(path?.kind).toBe("Path");
        if (path?.kind === "Path") {
          expect(path.commands).toEqual(degenerateCommands);
        }
      }
    });

    it("decorates converted circle and ellipse elements while preserving non-path elements by mode", () => {
      const style = {
        ...defaultStyle(),
        decoration: makeDecoration("zigzag"),
        decorationPreActions: [{ ...makeDecoration("zigzag"), params: { amplitude: "1pt" } }],
        decorationPostActions: [{ ...makeDecoration("ticks"), params: { amplitude: "1pt" } }]
      };
      const circle: SceneElement = {
        kind: "Circle",
        id: "circle",
        runtimeId: "circle",
        layer: "main",
        sourceRef: SOURCE_REF,
        style,
        styleChain: [],
        center: worldPoint(pt(0), pt(0)),
        radius: 12
      };
      const ellipse: SceneElement = {
        kind: "Ellipse",
        id: "ellipse",
        runtimeId: "ellipse",
        layer: "main",
        sourceRef: SOURCE_REF,
        style,
        styleChain: [],
        center: worldPoint(pt(20), pt(0)),
        rx: 14,
        ry: 8,
        rotation: 15
      };
      const text: SceneElement = {
        kind: "Text",
        id: "text",
        runtimeId: "text",
        layer: "main",
        sourceRef: SOURCE_REF,
        style,
        styleChain: [],
        text: "kept",
        position: worldPoint(pt(0), pt(0))
      };
      const features: string[] = [];
      const diagnostics: string[] = [];

      const replaced = decoratePathElements(
        [circle, ellipse, text],
        makeDecoration(" zigzag "),
        "replace",
        "stmt",
        createPgfRandom(1),
        (feature, status) => features.push(`${feature}:${status}`),
        (code) => diagnostics.push(code)
      );

      expect(replaced.filter((element) => element.kind === "Path")).toHaveLength(2);
      expect(replaced.at(-1)).toBe(text);
      expect(features).toContain("decoration_pathmorphing:supported");
      expect(diagnostics).toEqual([]);

      const collected = decoratePathElements(
        [text],
        makeDecoration("unknown decoration"),
        "collect",
        "stmt",
        createPgfRandom(1),
        (feature, status) => features.push(`${feature}:${status}`),
        (code) => diagnostics.push(code)
      );
      expect(collected).toEqual([]);
    });

    it("marks every known decoration feature family and ignores empty names", () => {
      const marked: string[] = [];
      const mark = (name: string, status: "supported" | "unsupported") => marked.push(`${name}:${status}`);

      for (const name of [
        "lineto",
        "text along path",
        "Koch curve type 2",
        "triangles",
        "footprints",
        "shape backgrounds"
      ]) {
        markDecorationFeature(name, "unsupported", mark);
      }
      markDecorationFeature(" none ", "unsupported", mark);
      markDecorationFeature("   ", "unsupported", mark);

      expect(marked).toEqual([
        "decoration_pathmorphing:unsupported",
        "decoration_pathreplacing:unsupported",
        "decoration_fractals:unsupported",
        "decoration_shape_marks:unsupported",
        "decoration_footprints:unsupported",
        "decoration_shape_backgrounds:unsupported"
      ]);
    });

    it("reports unsupported decorations from decorated path elements in replace and collect modes", () => {
      const features: string[] = [];
      const diagnostics: Array<{ code: string; message: string }> = [];
      const mark = (feature: string, status: "supported" | "unsupported") => features.push(`${feature}:${status}`);
      const pushDiagnostic = (code: string, message: string) => diagnostics.push({ code, message });
      const unknown = makeDecoration("not a decoration");
      const path = linePath(unknown);

      const replaced = decoratePathElements(
        [path],
        unknown,
        "replace",
        "stmt",
        createPgfRandom(1),
        mark,
        pushDiagnostic
      );
      expect(replaced).toEqual([path]);
      expect(diagnostics.at(-1)).toMatchObject({
        code: "unsupported-decoration-name:not a decoration",
        message: "Decoration `not a decoration` is not implemented; keeping the undecorated path."
      });

      const deferred = makeDecoration("markings");
      const collected = decoratePathElements(
        [linePath(deferred)],
        deferred,
        "collect",
        "stmt",
        createPgfRandom(1),
        mark,
        pushDiagnostic
      );
      expect(collected.at(0)?.kind).toBe("Path");
      expect(diagnostics.at(-1)?.message).toContain("requires dynamic TeX code execution");
    });
});
