import { describe, expect, it } from "vitest";

import type { ScopeStatement, Statement } from "../packages/core/src/ast/types.js";
import { applyEditAction } from "../packages/core/src/edit/actions.js";
import { createStandaloneLatexExportArtifact } from "../packages/core/src/export/standalone-latex.js";
import { createIncrementalParseSession, parseTikz } from "../packages/core/src/parser/index.js";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate.js";
import { createIncrementalSemanticSession } from "../packages/core/src/semantic/incremental.js";
import type { SceneElement, ScenePath } from "../packages/core/src/semantic/types.js";
import { evaluateSemantic } from "./semantic/helpers.js";

const picture = (body: string): string => `\\begin{tikzpicture}\n${body}\n\\end{tikzpicture}`;

function scopeAt(statements: readonly Statement[], index: number): ScopeStatement {
  const statement = statements[index];
  if (statement?.kind !== "Scope") throw new Error(`Expected a scope at ${index}, got ${statement?.kind ?? "nothing"}`);
  return statement;
}

function paths(elements: readonly SceneElement[]): ScenePath[] {
  return elements.filter((element): element is ScenePath => element.kind === "Path");
}

/** The stroke colours of the scene's paths, in paint order: the snippets below give each path its own colour. */
function strokeOrder(source: string, parseOptions = {}): Array<string | null> {
  return paths(evaluateSemantic(source, undefined, parseOptions).scene.elements).map((path) => path.style.stroke);
}

const RED = "#ff0000";
const GREEN = "#00ff00";
const BLUE = "#0000ff";

