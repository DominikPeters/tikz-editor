import { describe, expect, it } from "vitest";

import {
  evaluateSemantic,
  firstElementOfKind,
  elementsOfKind
} from "./helpers.js";
import type { OptionEntry } from "../../packages/core/src/options/types.js";
import { worldTransform } from "../../packages/core/src/coords/transforms.js";
import { applyKvEntry } from "../../packages/core/src/semantic/style/apply-kv.js";
import type { ApplyOutcome } from "../../packages/core/src/semantic/style/apply-types.js";
import { defaultStyle } from "../../packages/core/src/semantic/style/defaults.js";
import { SHADOW_INHERIT_FILL, SHADOW_INHERIT_STROKE } from "../../packages/core/src/semantic/types.js";

describe("semantic evaluator / styles and colors", () => {
    it("reports malformed style, library, and color declarations", () => {
      const source = String.raw`\begin{tikzpicture}
    \tikzstyle{}=[draw]
    \usetikzlibrary{}
    \colorlet{}{red}
    \colorlet{accent}{}
    \definecolor{}{rgb}{1,0,0}
    \definecolor{missing-model}{}{1,0,0}
    \definecolor{unknown-model}{unknown}{1}
    \draw (0,0) -- (1,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
        "invalid-tikzstyle-name",
        "invalid-tikzlibrary",
        "invalid-colorlet-name",
        "invalid-colorlet-value",
        "invalid-definecolor-name",
        "invalid-definecolor-args",
        "invalid-definecolor-model"
      ]));
    });

    it("applies style cascade with statement options", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[red, line width=2pt] (0,0) -- (1,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        expect(path.style.stroke).toBe("#ff0000");
        expect(path.style.lineWidth).toBeCloseTo(2);
      }
    });

    it("resolves pre-picture styles before tikzpicture options", () => {
      const source = String.raw`\tikzset{wide lines/.style={line width=1ex}}
\begin{tikzpicture}[wide lines]
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
      const result = evaluateSemantic(source, undefined, { includeContextDefinitions: true });

      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        expect(path.style.lineWidth).toBeCloseTo(4.3);
      }
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain("unsupported-option-flag:wide lines");
    });

    it("uses black stroke as default for draw command", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw (0,0) -- (1,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        expect(path.style.stroke).toBe("black");
      }
    });

    it("uses named color flags as fill color for fill commands without enabling stroke", () => {
      const source = String.raw`\begin{tikzpicture}
    \fill [green] (0,0) rectangle (1,1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        expect(path.style.fill).toBe("#00ff00");
        expect(path.style.stroke).toBeNull();
      }
    });

    it("uses inherited color as the default fill paint for fill commands", () => {
      const source = String.raw`\begin{tikzpicture}
    \begin{scope}[color=yellow]
      \fill (0,0) rectangle (1,1);
    \end{scope}
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        expect(path.style.fill).toBe("#ffff00");
        expect(path.style.stroke).toBeNull();
      }
    });

    it("uses xcolor mix flags as fill color for fill commands without enabling stroke", () => {
      const source = String.raw`\begin{tikzpicture}
    \fill [green!50!white] (0,0) rectangle (1,1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        expect(path.style.fill).toBe("#80ff80");
        expect(path.style.stroke).toBeNull();
      }
    });

    it("supports lightgray named color flags", () => {
      const source = String.raw`\begin{tikzpicture}
    \fill [lightgray] (0,0) rectangle (1,1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-flag:lightgray")).toBe(false);
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        expect(path.style.fill).toBe("#bfbfbf");
      }
    });

    it("resolves `. !` xcolor mixes against the current color", () => {
      const source = String.raw`\begin{tikzpicture}
    \filldraw[violet,fill=.!50] (0,0) rectangle (1,1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        expect(path.style.stroke).toBe("#800080");
        expect(path.style.fill).toBe("#c080c0");
      }
    });

    it("uses current line width for dotted and densely dotted dash patterns", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[line width=2pt, dotted] (0,0) -- (1,0);
    \draw[densely dotted] (0,1) -- (1,1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const paths = elementsOfKind(result.scene.elements, "Path");
      expect(paths.length).toBe(2);
      const dottedPath = paths[0];
      const denselyDottedPath = paths[1];
      if (dottedPath?.kind === "Path") {
        expect(dottedPath.style.dashArray).toEqual([2, 2]);
      }
      if (denselyDottedPath?.kind === "Path") {
        expect(denselyDottedPath.style.dashArray).toEqual([0.4, 1]);
      }
    });

    it("applies every edge styles when configured on the path scope", () => {
      const source = String.raw`\begin{tikzpicture}[every edge/.style={draw,red,dashed}]
    \path (0,0) edge (1,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        expect(path.style.stroke === "red" || path.style.stroke === "#ff0000").toBe(true);
        expect(path.style.dashArray).toEqual([3, 3]);
      }
    });

    it("supports the ultra thick line width preset", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[ultra thick] (0,0) -- (1,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        expect(path.style.lineWidth).toBeCloseTo(1.6);
      }
    });

    it("treats transparent as a hide override without altering stored opacity options", () => {
      const source = String.raw`\begin{tikzpicture}
    \fill[red, opacity=0.4, transparent] (0,0) rectangle (1,1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        expect(path.style.fill).toBe("#ff0000");
        expect(path.style.fillOpacity).toBe(0);
        expect(path.style.strokeOpacity).toBe(0);
        expect(path.style.textOpacity).toBe(0);
      }
    });

    it("supports the standard TikZ line width presets and explicit line width values", () => {
      const presets: Array<{ key: string; width: number }> = [
        { key: "ultra thin", width: 0.1 },
        { key: "very thin", width: 0.2 },
        { key: "thin", width: 0.4 },
        { key: "semithick", width: 0.6 },
        { key: "thick", width: 0.8 },
        { key: "very thick", width: 1.2 },
        { key: "ultra thick", width: 1.6 }
      ];
  
      for (const preset of presets) {
        const source = String.raw`\begin{tikzpicture}
    \draw[${preset.key}] (0,0) -- (1,0);
  \end{tikzpicture}`;
        const result = evaluateSemantic(source);
        const path = firstElementOfKind(result.scene.elements, "Path");
        expect(path?.kind).toBe("Path");
        if (path?.kind === "Path") {
          expect(path.style.lineWidth).toBeCloseTo(preset.width);
        }
      }
  
      const explicitSource = String.raw`\begin{tikzpicture}
    \draw[line width=10pt] (0,0) -- (1,0);
  \end{tikzpicture}`;
      const explicitResult = evaluateSemantic(explicitSource);
      const explicitPath = firstElementOfKind(explicitResult.scene.elements, "Path");
      expect(explicitPath?.kind).toBe("Path");
      if (explicitPath?.kind === "Path") {
        expect(explicitPath.style.lineWidth).toBeCloseTo(10);
      }
    });

    it("composes scope transforms", () => {
      const source = String.raw`\begin{tikzpicture}
    \begin{scope}[xshift=1cm,yshift=2cm]
      \draw (0,0) -- (1,0);
    \end{scope}
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        const move = path.commands.find((command) => command.kind === "M");
        expect(move?.kind).toBe("M");
        if (move?.kind === "M") {
          expect(move.to.x).toBeCloseTo(28.4527, 3);
          expect(move.to.y).toBeCloseTo(56.9055, 3);
        }
      }
    });

    it("resolves dash/cap/join and opacity style options", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[opacity=0.8, draw opacity=0.6, fill opacity=0.3, dashed, line cap=round, line join=bevel] (0,0) -- (1,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        expect(path.style.opacity).toBeCloseTo(1);
        expect(path.style.strokeOpacity).toBeCloseTo(0.6);
        expect(path.style.fillOpacity).toBeCloseTo(0.3);
        expect(path.style.lineCap).toBe("round");
        expect(path.style.lineJoin).toBe("bevel");
        expect(path.style.dashArray).toEqual([3, 3]);
      }
    });

    it("resolves TikZ shading option keys into semantic shading state", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[top color=red,bottom color=blue,shading angle=30] (0,0) rectangle (1,1);
    \shade[left color=green,right color=yellow] (2,0) rectangle (3,1);
    \shade[inner color=white,outer color=black] (4,0) circle (0.5);
    \shade[ball color=red] (6,0) circle (0.5);
    \shade[middle color=yellow] (8,0) rectangle (9,1);
    \shade[lower left=red,lower right=green,upper left=blue,upper right=white] (10,0) rectangle (11,1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const unsupportedShadingOptions = result.diagnostics.filter((diagnostic) =>
        [
          "unsupported-option-key:top color",
          "unsupported-option-key:bottom color",
          "unsupported-option-key:left color",
          "unsupported-option-key:right color",
          "unsupported-option-key:inner color",
          "unsupported-option-key:outer color",
          "unsupported-option-key:ball color"
        ].includes(diagnostic.code!)
      );
      expect(unsupportedShadingOptions).toHaveLength(0);
  
      const paths = elementsOfKind(result.scene.elements, "Path");
      expect(paths.length).toBeGreaterThanOrEqual(4);
  
      const axisPath = paths[0];
      expect(axisPath?.kind).toBe("Path");
      if (axisPath?.kind === "Path") {
        expect(axisPath.style.shadeEnabled).toBe(true);
        expect(axisPath.style.shading).toBe("axis");
        expect(axisPath.style.shadingAngle).toBeCloseTo(30);
        expect(axisPath.style.axisTopColor).toBe("#ff0000");
        expect(axisPath.style.axisBottomColor).toBe("#0000ff");
        expect(axisPath.style.axisMiddleColor).toBe("#800080");
      }
  
      const sideAxisPath = paths[1];
      expect(sideAxisPath?.kind).toBe("Path");
      if (sideAxisPath?.kind === "Path") {
        expect(sideAxisPath.style.shading).toBe("axis");
        expect(sideAxisPath.style.shadingAngle).toBeCloseTo(90);
        expect(sideAxisPath.style.axisTopColor).toBe("#00ff00");
        expect(sideAxisPath.style.axisBottomColor).toBe("#ffff00");
      }
  
      const radialPath = paths[2];
      expect(radialPath?.kind).toBe("Path");
      if (radialPath?.kind === "Path") {
        expect(radialPath.style.shading).toBe("radial");
        expect(radialPath.style.radialInnerColor).toBe("#ffffff");
        expect(radialPath.style.radialOuterColor).toBe("#000000");
      }
  
      const ballPath = paths[3];
      expect(ballPath?.kind).toBe("Path");
      if (ballPath?.kind === "Path") {
        expect(ballPath.style.shading).toBe("ball");
        expect(ballPath.style.ballColor).toBe("#ff0000");
      }

      const middlePath = paths[4];
      expect(middlePath?.kind).toBe("Path");
      if (middlePath?.kind === "Path") {
        expect(middlePath.style.shading).toBe("axis");
        expect(middlePath.style.axisMiddleColor).toBe("#ffff00");
      }

      const bilinearPath = paths[5];
      expect(bilinearPath?.kind).toBe("Path");
      if (bilinearPath?.kind === "Path") {
        expect(bilinearPath.style.shading).toBe("bilinear interpolation");
        expect(bilinearPath.style.bilinearLowerLeft).toBe("#ff0000");
        expect(bilinearPath.style.bilinearLowerRight).toBe("#00ff00");
        expect(bilinearPath.style.bilinearUpperLeft).toBe("#0000ff");
        expect(bilinearPath.style.bilinearUpperRight).toBe("#ffffff");
      }
    });

    it("reports invalid style option values for uncommon key-value branches", () => {
      const identity = worldTransform(1, 0, 0, 1, 0, 0);
      const applyOptionEntry = (entry: OptionEntry, style = defaultStyle(), transform = identity): ApplyOutcome => {
        if (entry.kind !== "kv") {
          return { style, transform, diagnostics: [] };
        }
        return applyKvEntry(entry.key, entry.valueRaw, style, transform, applyOptionEntry);
      };
      const codes = [
        ["shadow scale", "bad"],
        ["shadow xshift", "bad"],
        ["shadow yshift", "bad"],
        ["path fading", "bad"],
        ["decorate", "maybe"],
        ["tips", "sideways"],
        ["shade", "maybe"],
        ["shading", ""],
        ["shading angle", "bad"],
        ["text opacity", "bad"],
        ["align", "diagonal"],
        ["line width", "bad"],
        ["double distance", "-1pt"],
        ["double distance between line centers", "bad"],
        ["radius", "bad"],
        ["x radius", "bad"],
        ["y radius", "bad"],
        ["rounded corners", "bad"],
        ["opacity", "bad"],
        ["draw opacity", "bad"],
        ["fill opacity", "bad"],
        ["line cap", "triangle"],
        ["line join", "point"],
        ["shorten <=", "bad"],
        ["shorten >=", "bad"],
        ["dash pattern", "bad"],
        ["dash phase", "bad"],
        ["dash", "bad"],
        ["xshift", "bad"],
        ["yshift", "bad"],
        ["shift", "bad"],
        ["scale", "bad"],
        ["xscale", "bad"],
        ["yscale", "bad"],
        ["rotate", "bad"],
        ["rotate around", "bad"],
        ["cm", "bad"],
        ["x", "bad"],
        ["y", "bad"]
      ].flatMap(([key, valueRaw]) =>
        applyKvEntry(key, valueRaw, defaultStyle(), identity, applyOptionEntry).diagnostics
      );

      expect(codes).toEqual(expect.arrayContaining([
        "invalid-shadow-scale:bad",
        "invalid-shadow-xshift:bad",
        "invalid-shadow-yshift:bad",
        "unsupported-path-fading:bad",
        "invalid-decorate-flag:maybe",
        "invalid-tips:sideways",
        "invalid-shade:maybe",
        "invalid-shading:",
        "invalid-shading-angle:bad",
        "invalid-text-opacity:bad",
        "invalid-align:diagonal",
        "invalid-line-width:bad",
        "invalid-double-distance:-1pt",
        "invalid-double-distance-between-line-centers:bad",
        "invalid-radius:bad",
        "invalid-x-radius:bad",
        "invalid-y-radius:bad",
        "invalid-rounded-corners:bad",
        "invalid-opacity:bad",
        "invalid-draw-opacity:bad",
        "invalid-fill-opacity:bad",
        "invalid-line-cap:triangle",
        "invalid-line-join:point",
        "invalid-shorten-start:bad",
        "invalid-shorten-end:bad",
        "invalid-dash-pattern:bad",
        "invalid-dash-phase:bad",
        "invalid-dash:bad",
        "invalid-xshift:bad",
        "invalid-yshift:bad",
        "invalid-shift:bad",
        "invalid-scale:bad",
        "invalid-xscale:bad",
        "invalid-yscale:bad",
        "invalid-rotate:bad",
        "invalid-rotate-around:bad",
        "invalid-cm:bad",
        "invalid-x-axis:bad",
        "invalid-y-axis:bad"
      ]));
    });

    it("resolves pattern and pattern color keys without unsupported-option diagnostics", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[pattern=grid,pattern color=red] (0,0) rectangle (1,1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:pattern")).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:pattern color")).toBe(false);

      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        expect(path.style.patternColor).toBe("#ff0000");
        expect(path.style.fillPattern?.kind).toBe("legacy");
        if (path.style.fillPattern?.kind === "legacy") {
          expect(path.style.fillPattern.name).toBe("grid");
          expect(path.style.fillPattern.inherentlyColored).toBe(false);
        }
      }
    });

    it("marks inherently colored patterns in semantic style descriptors", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[pattern={checkerboard light gray},pattern color=red] (0,0) rectangle (1,1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        expect(path.style.fillPattern?.kind).toBe("legacy");
        if (path.style.fillPattern?.kind === "legacy") {
          expect(path.style.fillPattern.inherentlyColored).toBe(true);
          expect(path.style.fillPattern.name).toBe("checkerboard light gray");
        }
      }
    });

    it("disables fill for pattern=none", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[fill=blue,pattern=none] (0,0) rectangle (1,1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        expect(path.style.fill).toBeNull();
        expect(path.style.fillPattern).toBeNull();
      }
    });

    it("falls back to solid fill for unsupported custom patterns", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[pattern={CustomPattern}] (0,0) rectangle (1,1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-pattern:custompattern")).toBe(true);

      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        expect(path.style.fillPattern).toBeNull();
        expect(path.style.fill).toBe("black");
      }
    });

    it("parses patterns.meta options into canonical descriptors", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[pattern={Lines[angle=45,distance={3pt/sqrt(2)},line width=0.8pt,xshift=1pt,yshift=2pt]}] (0,0) rectangle (1,1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        expect(path.style.fillPattern?.kind).toBe("meta-lines");
        if (path.style.fillPattern?.kind === "meta-lines") {
          expect(path.style.fillPattern.angle).toBeCloseTo(45, 6);
          expect(path.style.fillPattern.distance).toBeCloseTo(2.1213, 3);
          expect(path.style.fillPattern.lineWidth).toBeCloseTo(0.8, 4);
          expect(path.style.fillPattern.xshift).toBeCloseTo(1, 4);
          expect(path.style.fillPattern.yshift).toBeCloseTo(2, 4);
        }
      }
    });

    it("treats node-local pattern styles as fill-enabling", () => {
      const source = String.raw`\begin{tikzpicture}
    \node[draw,pattern=dots,pattern color=blue] at (0,0) {A};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const nodeBox = firstElementOfKind(result.scene.elements, "Path");
      expect(nodeBox?.kind).toBe("Path");
      if (nodeBox?.kind === "Path") {
        expect(nodeBox.style.fill).not.toBeNull();
        expect(nodeBox.style.fillPattern?.kind).toBe("legacy");
      }
    });

    it("resolves TikZ shadow option keys into semantic shadow layers", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[drop shadow] (0,0) rectangle (1,1);
    \draw[copy shadow={opacity=.4}] (2,0) rectangle (3,1);
    \draw[double copy shadow={shadow xshift=1ex,shadow yshift=1ex}] (4,0) rectangle (5,1);
    \draw[circular glow] (6,0) rectangle (7,1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const unsupportedShadowDiagnostics = result.diagnostics.filter((diagnostic) =>
        [
          "unsupported-option-key:general shadow",
          "unsupported-option-key:drop shadow",
          "unsupported-option-key:copy shadow",
          "unsupported-option-key:double copy shadow",
          "unsupported-option-key:circular drop shadow",
          "unsupported-option-key:circular glow"
        ].includes(diagnostic.code!)
      );
      expect(unsupportedShadowDiagnostics).toHaveLength(0);
  
      const paths = elementsOfKind(result.scene.elements, "Path");
      expect(paths.length).toBeGreaterThanOrEqual(4);
  
      const dropShadow = paths[0];
      expect(dropShadow?.kind).toBe("Path");
      if (dropShadow?.kind === "Path") {
        expect(dropShadow.style.shadowLayers).toHaveLength(1);
        expect(dropShadow.style.shadowLayers[0]?.scale).toBeCloseTo(1, 4);
        expect(dropShadow.style.shadowLayers[0]?.xshift).toBeCloseTo(2.15, 2);
        expect(dropShadow.style.shadowLayers[0]?.yshift).toBeCloseTo(-2.15, 2);
        expect(dropShadow.style.shadowLayers[0]?.style.stroke).toBeNull();
        expect(dropShadow.style.shadowLayers[0]?.style.fill).toBe("#808080");
        expect(dropShadow.style.shadowLayers[0]?.style.fillOpacity).toBeCloseTo(0.5, 4);
        expect(dropShadow.style.shadowLayers[0]?.style.strokeOpacity).toBeCloseTo(0.5, 4);
      }
  
      const copyShadow = paths[1];
      expect(copyShadow?.kind).toBe("Path");
      if (copyShadow?.kind === "Path") {
        expect(copyShadow.style.shadowLayers).toHaveLength(1);
        expect(copyShadow.style.shadowLayers[0]?.xshift).toBeCloseTo(2.15, 2);
        expect(copyShadow.style.shadowLayers[0]?.yshift).toBeCloseTo(-2.15, 2);
        expect(copyShadow.style.shadowLayers[0]?.style.stroke).toBe(SHADOW_INHERIT_STROKE);
        expect(copyShadow.style.shadowLayers[0]?.style.fill).toBe(SHADOW_INHERIT_FILL);
        expect(copyShadow.style.shadowLayers[0]?.style.fillOpacity).toBeCloseTo(0.4, 4);
        expect(copyShadow.style.shadowLayers[0]?.style.strokeOpacity).toBeCloseTo(0.4, 4);
        expect(copyShadow.style.shadowLayers[0]?.style.shadeEnabled).toBe(false);
      }
  
      const doubleCopyShadow = paths[2];
      expect(doubleCopyShadow?.kind).toBe("Path");
      if (doubleCopyShadow?.kind === "Path") {
        expect(doubleCopyShadow.style.shadowLayers).toHaveLength(2);
        expect(doubleCopyShadow.style.shadowLayers[0]?.xshift).toBeCloseTo(8.6, 2);
        expect(doubleCopyShadow.style.shadowLayers[0]?.yshift).toBeCloseTo(8.6, 2);
        expect(doubleCopyShadow.style.shadowLayers[1]?.xshift).toBeCloseTo(4.3, 2);
        expect(doubleCopyShadow.style.shadowLayers[1]?.yshift).toBeCloseTo(4.3, 2);
      }
  
      const circularGlow = paths[3];
      expect(circularGlow?.kind).toBe("Path");
      if (circularGlow?.kind === "Path") {
        expect(circularGlow.style.shadowLayers).toHaveLength(1);
        expect(circularGlow.style.shadowLayers[0]?.fade).toBe("circle-fuzzy-edge-15");
        expect(circularGlow.style.shadowLayers[0]?.scale).toBeCloseTo(1.25, 4);
        expect(circularGlow.style.shadowLayers[0]?.xshift).toBeCloseTo(0, 4);
        expect(circularGlow.style.shadowLayers[0]?.yshift).toBeCloseTo(0, 4);
        expect(circularGlow.style.shadowLayers[0]?.style.fill).toBe("#000000");
      }
    });

    it("keeps even-odd compound geometry for filled shadow preactions", () => {
      const source = String.raw`\begin{tikzpicture}[even odd rule]
    \draw[general shadow={fill=red}] (0,0) circle (.5) (0.5,0) circle (.5);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        expect(path.style.shadowLayers).toHaveLength(1);
        expect(path.style.shadowLayers[0]?.style.fillRule).toBe("evenodd");
        expect(path.commands.filter((command) => command.kind === "Z")).toHaveLength(2);
      }
    });

    it("supports arrows and >/< shorthand keys used in tikz arrow specs", () => {
      const source = String.raw`\begin{tikzpicture}[>=Stealth]
    \draw[arrows={-Latex[open,length=10pt]}] (0,0) -- (2,0);
    \draw[>->] (0,1) -- (2,1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:arrows")).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:>")).toBe(false);
  
      const paths = elementsOfKind(result.scene.elements, "Path");
      expect(paths.length).toBeGreaterThanOrEqual(2);
  
      const explicitArrows = paths[0];
      const shorthandArrows = paths[1];
      expect(explicitArrows?.kind).toBe("Path");
      expect(shorthandArrows?.kind).toBe("Path");
      if (explicitArrows?.kind === "Path" && shorthandArrows?.kind === "Path") {
        expect(explicitArrows.style.markerStart).toBeNull();
        expect(explicitArrows.style.markerEnd?.tips[0]?.kind).toBe("latex");
        expect(explicitArrows.style.markerEnd?.tips[0]?.open).toBe(true);
        expect(explicitArrows.style.markerEnd?.tips[0]?.length).toBeCloseTo(10, 3);
  
        expect(shorthandArrows.style.markerStart?.tips[0]?.kind).toBe("stealth");
        expect(shorthandArrows.style.markerEnd?.tips[0]?.kind).toBe("stealth");
      }
    });

    it("recognizes additional arrows.meta tip names and aliases from pgf source", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[-{Straight Barb[]}] (0,0) -- (2,0);
    \draw[-{Arc Barb[]}] (0,1) -- (2,1);
    \draw[-{Tee Barb[]}] (0,2) -- (2,2);
    \draw[-{Kite[]}] (0,3) -- (2,3);
    \draw[-{Square[]}] (0,4) -- (2,4);
    \draw[-{Circle[]}] (0,5) -- (2,5);
    \draw[-{Rays[n=6]}] (0,6) -- (2,6);
    \draw[-{Bracket[] Parenthesis[] Diamond[] Rectangle[] Ellipse[]}] (0,7) -- (2,7);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
      const paths = elementsOfKind(result.scene.elements, "Path");
  
      expect(paths.length).toBeGreaterThanOrEqual(8);
  
      const expectedKinds = ["straight-barb", "arc-barb", "tee-barb", "kite", "square", "circle", "rays"] as const;
      for (let index = 0; index < expectedKinds.length; index += 1) {
        const path = paths[index];
        expect(path?.kind).toBe("Path");
        if (path?.kind === "Path") {
          expect(path.style.markerEnd?.tips[0]?.kind).toBe(expectedKinds[index]);
        }
      }
  
      const raysPath = paths[6];
      expect(raysPath?.kind).toBe("Path");
      if (raysPath?.kind === "Path") {
        expect(raysPath.style.markerEnd?.tips[0]?.rayCount).toBe(6);
      }
  
      const aliasPath = paths[7];
      expect(aliasPath?.kind).toBe("Path");
      if (aliasPath?.kind === "Path") {
        expect(aliasPath.style.markerEnd?.tips.map((tip) => tip.kind)).toEqual(["tee-barb", "arc-barb", "kite", "square", "circle"]);
      }
    });

    it("uses computer modern rightarrow as the default > tip in arrows.meta-style specs", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[->]        (0,0)   -- (1,0);
    \draw[>-Stealth] (0,0.3) -- (1,0.3);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
      const paths = elementsOfKind(result.scene.elements, "Path");
  
      expect(paths.length).toBeGreaterThanOrEqual(2);
  
      const first = paths[0];
      const second = paths[1];
      expect(first?.kind).toBe("Path");
      expect(second?.kind).toBe("Path");
      if (first?.kind === "Path" && second?.kind === "Path") {
        expect(first.style.markerStart).toBeNull();
        expect(first.style.markerEnd?.tips[0]?.kind).toBe("cm-rightarrow");
        expect(second.style.markerStart?.tips[0]?.kind).toBe("cm-rightarrow");
        expect(second.style.markerEnd?.tips[0]?.kind).toBe("stealth");
      }
    });

    it("treats `triangle 45` as a single arrow tip", () => {
      const source = String.raw`\begin{tikzpicture}[>=triangle 45]
    \draw[->] (0,0) -- (1,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const path = elementsOfKind(result.scene.elements, "Path")[0];
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        expect(path.style.markerEnd?.tips).toHaveLength(1);
        expect(path.style.markerEnd?.tips[0]?.kind).toBe("triangle");
      }
    });

    it("does not split multi-word arrow tip names without explicit [] delimiters", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[-{Computer Modern Rightarrow Stealth[]}] (0,0) -- (1,0);
    \draw[-{Computer Modern Rightarrow[] Stealth[]}] (0,1) -- (1,1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
      const paths = elementsOfKind(result.scene.elements, "Path");

      expect(paths.length).toBeGreaterThanOrEqual(2);

      const withoutDelimiter = paths[0];
      const withDelimiter = paths[1];
      expect(withoutDelimiter?.kind).toBe("Path");
      expect(withDelimiter?.kind).toBe("Path");
      if (withoutDelimiter?.kind === "Path" && withDelimiter?.kind === "Path") {
        expect(withoutDelimiter.style.markerEnd?.tips).toHaveLength(1);
        expect(withDelimiter.style.markerEnd?.tips).toHaveLength(2);
      }
    });

    it("treats double distance as enabling a double stroke", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[thin,double distance=2pt] (0,0) arc (180:90:1cm);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        expect(path.style.doubleStroke).toBe(true);
        expect(path.style.doubleDistance).toBeCloseTo(2);
      }
    });

    it("uses key-value double options as the double-stroke color", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[draw=red,double=blue] (-2.5,2.5) -- (2.5,2.5);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:double")).toBe(false);
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        expect(path.style.stroke).toBe("#ff0000");
        expect(path.style.doubleStroke).toBe(true);
        expect(path.style.doubleColor).toBe("#0000ff");
      }
    });

    it("supports center-to-center double line distances independently of line width order", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[double distance between line centers=3pt,line width=2pt] (0,0) -- (1,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-key:double distance between line centers")).toBe(false);
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        expect(path.style.lineWidth).toBeCloseTo(2);
        expect(path.style.doubleStroke).toBe(true);
        expect(path.style.doubleLineCenterDistance).toBeCloseTo(3);
      }
    });

    it("supports double=none and double equal sign distance", () => {
      const source = String.raw`\begin{tikzpicture}
    \draw[double,double=none] (0,0) -- (1,0);
    \draw[line width=1pt,double equal sign distance] (0,1) -- (1,1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
      const paths = elementsOfKind(result.scene.elements, "Path");

      expect(paths[0]?.style.doubleStroke).toBe(false);
      expect(paths[1]?.style.doubleStroke).toBe(true);
      expect(paths[1]?.style.doubleLineCenterDistance).toBeCloseTo(0.45 * 4.3);
    });

    it("applies scope/statement precedence and fill command defaults", () => {
      const source = String.raw`\begin{tikzpicture}[blue,line width=1pt]
    \begin{scope}[red,line width=2pt]
      \draw[green,line width=3pt] (0,0) -- (1,0);
    \end{scope}
    \draw (0,1) -- (1,1);
    \fill (0,2) -- (1,2) -- (1,3) -- cycle;
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const paths = elementsOfKind(result.scene.elements, "Path");
      expect(paths.length).toBeGreaterThanOrEqual(3);
  
      const drawInScope = paths[0];
      expect(drawInScope?.kind).toBe("Path");
      if (drawInScope?.kind === "Path") {
        expect(drawInScope.style.stroke).toBe("#00ff00");
        expect(drawInScope.style.lineWidth).toBeCloseTo(3);
      }
  
      const drawOutsideScope = paths[1];
      expect(drawOutsideScope?.kind).toBe("Path");
      if (drawOutsideScope?.kind === "Path") {
        expect(drawOutsideScope.style.stroke).toBe("#0000ff");
        expect(drawOutsideScope.style.lineWidth).toBeCloseTo(1);
      }
  
      const fillPath = paths[2];
      expect(fillPath?.kind).toBe("Path");
      if (fillPath?.kind === "Path") {
        expect(fillPath.style.fill).toBe("#0000ff");
        expect(fillPath.style.stroke).toBeNull();
      }
    });

    it("does not inherit scope fill paint into draw command defaults", () => {
      const source = String.raw`\begin{tikzpicture}
    \begin{scope}[fill=blue]
      \draw[gray!65] (0,0) circle [radius=1cm];
    \end{scope}
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);

      const circle = firstElementOfKind(result.scene.elements, "Circle");
      expect(circle?.kind).toBe("Circle");
      if (circle?.kind === "Circle") {
        expect(circle.style.stroke).toBe("#acacac");
        expect(circle.style.fill).toBeNull();
      }
    });

    it("applies custom styles defined via \\tikzset, \\tikzstyle, and \\pgfkeys", () => {
      const source = String.raw`\begin{tikzpicture}
    \tikzset{
      base/.style={draw=red},
      base/.append style={ultra thick}
    }
    \tikzstyle{legacy}=[dashed]
    \pgfkeys{/tikz/.cd, helper/.style={line width=2pt}}
    \draw[base,legacy,helper] (0,0) -- (1,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-flag:base")).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-flag:legacy")).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-option-flag:helper")).toBe(false);
  
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind === "Path") {
        expect(path.style.stroke).toBe("#ff0000");
        expect(path.style.lineWidth).toBeCloseTo(2, 6);
        expect(path.style.dashArray).toEqual([3, 3]);
      }
    });

    it("supports custom style prefixes, arguments, and recursion diagnostics", () => {
      const source = String.raw`\begin{tikzpicture}
    \tikzset{
      pair/.style 2 args={draw=#1,fill=#2},
      pair/.prefix style={line width=2pt},
      recursive/.style={recursive,draw=red}
    }
    \draw[pair={red,blue}] (0,0) rectangle (1,1);
    \draw[recursive] (2,0) -- (3,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
      const paths = elementsOfKind(result.scene.elements, "Path");

      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "custom-style-recursion:recursive")).toBe(true);
      const styledPath = paths[0];
      expect(styledPath?.kind).toBe("Path");
      if (styledPath?.kind === "Path") {
        expect(styledPath.style.lineWidth).toBeCloseTo(2);
        expect(styledPath.style.stroke).toBe("#ff0000");
        expect(styledPath.style.fill).toBe("#0000ff");
      }
    });

    it("keeps help lines defaults when appending dashed style", () => {
      const source = String.raw`\begin{tikzpicture}[help lines/.append style={dashed}]
    \draw[help lines] grid(3,2);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const gridPath = result.scene.elements.find((element) => element.kind === "Path" && element.id.includes("scene-grid-"));
      expect(gridPath?.kind).toBe("Path");
      if (gridPath?.kind === "Path") {
        expect(gridPath.style.stroke).toBe("#808080");
        expect(gridPath.style.lineWidth).toBeCloseTo(0.2, 6);
        expect(gridPath.style.dashArray).toEqual([3, 3]);
      }
    });

    it("resolves custom style overwrite order left-to-right", () => {
      const source = String.raw`\begin{tikzpicture}
    \tikzset{
      style1/.style={draw=red,fill=blue},
      style2/.style={draw=green}
    }
    \draw[style1,style2] (0,0) rectangle (1,1);
    \draw[style2,style1] (2,0) rectangle (3,1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const paths = elementsOfKind(result.scene.elements, "Path");
      expect(paths.length).toBeGreaterThanOrEqual(2);
      const first = paths[0];
      const second = paths[1];
      expect(first?.kind).toBe("Path");
      expect(second?.kind).toBe("Path");
      if (first?.kind === "Path" && second?.kind === "Path") {
        expect(first.style.fill).toBe("#0000ff");
        expect(first.style.stroke).toBe("#00ff00");
        expect(second.style.fill).toBe("#0000ff");
        expect(second.style.stroke).toBe("#ff0000");
      }
    });

    it("lets later `font=` assignments override earlier style-provided font commands", () => {
      const source = String.raw`\begin{tikzpicture}[nd/.style={font=\bfseries}]
    \node at (0,0) {base};
    \node[nd,font=\footnotesize] at (1,0) {override};
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const base = result.scene.elements.find((element) => element.kind === "Text" && element.text === "base");
      const override = result.scene.elements.find((element) => element.kind === "Text" && element.text === "override");
      expect(base?.kind).toBe("Text");
      expect(override?.kind).toBe("Text");
      if (base?.kind === "Text" && override?.kind === "Text") {
        expect(override.style.fontWeight).toBe("normal");
        expect(override.style.fontSize).toBeCloseTo(base.style.fontSize * 0.8, 3);
      }
    });

    it("supports definecolor aliases across common xcolor models", () => {
      const source = String.raw`\begin{tikzpicture}
    \definecolor{fromrgbdecimal}{rgb}{0.1,0.2,0.3}
    \definecolor{fromrgbint}{RGB}{26,43,60}
    \definecolor{fromgraydecimal}{gray}{0.5}
    \definecolor{fromgrayint}{Gray}{8}
    \definecolor{fromcmy}{cmy}{0.1,0.2,0.3}
    \definecolor{fromcmyk}{cmyk}{0,0.5,0.5,0}
    \definecolor{fromhsb}{hsb}{0,1,1}
    \definecolor{fromhsbint}{HSB}{80,240,240}
    \fill[fromrgbdecimal] (0,0) rectangle +(1,1);
    \fill[fromrgbint] (2,0) rectangle +(1,1);
    \fill[fromgraydecimal] (4,0) rectangle +(1,1);
    \fill[fromgrayint] (6,0) rectangle +(1,1);
    \fill[fromcmy] (8,0) rectangle +(1,1);
    \fill[fromcmyk] (10,0) rectangle +(1,1);
    \fill[fromhsb] (12,0) rectangle +(1,1);
    \fill[fromhsbint] (14,0) rectangle +(1,1);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const unsupportedAliasDiagnostics = result.diagnostics.filter((diagnostic) =>
        diagnostic.code!.startsWith("unsupported-option-flag:from")
      );
      expect(unsupportedAliasDiagnostics).toHaveLength(0);
  
      const fillColors = result.scene.elements
        .filter((element) => element.kind === "Path" && element.style.fill != null)
        .map((element) => (element.kind === "Path" ? element.style.fill : null))
        .filter((value): value is string => value != null);
  
      expect(fillColors).toContain("#1a334d");
      expect(fillColors).toContain("#1a2b3c");
      expect(fillColors).toContain("#808080");
      expect(fillColors).toContain("#888888");
      expect(fillColors).toContain("#e6ccb3");
      expect(fillColors).toContain("#ff8080");
      expect(fillColors).toContain("#ff0000");
      expect(fillColors).toContain("#00ff00");
    });

    it("records path style-chain ordering and contribution snapshots", () => {
      const source = String.raw`\begin{tikzpicture}
    \tikzset{base/.style={line width=1pt,blue}}
    \begin{scope}[base,line width=2pt]
      \draw[red] (0,0) -- (1,0);
    \end{scope}
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind !== "Path") {
        return;
      }
  
      const namedStyleIndex = path.styleChain.findIndex((entry) => entry.kind === "named-style" && entry.styleName === "base");
      const scopeIndex = path.styleChain.findIndex(
        (entry) => entry.kind === "scope" && entry.sourceRef?.sourceKind === "scope-statement"
      );
      const commandIndex = path.styleChain.findIndex(
        (entry) => entry.kind === "command" && entry.sourceRef?.sourceKind === "path-statement"
      );
      expect(namedStyleIndex).toBeGreaterThan(-1);
      expect(scopeIndex).toBeGreaterThan(-1);
      expect(commandIndex).toBeGreaterThan(-1);
      expect(namedStyleIndex).toBeLessThan(scopeIndex);
      expect(scopeIndex).toBeLessThan(commandIndex);
  
      const commandLayer = path.styleChain[commandIndex];
      expect(commandLayer?.before.stroke).toBe("#0000ff");
      expect(commandLayer?.after.stroke).toBe("#ff0000");
      expect(commandLayer?.resolvedContributions.stroke).toBe("#ff0000");
    });

    it("records .style/.append style/.prefix style fragments as ordered named-style layers with spans", () => {
      const source = String.raw`\begin{tikzpicture}
    \tikzset{
      box/.style={line width=1pt},
      box/.append style={red},
      box/.prefix style={draw}
    }
    \draw[box] (0,0) -- (1,0);
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const path = firstElementOfKind(result.scene.elements, "Path");
      expect(path?.kind).toBe("Path");
      if (path?.kind !== "Path") {
        return;
      }
  
      const namedBoxLayers = path.styleChain.filter(
        (entry): entry is Extract<(typeof path.styleChain)[number], { kind: "named-style" }> =>
          entry.kind === "named-style" && entry.styleName === "box"
      );
      expect(namedBoxLayers).toHaveLength(3);
      for (const layer of namedBoxLayers) {
        expect(layer.sourceRef?.sourceId.length ?? 0).toBeGreaterThan(0);
        expect(layer.sourceRef?.sourceSpan).toBeDefined();
      }
  
      const prefixSlice = source.slice(namedBoxLayers[0].sourceRef!.sourceSpan!.from, namedBoxLayers[0].sourceRef!.sourceSpan!.to);
      const styleSlice = source.slice(namedBoxLayers[1].sourceRef!.sourceSpan!.from, namedBoxLayers[1].sourceRef!.sourceSpan!.to);
      const appendSlice = source.slice(namedBoxLayers[2].sourceRef!.sourceSpan!.from, namedBoxLayers[2].sourceRef!.sourceSpan!.to);
      expect(prefixSlice).toContain(".prefix style");
      expect(styleSlice).toContain(".style");
      expect(appendSlice).toContain(".append styl");
    });

    it("keeps independent style chains for matrix wrapper and generated cell elements", () => {
      const source = String.raw`\begin{tikzpicture}
    \matrix[matrix of nodes,draw,nodes={circle,draw}] (m) {
      A & B \\
      C & D \\
    };
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const matrixWrapper = result.scene.elements.find((element) => element.kind === "Path" && element.id.startsWith("scene-node-box:"));
      const matrixCellTexts = result.scene.elements.filter((element) => element.kind === "Text" && element.id.includes("matrix-cell:"));
      expect(matrixWrapper?.kind).toBe("Path");
      expect(matrixCellTexts).toHaveLength(4);
      if (matrixWrapper?.kind !== "Path") {
        return;
      }
  
      const wrapperTailSourceId = matrixWrapper.styleChain[matrixWrapper.styleChain.length - 1]?.sourceRef?.sourceId ?? "";
      expect(wrapperTailSourceId.includes("node:")).toBe(true);
  
      const cellTailSourceIds = matrixCellTexts.map(
        (cell) => cell.styleChain[cell.styleChain.length - 1]?.sourceRef?.sourceId ?? ""
      );
      expect(cellTailSourceIds.every((sourceId) => sourceId.includes("matrix-cell:"))).toBe(true);
      expect(new Set(cellTailSourceIds).size).toBe(4);
    });

    it("emits non-empty source ids on style-chain entries and valid source spans where available", () => {
      const source = String.raw`\begin{tikzpicture}[every edge/.style={draw,blue},every node/.style={draw}]
    \tikzset{box/.style={line width=1pt},box/.append style={red},box/.prefix style={draw}}
    \begin{scope}[box]
      \draw[red] (0,0) -- (1,0) edge[dashed] (2,0);
      \node[circle,fill=red] at (0,1) {A};
    \end{scope}
  \end{tikzpicture}`;
      const result = evaluateSemantic(source);
  
      const allEntries = result.scene.elements.flatMap((element) => element.styleChain);
      expect(allEntries.length).toBeGreaterThan(0);
      for (const entry of allEntries) {
        expect(entry.sourceRef?.sourceId.length ?? 0).toBeGreaterThan(0);
        const span = entry.sourceRef?.sourceSpan;
        if (!span) {
          continue;
        }
        expect(span.from).toBeGreaterThanOrEqual(0);
        expect(span.to).toBeLessThanOrEqual(source.length);
        expect(span.to).toBeGreaterThan(span.from);
        expect(source.slice(span.from, span.to).length).toBeGreaterThan(0);
      }
    });
});
