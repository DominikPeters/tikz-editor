import { describe, expect, it } from "vitest";

import { renderTikzToSvg, renderTikzToSvgAsync } from "../packages/core/src/render/index.js";
import { parseLength } from "../packages/core/src/semantic/coords/parse-length.js";
import type { SceneCircle, ScenePath, SceneText } from "../packages/core/src/semantic/types.js";
import { applyMatrix } from "../packages/core/src/semantic/transform.js";
import { getKnuthPlassReportsFromOutputJax } from "../packages/core/src/text/knuth-plass/index.js";
import { getActiveMathJaxOutputJax } from "../packages/core/src/text/mathjax-engine.js";
import { projectInputRange } from "../packages/core/src/text/source-map.js";
import type { NodeTextEngine, NodeTextMeasureRequest, NodeTextMetrics } from "../packages/core/src/text/types.js";

function readLineboxTranslateXs(svg: string): number[] {
  const xs: number[] = [];
  const lineboxPattern = /<g\b[^>]*data-mjx-linebox="true"[^>]*>/g;
  for (const match of svg.matchAll(lineboxPattern)) {
    const tag = match[0];
    const transformMatch = tag.match(/transform="translate\(([-+0-9.]+)(?:\s*,\s*|\s+)([-+0-9.]+)\)"/);
    xs.push(transformMatch ? Number(transformMatch[1]) : 0);
  }
  return xs;
}

function readLineboxTranslateYs(svg: string): number[] {
  const ys: number[] = [];
  const lineboxPattern = /<g\b[^>]*data-mjx-linebox="true"[^>]*>/g;
  for (const match of svg.matchAll(lineboxPattern)) {
    const tag = match[0];
    const transformMatch = tag.match(/transform="translate\(([-+0-9.]+)(?:\s*,\s*|\s+)([-+0-9.]+)\)"/);
    ys.push(transformMatch ? Number(transformMatch[2]) : 0);
  }
  return ys;
}

function countLineboxes(svg: string): number {
  return (svg.match(/data-mjx-linebox=/g) ?? []).length;
}

function renderedMspaceAdvances(svg: string): number[] {
  const advances: number[] = [];
  const pairPattern =
    /data-mml-node="mspace"[^>]*transform="translate\(([-+0-9.]+),0\)"[^>]*><\/g>\s*<g data-mml-node="mtext"[^>]*transform="translate\(([-+0-9.]+),0\)"/g;
  for (const match of svg.matchAll(pairPattern)) {
    const currentX = Number.parseFloat(match[1] ?? "");
    const nextX = Number.parseFloat(match[2] ?? "");
    if (!Number.isFinite(currentX) || !Number.isFinite(nextX)) {
      continue;
    }
    advances.push(nextX - currentX);
  }
  return advances;
}

function reportForParagraphId(paragraphId: string | null) {
  const reports = getKnuthPlassReportsFromOutputJax(getActiveMathJaxOutputJax());
  return reports.find((report) => report.paragraphId === paragraphId) ?? null;
}

function pathBounds(path: ScenePath): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const points = path.commands.flatMap((command) => {
    if (command.kind === "M" || command.kind === "L" || command.kind === "A") {
      return [command.to];
    }
    if (command.kind === "C") {
      return [command.c1, command.c2, command.to];
    }
    return [];
  });
  if (points.length === 0) {
    return null;
  }

  const transformed = points.map((point) => (path.transform ? applyMatrix(path.transform, point) : point));
  return {
    minX: Math.min(...transformed.map((point) => point.x)),
    minY: Math.min(...transformed.map((point) => point.y)),
    maxX: Math.max(...transformed.map((point) => point.x)),
    maxY: Math.max(...transformed.map((point) => point.y))
  };
}

describe("render pipeline", () => {
  it("renders basic source end-to-end", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[->,red] (0,0) -- (2,1);
  \node at (2,1) {A};
\end{tikzpicture}`;

    const result = renderTikzToSvg(source);

    expect(result.parse.figure.body.length).toBeGreaterThan(0);
    expect(result.semantic.scene.elements.length).toBeGreaterThan(0);
    expect(result.svg.svg).toContain("<svg");
    expect(result.svg.svg).toContain("<path");
    expect(result.svg.svg).toContain("<text");
  });

  it("resets path state between standalone draw statements", () => {
    const source = String.raw`\begin{tikzpicture}[scale = 0.8]
  \draw[shift = {(2.5,0.5)}, color = blue] node[font=\Large] {$q$};
  \draw[shift = {(4.5,4.5)}, color = black] node[font=\Large] {$r$};
\end{tikzpicture}`;

    const result = renderTikzToSvg(source);
    const textElements = result.semantic.scene.elements.filter((element): element is SceneText => element.kind === "Text");

    expect(textElements).toHaveLength(2);
    expect(textElements[0]?.position.x).toBeCloseTo(56.905511811, 6);
    expect(textElements[0]?.position.y).toBeCloseTo(11.3811023622, 6);
    expect(textElements[1]?.position.x).toBeCloseTo(102.4299212598, 6);
    expect(textElements[1]?.position.y).toBeCloseTo(102.4299212598, 6);
  });

  it("keeps help lines color when appending dashed style", () => {
    const source = String.raw`\begin{tikzpicture}[help lines/.append style={dashed}]
  \draw[help lines] grid(3,2);
\end{tikzpicture}`;
    const result = renderTikzToSvg(source);

    expect(result.svg.svg).toContain('stroke="#808080"');
    expect(result.svg.svg).toContain('stroke-dasharray="3 3"');
  });

  it("applies TikZ transparency aliases", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[fill=red!40,nearly transparent] (0,0) -- (1,0) -- (1,1) -- cycle;
\end{tikzpicture}`;

    const result = renderTikzToSvg(source);
    const path = result.semantic.scene.elements.find((element): element is ScenePath => element.kind === "Path");

    expect(path).toBeDefined();
    expect(path?.style.fillOpacity).toBeCloseTo(0.25, 6);
    expect(path?.style.strokeOpacity).toBeCloseTo(0.25, 6);
    expect(result.svg.svg).toContain('fill-opacity="0.25"');
  });

  it("renders matrix of math nodes cells in math mode", async () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of math nodes] {
    x^2 & \frac{1}{y} \\
  };
\end{tikzpicture}`;
    const result = await renderTikzToSvgAsync(source);

    expect(result.svg.svg).toContain('data-text-renderer="mathjax"');
    expect(result.svg.svg).toContain('data-latex="x^2"');
    expect(result.svg.svg).toContain('data-latex="\\frac{1}{y}"');
    expect(result.svg.svg).not.toContain('\\mbox{x^2}');
  });

  it("supports fit around coordinates and marks fit capability usage", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,fit=(0,0) (1,1)] {};
\end{tikzpicture}`;
    const result = renderTikzToSvg(source);

    expect(result.semantic.featureUsage.fit_node).toBe("used-supported");
    expect(result.semantic.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-fit-targets")).toBe(false);
    expect(result.semantic.scene.requiredTikzLibraries).toContain("fit");
  });

  it("expands bare fit node references to side anchors rather than center only", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,minimum width=2cm] (a) at (0,0) {};
  \node[draw,fit=(a)] (fit) {};