describe("PGF environments: no statement inside or after is lost (reproduction)", () => {
  const environments: Array<{ begin: string; end: string; name: string }> = [
    { begin: "\\begin{pgfonlayer}{background}", end: "\\end{pgfonlayer}", name: "pgfonlayer" },
    { begin: "\\begin{pgfscope}", end: "\\end{pgfscope}", name: "pgfscope" },
    { begin: "\\begin{pgfinterruptboundingbox}", end: "\\end{pgfinterruptboundingbox}", name: "pgfinterruptboundingbox" },
    { begin: "\\begin{pgftransparencygroup}[knockout]", end: "\\end{pgftransparencygroup}", name: "pgftransparencygroup" },
    { begin: "\\begin{pgflowlevelscope}{\\pgftransformscale{2}}", end: "\\end{pgflowlevelscope}", name: "pgflowlevelscope" },
    {
      begin: "\\begin{pgfviewboxscope}\n    {\\pgfpoint{0mm}{0mm}}{\\pgfpoint{10mm}{10mm}} % source\n    {\\pgfpoint{0mm}{0mm}}{\\pgfpoint{20mm}{20mm}} % target\n    {meet}",
      end: "\\end{pgfviewboxscope}",
      name: "pgfviewboxscope"
    },
    { begin: "\\pgfonlayer{background}", end: "\\endpgfonlayer", name: "pgfonlayer" },
    { begin: "\\pgfscope", end: "\\endpgfscope", name: "pgfscope" },
    { begin: "\\startpgfonlayer{background}", end: "\\stoppgfonlayer", name: "pgfonlayer" }
  ];

  for (const environment of environments) {
    it(`keeps the first statement in, and the first after, ${environment.begin.split("\n")[0]}`, () => {
      const source = picture(`  \\draw[red] (0,0) -- (1,0);\n  ${environment.begin}\n    \\draw[green] (0,1) -- (1,1);\n    \\draw[blue] (0,2) -- (1,2);\n  ${environment.end}\n  \\draw[red] (0,3) -- (1,3);`);
      const parsed = parseTikz(source);
      expect(parsed.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
      expect(parsed.figure.body.map((statement) => statement.kind)).toEqual(["Path", "Scope", "Path"]);
      const scope = scopeAt(parsed.figure.body, 1);
      expect(scope.environment?.name).toBe(environment.name);
      expect(scope.environment?.terminated).toBe(true);
      expect(scope.body.map((statement) => statement.kind)).toEqual(["Path", "Path"]);
      const semantic = evaluateSemantic(source);
      expect(paths(semantic.scene.elements)).toHaveLength(4);
      expect(semantic.diagnostics.filter((diagnostic) => diagnostic.code === "unsupported-statement")).toEqual([]);
    });
  }

  it("closes a basic-layer command left without `;` at the environment's end", () => {
    const source = picture("  \\begin{pgfscope}\n    \\pgfsetlinewidth{2pt}\n  \\end{pgfscope}\n  \\draw (0,0) -- (1,0);");
    const parsed = parseTikz(source);
    expect(parsed.figure.body.map((statement) => statement.kind)).toEqual(["Scope", "Path"]);
    expect(scopeAt(parsed.figure.body, 0).body.map((statement) => statement.kind)).toEqual(["UnknownStatement"]);
  });

  it("closes an unknown command left open before a PGF environment begins", () => {
    const source = picture("  \\pgfsetfillcolor{red}\n  \\begin{pgfonlayer}{background}\n    \\draw (0,0) -- (1,0);\n  \\end{pgfonlayer}");
    const parsed = parseTikz(source);
    expect(parsed.figure.body.map((statement) => statement.kind)).toEqual(["UnknownStatement", "Scope"]);
  });

  it("reads the environment descriptor: layer, arguments, spans and form", () => {
    const source = picture("  \\begin{pgfonlayer}{ back layer }\n    \\draw (0,0) -- (1,0);\n  \\end{pgfonlayer}");
    const scope = scopeAt(parseTikz(source).figure.body, 0);
    const begin = "\\begin{pgfonlayer}{ back layer }";
    const from = source.indexOf(begin);
    expect(scope.options).toBeUndefined();
    expect(scope.environment).toEqual({
      name: "pgfonlayer",
      form: "latex",
      beginSpan: { from, to: from + begin.length },
      arguments: [{ delimiter: "{", raw: " back layer ", span: { from: from + "\\begin{pgfonlayer}".length, to: from + begin.length } }],
      endSpan: { from: source.indexOf("\\end{pgfonlayer}"), to: source.indexOf("\\end{pgfonlayer}") + "\\end{pgfonlayer}".length },
      terminated: true,
      layer: "back layer"
    });
  });

  it("nests environments in scopes and scopes in environments", () => {
    const source = picture(String.raw`  \begin{scope}[xshift=1cm]
    \begin{pgfonlayer}{background}
      \begin{scope}[yshift=1cm]
        \begin{pgfscope}
          \draw (0,0) -- (1,0);
        \end{pgfscope}
      \end{scope}
    \end{pgfonlayer}
  \end{scope}
  \draw (0,0) -- (1,1);`);
    const parsed = parseTikz(source);
    expect(parsed.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const outer = scopeAt(parsed.figure.body, 0);
    const layer = scopeAt(outer.body, 0);
    expect(layer.environment?.layer).toBe("background");
    const inner = scopeAt(layer.body, 0);
    expect(scopeAt(inner.body, 0).environment?.name).toBe("pgfscope");
    const semantic = evaluateSemantic(source);
    const [first] = paths(semantic.scene.elements);
    expect(first?.layer).toBe("background");
    expect(first?.commands[0]).toMatchObject({ kind: "M" });
    expect(parsed.figure.body[1]?.kind).toBe("Path");
  });

  it("diagnoses an environment ended by another one and an unterminated one", () => {
    const mismatched = picture("  \\begin{pgfonlayer}{background}\n    \\draw (0,0) -- (1,0);\n  \\end{pgfscope}");
    const mismatchedScope = scopeAt(parseTikz(mismatched).figure.body, 0);
    expect(mismatchedScope.environment?.endName).toBe("pgfscope");
    expect(evaluateSemantic(mismatched).diagnostics.map((diagnostic) => diagnostic.code)).toContain("pgf-environment-unterminated");

    const unterminated = picture("  \\begin{pgfscope}\n    \\draw (0,0) -- (1,0);");
    const parsed = parseTikz(unterminated);
    const scope = scopeAt(parsed.figure.body, 0);
    expect(scope.environment?.terminated).toBe(false);
    expect(scope.body).toHaveLength(1);
    expect(paths(evaluateSemantic(unterminated).scene.elements)).toHaveLength(1);
  });

  it("leaves the PGF environments out of the generic fallback outside a picture", () => {
    const source = "\\begin{pgfonlayer}{background}\n\\end{pgfonlayer}\n" + picture("  \\draw (0,0) -- (1,0);");
    const parsed = parseTikz(source);
    expect(parsed.figure.body.map((statement) => statement.kind)).toEqual(["Path"]);
  });
});

describe("PGF layers: paint order", () => {
  it("paints the background layer behind main content drawn before it", () => {
    const source = picture(String.raw`  \draw[red] (0,0) -- (1,0);
  \begin{pgfonlayer}{background}
    \draw[green] (0,1) -- (1,1);
  \end{pgfonlayer}
  \draw[blue] (0,2) -- (1,2);`);
    const semantic = evaluateSemantic(source);
    expect(semantic.scene.layers).toEqual([{ name: "background", order: 0 }, { name: "main", order: 1 }]);
    expect(paths(semantic.scene.elements).map((path) => [path.layer, path.style.stroke])).toEqual([
      ["background", GREEN], ["main", RED], ["main", BLUE]
    ]);
    expect(semantic.scene.requiredTikzLibraries).toContain("backgrounds");
    expect(semantic.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("paints declared layers in the \\pgfsetlayers order, accumulating repeated environments", () => {
    const source = picture(String.raw`  \pgfdeclarelayer{back}
  \pgfdeclarelayer{front}
  \pgfsetlayers{back,main,front}
  \draw[red] (0,0) -- (1,0);
  \begin{pgfonlayer}{front}
    \draw[green] (0,1) -- (1,1);
  \end{pgfonlayer}
  \begin{pgfonlayer}{back}
    \draw[blue] (0,2) -- (1,2);
  \end{pgfonlayer}
  \begin{pgfonlayer}{front}
    \draw[red] (0,3) -- (1,3);
  \end{pgfonlayer}
  \begin{pgfonlayer}{back}
    \draw[green] (0,4) -- (1,4);
  \end{pgfonlayer}`);
    const semantic = evaluateSemantic(source);
    expect(semantic.scene.layers.map((layer) => layer.name)).toEqual(["back", "main", "front"]);
    expect(paths(semantic.scene.elements).map((path) => path.layer)).toEqual(["back", "back", "main", "front", "front"]);
    expect(paths(semantic.scene.elements).map((path) => path.style.stroke)).toEqual([BLUE, GREEN, RED, GREEN, RED]);
  });

  it("reads layer declarations from the preamble", () => {
    const source = String.raw`\documentclass{standalone}
\usepackage{tikz}
\pgfdeclarelayer{back}
\pgfsetlayers{main,back}
\begin{document}
` + picture(String.raw`  \begin{pgfonlayer}{back}
    \draw[red] (0,0) -- (1,0);
  \end{pgfonlayer}
  \draw[blue] (0,1) -- (1,1);`) + "\n\\end{document}\n";
    expect(strokeOrder(source, { includeContextDefinitions: true })).toEqual([BLUE, RED]);
  });

  it("keeps an earlier picture's layer declaration but not its \\pgfsetlayers", () => {
    const source = picture("  \\pgfdeclarelayer{back}\n  \\pgfsetlayers{back,main}\n  \\draw (0,0) -- (1,0);") + "\n" +
      picture("  \\draw[red] (0,0) -- (1,0);\n  \\begin{pgfonlayer}{back}\n    \\draw[blue] (0,1) -- (1,1);\n  \\end{pgfonlayer}");
    const semantic = evaluateSemantic(source, undefined, { includeContextDefinitions: true, activeFigureId: "figure:1" });
    expect(paths(semantic.scene.elements).map((path) => path.style.stroke)).toEqual([RED]);
    const codes = semantic.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toContain("pgf-layer-not-listed");
    expect(codes).not.toContain("pgf-layer-undeclared");
  });

  it("uses the list at the picture's top level when the picture ends (\\pgfsetlayers in the picture)", () => {
    // pdfTeX: green (fg), red (main), blue (background), with an error at the
    // first {pgfonlayer}{fg}: fg is not in the list yet.
    const source = String.raw`\usetikzlibrary{backgrounds}
\pgfdeclarelayer{fg}
` + picture(String.raw`  \draw[red] (0,0) -- (1,0);
  \begin{pgfonlayer}{fg}
    \draw[green] (0,1) -- (1,1);
  \end{pgfonlayer}
  \begin{pgfonlayer}{background}
    \draw[blue] (0,2) -- (1,2);
  \end{pgfonlayer}
  \pgfsetlayers{fg,main,background}`);
    const semantic = evaluateSemantic(source, undefined, { includeContextDefinitions: true });
    expect(paths(semantic.scene.elements).map((path) => path.style.stroke)).toEqual([GREEN, RED, BLUE]);
    expect(semantic.diagnostics.map((diagnostic) => diagnostic.code)).toContain("pgf-layer-not-listed");
  });

  it("keeps a \\pgfsetlayers inside a scope local to it", () => {
    const source = String.raw`\usetikzlibrary{backgrounds}
` + picture(String.raw`  \begin{scope}\pgfsetlayers{main,background}\end{scope}
  \draw[red] (0,0) -- (1,0);
  \begin{pgfonlayer}{background}
    \draw[blue] (0,0.5) -- (1,0.5);
  \end{pgfonlayer}`);
    expect(strokeOrder(source, { includeContextDefinitions: true })).toEqual([BLUE, RED]);
  });

  it("draws an undeclared layer's content in place with TeX's error", () => {
    const source = picture(String.raw`  \draw[red] (0,0) -- (1,0);
  \begin{pgfonlayer}{nosuch}
    \draw[green] (0,1) -- (1,1);
  \end{pgfonlayer}
  \draw[blue] (0,2) -- (1,2);`);
    const semantic = evaluateSemantic(source);
    expect(paths(semantic.scene.elements).map((path) => path.style.stroke)).toEqual([RED, GREEN, BLUE]);
    const error = semantic.diagnostics.find((diagnostic) => diagnostic.code === "pgf-layer-undeclared");
    expect(error?.severity).toBe("error");
    expect(error?.message).toContain("`nosuch`");
  });

  it("drops an unlisted layer's content, which still counts for the bounding box", () => {
    // pdfTeX: error, nothing painted, and the page is 8cm wide.
    const source = picture(String.raw`  \pgfdeclarelayer{unlisted}
  \draw (0,0) -- (1,0);
  \begin{pgfonlayer}{unlisted}
    \draw[blue] (0,-1) -- (8,-1);
  \end{pgfonlayer}`);
    const semantic = evaluateSemantic(source);
    expect(paths(semantic.scene.elements)).toHaveLength(1);
    // Half the 0.4pt line width past the end point, as PGF's path bounding box.
    expect(semantic.scene.bounds?.maxX).toBeCloseTo(8 * 28.4527559055 + 0.2, 3);
    const codes = semantic.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toContain("pgf-layer-not-listed");
    expect(codes).toContain("pgf-layer-not-painted");
  });

  it("discards the discard layer without an error, and loses main content added from another layer", () => {
    // pdfTeX: blue, green, purple (background), black, cyan, yellow; orange and magenta are not painted.
    const source = String.raw`\usetikzlibrary{backgrounds}
\pgfdeclarelayer{discard}
` + picture(String.raw`  \draw[black] (0,0.5) -- (1,0.5);
  \begin{pgfonlayer}{background}
    \draw[blue] (0,1) -- (1,1);
    \begin{pgfonlayer}{background}
      \draw[green] (0,1.5) -- (1,1.5);
    \end{pgfonlayer}
    \begin{pgfonlayer}{main}
      \draw[orange] (0,2) -- (1,2);
    \end{pgfonlayer}
    \draw[purple] (0,2.2) -- (1,2.2);
  \end{pgfonlayer}
  \begin{pgfonlayer}{main}
    \draw[cyan] (0,2.5) -- (1,2.5);
  \end{pgfonlayer}
  \begin{pgfonlayer}{discard}
    \draw[magenta] (0,3) -- (1,3);
  \end{pgfonlayer}
  \draw[yellow] (0,3.5) -- (1,3.5);`);
    const semantic = evaluateSemantic(source, undefined, { includeContextDefinitions: true });
    const strokes = paths(semantic.scene.elements).map((path) => path.style.stroke);
    expect(strokes).toHaveLength(6);
    expect(strokes.slice(0, 2)).toEqual([BLUE, GREEN]);
    expect(paths(semantic.scene.elements).map((path) => path.layer)).toEqual(["background", "background", "background", "main", "main", "main"]);
    const codes = semantic.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toContain("pgf-layer-main-lost");
    expect(codes).not.toContain("pgf-layer-not-painted");
    expect(semantic.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("keeps node names defined on a layer usable after it", () => {
    const source = picture(String.raw`  \begin{pgfonlayer}{background}
    \node[draw] (n) at (1,1) {N};
  \end{pgfonlayer}
  \draw (n.north) -- (2,2);`);
    const semantic = evaluateSemantic(source);
    expect(semantic.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
    const main = paths(semantic.scene.elements).filter((path) => path.layer === "main");
    expect(main).toHaveLength(1);
  });
});

describe("PGF layers: what layer content inherits", () => {
  it("resets the PDF graphic state but keeps text colour and the transformation", () => {
    // pdfTeX: the layer's stroke and fill are black, 0.4pt, solid and opaque; the node text is blue.
    const source = picture(String.raw`  \begin{scope}[dashed, opacity=0.5, draw=red, fill=yellow, text=blue, line width=3pt, xshift=1cm]
    \begin{pgfonlayer}{background}
      \draw (0,0) -- (1,1);
      \node at (2,0) {X};
    \end{pgfonlayer}
    \draw (0,1) -- (1,2);
  \end{scope}`);
    const semantic = evaluateSemantic(source);
    const [layerPath, mainPath] = paths(semantic.scene.elements);
    expect(layerPath?.layer).toBe("background");
    expect(layerPath?.style).toMatchObject({ stroke: "black", lineWidth: 0.4, dashArray: null, opacity: 1, strokeOpacity: 1, fillOpacity: 1 });
    // `\pgfonlayer` sets the line width to 0.4pt in the enclosing stream before
    // it opens the layer's box: pdfTeX strokes the path after it at 0.4pt too.
    expect(mainPath?.style.lineWidth).toBe(0.4);
    expect(mainPath?.style.dashArray).not.toBeNull();
    const text = semantic.scene.elements.find((element) => element.kind === "Text");
    expect(text?.style.textColor).toBe(BLUE);
    const firstPoint = layerPath?.commands[0];
    expect(firstPoint?.kind).toBe("M");
    if (firstPoint?.kind === "M") expect(firstPoint.to.x).toBeCloseTo(28.4527559055, 5);
  });

  it("escapes the enclosing clip, and keeps a clip set on the layer for the layer's later content", () => {
    const source = picture(String.raw`  \begin{scope}
    \clip (0,0) rectangle (1,1);
    \draw[red] (0,0) -- (2,2);
    \begin{pgfonlayer}{background}
      \draw[blue] (0,0.5) -- (3,0.5);
      \clip (0,0) rectangle (2,2);
      \draw[green] (0,0.2) -- (3,0.2);
    \end{pgfonlayer}
  \end{scope}
  \begin{pgfonlayer}{background}
    \draw[blue] (0,0.7) -- (3,0.7);
  \end{pgfonlayer}
  \draw[red] (0,0.9) -- (3,0.9);`);
    const semantic = evaluateSemantic(source);
    const byOrder = paths(semantic.scene.elements).filter((path) => path.style.stroke !== null);
    expect(byOrder.map((path) => [path.layer, path.clipChain?.length ?? 0])).toEqual([
      ["background", 0], ["background", 1], ["background", 1], ["main", 1], ["main", 0]
    ]);
  });

  it("makes `on background layer` the same as {pgfonlayer}{background} with its options applied on the layer", () => {
    // pdfTeX: the scope's red is not used by strokes on the layer; the key's green is.
    const viaKey = picture(String.raw`  \begin{scope}[blue, line width=2pt]
    \clip (0,0) rectangle (1,1);
    \draw (0,0) -- (2,2);
    \begin{scope}[on background layer, red, xshift=1cm]
      \draw (0,0.5) -- (2,0.5);
    \end{scope}
    \begin{scope}[on background layer={green, thick}]
      \draw (0,0.2) -- (2,0.2);
    \end{scope}
    \draw (0,1) -- (2,1);
  \end{scope}`);
    const viaEnvironment = picture(String.raw`  \begin{scope}[blue, line width=2pt]
    \clip (0,0) rectangle (1,1);
    \draw (0,0) -- (2,2);
    \begin{scope}[red, xshift=1cm]
      \begin{pgfonlayer}{background}
        \draw (0,0.5) -- (2,0.5);
      \end{pgfonlayer}
    \end{scope}
    \begin{pgfonlayer}{background}
      \begin{scope}[green, thick]
        \draw (0,0.2) -- (2,0.2);
      \end{scope}
    \end{pgfonlayer}
    \draw (0,1) -- (2,1);
  \end{scope}`);
    const summarize = (source: string) => paths(evaluateSemantic(source).scene.elements)
      .filter((path) => path.style.stroke !== null)
      .map((path) => ({ layer: path.layer, stroke: path.style.stroke, width: path.style.lineWidth, clipped: (path.clipChain?.length ?? 0) > 0, commands: path.commands }));
    const key = summarize(viaKey);
    expect(key.map((entry) => [entry.layer, entry.stroke, entry.width, entry.clipped])).toEqual([
      ["background", "black", 0.4, false],
      ["background", GREEN, 0.8, false],
      ["main", BLUE, 2, true],
      ["main", BLUE, 2, true]
    ]);
    // The same, but for the path after the layer content: the key enters the
    // layer inside its scope's graphic-state group, so the 0.4pt line width
    // `\pgfonlayer` sets in the enclosing stream ends with that scope; the
    // environment sets it in the enclosing scope itself.
    const environment = summarize(viaEnvironment);
    expect(environment.slice(0, 3)).toEqual(key.slice(0, 3));
    expect(environment[3]).toEqual({ ...key[3], width: 0.4 });
  });
});

describe("PGF environments: other treatments", () => {
  it("{pgfscope} groups like a scope", () => {
    const source = picture(String.raw`  \begin{scope}[blue]
    \begin{pgfscope}
      \draw (0,1) -- (1,1);
    \end{pgfscope}
  \end{scope}`);
    const semantic = evaluateSemantic(source);
    expect(paths(semantic.scene.elements).map((path) => [path.layer, path.style.stroke])).toEqual([["main", BLUE]]);
    expect(semantic.featureUsage.pgf_environments).toBe("used-supported");
  });

  it("{pgfinterruptboundingbox} keeps its content out of the picture's bounds", () => {
    const source = picture(String.raw`  \draw (0,0) -- (1,0);
  \begin{pgfinterruptboundingbox}
    \draw[red] (0,0) -- (5,0);
  \end{pgfinterruptboundingbox}`);
    const semantic = evaluateSemantic(source);
    expect(paths(semantic.scene.elements)).toHaveLength(2);
    expect(semantic.scene.bounds?.maxX).toBeCloseTo(28.4527559055 + 0.2, 3);
    expect(paths(semantic.scene.elements)[1]?.pictureSizeRelevant).toBe(false);
  });

  it("{pgftransparencygroup} draws its content and names the limitation", () => {
    const source = picture("  \\begin{pgftransparencygroup}\n    \\fill[opacity=0.5] (0,0) circle (1);\n    \\fill[opacity=0.5] (1,0) circle (1);\n  \\end{pgftransparencygroup}");
    const semantic = evaluateSemantic(source);
    expect(semantic.scene.elements.length).toBeGreaterThanOrEqual(2);
    expect(semantic.diagnostics.map((diagnostic) => diagnostic.code)).toContain("pgf-transparency-group-approximate");
  });

  it("{pgflowlevelscope} transforms the content's coordinates and leaves the bounding box alone", () => {
    const source = picture("  \\draw (0,0) -- (1,0);\n  \\begin{pgflowlevelscope}{\\pgftransformxshift{1cm}\\pgftransformscale{2}}\n    \\draw (0,0) -- (1,1);\n  \\end{pgflowlevelscope}");
    const semantic = evaluateSemantic(source);
    const moved = paths(semantic.scene.elements)[1];
    const end = moved?.commands[1];
    expect(end?.kind).toBe("L");
    if (end?.kind === "L") {
      expect(end.to.x).toBeCloseTo(28.4527559055 * 3, 4);
      expect(end.to.y).toBeCloseTo(28.4527559055 * 2, 4);
    }
    expect(semantic.scene.bounds?.maxY).toBeCloseTo(0.2, 3);
    expect(semantic.diagnostics.map((diagnostic) => diagnostic.code)).toContain("pgf-canvas-transform-approximate");
  });

  it("{pgfviewboxscope} centres and scales the source rectangle on the target (meet and slice)", () => {
    const view = (mode: string) => picture(`  \\begin{pgfviewboxscope}{\\pgfpoint{5mm}{5mm}}{\\pgfpoint{25mm}{15mm}}{\\pgfpoint{0mm}{0mm}}{\\pgfpoint{20mm}{20mm}}{${mode}}\n    \\draw (5mm,5mm) rectangle (25mm,15mm);\n  \\end{pgfviewboxscope}`);
    const corners = (source: string) => {
      const path = paths(evaluateSemantic(source).scene.elements)[0];
      const xs = path?.commands.flatMap((command) => "to" in command ? [command.to.x] : []) ?? [];
      const ys = path?.commands.flatMap((command) => "to" in command ? [command.to.y] : []) ?? [];
      const mm = 2.84527559055;
      return [Math.min(...xs) / mm, Math.min(...ys) / mm, Math.max(...xs) / mm, Math.max(...ys) / mm].map((value) => Math.round(value * 1000) / 1000);
    };
    // meet: 20mm x 10mm fits the 20mm square at scale 1, centred: y from 5 to 15.
    expect(corners(view("meet"))).toEqual([0, 5, 20, 15]);
    // slice: scale 2 covers the square: 40mm x 20mm centred on (10,10).
    expect(corners(view("slice"))).toEqual([-10, 0, 30, 20]);
  });

  it("draws an unsupported low-level transformation's content untransformed, with one diagnostic", () => {
    const source = picture("  \\begin{pgflowlevelscope}{\\mytransform}\n    \\draw (0,0) -- (1,1);\n  \\end{pgflowlevelscope}\n  \\draw (0,0) -- (1,0);");
    const semantic = evaluateSemantic(source);
    expect(paths(semantic.scene.elements)).toHaveLength(2);
    const unsupported = semantic.diagnostics.filter((diagnostic) => diagnostic.code === "unsupported-environment");
    expect(unsupported).toHaveLength(1);
    expect(unsupported[0]?.message).toContain("pgflowlevelscope");
  });
});

describe("PGF environments: incremental parsing matches a full parse", () => {
  const BASE = picture(String.raw`  \draw (0,0) -- (1,1);
  \begin{pgfonlayer}{background}
    \draw (0,1) -- (1,2);
    \node at (2,0) {A};
  \end{pgfonlayer}
  \begin{pgfscope}
    \draw (3,3) -- (4,4);
  \end{pgfscope}
  \draw (5,5) -- (6,6);`);

  const edits: Array<{ name: string; next: string; strategy?: "incremental" | "full" }> = [
    { name: "a coordinate inside the layer", next: BASE.replace("(0,1) -- (1,2)", "(0,1) -- (2,3)"), strategy: "incremental" },
    { name: "node text inside the layer", next: BASE.replace("{A}", "{B}"), strategy: "incremental" },
    { name: "a coordinate after the environments", next: BASE.replace("(5,5) -- (6,6)", "(5,5) -- (7,7)"), strategy: "incremental" },
    { name: "the layer name", next: BASE.replace("{background}", "{foreground}") },
    { name: "the end, deleted", next: BASE.replace("  \\end{pgfonlayer}\n", "") },
    { name: "the end's name", next: BASE.replace("\\end{pgfonlayer}", "\\end{pgfscope}") },
    { name: "a statement added inside", next: BASE.replace("    \\node at", "    \\draw (9,9) -- (8,8);\n    \\node at") },
    { name: "an environment typed into a path", next: BASE.replace("\\draw (5,5)", "\\begin{pgfscope}\\draw (5,5)") },
    { name: "a layer declaration typed in", next: BASE.replace("  \\draw (0,0) -- (1,1);", "  \\pgfdeclarelayer{x}\n  \\draw (0,0) -- (1,1);") }
  ];

  for (const edit of edits) {
    it(`after editing ${edit.name}`, () => {
      const session = createIncrementalParseSession();
      session.prime(parseTikz(BASE), { sourceRevision: 1 });
      const result = session.evaluate({ source: edit.next, sourceRevision: 2, inferChanges: true });
      const full = parseTikz(edit.next);
      expect(result.parse.figure).toEqual(full.figure);
      expect(result.parse.diagnostics).toEqual(full.diagnostics);
      if (edit.strategy) expect(result.stats.strategy).toBe(edit.strategy);
    });
  }
});

describe("PGF layers: incremental evaluation matches a full one", () => {
  const BASE = picture(String.raw`  \pgfdeclarelayer{front}
  \pgfsetlayers{background,main,front}
  \draw[red] (0,0) -- (1,1);
  \begin{pgfonlayer}{front}
    \draw[green] (0,1) -- (1,2);
  \end{pgfonlayer}
  \begin{scope}[line width=2pt]
    \begin{pgfonlayer}{background}
      \clip (0,0) rectangle (3,3);
      \draw[blue] (3,3) -- (4,4);
    \end{pgfonlayer}
    \draw (5,5) -- (6,6);
  \end{scope}
  \begin{pgfonlayer}{background}
    \draw[blue] (0,0) -- (4,4);
  \end{pgfonlayer}`);

  const edits: Array<{ name: string; next: string; changedSourceIds: string[] }> = [
    { name: "a coordinate on a layer", next: BASE.replace("(0,1) -- (1,2)", "(0,1) -- (2,3)"), changedSourceIds: ["path:4"] },
    { name: "a coordinate after the layers", next: BASE.replace("(5,5) -- (6,6)", "(5,5) -- (7,7)"), changedSourceIds: ["path:9"] },
    { name: "the layer list", next: BASE.replace("{background,main,front}", "{front,main,background}"), changedSourceIds: ["pgf-layer:1"] }
  ];
  for (const edit of edits) {
    it(`after editing ${edit.name}`, () => {
      const session = createIncrementalSemanticSession();
      session.evaluate({ source: BASE, figure: parseTikz(BASE).figure });
      const parsed = parseTikz(edit.next);
      const result = session.evaluate({ source: edit.next, figure: parsed.figure, hints: { trigger: "drag-element", changedSourceIds: edit.changedSourceIds } });
      const full = evaluateTikzFigure(parsed.figure, edit.next);
      expect(result.semantic.scene).toEqual(full.scene);
      expect(result.semantic.diagnostics).toEqual(full.diagnostics);
    });
  }
});

describe("PGF environments: source-preserving edits", () => {
  const SOURCE = picture(String.raw`  \draw (0,0) -- (1,0);
  \begin{pgfonlayer}{background}
    \draw (0,1) -- (1,1);
  \end{pgfonlayer}
  \draw (0,2) -- (1,2);`);

  function succeed(result: ReturnType<typeof applyEditAction>): string {
    if (result.kind !== "success") throw new Error(`Expected success, got ${JSON.stringify(result)}`);
    return result.newSource;
  }

  it("numbers the environment like a scope and its statements after it", () => {
    const ids = (statements: readonly Statement[]): string[] => statements.flatMap((statement) => [statement.id, ...(statement.kind === "Scope" ? ids(statement.body) : [])]);
    expect(ids(parseTikz(SOURCE).figure.body)).toEqual(["path:0", "scope:1", "path:2", "path:3"]);
  });

  it("deleting the last statement inside leaves an empty environment, as a scope does", () => {
    const next = succeed(applyEditAction(SOURCE, [], { kind: "deleteElement", elementId: "path:2" }));
    expect(next).toBe(picture("  \\draw (0,0) -- (1,0);\n  \\begin{pgfonlayer}{background}\n  \\end{pgfonlayer}\n  \\draw (0,2) -- (1,2);"));
    expect(parseTikz(next).diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  });

  it("deletes the whole environment, and statements around it without touching it", () => {
    expect(succeed(applyEditAction(SOURCE, [], { kind: "deleteElement", elementId: "scope:1" }))).toBe(picture("  \\draw (0,0) -- (1,0);\n  \\draw (0,2) -- (1,2);"));
    expect(succeed(applyEditAction(SOURCE, [], { kind: "deleteElement", elementId: "path:3" }))).toContain("\\begin{pgfonlayer}{background}\n    \\draw (0,1) -- (1,1);\n  \\end{pgfonlayer}");
  });

  it("moves a statement inside the environment, and the environment by its statements", () => {
    const handles = renderTikzToSvg(SOURCE).semantic.editHandles;
    const delta = { x: 28.4527559055, y: 0 } as never;
    const inner = succeed(applyEditAction(SOURCE, handles, { kind: "moveElements", elementIds: ["path:2"], delta }));
    expect(inner).toContain("\\begin{pgfonlayer}{background}\n    \\draw (1,1) -- (2,1);\n  \\end{pgfonlayer}");
    const whole = succeed(applyEditAction(SOURCE, handles, { kind: "moveElements", elementIds: ["scope:1"], delta }));
    expect(whole).toBe(inner);
  });

  it("reorders within the environment's parent list only: z-order never moves a statement across its boundary", () => {
    const source = picture(String.raw`  \draw (0,0) -- (1,0);
  \begin{pgfonlayer}{background}
    \draw (0,1) -- (1,1);
    \draw (0,3) -- (1,3);
  \end{pgfonlayer}
  \draw (0,2) -- (1,2);`);
    for (const direction of ["sendToBack", "sendBackward", "bringForward", "bringToFront"] as const) {
      for (const elementId of ["path:0", "path:2", "path:3", "path:4", "scope:1"]) {
        const result = applyEditAction(source, [], { kind: "reorderElements", elementIds: [elementId], direction });
        if (result.kind !== "success") continue;
        const layer = scopeAt(parseTikz(result.newSource).figure.body, parseTikz(result.newSource).figure.body.findIndex((statement) => statement.kind === "Scope"));
        expect(layer.body.map((statement) => (statement.kind === "Path" ? statement.items.length : 0))).toHaveLength(2);
        expect(result.newSource.match(/\\draw \(0,[13]\)/gu)?.length).toBe(2);
        const inside = result.newSource.slice(result.newSource.indexOf("\\begin{pgfonlayer}"), result.newSource.indexOf("\\end{pgfonlayer}"));
        expect(inside).toContain("\\draw (0,1)");
        expect(inside).toContain("\\draw (0,3)");
      }
    }
  });

  it("refuses to ungroup the environment or to write options on it; writes a statement's options inside", () => {
    const ungroup = applyEditAction(SOURCE, [], { kind: "ungroupElements", elementIds: ["scope:1"] });
    expect(ungroup.kind).toBe("unsupported");
    expect(applyEditAction(SOURCE, [], { kind: "setProperty", elementId: "scope:1", level: "command", key: "color", value: "red" }).kind).toBe("unsupported");
    expect(succeed(applyEditAction(SOURCE, [], { kind: "setProperty", elementId: "path:2", level: "command", key: "color", value: "red" }))).toContain("\\draw[color=red] (0,1) -- (1,1);");
  });
});

describe("PGF layers: standalone export", () => {
  it("carries the layer declarations from before the picture when the picture uses layers", () => {
    const source = String.raw`\documentclass{article}
\usepackage{tikz}
\pgfdeclarelayer{back}
\pgfdeclarelayer{front}
\pgfsetlayers{back,main,front}
\begin{document}
` + picture(String.raw`  \node[draw] (a) {A};
  \begin{pgfonlayer}{back}
    \fill[yellow] (-1,-1) rectangle (1,1);
  \end{pgfonlayer}`) + `
` + picture("  \\draw (0,0) -- (1,1);") + "\n\\end{document}\n";
    const exported = createStandaloneLatexExportArtifact({ source, activeFigureId: "figure:0" });
    const preamble = exported.text.slice(0, exported.text.indexOf("\\begin{document}"));
    expect(preamble).toContain("\\pgfdeclarelayer{back}\n\\pgfdeclarelayer{front}\n\\pgfsetlayers{back,main,front}");
    expect(exported.complete).toBe(true);

    const second = createStandaloneLatexExportArtifact({ source, activeFigureId: "figure:1" });
    expect(second.text).toContain("\\draw (0,0) -- (1,1);");
    expect(second.text).not.toContain("\\pgfdeclarelayer");
  });
});
