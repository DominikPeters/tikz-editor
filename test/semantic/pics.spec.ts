import { describe, expect, it } from "vitest";

import { elementsOfKind, evaluateSemantic } from "./helpers.js";

describe("semantic pic operations", () => {
  it("renders inline pics/code at an explicit placement", () => {
    const source = String.raw`\begin{tikzpicture}
  \pic at (1,0) [pics/code={\draw (0,0) -- (1,0); \node at (.5,.25) {P};}] {};
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
    const paths = elementsOfKind(result.scene.elements, "Path");
    const texts = elementsOfKind(result.scene.elements, "Text");
    expect(paths).toHaveLength(1);
    expect(texts.map((text) => text.text)).toContain("P");
    expect(paths[0]?.sourceRef.sourceId).toBe("pic-operation:0:0");
    expect(paths[0]?.origin?.picTemplateLocalTargetId).toBe("path:0");
  });

  it("renders simple .pic and pics/name/.style code definitions", () => {
    const source = String.raw`\begin{tikzpicture}[pics/dot/.style={code={\fill (0,0) circle [radius=1pt];}}]
  \tikzset{tick/.pic={\draw (0,-.1) -- (0,.1);}}
  \pic at (0,0) {tick};
  \pic at (1,0) {dot};
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
    expect(elementsOfKind(result.scene.elements, "Path").filter((path) => path.origin?.picStack?.length)).toHaveLength(2);
  });

  it("places path-attached pics using pos", () => {
    const source = String.raw`\begin{tikzpicture}
  \tikzset{mark/.pic={\draw (0,0) -- (.2,0);}}
  \path (0,0) -- (2,0) pic[pos=.5] {mark};
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
    const generatedPicPath = elementsOfKind(result.scene.elements, "Path").find((path) => path.origin?.picStack?.length);
    expect(generatedPicPath).toBeDefined();
    const start = generatedPicPath?.commands[0];
    expect(start?.kind).toBe("M");
    if (start?.kind === "M") {
      expect(start.to.x).toBeGreaterThan(20);
      expect(start.to.x).toBeLessThan(40);
      expect(Math.abs(start.to.y)).toBeLessThan(1e-6);
    }
  });

  it("applies pic-local color options to generated draw commands", () => {
    const source = String.raw`\begin{tikzpicture}
  \tikzset{mark/.pic={\draw (0,0) -- (.2,0);}}
  \path (0,0) pic [red] {mark};
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    const generatedPicPath = elementsOfKind(result.scene.elements, "Path").find((path) => path.origin?.picStack?.length);
    expect(generatedPicPath?.style.stroke).toBe("#ff0000");
  });

  it("renders path pics whose type is provided only by pic type", () => {
    const source = String.raw`\begin{tikzpicture}
  \tikzset{mark/.pic={\draw (0,0) -- (.2,0);}}
  \path (0,0) pic [pic type=mark] (1,0) pic {mark};
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-pic-operation")).toBe(false);
    expect(elementsOfKind(result.scene.elements, "Path").filter((path) => path.origin?.picStack?.length)).toHaveLength(2);
  });

  it("renders pics attached to to operations", () => {
    const source = String.raw`\begin{tikzpicture}
  \tikzset{mark/.pic={\draw (0,0) -- (.2,0);}}
  \draw (0,0) to [bend left]
    pic [near start] {mark}
    pic {mark}
    pic [sloped, near end] {mark} (4,0);
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-to-operation")).toBe(false);
    expect(elementsOfKind(result.scene.elements, "Path").filter((path) => path.origin?.picStack?.length)).toHaveLength(3);
    expect(elementsOfKind(result.scene.elements, "Path").filter((path) => !path.origin?.picStack?.length)).toHaveLength(1);
  });

  it("renders simple parameterized background-code pic styles", () => {
    const source = String.raw`\begin{tikzpicture}[fill=blue!30]
  \tikzset{pics/my circle/.style={background code={\fill circle [radius=#1];}}}
  \draw (0,0) pic {my circle=2mm} -- (1,1) pic {my circle=5mm};
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-parameterized-pic")).toBe(false);
    const picElements = elementsOfKind(result.scene.elements, "Path").filter((path) => path.origin?.picStack?.length);
    expect(picElements).toHaveLength(2);
    expect(picElements.every((path) => path.style.fill === "#b3b3ff")).toBe(true);
    expect(result.scene.elements.findIndex((element) => element.id === picElements[0]?.id)).toBeLessThan(
      result.scene.elements.findIndex((element) => element.kind === "Path" && !element.origin?.picStack?.length)
    );
  });

  it("expands top-level pic foreach operations", () => {
    const source = String.raw`\begin{tikzpicture}
  \tikzset{seagull/.pic={\draw (-3mm,0) to [bend left] (0,0) to [bend left] (3mm,0);}}
  \pic foreach \x in {1,2,3} at (\x,0) {seagull};
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "foreach-body-parse-error")).toBe(false);
    expect(elementsOfKind(result.scene.elements, "Path").filter((path) => path.origin?.picStack?.length)).toHaveLength(3);
  });

  it("applies every pic styles and exposes only explicit placement handles", () => {
    const source = String.raw`\begin{tikzpicture}[every pic/.style={red,line width=2pt}]
  \tikzset{tick/.pic={\draw (0,0) -- (1,0);}}
  \pic at (1,0) {tick};
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    const path = elementsOfKind(result.scene.elements, "Path")[0];
    expect(path?.style.lineWidth).toBe(2);
    expect(result.editHandles).toHaveLength(1);
    expect(result.editHandles[0]?.sourceRef.sourceId).toMatch(/^pic-operation:/);
  });

  it("uses pic names as name prefixes for internal coordinates and nodes", () => {
    const source = String.raw`\begin{tikzpicture}
  \tikzset{pair/.pic={\coordinate (-left) at (0,0); \node (-right) at (1,0) {R};}}
  \pic[name=p] at (0,0) {pair};
  \draw (p-left) -- (p-right);
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
    const ordinaryPath = elementsOfKind(result.scene.elements, "Path").find((path) => !path.origin?.picStack?.length);
    expect(ordinaryPath?.commands.some((command) => command.kind === "L")).toBe(true);
  });
});