\end{tikzpicture}`;
    const result = renderTikzToSvg(source);
    const fitPath = result.semantic.scene.elements.find(
      (element): element is ScenePath => element.kind === "Path" && element.sourceRef.sourceId === "path:1"
    );
    expect(fitPath).toBeDefined();
    if (!fitPath) {
      throw new Error("Expected fit node path element.");
    }
    const bounds = pathBounds(fitPath);
    expect(bounds).not.toBeNull();
    if (bounds) {
      expect(bounds.maxX - bounds.minX).toBeGreaterThan(parseLength("1cm", "pt") ?? 28.4);
    }
  });

  it("treats explicit center references in fit as center-only samples", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,minimum width=2cm] (a) at (0,0) {};
  \node[draw,fit=(a.center)] (fit) {};
\end{tikzpicture}`;
    const result = renderTikzToSvg(source);
    const fitPath = result.semantic.scene.elements.find(
      (element): element is ScenePath => element.kind === "Path" && element.sourceRef.sourceId === "path:1"
    );
    expect(fitPath).toBeDefined();
    if (!fitPath) {
      throw new Error("Expected fit node path element.");
    }
    const bounds = pathBounds(fitPath);
    expect(bounds).not.toBeNull();
    if (bounds) {
      expect(bounds.maxX - bounds.minX).toBeLessThan(parseLength("1cm", "pt") ?? 28.4);
    }
  });

  it("applies rotate fit as node rotation side effect", () => {
    const source = String.raw`\begin{tikzpicture}
  \node (a) at (0,0) {};
  \node (b) at (2,0) {};
  \node[draw,rotate fit=30,fit=(a) (b)] {};
\end{tikzpicture}`;
    const result = renderTikzToSvg(source);
    const fitPath = result.semantic.scene.elements.find(
      (element): element is ScenePath => element.kind === "Path" && element.sourceRef.sourceId === "path:2"
    );
    expect(fitPath).toBeDefined();
    if (!fitPath) {
      throw new Error("Expected rotated fit node path element.");
    }
    expect(fitPath.transform).toBeDefined();
    if (fitPath.transform) {
      expect(Math.abs(fitPath.transform.b) + Math.abs(fitPath.transform.c)).toBeGreaterThan(0.01);
    }
  });

  it("applies every fit styles only to fit nodes", () => {
    const source = String.raw`\begin{tikzpicture}[every fit/.style={fill=red}]
  \node (a) at (0,0) {};
  \node[draw,fit=(a)] {};
  \node[draw] at (2,0) {};
\end{tikzpicture}`;
    const result = renderTikzToSvg(source);
    const fitPath = result.semantic.scene.elements.find(
      (element): element is ScenePath => element.kind === "Path" && element.sourceRef.sourceId === "path:1"
    );
    const nonFitPath = result.semantic.scene.elements.find(
      (element): element is ScenePath => element.kind === "Path" && element.sourceRef.sourceId === "path:2"
    );
    expect(fitPath?.style.fill).toBe("#ff0000");
    expect(nonFitPath?.style.fill).not.toBe("#ff0000");
  });

  it("supports fit references to node names with apostrophes and spaces", () => {
    const source = String.raw`\begin{tikzpicture}
  \node (d) at (-1,-1) {};
  \node (e) at (1,-1) {};
  \node (b's parent) at (0,0) {};
  \node[draw,fit=(d) (e) (b's parent)] {};
\end{tikzpicture}`;
    const result = renderTikzToSvg(source);

    expect(result.parse.diagnostics.some((diagnostic) => diagnostic.code === "parse-error")).toBe(false);
    expect(result.semantic.featureUsage.fit_node).toBe("used-supported");
    expect(result.semantic.diagnostics.some((diagnostic) => diagnostic.code === "unsupported-fit-targets")).toBe(false);
  });

  it("inherits picture-level inner sep into node layout defaults", () => {
    const source = String.raw`\begin{tikzpicture}[inner sep=0pt]
  \node[fill=blue,circle,minimum size=3pt] at (0,0) {};
\end{tikzpicture}`;
    const result = renderTikzToSvg(source);
    const circle = result.semantic.scene.elements.find((element): element is SceneCircle => element.kind === "Circle");
    expect(circle).toBeDefined();
    if (!circle) {
      throw new Error("Expected circle node path element.");
    }
    expect(circle.radius).toBeLessThan(2.5);
  });

  it("mirrors rotated ellipse arc angles when emitting SVG path data", () => {
    const source = String.raw`\begin{tikzpicture}
  \fill (0,0) ellipse[x radius=1, y radius=2, rotate=45];
\end{tikzpicture}`;
    const result = renderTikzToSvg(source);

    const arcMatch = result.svg.svg.match(/A [^ ]+ [^ ]+ ([^ ]+) 0 [01] [^ ]+ [^ ]+/);
    expect(arcMatch).not.toBeNull();
    if (arcMatch) {
      expect(Number(arcMatch[1])).toBeLessThan(0);
    }
  });

  it("renders cm-transformed paths with translated swapped axes", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[cm={0,1,1,0,(1cm,1cm)}] (0,0) -- (1,1) -- (1,0);
\end{tikzpicture}`;
    const result = renderTikzToSvg(source);

    expect(result.semantic.diagnostics.some((diagnostic) => (diagnostic.code ?? "").startsWith("invalid-cm:"))).toBe(false);
    expect(result.svg.svg).toMatch(/d="M 28\.45\d* 56\.90\d* L 56\.90\d* 28\.45\d* L 28\.45\d* 28\.45\d*"/);
  });

  it("keeps explicit circle radii absolute under x and y scaling", () => {
    const source = String.raw`\begin{tikzpicture}[x=1mm,y=1mm]
  \draw (0,0) circle (.6mm);
\end{tikzpicture}`;

    const result = renderTikzToSvg(source);

    expect(result.svg.svg).toContain('r="1.7072"');
    expect(result.semantic.scene.elements.some((element) => element.kind === "Circle" && element.radius > 1)).toBe(true);
  });

  it("still scales unitless circle radii with x and y", () => {
    const source = String.raw`\begin{tikzpicture}[x=1mm,y=1mm]
  \draw (0,0) circle (1);
\end{tikzpicture}`;

    const result = renderTikzToSvg(source);

    expect(result.svg.svg).toContain('r="2.8453"');
    expect(result.semantic.scene.elements.some((element) => element.kind === "Circle" && element.radius > 2)).toBe(true);
  });

  it("keeps recoverable flow on partial input", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,
\end{tikzpicture}`;
    const result = renderTikzToSvg(source, {
      parse: { recover: true }
    });

    expect(result.parse.diagnostics.length).toBeGreaterThan(0);
    expect(result.semantic.scene.kind).toBe("SceneFigure");
  });

  it("renders node text through MathJax in async mode", async () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,text width=2cm] at (0,0) {Hello \textit{World}};
\end{tikzpicture}`;

    const result = await renderTikzToSvgAsync(source);

    expect(result.svg.svg).toContain('data-text-renderer="mathjax"');
    expect(result.parse.diagnostics.some((diagnostic) => diagnostic.code === "invalid-node-tex")).toBe(false);
  });

  it("rerenders after async text-engine flush when first measure pass is pending", async () => {
    const source = String.raw`\begin{tikzpicture}
  \node at (0,0) {$\ell^2$};
\end{tikzpicture}`;

    const cache = new Map<string, { cacheKey: string; viewBox: { x: number; y: number; width: number; height: number }; body: string }>();
    let ready = false;
    let flushCalls = 0;

    const fakeTextEngine: NodeTextEngine = {
      validate: () => null,
      measure: (_request: NodeTextMeasureRequest): NodeTextMetrics | null => {
        if (!ready) {
          return null;
        }
        const cacheKey = "ready-cache";
        cache.set(cacheKey, {
          cacheKey,
          viewBox: { x: 0, y: 0, width: 1000, height: 1000 },
          body: "<g data-test='ready'></g>"
        });
        return {
          cacheKey,
          width: 10,
          height: 10,
          baselineY: 0,
          midLineY: 0,
          paragraphId: "ready-paragraph",
          renderSourceText: String.raw`$\ell^2$`
        };
      },
      renderFromCache: (cacheKey) => cache.get(cacheKey) ?? null,
      flushPending: async () => {
        flushCalls += 1;
        if (!ready) {
          ready = true;
          return ["ready-cache"];
        }
        return [];
      }
    };

    const result = await renderTikzToSvgAsync(source, {
      textEngine: fakeTextEngine
    });

    expect(flushCalls).toBeGreaterThan(0);
    expect(result.svg.svg).toContain('data-text-renderer="mathjax"');
    expect(result.svg.svg).toContain("data-test='ready'");
  });

  it("honors explicit null textEngine in async rendering", async () => {
    const source = String.raw`\begin{tikzpicture}
  \node at (0,0) {$x^2$};
\end{tikzpicture}`;

    const result = await renderTikzToSvgAsync(source, {
      textEngine: null
    });

    expect(result.renderDiagnostics).toEqual([]);
    expect(result.svg.svg).toContain("<text");
    expect(result.svg.svg).not.toContain('data-text-renderer="mathjax"');
  });

  it("passes macro-expanded node text source maps to the text engine", async () => {
    const source = String.raw`\begin{tikzpicture}
  \newcommand{\wrap}[1]{\textbf{#1}}
  \node at (0,0) {\wrap{Alpha}};
\end{tikzpicture}`;
    const requests: NodeTextMeasureRequest[] = [];
    const textEngine: NodeTextEngine = {
      validate: () => null,
      measure: (request) => {
        requests.push(request);
        return null;
      },
      renderFromCache: () => null
    };

    await renderTikzToSvgAsync(source, { textEngine });

    const request = requests.find((candidate) => candidate.text.includes("Alpha"));
    expect(request?.text).toBe(String.raw`\textbf{Alpha}`);
    expect(request?.sourceMap?.inputText).toBe(String.raw`\textbf{Alpha}`);
    expect(projectInputRange(request?.sourceMap, "\\textbf{".length, "\\textbf{Alpha".length)).toEqual({
      kind: "source-range",
      from: source.indexOf("Alpha"),
      to: source.indexOf("Alpha") + "Alpha".length,
      policy: "caret"
    });
    expect(projectInputRange(request?.sourceMap, 0, "\\textbf{".length)).toEqual({
      kind: "source-range",
      from: source.indexOf(String.raw`\wrap{Alpha}`),
      to: source.indexOf(String.raw`\wrap{Alpha}`) + String.raw`\wrap{Alpha}`.length,
      policy: "macro",
      macroName: "\\wrap"
    });
  });

  it("uses custom validators for node text but skips matrices and user macro sources", async () => {
    const validatedTexts: string[] = [];
    const validatingEngine: NodeTextEngine = {
      validate: (text) => {
        validatedTexts.push(text);
        return text.includes("_") ? { code: "synthetic-invalid", message: "invalid test text" } : null;
      },
      measure: () => null,
      renderFromCache: () => null
    };

    const invalidNode = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node at (0,0) {A_};
\end{tikzpicture}`, {
      textEngine: validatingEngine
    });
    expect(invalidNode.parse.diagnostics.some((diagnostic) => diagnostic.code === "synthetic-invalid")).toBe(true);
    expect(validatedTexts).toEqual(["A_"]);

    validatedTexts.length = 0;
    await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] at (0,0) {
    A_ & B_ \\
  };
