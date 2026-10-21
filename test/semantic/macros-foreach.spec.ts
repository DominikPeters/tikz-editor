import { describe, expect, it } from "vitest";

import {
  evaluateSemantic,
  firstElementOfKind,
  elementsOfKind
} from "./helpers.js";

describe("semantic evaluator / macros and foreach", () => {
    it("expands foreach statements and attaches provenance metadata", () => {
      const source = String.raw`\begin{tikzpicture}
    \foreach \x in {0,1}
      \node at (\x,0) {\x};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-foreach")).toBe(false);
      const labels = elementsOfKind(result.scene.elements, "Text");
      expect(labels).toHaveLength(2);
      for (const label of labels) {
        if (label.kind !== "Text") {
          continue;
        }
        expect(label.sourceRef.sourceId.startsWith("foreach:")).toBe(true);
        expect(label.origin?.foreachStack.length).toBeGreaterThan(0);
        expect(label.origin?.foreachStack[0]?.bindings["\\x"]).toBeDefined();
      }
    });

    it("supports directly-followed nested foreach loops", () => {
      const source = String.raw`\begin{tikzpicture}
    \foreach \x in {0,1}
      \foreach \y in {0,1}
        \node at (\x,\y) {\x\y};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const labels = elementsOfKind(result.scene.elements, "Text");
      expect(labels).toHaveLength(4);
      for (const label of labels) {
        if (label.kind !== "Text") {
          continue;
        }
        expect(label.origin?.foreachStack).toHaveLength(2);
        expect(label.origin?.foreachStack[0]?.bindings["\\x"]).toBeDefined();
        expect(label.origin?.foreachStack[1]?.bindings["\\y"]).toBeDefined();
      }
    });

    it("separates original source refs from generated identity refs for statement foreach", () => {
      const source = String.raw`\begin{tikzpicture}
    \foreach \x in {0,1}
      \draw (\x,0) -- ++(1,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const paths = elementsOfKind(result.scene.elements, "Path");
      expect(paths).toHaveLength(2);
      for (const path of paths) {
        expect(path.sourceRef.sourceId.startsWith("foreach:")).toBe(true);
        expect(source.slice(path.sourceRef.sourceSpan.from, path.sourceRef.sourceSpan.to)).toBe(String.raw`\draw (\x,0) -- ++(1,0);`);
        expect(path.identityRef?.sourceId.startsWith("path:")).toBe(true);
      }
    });

    it("maps nested foreach source refs back to the original template body", () => {
      const source = String.raw`\begin{tikzpicture}
    \foreach \x in {0,1}
      \foreach \y in {0,1}
        \draw (\x,\y) -- ++(1,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const paths = elementsOfKind(result.scene.elements, "Path");
      expect(paths).toHaveLength(4);
      for (const path of paths) {
        expect(path.origin?.foreachStack).toHaveLength(2);
        expect(source.slice(path.sourceRef.sourceSpan.from, path.sourceRef.sourceSpan.to)).toBe(String.raw`\draw (\x,\y) -- ++(1,0);`);
        expect(path.identityRef?.sourceId.startsWith("path:")).toBe(true);
      }
    });

    it("maps diagnostics from expanded foreach statements back to the original source", () => {
      const source = String.raw`\begin{tikzpicture}
    \foreach \x in {0,1}
      \draw[definitely unsupported key] (\x,0) -- ++(1,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const diagnostics = result.diagnostics.filter(
        (entry) => entry.code === "unsupported-option-flag:definitely unsupported key"
      );
      expect(diagnostics.length).toBeGreaterThan(0);
      for (const diagnostic of diagnostics) {
        expect(source.slice(diagnostic.span.from, diagnostic.span.to)).toBe(String.raw`\draw[definitely unsupported key] (\x,0) -- ++(1,0);`);
      }
    });

    it("supports nested foreach loops with braced bodies", () => {
      const source = String.raw`\begin{tikzpicture}
    \foreach \x in {3,4,5}
    {
      \foreach \y in {0,1,2}
      {
        \draw (\x,\y) rectangle (\x+1,\y+1);
      }
    }
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "foreach-body-parse-error")).toBe(false);
      const paths = elementsOfKind(result.scene.elements, "Path");
      expect(paths).toHaveLength(9);
      for (const path of paths) {
        expect(path.origin?.foreachStack).toHaveLength(2);
      }
    });

    it("preserves TeX control sequence boundaries during foreach substitution", () => {
      const source = String.raw`\begin{tikzpicture}
    \foreach \x in {a}
      \foreach \y in {a}
        \node at (0,0) {$\mathstrut\x\y$};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const text = result.scene.elements.find((element) => element.kind === "Text");
      expect(text?.kind).toBe("Text");
      if (text?.kind === "Text") {
        expect(text.text).toBe(String.raw`$\mathstrut{}aa$`);
      }
    });

    it("preserves escaped spaces for shared TeX lowering", () => {
      const source = String.raw`\begin{tikzpicture}
    \node at (0,0) {min.\ utility};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const label = result.scene.elements.find((element) => element.kind === "Text");
      expect(label?.kind).toBe("Text");
      if (label?.kind === "Text") {
        expect(label.text).toBe(String.raw`min.\ utility`);
      }
    });

    it("expands path foreach operations in-place", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) foreach \x in {1,2,3} { -- (\x,0) };
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const path = result.scene.elements.find((element) => element.kind === "Path" && element.id.startsWith("scene-path:"));
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        const lineCount = path.commands.filter((command) => command.kind === "L").length;
        expect(lineCount).toBe(3);
        expect(path.origin?.foreachStack.length).toBeGreaterThan(0);
        expect(path.origin?.foreachStack[0]?.bindings["\\x"]).toBe("1");
        expect(source.slice(path.sourceRef.sourceSpan.from, path.sourceRef.sourceSpan.to)).toContain("foreach");
      }
    });

    it("expands node foreach clauses including chained clauses", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) -- (2,0) node foreach \p in {0.25,0.75} [pos=\p] {\p};
    \path (0,0) node foreach \x in {0,1} foreach \y in {a,b} {\x\y};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const labels = elementsOfKind(result.scene.elements, "Text");
      expect(labels.length).toBeGreaterThanOrEqual(6);
      const chained = labels.filter((element) => element.kind === "Text" && /^(0|1)(a|b)$/.test(element.text));
      expect(chained).toHaveLength(4);
      for (const element of chained) {
        if (element.kind !== "Text") {
          continue;
        }
        expect(element.origin?.foreachStack).toHaveLength(2);
      }
    });

    it("supports core foreach options (var/evaluate/remember/count/parse/expand list)", () => {
      const source = String.raw`\begin{tikzpicture}
    \foreach \x [var=\v,count=\i from 1,remember=\x as \prev (initially 0),evaluate=\x as \dbl using \x*2,parse=true,expand list=true] in {1,2}
      \node at (\i,0) {\prev/\dbl/\v};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const unsupported = result.diagnostics.filter((diagnostic) => diagnostic.code!.startsWith("foreach-unsupported-option:"));
      expect(unsupported).toHaveLength(0);
  
      const labels = result.scene.elements
        .filter((element) => element.kind === "Text")
        .map((element) => (element.kind === "Text" ? element.text : ""));
      expect(labels).toEqual(["0/2/1", "1/4/2"]);
    });

    it("enforces maxForeachExpansions with truncation warning", () => {
      const source = String.raw`\begin{tikzpicture}
    \foreach \x in {0,1,2,3,4}
      \node at (\x,0) {\x};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source, { maxForeachExpansions: 2 });
  
      const labels = elementsOfKind(result.scene.elements, "Text");
      expect(labels).toHaveLength(2);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "foreach-expansion-limit")).toBe(true);
    });

    it("applies \\def macro bindings to coordinate expressions", () => {
      const source = String.raw`\begin{tikzpicture}
    \def\x{3}
    \draw (\x,2) -- (\x,3);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("invalid-cartesian-coordinate"))).toBe(false);
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        const move = path.commands.find((command) => command.kind === "M");
        const line = path.commands.find((command) => command.kind === "L");
        expect(move?.kind).toBe("M");
        expect(line?.kind).toBe("L");
        if (move?.kind === "M" && line?.kind === "L") {
          expect(move.to.x).toBeCloseTo(85.3583, 3);
          expect(move.to.y).toBeCloseTo(56.9055, 3);
          expect(line.to.x).toBeCloseTo(85.3583, 3);
          expect(line.to.y).toBeCloseTo(85.3583, 3);
        }
      }
    });

    it("applies \\let aliases by value at definition time", () => {
      const source = String.raw`\begin{tikzpicture}
    \def\x{1}
    \let\y=\x
    \def\x{2}
    \draw (\y,0) -- (\x,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        const move = path.commands.find((command) => command.kind === "M");
        const line = path.commands.find((command) => command.kind === "L");
        expect(move?.kind).toBe("M");
        expect(line?.kind).toBe("L");
        if (move?.kind === "M" && line?.kind === "L") {
          expect(move.to.x).toBeCloseTo(28.4527, 3);
          expect(line.to.x).toBeCloseTo(56.9055, 3);
        }
      }
    });

    it("keeps macro definitions scoped inside nested scope statements", () => {
      const source = String.raw`\begin{tikzpicture}
    \def\x{1}
    \begin{scope}
      \def\x{2}
      \draw (\x,0) -- (\x,1);
    \end{scope}
    \draw (\x,0) -- (\x,1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const paths = elementsOfKind(result.scene.elements, "Path");
      expect(paths).toHaveLength(2);
      const first = paths[0];
      const second = paths[1];
      expect(first?.kind).toBe("Path");
      expect(second?.kind).toBe("Path");
      if (first?.kind === "Path" && second?.kind === "Path") {
        const firstMove = first.commands.find((command) => command.kind === "M");
        const secondMove = second.commands.find((command) => command.kind === "M");
        expect(firstMove?.kind).toBe("M");
        expect(secondMove?.kind).toBe("M");
        if (firstMove?.kind === "M" && secondMove?.kind === "M") {
          expect(firstMove.to.x).toBeCloseTo(56.9055, 3);
          expect(secondMove.to.x).toBeCloseTo(28.4527, 3);
        }
      }
    });

    it("applies fixed-arity \\newcommand macros in coordinate expressions", () => {
      const source = String.raw`\begin{tikzpicture}
    \newcommand{\xof}[1]{#1}
    \draw (\xof{3},0) -- (\xof{4},0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("invalid-cartesian-coordinate"))).toBe(false);
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        const move = path.commands.find((command) => command.kind === "M");
        const line = path.commands.find((command) => command.kind === "L");
        expect(move?.kind).toBe("M");
        expect(line?.kind).toBe("L");
        if (move?.kind === "M" && line?.kind === "L") {
          expect(move.to.x).toBeCloseTo(85.3583, 3);
          expect(line.to.x).toBeCloseTo(113.811, 3);
        }
      }
    });

    it("supports callable aliases via \\let for \\newcommand macros", () => {
      const source = String.raw`\begin{tikzpicture}
    \newcommand{\pair}[2]{#1/#2}
    \let\alias=\pair
    \node at (0,0) {\alias{A}{B}};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const label = result.scene.elements.find((element) => element.kind === "Text");
      expect(label?.kind).toBe("Text");
      if (label?.kind === "Text") {
        expect(label.text).toBe("A/B");
      }
    });

    it("applies renewcommand overrides with normal scope rollback", () => {
      const source = String.raw`\begin{tikzpicture}
    \newcommand{\xv}{1}
    \begin{scope}
      \renewcommand{\xv}{2}
      \draw (\xv,0) -- (\xv,1);
    \end{scope}
    \draw (\xv,0) -- (\xv,1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const paths = elementsOfKind(result.scene.elements, "Path");
      expect(paths).toHaveLength(2);
      const first = paths[0];
      const second = paths[1];
      expect(first?.kind).toBe("Path");
      expect(second?.kind).toBe("Path");
      if (first?.kind === "Path" && second?.kind === "Path") {
        const firstMove = first.commands.find((command) => command.kind === "M");
        const secondMove = second.commands.find((command) => command.kind === "M");
        expect(firstMove?.kind).toBe("M");
        expect(secondMove?.kind).toBe("M");
        if (firstMove?.kind === "M" && secondMove?.kind === "M") {
          expect(firstMove.to.x).toBeCloseTo(56.9055, 3);
          expect(secondMove.to.x).toBeCloseTo(28.4527, 3);
        }
      }
    });

    it("attaches macro provenance metadata to expanded elements", () => {
      const source = String.raw`\begin{tikzpicture}
    \def\x{A}
    \newcommand{\fmt}[1]{#1}
    \node at (0,0) {\fmt{\x}};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const label = result.scene.elements.find((element) => element.kind === "Text");
      expect(label?.kind).toBe("Text");
      if (label?.kind === "Text") {
        expect(label.origin?.foreachStack).toEqual([]);
        expect(label.origin?.macroStack?.map((entry) => entry.macroName)).toEqual(expect.arrayContaining(["\\x", "\\fmt"]));
        expect(label.origin?.macroStack?.some((entry) => entry.commandRaw === "\\newcommand")).toBe(true);
      }
    });

    it("expands fixed-arity \\newcommand macros in node text", () => {
      const source = String.raw`\begin{tikzpicture}
    \newcommand{\pair}[2]{#1-#2}
    \node at (0,0) {\pair{A}{B}};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const label = result.scene.elements.find((element) => element.kind === "Text");
      expect(label?.kind).toBe("Text");
      if (label?.kind === "Text") {
        expect(label.text).toBe("A-B");
      }
    });

    it("caps recursive macro expansion depth during semantic evaluation", () => {
      const source = String.raw`\begin{tikzpicture}
    \def\loop{\loop x}
    \node at (0,0) {\loop};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const label = result.scene.elements.find((element) => element.kind === "Text");
      expect(label?.kind).toBe("Text");
      if (label?.kind === "Text") {
        const growthCount = (label.text.match(/ x/g) ?? []).length;
        expect(growthCount).toBe(100);
        expect(label.text.startsWith(String.raw`\loop`)).toBe(true);
      }
    });

    it("supports newcommand optional/default arguments in semantic text expansion", () => {
      const source = String.raw`\begin{tikzpicture}
    \newcommand{\pair}[2][left]{#1/#2}
    \node at (0,0) {\pair{R}};
    \node at (1,0) {\pair[right]{R}};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const labels = result.scene.elements
        .filter((element) => element.kind === "Text")
        .map((element) => (element.kind === "Text" ? element.text : ""));
      expect(labels).toContain("left/R");
      expect(labels).toContain("right/R");
    });

    it("supports newcommand optional/default arguments in coordinate expansion", () => {
      const source = String.raw`\begin{tikzpicture}
    \newcommand{\xof}[2][2]{#1}
    \draw (\xof{Q},0) -- (\xof[3]{Q},0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("invalid-cartesian-coordinate"))).toBe(false);
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        const move = path.commands.find((command) => command.kind === "M");
        const line = path.commands.find((command) => command.kind === "L");
        expect(move?.kind).toBe("M");
        expect(line?.kind).toBe("L");
        if (move?.kind === "M" && line?.kind === "L") {
          expect(move.to.x).toBeCloseTo(56.9055, 3);
          expect(line.to.x).toBeCloseTo(85.3583, 3);
        }
      }
    });

    it("expands macros in shift option coordinates after foreach substitution", () => {
      const source = String.raw`\begin{tikzpicture}
    \def\rulery{1}
    \foreach \x/\xtext in {-0.6/\frac12, 0/1, 0.6/\frac32, 1.2/2}
      \draw[shift={(\x,\rulery)}] (0pt,2.5pt) -- (0pt,-2.5pt) node[above=5.5pt] {$\strut\xtext$};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code!.startsWith("invalid-shift:"))).toBe(false);
      const labels = elementsOfKind(result.scene.elements, "Text");
      expect(labels).toHaveLength(4);
    });

    it("accepts comments in tikzset styles and foreach headers", () => {
      const styleSource = String.raw`\begin{tikzpicture}[box/.style={rectangle,
    % this comment should not break style parsing
    draw=red}]
    \node [box] {test};
  \end{tikzpicture}`;
      const styleResult = evaluateSemantic(styleSource);
      expect(styleResult.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
      const styledBox = styleResult.scene.elements.find((element) => element.kind === "Path" && element.id.startsWith("scene-node-box:"));
      expect(styledBox?.kind).toBe("Path");
      if (styledBox?.kind === "Path") {
        expect(styledBox.style.stroke).toBe("#ff0000");
      }
  
      const foreachSource = String.raw`\begin{tikzpicture}
    \foreach \x [count=\i, % in-comment token should be ignored
                 var=\v] in {1,2}
      \node at (\x,0) {\v};
  \end{tikzpicture}`;
      const foreachResult = evaluateSemantic(foreachSource);
      expect(foreachResult.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
      expect(foreachResult.diagnostics.some((diagnostic) => diagnostic.code === "foreach-body-parse-error")).toBe(false);
      const textLabels = foreachResult.scene.elements.filter((element) => element.kind === "Text");
      expect(textLabels).toHaveLength(2);
    });

    it("keeps foreach-attributed handle source ids aligned with emitted element source ids", () => {
      const source = String.raw`\begin{tikzpicture}
    \foreach \x in {0,1} {
      \draw (\x,0) -- (\x,1);
    }
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const elementSourceIds = new Set(result.scene.elements.map((element) => element.sourceRef.sourceId));
      expect(elementSourceIds.size).toBe(1);
      const [elementSourceId] = [...elementSourceIds];
      expect(elementSourceId.startsWith("foreach:")).toBe(true);
      expect(result.editHandles.length).toBeGreaterThan(0);
      for (const handle of result.editHandles) {
        expect(handle.sourceRef.sourceId).toBe(elementSourceId);
      }
    });
});
