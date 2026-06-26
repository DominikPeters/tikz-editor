import { describe, expect, it } from "vitest";

import type { ScenePath } from "../../packages/core/src/semantic/types.js";
import { evaluateSemantic, elementsOfKind } from "./helpers.js";

function unsupportedOptionDiagnostics(result: ReturnType<typeof evaluateSemantic>): string[] {
  return result.diagnostics
    .map((diagnostic) => diagnostic.code)
    .filter((code): code is string => Boolean(code?.startsWith("unsupported-option")));
}

describe("semantic evaluator / backgrounds library", () => {
  it("orders background-scope elements before main-layer elements while preserving local layers", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \begin{scope}[on background layer]
    \draw (0,-1) -- (1,-1);
  \end{scope}
  \draw (0,-2) -- (1,-2);
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    expect(result.scene.layers).toEqual([
      { name: "background", order: 0 },
      { name: "main", order: 1 }
    ]);
    expect(result.scene.elements.map((element) => element.layer)).toEqual(["background", "main", "main"]);
    expect(result.scene.requiredTikzLibraries).toContain("backgrounds");
    expect(result.scene.hasStatefulGraphicsState).toBe(true);
  });

  it("applies every-on-background-layer before explicit on-background-layer options", () => {
    const source = String.raw`\begin{tikzpicture}
  \tikzset{every on background layer/.style={color=blue}}
  \begin{scope}[on background layer={color=yellow}]
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;
    const result = evaluateSemantic(source);
    const path = elementsOfKind(result.scene.elements, "Path")[0];

    expect(path?.layer).toBe("background");
    expect(path?.style.stroke).toBe("#ffff00");
    expect(unsupportedOptionDiagnostics(result)).toEqual([]);
  });

  it("applies pre-picture every picture styles to picture and background-layer scopes", () => {
    const source = String.raw`\usetikzlibrary {backgrounds}
\tikzset{
  every picture/.style={line width=1ex},
  every on background layer/.style={every picture}
}
\begin{tikzpicture}
  \draw [->] (0,0) -- (2,1);

  \begin{scope}[on background layer]
    \draw[red] (0,1) -- (2,0);
  \end{scope}
\end{tikzpicture}`;
    const result = evaluateSemantic(source, undefined, { includeContextDefinitions: true });
    const paths = elementsOfKind(result.scene.elements, "Path");
    const backgroundLine = paths.find((path) => path.layer === "background" && path.style.stroke === "#ff0000");
    const mainArrow = paths.find((path) => path.layer === "main" && path.style.stroke === "black");

    expect(backgroundLine?.style.lineWidth).toBeCloseTo(4.3);
    expect(mainArrow?.style.lineWidth).toBeCloseTo(4.3);
    expect(unsupportedOptionDiagnostics(result)).toEqual([]);
  });

  it("generates framed and gridded background hooks in registration order", () => {
    const source = String.raw`\begin{tikzpicture}[framed,gridded]
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = evaluateSemantic(source);
    const paths = elementsOfKind(result.scene.elements, "Path");

    expect(result.featureUsage.backgrounds_library).toBe("used-supported");
    expect(result.scene.requiredTikzLibraries).toContain("backgrounds");
    expect(paths[0]?.layer).toBe("background");
    expect(paths[0]?.shapeHint).toBe("rectangle");
    expect(paths[0]?.style.stroke).toBe("black");
    expect(paths[1]?.layer).toBe("background");
    expect(paths[1]?.id).toMatch(/^scene-grid-/);
    expect(paths[1]?.style.stroke).toBe("#808080");
    expect(paths[1]?.style.lineWidth).toBeCloseTo(0.2);
    expect(paths.at(-1)?.layer).toBe("main");
  });

  it("uses inner and outer frame sep for side-line hook coordinates without changing content bounds first", () => {
    const source = String.raw`\begin{tikzpicture}[inner frame sep=1pt,outer frame sep=2pt,show background top]
  \draw (0pt,0pt) -- (10pt,0pt);
\end{tikzpicture}`;
    const result = evaluateSemantic(source);
    const top = result.scene.elements[0] as ScenePath | undefined;

    expect(top?.kind).toBe("Path");
    expect(top?.layer).toBe("background");
    expect(top?.commands[0]).toMatchObject({ kind: "M" });
    expect(top?.commands[1]).toMatchObject({ kind: "L" });
    if (top?.commands[0]?.kind === "M" && top.commands[1]?.kind === "L") {
      expect(top.commands[0].to.x).toBeCloseTo(-3);
      expect(top.commands[0].to.y).toBeCloseTo(1);
      expect(top.commands[1].to.x).toBeCloseTo(13);
      expect(top.commands[1].to.y).toBeCloseTo(1);
    }
    expect(result.scene.bounds?.minX).toBeCloseTo(-3);
    expect(result.scene.bounds?.maxX).toBeCloseTo(13);
  });

  it("collects standalone tikzset background hooks", () => {
    const source = String.raw`\begin{tikzpicture}
  \tikzset{show background rectangle}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const result = evaluateSemantic(source);
    const path = elementsOfKind(result.scene.elements, "Path")[0];

    expect(result.scene.elements[0]?.layer).toBe("background");
    expect(path?.style.stroke).toBe("black");
    expect(result.scene.requiredTikzLibraries).toContain("backgrounds");
  });

  it("renders direct show-background rectangle and grid hooks with visible default paint", () => {
    const rectangle = evaluateSemantic(String.raw`\begin{tikzpicture}[show background rectangle]
  \draw (0,0) -- (1,0);
\end{tikzpicture}`);
    const grid = evaluateSemantic(String.raw`\begin{tikzpicture}[show background grid]
  \draw (0,0) -- (1,0);
\end{tikzpicture}`);

    const rectanglePath = elementsOfKind(rectangle.scene.elements, "Path")[0];
    const gridPaths = elementsOfKind(grid.scene.elements, "Path").filter((path) => path.layer === "background");
    const gridPath = gridPaths[0];

    expect(rectanglePath?.layer).toBe("background");
    expect(rectanglePath?.style.stroke).toBe("black");
    expect(gridPath?.layer).toBe("background");
    expect(gridPath?.style.stroke).toBe("#808080");
    expect(gridPath?.style.lineWidth).toBeCloseTo(0.2);
    const verticalXs = gridPaths
      .filter((path) => path.id.includes("scene-grid-x:"))
      .map((path) => path.commands[0])
      .filter((command): command is Extract<ScenePath["commands"][number], { kind: "M" }> => command?.kind === "M")
      .map((command) => command.to.x);
    const horizontalYs = gridPaths
      .filter((path) => path.id.includes("scene-grid-y:"))
      .map((path) => path.commands[0])
      .filter((command): command is Extract<ScenePath["commands"][number], { kind: "M" }> => command?.kind === "M")
      .map((command) => command.to.y);
    expect(verticalXs).toHaveLength(2);
    expect(verticalXs[0]).toBeCloseTo(0);
    expect(verticalXs[1]).toBeCloseTo(28.4528, 3);
    expect(horizontalYs).toEqual([0]);
  });

  it("uses on-background-layer color as the default fill color for fill commands", () => {
    const source = String.raw`\begin{tikzpicture}
  \fill[blue] (0,0) circle (1cm);
  \begin{scope}[on background layer={color=yellow}]
    \fill (-1,-1) rectangle (1,1);
  \end{scope}
  \begin{scope}[on background layer]
    \fill[black] (-.8,-.8) rectangle (.8,.8);
  \end{scope}
  \fill[blue!50] (-.5,-1) rectangle (.5,1);
\end{tikzpicture}`;
    const result = evaluateSemantic(source);
    const paths = elementsOfKind(result.scene.elements, "Path");
    const backgroundRectangle = paths.find((path) => path.layer === "background" && path.style.fill === "#ffff00");
    const blackRectangle = paths.find((path) => path.layer === "background" && path.style.fill === "#000000");

    expect(backgroundRectangle?.style.stroke).toBeNull();
    expect(blackRectangle).toBeDefined();
  });
});