\end{tikzpicture}`, {
      textEngine: validatingEngine
    });
    expect(validatedTexts).toEqual([]);

    await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \def\labelText{A_}
  \node at (0,0) {\labelText};
\end{tikzpicture}`, {
      textEngine: validatingEngine
    });
    expect(validatedTexts).toEqual([]);
  });

  it("reports invalid node TeX as parser errors while preserving rendering", async () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {A_};
\end{tikzpicture}`;

    const result = await renderTikzToSvgAsync(source);

    expect(result.parse.diagnostics.some((diagnostic) => diagnostic.code === "invalid-node-tex")).toBe(true);
    expect(result.svg.svg).toContain("<svg");
    expect(result.semantic.scene.elements.length).toBeGreaterThan(0);
  });

  it("keeps rendering recoverable for partial text commands in explicit multiline node text", async () => {
    const source = String.raw`\begin{tikzpicture}
  \node at (0.2,3.2) [align=left]{I'm testing the Mathjax \\ rendering \te};
\end{tikzpicture}`;

    const result = await renderTikzToSvgAsync(source);

    expect(result.parse.diagnostics.some((diagnostic) => diagnostic.code === "invalid-node-tex")).toBe(true);
    expect(result.svg.svg).toContain("<svg");
    expect(result.semantic.scene.elements.length).toBeGreaterThan(0);
    expect(result.svg.svg).toContain("<text");
  });

  it("uses browser text measurement for plain node text fallback width", () => {
    const target = globalThis as unknown as {
      document?: unknown;
    };
    const previousDocument = target.document;
    target.document = {
      createElement: (tagName: string) => {
        if (tagName !== "canvas") {
          return {};
        }
        return {
          getContext: (contextId: string) =>
            contextId === "2d"
              ? {
                  font: "",
                  measureText: (text: string) => ({
                    width: text === "iiiiiiiiii" ? 12 : text.length * 10,
                    actualBoundingBoxAscent: 7,
                    actualBoundingBoxDescent: 2
                  })
                }
              : null
        };
      }
    };

    try {
      const source = String.raw`\begin{tikzpicture}
  \node at (0,0) {iiiiiiiiii};
\end{tikzpicture}`;
      const result = renderTikzToSvg(source);
      const text = result.semantic.scene.elements.find((element): element is SceneText => element.kind === "Text");

      expect(text?.textBlockWidth).toBe(12);
      expect(text?.textBlockHeight).toBe(9);
    } finally {
      if (previousDocument === undefined) {
        delete target.document;
      } else {
        target.document = previousDocument;
      }
    }
  });

  it("does not report invalid-node-tex for matrix bodies containing ampersands", async () => {
    const source = String.raw`\begin{tikzpicture}
  \matrix[matrix of nodes] at (0,0) {
    A & B \\
    C & D \\
  };
\end{tikzpicture}`;

    const result = await renderTikzToSvgAsync(source);

    expect(result.parse.diagnostics.some((diagnostic) => diagnostic.code === "invalid-node-tex")).toBe(false);
  });

  it("uses measured parbox heights for text width wrapping in async mode", async () => {
    const narrow = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node[draw,text width=1cm] at (0,0) {alpha beta gamma delta epsilon};
\end{tikzpicture}`);
    const wide = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node[draw,text width=3cm] at (0,0) {alpha beta gamma delta epsilon};
\end{tikzpicture}`);

    const narrowText = narrow.semantic.scene.elements.find((element) => element.kind === "Text");
    const wideText = wide.semantic.scene.elements.find((element) => element.kind === "Text");
    expect(narrowText?.kind).toBe("Text");
    expect(wideText?.kind).toBe("Text");
    if (narrowText?.kind === "Text" && wideText?.kind === "Text") {
      expect((narrowText.textBlockHeight ?? 0)).toBeGreaterThan(wideText.textBlockHeight ?? 0);
    }
  });

  it("keeps plain multi-word node text single-line without align or text width", async () => {
    const singleWord = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {Hello};
\end{tikzpicture}`);
    const multiWord = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {Hello World};
\end{tikzpicture}`);

    const singleWordText = singleWord.semantic.scene.elements.find((element): element is SceneText => element.kind === "Text");
    const multiWordText = multiWord.semantic.scene.elements.find((element): element is SceneText => element.kind === "Text");

    expect(singleWordText?.kind).toBe("Text");
    expect(multiWordText?.kind).toBe("Text");
    if (singleWordText?.kind === "Text" && multiWordText?.kind === "Text") {
      const singleRenderInfo = singleWordText.textRenderInfo;
      const multiRenderInfo = multiWordText.textRenderInfo;
      expect(singleRenderInfo?.mode).toBe("mathjax");
      expect(multiRenderInfo?.mode).toBe("mathjax");
      if (singleRenderInfo?.mode === "mathjax" && multiRenderInfo?.mode === "mathjax") {
        expect(singleRenderInfo.layoutKind).toBe("single-line");
        expect(multiRenderInfo.layoutKind).toBe("single-line");
      }
      expect(multiWordText.textBlockHeight ?? 0).toBeLessThan((singleWordText.textBlockHeight ?? 0) * 1.5);
    }
    expect(renderedMspaceAdvances(multiWord.svg.svg).every((advance) => advance > 0)).toBe(true);
  });

  it("preserves visible spaces in plain single-line MathJax node text", async () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] (test) at (0, 1.5) {this is a node with text};
\end{tikzpicture}`;

    const result = await renderTikzToSvgAsync(source);
    const text = result.semantic.scene.elements.find((element): element is SceneText => element.kind === "Text");

    expect(text?.kind).toBe("Text");
    if (text?.kind === "Text") {
      expect(text.text).toBe("this is a node with text");
      const renderInfo = text.textRenderInfo;
      expect(renderInfo?.mode).toBe("mathjax");
      if (renderInfo?.mode === "mathjax") {
        const report = reportForParagraphId(renderInfo.paragraphId);
        const spaceRuns = report?.runs.filter((run) => run.kind === "space") ?? [];
        expect(spaceRuns).toHaveLength(5);
        expect(spaceRuns.every((run) => run.width > 0)).toBe(true);
      }
    }
  });

  it("keeps long plain node text single-line without align or text width", async () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {Let me think of something long and fun to write};
\end{tikzpicture}`;

    const result = await renderTikzToSvgAsync(source);
    const text = result.semantic.scene.elements.find((element): element is SceneText => element.kind === "Text");

    expect(text?.kind).toBe("Text");
    if (text?.kind === "Text") {
      expect(text.text).toBe("Let me think of something long and fun to write");
      expect(text.text).not.toContain("\n");
      const renderInfo = text.textRenderInfo;
      expect(renderInfo?.mode).toBe("mathjax");
      if (renderInfo?.mode === "mathjax") {
        expect(renderInfo.layoutKind).toBe("single-line");
        expect(renderInfo.paragraphId).toBeTruthy();
      }
    }
  });

  it("uses exact single-line text width without adding extra node slack", async () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] (C) at (0, 1.5) {C};
\end{tikzpicture}`;

    const result = await renderTikzToSvgAsync(source);
    const text = result.semantic.scene.elements.find((element): element is SceneText => element.kind === "Text");

    expect(text?.kind).toBe("Text");
    if (text?.kind === "Text") {
      const renderInfo = text.textRenderInfo;
      expect(text.text).toBe("C");
      expect(renderInfo?.mode).toBe("mathjax");
      if (renderInfo?.mode === "mathjax") {
        expect(renderInfo.layoutKind).toBe("single-line");
        expect(renderInfo.paragraphId).toBeTruthy();
        expect(renderInfo.renderSourceText).toBe("C");
      }
      const defaultInset = (parseLength(".3333em", "pt") ?? 3.333) * 2;
      expect((text.nodeVisualWidth ?? 0) - (text.textBlockWidth ?? 0)).toBeCloseTo(defaultInset, 3);
    }

    expect(result.svg.svg).toContain('data-text-layout-kind="single-line"');
    expect(result.svg.svg).toContain('data-paragraph-id="tex:');
    expect(result.svg.svg).toContain('data-tex-font="lmroman10-regular"');
    expect(result.svg.svg).not.toContain(String.raw`\mbox{C}`);
    expect(countLineboxes(result.svg.svg)).toBeLessThanOrEqual(1);
  });

  it("includes transformed node-box geometry in scene bounds for rotated wrapped nodes", async () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw,align=left,text width=90pt,rotate=34] at (0,0) {Let me think of something long to write to see the multi-line functionalities of this app};
\end{tikzpicture}`;
    const result = await renderTikzToSvgAsync(source);
    const bounds = result.semantic.scene.bounds;
    expect(bounds).toBeDefined();

    const transformedPathPoints = result.semantic.scene.elements
      .filter((element): element is ScenePath => element.kind === "Path")
      .flatMap((path) =>
        path.commands
          .filter((command): command is Extract<ScenePath["commands"][number], { to: { x: number; y: number } }> => "to" in command)
          .map((command) => (path.transform ? applyMatrix(path.transform, command.to) : command.to))
      );

    expect(transformedPathPoints.length).toBeGreaterThan(0);
    if (bounds && transformedPathPoints.length > 0) {
      for (const point of transformedPathPoints) {
        expect(point.x).toBeGreaterThanOrEqual(bounds.minX - 1e-6);
        expect(point.x).toBeLessThanOrEqual(bounds.maxX + 1e-6);
        expect(point.y).toBeGreaterThanOrEqual(bounds.minY - 1e-6);
        expect(point.y).toBeLessThanOrEqual(bounds.maxY + 1e-6);
      }
    }
  });

  it("treats literal newlines inside node text as spaces rather than explicit multiline breaks", async () => {
    const inlineSpaces = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {Hello World};
\end{tikzpicture}`);
    const literalNewline = await renderTikzToSvgAsync(`\\begin{tikzpicture}
  \\node[draw] at (0,0) {Hello
World};
\\end{tikzpicture}`);

    const inlineText = inlineSpaces.semantic.scene.elements.find((element): element is SceneText => element.kind === "Text");
    const newlineText = literalNewline.semantic.scene.elements.find((element): element is SceneText => element.kind === "Text");

    expect(inlineText?.kind).toBe("Text");
    expect(newlineText?.kind).toBe("Text");
    if (inlineText?.kind === "Text" && newlineText?.kind === "Text") {
      const inlineRenderInfo = inlineText.textRenderInfo;
      const newlineRenderInfo = newlineText.textRenderInfo;
      expect(inlineRenderInfo?.mode).toBe("mathjax");
      expect(newlineRenderInfo?.mode).toBe("mathjax");
      if (inlineRenderInfo?.mode === "mathjax" && newlineRenderInfo?.mode === "mathjax") {
        expect(inlineRenderInfo.layoutKind).toBe("single-line");
        expect(newlineRenderInfo.layoutKind).toBe("single-line");
      }
      expect(newlineText.textBlockHeight ?? 0).toBeLessThan((inlineText.textBlockHeight ?? 0) * 1.2);
    }
  });

  it("treats \\\\ as inert when neither align nor text width is set", async () => {
    const result = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {First\\Second};
\end{tikzpicture}`);

    const text = result.semantic.scene.elements.find((element): element is SceneText => element.kind === "Text");
    expect(text?.kind).toBe("Text");
    if (text?.kind === "Text") {
      expect(text.text).toBe("FirstSecond");
      const renderInfo = text.textRenderInfo;
      expect(renderInfo?.mode).toBe("mathjax");
      if (renderInfo?.mode === "mathjax") {
        expect(renderInfo.layoutKind).toBe("single-line");
        expect(renderInfo.renderSourceText).toBe("FirstSecond");
      }
    }
  });

  it("uses explicit multiline layout for \\\\ when align is set without text width", async () => {
    const result = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node[draw,align=center] at (0,0) {First\\Second};
\end{tikzpicture}`);

    const text = result.semantic.scene.elements.find((element): element is SceneText => element.kind === "Text");
    expect(text?.kind).toBe("Text");
    if (text?.kind === "Text") {
      expect(text.text).toBe("First\nSecond");
      const renderInfo = text.textRenderInfo;
      expect(renderInfo?.mode).toBe("mathjax");
      if (renderInfo?.mode === "mathjax") {
        expect(renderInfo.layoutKind).toBe("explicit-multiline");
      }
    }
    expect(result.svg.svg).toContain(String.raw`\parbox[t]{`);
    expect(result.svg.svg).toContain('data-paragraph-id=');
    expect(result.svg.svg).not.toContain(String.raw`\begin{array}`);
    expect(countLineboxes(result.svg.svg)).toBeGreaterThan(1);
  });

  it("treats \\\\ followed by spaces as explicit multiline when align is set", async () => {
    const result = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node[draw,align=center] (A) at (-1, -1) {Abcd \\ defgh};
\end{tikzpicture}`);

    const text = result.semantic.scene.elements.find((element): element is SceneText => element.kind === "Text");
    expect(text?.kind).toBe("Text");
    if (text?.kind === "Text") {
      expect(text.text).toBe("Abcd\ndefgh");
      const renderInfo = text.textRenderInfo;
      expect(renderInfo?.mode).toBe("mathjax");
      if (renderInfo?.mode === "mathjax") {
        expect(renderInfo.layoutKind).toBe("explicit-multiline");
      }
    }
    expect(result.svg.svg).toContain(String.raw`\parbox[t]{`);
    expect(result.svg.svg).toContain('data-paragraph-id=');
    expect(countLineboxes(result.svg.svg)).toBeGreaterThan(1);
  });

  it("keeps explicit multiline rendering for align=center when the first line is inline math", async () => {
    const result = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node[align=center] at (0,0) {$x$ \\ variable};
\end{tikzpicture}`);

    const text = result.semantic.scene.elements.find((element): element is SceneText => element.kind === "Text");
    expect(text?.kind).toBe("Text");
    if (text?.kind === "Text") {
      expect(text.text).toBe("$x$\nvariable");
      const renderInfo = text.textRenderInfo;
      expect(renderInfo?.mode).toBe("mathjax");
      if (renderInfo?.mode === "mathjax") {
        expect(renderInfo.layoutKind).toBe("explicit-multiline");
      }
    }
    expect(result.svg.svg).toContain(String.raw`\parbox[t]{`);
    expect(result.svg.svg).toContain('data-paragraph-id=');
    expect(countLineboxes(result.svg.svg)).toBeGreaterThan(1);
    const xs = readLineboxTranslateXs(result.svg.svg);
    expect(xs.some((x) => x > 0.5)).toBe(true);
  });

  it("uses TeX-shaped paragraph reports for simple wrapped LuaLaTeX-default text", async () => {
    const result = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node[draw,text width=32pt,align=left] at (0,0) {Alpha Beta};
\end{tikzpicture}`);

    const text = result.semantic.scene.elements.find((element): element is SceneText => element.kind === "Text");
    expect(text?.kind).toBe("Text");
    const renderInfo = text?.textRenderInfo;
    expect(renderInfo?.mode).toBe("mathjax");
    if (renderInfo?.mode === "mathjax") {
      expect(renderInfo.paragraphId).toMatch(/^tex:/);
      expect(renderInfo.layoutKind).toBe("wrapped");
      const report = reportForParagraphId(renderInfo.paragraphId);
      expect(report?.lines).toHaveLength(2);
      expect(report?.lines[0]?.segments.map((segment) => segment.text).join("")).toBe("Alpha");
      expect(report?.lines[1]?.segments.map((segment) => segment.text).join("")).toBe("Beta");
    }
    expect(result.svg.svg).toContain('data-paragraph-id="tex:');
    expect(result.svg.svg).toContain('data-mjx-linebox="true"');
    expect(result.svg.svg).toContain('data-tex-font="lmroman10-regular"');
    expect(result.svg.svg).toContain("<path");
    expect(result.svg.svg).not.toContain("<text");
  });

  it("emits TeX-derived glyph source ranges for wrapped display math editing", async () => {
    const sourceText = String.raw`Intro \[x^2=y\] Outro`;
    const result = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node[text width=120pt,align=left] at (0,0) {Intro \[x^2=y\] Outro};
\end{tikzpicture}`);

    const yOffset = sourceText.indexOf("y");
    expect(result.parse.diagnostics.some((diagnostic) => diagnostic.code === "invalid-node-tex")).toBe(false);
    expect(result.svg.svg).toContain('data-paragraph-id="tex:');
    expect(result.svg.svg).toContain('data-tex-glyph="73" data-source-start="0" data-source-end="1"');
    expect(result.svg.svg).toContain(`data-source-start="${yOffset}" data-source-end="${yOffset + 1}"`);
  });

  it("keeps explicit TeX line breaks on the TeX-shaped paragraph path", async () => {
    const result = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node[draw,text width=150pt,align=left] at (0,0) {Alpha \\[7pt] Beta};
\end{tikzpicture}`);

    const text = result.semantic.scene.elements.find((element): element is SceneText => element.kind === "Text");
    const renderInfo = text?.textRenderInfo;
    expect(renderInfo?.mode).toBe("mathjax");
    if (renderInfo?.mode === "mathjax") {
      expect(renderInfo.paragraphId).toMatch(/^tex:/);
      const report = reportForParagraphId(renderInfo.paragraphId);
      expect(report?.lines).toHaveLength(2);
      expect(report?.lines[0]?.break).toMatchObject({
        kind: "forced",
        lineLeading: "7pt",
      });
    }
    expect(result.svg.svg).toContain('data-paragraph-id="tex:');
    expect(result.svg.svg).toContain('data-lineleading="7pt"');
    expect(readLineboxTranslateYs(result.svg.svg)).toEqual([
      expect.closeTo(0, 6),
      expect.closeTo(19.33, 6),
    ]);
  });

  it("keeps align=left explicit multiline text without text width on the fixed-lines paragraph path", async () => {
    const result = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node[align=left] at (0,0) {a \\ variable};
\end{tikzpicture}`);

    const text = result.semantic.scene.elements.find((element): element is SceneText => element.kind === "Text");
    expect(text?.kind).toBe("Text");
    if (text?.kind === "Text") {
      expect(text.text).toBe("a\nvariable");
      const renderInfo = text.textRenderInfo;
      expect(renderInfo?.mode).toBe("mathjax");
      if (renderInfo?.mode === "mathjax") {
        expect(renderInfo.layoutKind).toBe("explicit-multiline");
      }
    }

    expect(countLineboxes(result.svg.svg)).toBe(2);
    expect(result.svg.svg).toContain('data-paragraph-id=');
    expect(result.svg.svg).not.toContain(String.raw`\begin{array}`);
    expect(result.svg.svg).not.toContain("10000pt");
    expect(result.svg.svg).not.toContain('data-c="2D"');
    expect(result.semantic.scene.bounds).toBeDefined();
    expect((result.semantic.scene.bounds?.maxX ?? 0) - (result.semantic.scene.bounds?.minX ?? 0)).toBeLessThan(100);
  });

  it("does not hyphenate the second line of align=left explicit multiline inline math nodes without text width", async () => {
    const result = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node[align=left] at (0,0) {$x$ \\ variable};
\end{tikzpicture}`);

    const text = result.semantic.scene.elements.find((element): element is SceneText => element.kind === "Text");
    expect(text?.kind).toBe("Text");
    if (text?.kind === "Text") {
      expect(text.text).toBe("$x$\nvariable");
      const renderInfo = text.textRenderInfo;
      expect(renderInfo?.mode).toBe("mathjax");
      if (renderInfo?.mode === "mathjax") {
        expect(renderInfo.layoutKind).toBe("explicit-multiline");
      }
    }

    expect(countLineboxes(result.svg.svg)).toBe(2);
    expect(result.svg.svg).toContain('data-paragraph-id=');
    expect(result.svg.svg).not.toContain(String.raw`\begin{array}`);
    expect(result.svg.svg).not.toContain("10000pt");
    expect(result.svg.svg).not.toContain('data-c="2D"');
    expect(result.semantic.scene.bounds).toBeDefined();
    expect((result.semantic.scene.bounds?.maxX ?? 0) - (result.semantic.scene.bounds?.minX ?? 0)).toBeLessThan(100);
  });

  it("keeps default natural-width inline math nodes on the same TeX path as aligned nodes", async () => {
    const result = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node at (1.09,2.76) {node $x=y$};
  \node[align=left] at (1.1,2.15) {node $x=y$};
  \node[align=left, text width=100pt] at (2.01,1.47) {node $x=y$};
\end{tikzpicture}`);

    const textElements = result.semantic.scene.elements.filter((element): element is SceneText => element.kind === "Text");
    expect(textElements).toHaveLength(3);
    const renderInfos = textElements.map((element) => element.textRenderInfo);
    expect(renderInfos.every((info) =>
      info?.mode === "mathjax" && info.paragraphId != null && info.paragraphId.startsWith("tex:")
    )).toBe(true);
    expect(textElements[0]?.textBlockWidth).toBeCloseTo(textElements[1]?.textBlockWidth ?? 0, 6);
    expect(textElements[0]?.textBlockHeight).toBeCloseTo(textElements[1]?.textBlockHeight ?? 0, 6);
    expect(result.svg.svg).toContain('data-tex-inline-math="true"');
    expect(result.svg.svg).not.toContain(String.raw`\mbox{node $x=y$}`);
  });

  it("does not preserve a leading space after \\\\ for wrapped text width nodes", async () => {
    const result = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node[draw,text width=5cm] (A) at (-1, -1) {This is the first line \\ and this is the second};
\end{tikzpicture}`);

    const text = result.semantic.scene.elements.find((element): element is SceneText => element.kind === "Text");
    expect(text?.kind).toBe("Text");
    if (text?.kind === "Text") {
      const lines = text.text.split("\n");
      expect(lines.length).toBeGreaterThan(1);
      const secondLine = lines[1] ?? "";
      expect(secondLine.startsWith(" ")).toBe(false);
      expect(secondLine.startsWith("and")).toBe(true);
      const renderInfo = text.textRenderInfo;
      expect(renderInfo?.mode).toBe("mathjax");
      if (renderInfo?.mode === "mathjax") {
        expect(renderInfo.renderSourceText).toContain(String.raw`\\and this is the second`);
        expect(renderInfo.renderSourceText).not.toContain(String.raw`\\ and this is the second`);
      }
    }
  });

  it("does not preserve a leading space after \\\\ for align=left explicit multiline nodes", async () => {
    const result = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node[draw,align=left] (A) at (-1, -1) {This is the first line \\ and this is the second};
\end{tikzpicture}`);

    const text = result.semantic.scene.elements.find((element): element is SceneText => element.kind === "Text");
    expect(text?.kind).toBe("Text");
    if (text?.kind === "Text") {
      const lines = text.text.split("\n");
      expect(lines.length).toBeGreaterThan(1);
      const secondLine = lines[1] ?? "";
      expect(secondLine.startsWith(" ")).toBe(false);
      expect(secondLine.startsWith("and")).toBe(true);
      const renderInfo = text.textRenderInfo;
      expect(renderInfo?.mode).toBe("mathjax");
      if (renderInfo?.mode === "mathjax") {
        expect(renderInfo.layoutKind).toBe("explicit-multiline");
      }
    }
    expect(result.svg.svg).toContain('data-paragraph-id="tex:');
    expect(result.svg.svg).toContain('data-paragraph-id=');
    expect(result.svg.svg).not.toContain(String.raw`\begin{array}`);
    expect(countLineboxes(result.svg.svg)).toBeGreaterThan(1);
  });

  it("applies \\\\[<len>] line leading under text width without rendering bracket text", async () => {
    const result = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node[draw,text width=6.1cm,align=left] (A) at (0,0) {This is the first line \\[10pt]and this is the second line};
\end{tikzpicture}`);

    const text = result.semantic.scene.elements.find((element): element is SceneText => element.kind === "Text");
    expect(text?.kind).toBe("Text");
    if (text?.kind === "Text") {
      expect(text.text).toBe("This is the first line\nand this is the second line");
      const renderInfo = text.textRenderInfo;
      expect(renderInfo?.mode).toBe("mathjax");
      if (renderInfo?.mode === "mathjax") {
        expect(renderInfo.layoutKind).toBe("explicit-multiline");
      }
    }

    expect(result.svg.svg).toContain('data-lineleading="10pt"');
    expect(result.svg.svg).not.toContain('data-c="5B"');
    expect(result.svg.svg).not.toContain('data-c="5D"');
  });

  it("preserves \\\\[<len>] line leading in align=left explicit multiline paragraph rendering", async () => {
    const result = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node[draw,align=left] (A) at (0,0) {This is the first line \\[10pt]and this is the second line};
\end{tikzpicture}`);

    const text = result.semantic.scene.elements.find((element): element is SceneText => element.kind === "Text");
    expect(text?.kind).toBe("Text");
    if (text?.kind === "Text") {
      expect(text.text).toBe("This is the first line\nand this is the second line");
      const renderInfo = text.textRenderInfo;
      expect(renderInfo?.mode).toBe("mathjax");
      if (renderInfo?.mode === "mathjax") {
        expect(renderInfo.layoutKind).toBe("explicit-multiline");
      }
    }

    expect(result.svg.svg).toContain('data-paragraph-id="tex:');
    expect(result.svg.svg).toContain('data-paragraph-id=');
    expect(result.svg.svg).not.toContain(String.raw`\begin{array}`);
    expect(countLineboxes(result.svg.svg)).toBeGreaterThan(1);
    expect(result.svg.svg).toContain('data-lineleading="10pt"');
    expect(result.svg.svg).not.toContain('data-c="5B"');
    expect(result.svg.svg).not.toContain('data-c="5D"');
  });

  it("keeps \\\\ multiline behavior under text width even with align=none", async () => {
    const result = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node[draw,text width=3cm,align=none] at (0,0) {First\\Second};
\end{tikzpicture}`);

    const text = result.semantic.scene.elements.find((element): element is SceneText => element.kind === "Text");
    expect(text?.kind).toBe("Text");
    if (text?.kind === "Text") {
      expect(text.text).toContain("\n");
      const renderInfo = text.textRenderInfo;
      expect(renderInfo?.mode).toBe("mathjax");
      if (renderInfo?.mode === "mathjax") {
        expect(renderInfo.layoutKind).toBe("explicit-multiline");
      }
    }
  });

  it("defaults wrapped nodes to ragged-right alignment unless align is explicitly set", async () => {
    const defaultAlign = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node[draw,text width=3cm] at (0,0) {alpha beta gamma delta epsilon};
\end{tikzpicture}`);
    const centered = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node[draw,text width=3cm,align=center] at (0,0) {alpha beta gamma delta epsilon};
\end{tikzpicture}`);
    const rightAligned = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node[draw,text width=3cm,align=right] at (0,0) {alpha beta gamma delta epsilon};
\end{tikzpicture}`);

    expect(defaultAlign.svg.svg).toContain('data-align="left"');
    expect(centered.svg.svg).toContain('data-align="center"');
    expect(rightAligned.svg.svg).toContain('data-align="right"');

    const defaultXs = readLineboxTranslateXs(defaultAlign.svg.svg);
    const centeredXs = readLineboxTranslateXs(centered.svg.svg);
    const rightXs = readLineboxTranslateXs(rightAligned.svg.svg);

    expect(defaultXs.length).toBeGreaterThan(1);
    expect(centeredXs.length).toBeGreaterThan(1);
    expect(rightXs.length).toBeGreaterThan(1);
    expect(centeredXs.some((x) => x > 0.5)).toBe(true);
    expect(rightXs.some((x) => x > 0.5)).toBe(true);
  });

  it("wraps long align=left paragraphs under text width without explicit breaks", async () => {
    const result = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node[draw,text width=8.1cm,align=left] (A) at (0,0) {This is the first line and this is the second line which is much longer};
\end{tikzpicture}`);

    const text = result.semantic.scene.elements.find((element): element is SceneText => element.kind === "Text");
    expect(text?.kind).toBe("Text");
    if (text?.kind === "Text") {
      const renderInfo = text.textRenderInfo;
      expect(renderInfo?.mode).toBe("mathjax");
      if (renderInfo?.mode === "mathjax") {
        expect(renderInfo.layoutKind).toBe("wrapped");
      }
    }
    const lineboxCount = (result.svg.svg.match(/data-mjx-linebox=/g) ?? []).length;
    expect(lineboxCount).toBeGreaterThan(1);
    expect(result.svg.svg).toContain('data-align="left"');
  });

  it("allows automatic hyphenation in wrapped align=left paragraphs when needed", async () => {
    const result = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node[draw,text width=6.1cm,align=left] (A) at (0,0) {This is the first line and this is the second line which is much longer};
\end{tikzpicture}`);

    const lineboxCount = (result.svg.svg.match(/data-mjx-linebox=/g) ?? []).length;
    expect(lineboxCount).toBeGreaterThan(1);
    expect(result.svg.svg).toContain('data-align="left"');
    // The source contains no hyphen, so a rendered hyphen glyph indicates
    // discretionary hyphenation was applied by the line breaker.
    expect(result.svg.svg).toMatch(/data-c="2D"|data-tex-glyph="45"/);
  });

  it("uses wider sentence spacing than ordinary interword spacing in wrapped paragraphs", async () => {
    const ordinary = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node[text width=100pt,align=left] at (0,0) {a b};
\end{tikzpicture}`);
    const sentence = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node[text width=100pt,align=left] at (0,0) {a. B};
\end{tikzpicture}`);
    const lowercaseSentence = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node[text width=100pt,align=left] at (0,0) {a. b};
\end{tikzpicture}`);
    const capitalAbbreviation = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node[text width=100pt,align=left] at (0,0) {A. B};
\end{tikzpicture}`);

    const ordinaryText = ordinary.semantic.scene.elements.find((element): element is SceneText => element.kind === "Text");
    const sentenceText = sentence.semantic.scene.elements.find((element): element is SceneText => element.kind === "Text");
    const lowercaseSentenceText = lowercaseSentence.semantic.scene.elements.find(
      (element): element is SceneText => element.kind === "Text"
    );
    const capitalAbbreviationText = capitalAbbreviation.semantic.scene.elements.find(
      (element): element is SceneText => element.kind === "Text"
    );

    expect(ordinaryText?.kind).toBe("Text");
    expect(sentenceText?.kind).toBe("Text");
    expect(lowercaseSentenceText?.kind).toBe("Text");
    expect(capitalAbbreviationText?.kind).toBe("Text");
    if (
      ordinaryText?.kind === "Text" &&
      sentenceText?.kind === "Text" &&
      lowercaseSentenceText?.kind === "Text" &&
      capitalAbbreviationText?.kind === "Text"
    ) {
      const ordinaryReport = reportForParagraphId(
        ordinaryText.textRenderInfo?.mode === "mathjax" ? ordinaryText.textRenderInfo.paragraphId : null
      );
      const sentenceReport = reportForParagraphId(
        sentenceText.textRenderInfo?.mode === "mathjax" ? sentenceText.textRenderInfo.paragraphId : null
      );
      const lowercaseSentenceReport = reportForParagraphId(
        lowercaseSentenceText.textRenderInfo?.mode === "mathjax"
          ? lowercaseSentenceText.textRenderInfo.paragraphId
          : null
      );
      const capitalAbbreviationReport = reportForParagraphId(
        capitalAbbreviationText.textRenderInfo?.mode === "mathjax"
          ? capitalAbbreviationText.textRenderInfo.paragraphId
          : null
      );
      expect(ordinaryReport).not.toBeNull();
      expect(sentenceReport).not.toBeNull();
      expect(lowercaseSentenceReport).not.toBeNull();
      expect(capitalAbbreviationReport).not.toBeNull();
      const ordinarySpace = ordinaryReport?.runs.find((run) => run.kind === "space");
      const sentenceSpace = sentenceReport?.runs.find((run) => run.kind === "space");
      const lowercaseSentenceSpace = lowercaseSentenceReport?.runs.find((run) => run.kind === "space");
      const capitalAbbreviationSpace = capitalAbbreviationReport?.runs.find((run) => run.kind === "space");
      expect(sentenceSpace?.width ?? 0).toBeGreaterThan(ordinarySpace?.width ?? 0);
      expect(lowercaseSentenceSpace?.width ?? 0).toBeGreaterThan(ordinarySpace?.width ?? 0);
      expect(capitalAbbreviationSpace?.width ?? 0).toBeCloseTo(ordinarySpace?.width ?? 0, 6);
    }
  });

  it("preserves rendered interword mspace advances for wrapped align=left paragraphs", async () => {
    const result = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node[align=left, text width=380pt,font=\itshape] at (0,0) {Lorem ipsum dolor sit amet, consectetuer adipiscing elit. Aenean commodo ligula eget dolor. Aenean massa. Cum sociis natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus. Donec quam felis, ultricies nec, pellentesque eu, pretium quis, sem. Nulla consequat massa quis enim. Donec pede justo, fringilla vel, aliquet nec, vulputate eget, arcu. In enim justo, rhoncus ut, imperdiet a, venenatis vitae, justo. Nullam dictum felis eu pede mollis pretium. Integer tincidunt. Cras dapibus. Vivamus elementum semper nisi. Aenean vulputate eleifend tellus. Aenean leo ligula, porttitor eu, consequat vitae, eleifend ac, enim. Aliquam lorem ante, dapibus in, viverra quis, feugiat a, tellus. Phasellus viverra nulla ut metus varius laoreet. Quisque rutrum. Aenean imperdiet. Etiam ultricies nisi vel augue. Curabitur ullamcorper ultricies nisi. Nam eget dui. Etiam rhoncus. Maecenas tempus, tellus eget condimentum rhoncus, sem quam semper libero, sit amet adipiscing sem neque sed ipsum. Nam quam nunc, blandit vel, luctus pulvinar, hendrerit id, lorem. Maecenas nec odio et ante tincidunt tempus. Donec vitae sapien ut libero venenatis faucibus. Nullam quis ante.};
\end{tikzpicture}`);

    const text = result.semantic.scene.elements.find((element): element is SceneText => element.kind === "Text");
    const report = reportForParagraphId(
      text?.textRenderInfo?.mode === "mathjax" ? text.textRenderInfo.paragraphId : null
    );
    const advances = report?.lines.flatMap((line) =>
      line.segments
        .filter((segment) => segment.kind === "space")
        .map((segment) => Number(segment.width) || 0)
    ) ?? [];
    expect(advances.length).toBeGreaterThan(100);
    expect(advances.every((advance) => advance > 0)).toBe(true);
  });

  it("keeps normal wrapped align=left lorem paragraphs on the canonical two-pass path", async () => {
    const result = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node[align=left, text width=380pt,font=\itshape] at (0,0) {Lorem ipsum dolor sit amet, consectetuer adipiscing elit. Aenean commodo ligula eget dolor. Aenean massa. Cum sociis natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus. Donec quam felis, ultricies nec, pellentesque eu, pretium quis, sem. Nulla consequat massa quis enim. Donec pede justo, fringilla vel, aliquet nec, vulputate eget, arcu. In enim justo, rhoncus ut, imperdiet a, venenatis vitae, justo. Nullam dictum felis eu pede mollis pretium. Integer tincidunt. Cras dapibus. Vivamus elementum semper nisi. Aenean vulputate eleifend tellus. Aenean leo ligula, porttitor eu, consequat vitae, eleifend ac, enim. Aliquam lorem ante, dapibus in, viverra quis, feugiat a, tellus. Phasellus viverra nulla ut metus varius laoreet. Quisque rutrum. Aenean imperdiet. Etiam ultricies nisi vel augue. Curabitur ullamcorper ultricies nisi. Nam eget dui. Etiam rhoncus. Maecenas tempus, tellus eget condimentum rhoncus, sem quam semper libero, sit amet adipiscing sem neque sed ipsum. Nam quam nunc, blandit vel, luctus pulvinar, hendrerit id, lorem. Maecenas nec odio et ante tincidunt tempus. Donec vitae sapien ut libero venenatis faucibus. Nullam quis ante.};
\end{tikzpicture}`);

    const text = result.semantic.scene.elements.find((element): element is SceneText => element.kind === "Text");
    const report =
      text?.kind === "Text" && text.textRenderInfo?.mode === "mathjax"
        ? reportForParagraphId(text.textRenderInfo.paragraphId)
        : null;
    expect(report).not.toBeNull();
    expect(report?.errors.some((entry) => entry === "pass=emergency")).toBe(false);
    expect(report?.linebreakingMode === "feasible" || report?.linebreakingMode === "overfull").toBe(true);
  });

  it("keeps wrapped justified line starts anchored at the left edge in the paragraph report", async () => {
    const result = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node[align=justify, text width=360pt] at (0,0) {Lorem ipsum dolor sit amet, consectetuer adipiscing elit. Aenean commodo ligula eget dolor. Aenean massa. Cum sociis natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus. Donec quam felis, ultricies nec, pellentesque eu, pretium quis, sem. Nulla consequat massa quis enim. Donec pede justo, fringilla vel, aliquet nec, vulputate eget, arcu. In enim justo, rhoncus ut, imperdiet a, venenatis vitae, justo. Nullam dictum felis eu pede mollis pretium. Integer tincidunt. Cras dapibus. Vivamus elementum semper nisi. Aenean vulputate eleifend tellus. Aenean leo ligula, porttitor eu, consequat vitae, eleifend ac, enim. Aliquam lorem ante, dapibus in, viverra quis, feugiat a, tellus. Phasellus viverra nulla ut metus varius laoreet. Quisque rutrum. Aenean imperdiet. Etiam ultricies nisi vel augue. Curabitur ullamcorper ultricies nisi. Nam eget dui. Etiam rhoncus. Maecenas tempus, tellus eget condimentum rhoncus, sem quam semper libero, sit amet adipiscing sem neque sed ipsum. Nam quam nunc, blandit vel, luctus pulvinar, hendrerit id, lorem. Maecenas nec odio et ante tincidunt tempus. Donec vitae sapien ut libero venenatis faucibus. Nullam quis ante.};
\end{tikzpicture}`);

    const text = result.semantic.scene.elements.find((element): element is SceneText => element.kind === "Text");
    const report =
      text?.kind === "Text" && text.textRenderInfo?.mode === "mathjax"
        ? reportForParagraphId(text.textRenderInfo.paragraphId)
        : null;
    expect(report).not.toBeNull();
    expect(report?.lines.length).toBeGreaterThan(1);
    expect(report?.lines.every((line) => Math.abs(line.xStart) < 1e-6)).toBe(true);
  });

  it("keeps justified non-final wrapped lines tight to the target width", async () => {
    const result = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node[align=justify, text width=360pt] at (0,0) {Lorem ipsum dolor sit amet, consectetuer adipiscing elit. Aenean commodo ligula eget dolor. Aenean massa. Cum sociis natoque penatibus et magnis dis parturient montes, nascetur ridiculus mus. Donec quam felis, ultricies nec, pellentesque eu, pretium quis, sem. Nulla consequat massa quis enim. Donec pede justo, fringilla vel, aliquet nec, vulputate eget, arcu. In enim justo, rhoncus ut, imperdiet a, venenatis vitae, justo. Nullam dictum felis eu pede mollis pretium. Integer tincidunt. Cras dapibus. Vivamus elementum semper nisi. Aenean vulputate eleifend tellus. Aenean leo ligula, porttitor eu, consequat vitae, eleifend ac, enim. Aliquam lorem ante, dapibus in, viverra quis, feugiat a, tellus. Phasellus viverra nulla ut metus varius laoreet. Quisque rutrum. Aenean imperdiet. Etiam ultricies nisi vel augue. Curabitur ullamcorper ultricies nisi. Nam eget dui. Etiam rhoncus. Maecenas tempus, tellus eget condimentum rhoncus, sem quam semper libero, sit amet adipiscing sem neque sed ipsum. Nam quam nunc, blandit vel, luctus pulvinar, hendrerit id, lorem. Maecenas nec odio et ante tincidunt tempus. Donec vitae sapien ut libero venenatis faucibus. Nullam quis ante.};
\end{tikzpicture}`);

    const text = result.semantic.scene.elements.find((element): element is SceneText => element.kind === "Text");
    expect(text?.kind).toBe("Text");
    if (text?.kind === "Text" && text.textRenderInfo?.mode === "mathjax") {
      const report = reportForParagraphId(text.textRenderInfo.paragraphId);
      expect(report).not.toBeNull();
      expect(report?.alignment).toBe("justified");
      expect(report?.linebreakingMode).toBe("feasible");
      expect(report?.errors.some((error) => error.includes("greedy-wrap")) ?? false).toBe(false);
      const nonLastLines = report?.lines.slice(0, -1) ?? [];
      expect(nonLastLines.length).toBeGreaterThan(0);
      for (const line of nonLastLines) {
        expect(Math.abs(line.targetWidth - line.xEnd)).toBeLessThan(0.08);
      }
    }
  }, 30000);

  it("centers explicit line breaks inside text width when align=center", async () => {
    const result = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node[draw,text width=10cm,align=center] (A) at (-1, -1) {This is the first line \\ and this is the second line which is much longer};
\end{tikzpicture}`);

    const text = result.semantic.scene.elements.find((element): element is SceneText => element.kind === "Text");
    expect(text?.kind).toBe("Text");
    if (text?.kind === "Text") {
      expect(text.text).toBe("This is the first line\nand this is the second line which is much longer");
      const renderInfo = text.textRenderInfo;
      expect(renderInfo?.mode).toBe("mathjax");
      if (renderInfo?.mode === "mathjax") {
        expect(renderInfo.layoutKind).toBe("explicit-multiline");
        expect(renderInfo.paragraphId).toBeTruthy();
      }
    }
    expect(result.svg.svg).toContain('data-paragraph-id=');
    expect(result.svg.svg).not.toContain(String.raw`\begin{array}`);
    expect(countLineboxes(result.svg.svg)).toBe(2);
    const centeredXs = readLineboxTranslateXs(result.svg.svg);
    expect(centeredXs[0] ?? 0).toBeGreaterThan(0.5);
  });

  it("right-aligns explicit line breaks inside text width when align=right", async () => {
    const result = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node[draw,text width=10cm,align=right] (A) at (-1, -1) {This is the first line \\ and this is the second line which is much longer};
\end{tikzpicture}`);

    const text = result.semantic.scene.elements.find((element): element is SceneText => element.kind === "Text");
    expect(text?.kind).toBe("Text");
    if (text?.kind === "Text") {
      expect(text.text).toBe("This is the first line\nand this is the second line which is much longer");
      const renderInfo = text.textRenderInfo;
      expect(renderInfo?.mode).toBe("mathjax");
      if (renderInfo?.mode === "mathjax") {
        expect(renderInfo.layoutKind).toBe("explicit-multiline");
        expect(renderInfo.paragraphId).toBeTruthy();
      }
    }
    expect(result.svg.svg).toContain('data-paragraph-id=');
    expect(result.svg.svg).not.toContain(String.raw`\begin{array}`);
    expect(countLineboxes(result.svg.svg)).toBe(2);
    const rightXs = readLineboxTranslateXs(result.svg.svg);
    expect(rightXs[0] ?? 0).toBeGreaterThan(0.5);
  });

  it("keeps centered explicit multiline text-width paragraphs on the wrapped-explicit path across multiple forced breaks", async () => {
    const result = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node[draw,text width=10cm,align=center] at (0,0) {Alpha \\ Beta \\ The longest line here};
\end{tikzpicture}`);

    const text = result.semantic.scene.elements.find((element): element is SceneText => element.kind === "Text");
    let reportParagraphId: string | null = null;
    expect(text?.kind).toBe("Text");
    if (text?.kind === "Text" && text.textRenderInfo?.mode === "mathjax") {
      expect(text.text).toBe("Alpha\nBeta\nThe longest line here");
      expect(text.textRenderInfo.layoutKind).toBe("explicit-multiline");
      expect(text.textRenderInfo.paragraphId).toBeTruthy();
      reportParagraphId = text.textRenderInfo.paragraphId;
    }
    const report = reportForParagraphId(reportParagraphId);
    expect(result.svg.svg).toContain('data-paragraph-id=');
    expect(result.svg.svg).not.toContain(String.raw`\begin{array}`);
    expect(countLineboxes(result.svg.svg)).toBe(3);
    expect(report?.layoutMode).toBe("wrapped-explicit");
    expect(report?.lines).toHaveLength(3);
    expect(report?.errors.some((entry) => entry === "pass=single-line")).toBe(false);
    expect(result.svg.svg).toContain('preserveAspectRatio="xMidYMid meet"');
  });

  it("keeps right-aligned explicit multiline text-width paragraphs on the wrapped-explicit path across multiple forced breaks", async () => {
    const result = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node[draw,text width=10cm,align=right] at (0,0) {Alpha \\ Beta \\ The longest line here};
\end{tikzpicture}`);

    const text = result.semantic.scene.elements.find((element): element is SceneText => element.kind === "Text");
    let reportParagraphId: string | null = null;
    expect(text?.kind).toBe("Text");
    if (text?.kind === "Text" && text.textRenderInfo?.mode === "mathjax") {
      expect(text.text).toBe("Alpha\nBeta\nThe longest line here");
      expect(text.textRenderInfo.layoutKind).toBe("explicit-multiline");
      expect(text.textRenderInfo.paragraphId).toBeTruthy();
      reportParagraphId = text.textRenderInfo.paragraphId;
    }
    const report = reportForParagraphId(reportParagraphId);
    expect(result.svg.svg).toContain('data-paragraph-id=');
    expect(result.svg.svg).not.toContain(String.raw`\begin{array}`);
    expect(countLineboxes(result.svg.svg)).toBe(3);
    expect(report?.layoutMode).toBe("wrapped-explicit");
    expect(report?.lines).toHaveLength(3);
    expect(report?.errors.some((entry) => entry === "pass=single-line")).toBe(false);
    expect(result.svg.svg).toContain('preserveAspectRatio="xMaxYMid meet"');
  });

  it("preserves \\\\[<len>] for centered text-width paragraphs with multiple explicit breaks", async () => {
    const result = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node[draw,text width=10cm,align=center] at (0,0) {Alpha \\[10pt] Beta \\ The longest line here};
\end{tikzpicture}`);

    const text = result.semantic.scene.elements.find((element): element is SceneText => element.kind === "Text");
    const report =
      text?.kind === "Text" && text.textRenderInfo?.mode === "mathjax"
        ? reportForParagraphId(text.textRenderInfo.paragraphId)
        : null;
    expect(countLineboxes(result.svg.svg)).toBe(3);
    expect(result.svg.svg).toContain('data-lineleading="10pt"');
    expect(result.svg.svg).not.toContain('data-c="5B"');
    expect(result.svg.svg).not.toContain('data-c="5D"');
    expect(report?.layoutMode).toBe("wrapped-explicit");
    expect(report?.lines).toHaveLength(3);
    expect(report?.lines[0]?.break?.lineLeading).toBe("10pt");
  });

  it("preserves \\\\[<len>] for right-aligned text-width paragraphs with multiple explicit breaks", async () => {
    const result = await renderTikzToSvgAsync(String.raw`\begin{tikzpicture}
  \node[draw,text width=10cm,align=right] at (0,0) {Alpha \\[10pt] Beta \\ The longest line here};
\end{tikzpicture}`);

    const text = result.semantic.scene.elements.find((element): element is SceneText => element.kind === "Text");
    const report =
      text?.kind === "Text" && text.textRenderInfo?.mode === "mathjax"
        ? reportForParagraphId(text.textRenderInfo.paragraphId)
        : null;
    expect(countLineboxes(result.svg.svg)).toBe(3);
    expect(result.svg.svg).toContain('data-lineleading="10pt"');
    expect(result.svg.svg).not.toContain('data-c="5B"');
    expect(result.svg.svg).not.toContain('data-c="5D"');
    expect(report?.layoutMode).toBe("wrapped-explicit");
    expect(report?.lines).toHaveLength(3);
    expect(report?.lines[0]?.break?.lineLeading).toBe("10pt");
  });

  it("preserves node font italic styling through MathJax wrappers in async mode", async () => {
    const source = String.raw`\begin{tikzpicture}
  \draw[node font=\itshape] (0,0) -- +(1,0) node[above] {italic};
\end{tikzpicture}`;
    const result = await renderTikzToSvgAsync(source);

    expect(result.svg.svg).toContain('data-text-renderer="mathjax"');
    expect(result.svg.svg).toContain('data-tex-font="lmroman10-italic"');
  });

  it("wraps MathJax text with family and weight commands from font options", async () => {
    const source = String.raw`\begin{tikzpicture}
  \node[font=\sffamily\bfseries] at (0,0) {Hello};
\end{tikzpicture}`;
    const result = await renderTikzToSvgAsync(source);

    expect(result.svg.svg).toContain('data-text-renderer="mathjax"');
    expect(result.svg.svg).toContain('data-tex-font="lmsans10-bold"');
    expect(result.parse.diagnostics.some((diagnostic) => diagnostic.code === "invalid-node-tex")).toBe(false);
  });

  it("normalizes legacy family switches inside node text for MathJax validation", async () => {
    const source = String.raw`\begin{tikzpicture}
  \node[draw] at (0,0) {{\sffamily\Large node n}};
  \node[draw] at (1,0) {\phantom{\sffamily\Large node n}};
\end{tikzpicture}`;
    const result = await renderTikzToSvgAsync(source);

    expect(result.svg.svg).toContain('data-text-renderer="mathjax"');
    expect(result.parse.diagnostics.some((diagnostic) => diagnostic.code === "invalid-node-tex")).toBe(false);
    expect(result.svg.svg).not.toContain(String.raw`\sffamily`);
  });

  it("resolves colorlet aliases before MathJax text rendering", async () => {
    const source = String.raw`\begin{tikzpicture}
  \colorlet{mycolor}{blue}
  \node at (0,0) {\textcolor{mycolor}{this}};
\end{tikzpicture}`;
    const result = await renderTikzToSvgAsync(source);

    expect(result.parse.diagnostics.some((diagnostic) => diagnostic.code === "invalid-node-tex")).toBe(false);
    const label = result.semantic.scene.elements.find((element) => element.kind === "Text");
    expect(label?.kind).toBe("Text");
    if (label?.kind === "Text") {
      expect(label.text).toContain(String.raw`\textcolor{blue}{this}`);
    }
  });

  it("skips node TeX validation when pgfmath parsing commands define runtime macros", async () => {
    const source = String.raw`\begin{tikzpicture}
  \pgfmathparse{2+3};
  \node at (0,0) {\pgfmathresult};
\end{tikzpicture}`;

    const result = await renderTikzToSvgAsync(source);
    expect(result.parse.diagnostics.some((diagnostic) => diagnostic.code === "invalid-node-tex")).toBe(false);
  });

  it("resolves definecolor aliases for fill key values before SVG emission", () => {
    const source = String.raw`\begin{tikzpicture}
  \definecolor{mypink}{rgb}{0.858, 0.188, 0.478}
  \draw[fill=mypink] (-3,-3) rectangle (3,3);
\end{tikzpicture}`;
    const result = renderTikzToSvg(source);

    expect(result.semantic.scene.elements.some((element) => element.kind === "Path" && element.style.fill === "#db307a")).toBe(true);
    expect(result.svg.svg).toContain('fill="#db307a"');
    expect(result.svg.svg).not.toContain('fill="mypink"');
  });

  it("resolves definecolor aliases inside xcolor mixtures for fill key values", () => {
    const source = String.raw`\begin{tikzpicture}
  \definecolor{mypink}{rgb}{0.858, 0.188, 0.478}
  \draw[fill=mypink!20] (-3,-3) rectangle (3,3);
\end{tikzpicture}`;
    const result = renderTikzToSvg(source);

    expect(result.semantic.scene.elements.some((element) => element.kind === "Path" && element.style.fill === "#f8d6e4")).toBe(true);
    expect(result.svg.svg).toContain('fill="#f8d6e4"');
    expect(result.svg.svg).not.toContain('fill="mypink!20"');
  });

  it("resolves definecolor HTML aliases before MathJax text rendering", async () => {
    const source = String.raw`\begin{tikzpicture}
  \definecolor{brand}{HTML}{1A2B3C}
  \node at (0,0) {\textcolor{brand}{this}};
\end{tikzpicture}`;
    const result = await renderTikzToSvgAsync(source);

    expect(result.parse.diagnostics.some((diagnostic) => diagnostic.code === "invalid-node-tex")).toBe(false);
    const label = result.semantic.scene.elements.find((element) => element.kind === "Text");
    expect(label?.kind).toBe("Text");
    if (label?.kind === "Text") {
      expect(label.text).toContain(String.raw`\textcolor{#1a2b3c}{this}`);
    }
  });

  it("resolves definecolor rgb aliases before MathJax text rendering", async () => {
    const source = String.raw`\begin{tikzpicture}
  \definecolor{brand}{rgb}{0.1,0.2,0.3}
  \node at (0,0) {\textcolor{brand}{this}};
\end{tikzpicture}`;
    const result = await renderTikzToSvgAsync(source);

    expect(result.parse.diagnostics.some((diagnostic) => diagnostic.code === "invalid-node-tex")).toBe(false);
    const label = result.semantic.scene.elements.find((element) => element.kind === "Text");
    expect(label?.kind).toBe("Text");
    if (label?.kind === "Text") {
      expect(label.text).toContain(String.raw`\textcolor{#1a334d}{this}`);
    }
  });

  it("renders foreach \\textsf labels through MathJax in async mode", async () => {
    const source = String.raw`\begin{tikzpicture}
  \foreach \label in {1,2,3}
    \node at (\label,0) {\textsf{\label}};
\end{tikzpicture}`;
    const result = await renderTikzToSvgAsync(source);

    expect(result.svg.svg).toContain('data-text-renderer="mathjax"');
    expect(result.svg.svg.includes('xml:space="preserve">\\textsf{')).toBe(false);
    expect(result.parse.diagnostics.some((diagnostic) => diagnostic.code === "invalid-node-tex")).toBe(false);
  });

  it("expands user-defined text macros before MathJax rendering in async mode", async () => {
    const source = String.raw`\begin{tikzpicture}
  \def\labelmacro{\textsf{A}}
  \node at (0,0) {$\labelmacro$};
\end{tikzpicture}`;
    const result = await renderTikzToSvgAsync(source);

    expect(result.parse.diagnostics.some((diagnostic) => diagnostic.code === "invalid-node-tex")).toBe(false);
    expect(result.svg.svg).toContain('data-text-renderer="mathjax"');
    const label = result.semantic.scene.elements.find((element) => element.kind === "Text");
    expect(label?.kind).toBe("Text");
    if (label?.kind === "Text") {
      expect(label.text).toBe(String.raw`$\textsf{A}$`);
    }
  });

  it("expands fixed-arity newcommand macros before MathJax rendering in async mode", async () => {
    const source = String.raw`\begin{tikzpicture}
  \newcommand{\vect}[1]{\mathbf{#1}}
  \node at (0,0) {$\vect{x}$};
\end{tikzpicture}`;
    const result = await renderTikzToSvgAsync(source);

    expect(result.parse.diagnostics.some((diagnostic) => diagnostic.code === "invalid-node-tex")).toBe(false);
    expect(result.svg.svg).toContain('data-text-renderer="mathjax"');
    const label = result.semantic.scene.elements.find((element) => element.kind === "Text");
    expect(label?.kind).toBe("Text");
    if (label?.kind === "Text") {
      expect(label.text).toBe(String.raw`$\mathbf{x}$`);
    }
  });

  it("expands DeclareMathOperator macros before MathJax rendering in async mode", async () => {
    const source = String.raw`\DeclareMathOperator{\cone}{cone}
\DeclareMathOperator*{\argmax}{argmax}
\begin{tikzpicture}
  \node at (0.11,3) {$\cone(M)$};
  \node at (0,0) {$\argmax_{x \in X} f(x)$};
\end{tikzpicture}`;
    const result = await renderTikzToSvgAsync(source);

    expect(result.parse.diagnostics.some((diagnostic) => diagnostic.code === "invalid-node-tex")).toBe(false);
    expect(result.svg.svg).toContain('data-text-renderer="mathjax"');
    const labels = result.semantic.scene.elements
      .filter((element) => element.kind === "Text")
      .map((element) => (element.kind === "Text" ? element.text : ""));
    expect(labels).toContain(String.raw`$\operatorname{cone}(M)$`);
    expect(labels).toContain(String.raw`$\operatorname*{argmax}_{x \in X} f(x)$`);
  });

  it("expands providecommand and DeclareRobustCommand macros before MathJax rendering in async mode", async () => {
    const source = String.raw`\newcommand{\kept}{A}
\providecommand{\kept}{B}
\providecommand{\fresh}[1]{\mathcal{#1}}
\DeclareRobustCommand{\vect}[1]{\mathbf{#1}}
\begin{tikzpicture}
  \node at (0,0) {$\kept+\fresh{F}+\vect{x}$};
\end{tikzpicture}`;
    const result = await renderTikzToSvgAsync(source);

    expect(result.parse.diagnostics.some((diagnostic) => diagnostic.code === "invalid-node-tex")).toBe(false);
    expect(result.svg.svg).toContain('data-text-renderer="mathjax"');
    const label = result.semantic.scene.elements.find((element) => element.kind === "Text");
    expect(label?.kind).toBe("Text");
    if (label?.kind === "Text") {
      expect(label.text).toBe(String.raw`$A+\mathcal{F}+\mathbf{x}$`);
    }
  });

  it("expands newcommand optional/default arguments before MathJax rendering in async mode", async () => {
    const source = String.raw`\begin{tikzpicture}
  \newcommand{\pair}[2][\alpha]{#1+#2}
  \node at (0,0) {$\pair{x}$};
  \node at (1,0) {$\pair[\beta]{x}$};
\end{tikzpicture}`;
    const result = await renderTikzToSvgAsync(source);

    expect(result.parse.diagnostics.some((diagnostic) => diagnostic.code === "invalid-node-tex")).toBe(false);
    expect(result.svg.svg).toContain('data-text-renderer="mathjax"');
    const labels = result.semantic.scene.elements
      .filter((element) => element.kind === "Text")
      .map((element) => (element.kind === "Text" ? element.text : ""));
    expect(labels).toContain(String.raw`$\alpha+x$`);
    expect(labels).toContain(String.raw`$\beta+x$`);
  });

  it("keeps math control sequence boundaries after foreach substitution in async mode", async () => {
    const source = String.raw`\begin{tikzpicture}
  \foreach \x in {a}
    \foreach \y in {b}
      \node at (0,0) {$\mathstrut\x\y$};
\end{tikzpicture}`;
    const result = await renderTikzToSvgAsync(source);

    expect(result.svg.svg).toContain('data-text-renderer="mathjax"');
    expect(result.svg.svg.includes('xml:space="preserve">$\\mathstrut')).toBe(false);
    const label = result.semantic.scene.elements.find((element) => element.kind === "Text");
    expect(label?.kind).toBe("Text");
    if (label?.kind === "Text") {
      expect(label.text).toBe(String.raw`$\mathstrut{}ab$`);
    }
  });
});
