import { describe, expect, it } from "vitest";
import { parseTikz } from "../../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../../packages/core/src/semantic/evaluate.js";
import { createIncrementalSemanticSession } from "../../packages/core/src/semantic/incremental.js";
import { worldTransform } from "../../packages/core/src/coords/transforms.js";
import type { EvaluateOptions } from "../../packages/core/src/semantic/types.js";
import type { NodeTextEngine } from "../../packages/core/src/text/types.js";
import type { DocumentGraphicsResolver } from "../../packages/core/src/graphics/types.js";

const picture = (options = "red") => `\\begin{tikzpicture}[${options}]\n` +
  Array.from({ length: 24 }, (_, index) => `\\draw (${index},0) -- (${index},1);`).join("\n") +
  "\n\\node at (0,2) {Label};\n\\end{tikzpicture}";

describe("semantic session initial state", () => {
  it.each([
    ["inherited picture options", { pictureOptions: "blue" }],
    ["surrounding font", { initialFont: "\\Huge" }],
    ["current page", { currentPage: { minX: 0, minY: 0, maxX: 100, maxY: 100 } }],
    ["placement transform", { initialTransform: worldTransform(1, 0, 0, 1, 20, 30) }]
  ] satisfies Array<[string, EvaluateOptions]>)("adopts changed %s before reusing checkpoints", (_, options) => {
    const source = picture("");
    const figure = parseTikz(source).figure;
    const session = createIncrementalSemanticSession();
    session.evaluate({ figure, source });
    const current = session.evaluate({ figure, source, options, hints: { changedSourceIds: ["path:16"] } });
    const full = evaluateTikzFigure(figure, source, options);
    const visible = (result: typeof full) => result.scene.elements.map(element => ({
      kind: element.kind, stroke: element.style.stroke, fontSize: element.style.fontSize, transform: element.transform
    }));
    expect(visible(current.semantic)).toEqual(visible(full));
    expect(current.semantic).toEqual(full);
  });

  it("adopts picture-wide option changes coalesced with a later path edit", () => {
    const source = picture();
    const session = createIncrementalSemanticSession();
    session.evaluate({ source, figure: parseTikz(source).figure });
    const next = picture("blue").replace("(16,1)", "(16,2)");
    const figure = parseTikz(next).figure;
    const current = session.evaluate({ source: next, figure, hints: { changedSourceIds: ["path:16"] } });
    expect(current.semantic).toEqual(evaluateTikzFigure(figure, next));
  });

  it("keeps previously published results and forked checkpoints independent", () => {
    const source = picture();
    const session = createIncrementalSemanticSession();
    const initial = session.evaluate({ source, figure: parseTikz(source).figure, options: { sourceFingerprint: "initial" } });
    const held = structuredClone(initial.semantic);
    const fork = session.fork();
    const next = source.replace("(16,1)", "(16,2)");
    const figure = parseTikz(next).figure;
    const branch = fork.evaluate({ source: next, figure, options: { sourceFingerprint: "branch" }, hints: { changedSourceIds: ["path:16"] } });
    expect(branch.semantic).toEqual(evaluateTikzFigure(figure, next, { sourceFingerprint: "branch" }));
    expect(initial.semantic).toEqual(held);
    expect(session.evaluate({ source, figure: parseTikz(source).figure, options: { sourceFingerprint: "initial" }, hints: { changedSourceIds: ["path:16"] } }).semantic).toEqual(held);
  });

  it("restarts from clean state when rebasing an unchanged picture fails", () => {
    const textEngine: NodeTextEngine = {
      validate: () => null,
      measure: () => ({ cacheKey: "text", width: 10, height: 10, baselineY: 8, midLineY: 5, paragraphId: "text", renderSourceText: "Label" }),
      renderFromCache: () => null
    };
    const source = String.raw`% original

\begin{tikzpicture}
\node at (0,0) {Label};
\tikzset{every node/.style={red}}
\node at (1,0) {Label};
\end{tikzpicture}`;
    const options = { textEngine };
    const session = createIncrementalSemanticSession(options);
    session.evaluate({ source, figure: parseTikz(source).figure });
    const next = source.replace("% original", "% a longer prefix");
    const figure = parseTikz(next).figure;
    const current = session.evaluate({ source: next, figure });
    const full = evaluateTikzFigure(figure, next, options);
    expect(current.semantic.scene.elements.map(element => element.style.textColor)).toEqual(full.scene.elements.map(element => element.style.textColor));
    expect(current.semantic).toEqual(full);
  });

  it.each([
    [String.raw`\tikzset{mark/.style={red}}`, "[mark]"],
    [String.raw`\tikzset{every path/.style={red}}`, ""]
  ])("rebases checkpoint definition metadata before later edits (%s)", (definition, pathOptions) => {
    const source = String.raw`% original

` + definition + "\n" + picture("").replaceAll("\\draw (", `\\draw${pathOptions} (`);
    const parse = (text: string) => parseTikz(text, { includeContextDefinitions: true }).figure;
    const session = createIncrementalSemanticSession();
    session.evaluate({ source, figure: parse(source) });
    const moved = source.replace("% original", "% moved definitions");
    const shifted = session.evaluate({ source: moved, figure: parse(moved) });
    expect(shifted.stats.strategy).toBe("incremental");
    expect(shifted.semantic).toEqual(evaluateTikzFigure(parse(moved), moved));
    const next = moved.replace("(16,1)", "(16,2)");
    const figure = parse(next);
    const edited = session.evaluate({ source: next, figure, hints: { changedSourceIds: [figure.body.find(statement => next.slice(statement.span.from, statement.span.to).includes("(16,2)"))!.id] } });
    const full = evaluateTikzFigure(figure, next);
    const definitionSpans = (result: typeof full) => result.scene.elements.flatMap(element =>
      element.styleChain?.flatMap(entry => entry.sourceRef?.sourceSpan ? [entry.sourceRef.sourceSpan] : []) ?? []);
    expect(definitionSpans(edited.semantic)).toEqual(definitionSpans(full));
    expect(edited.semantic).toEqual(full);
  });

  it("retains incremental replay for equal initial values and equal graphics content keys", () => {
    const resolver = (): DocumentGraphicsResolver => ({ cacheKey: "same resources", resolve: () => ({ status: "missing" }) });
    const source = picture();
    const session = createIncrementalSemanticSession();
    session.evaluate({ source, figure: parseTikz(source).figure, options: { sourceFingerprint: "first", graphicsResolver: resolver() } });
    const next = source.replace("(16,1)", "(16,2)");
    const figure = parseTikz(next).figure;
    const options = { sourceFingerprint: "next", graphicsResolver: resolver() };
    const current = session.evaluate({ source: next, figure, options, hints: { changedSourceIds: ["path:16"] } });
    expect(current.stats.strategy).toBe("incremental");
    expect(current.stats.reusedStatementCount).toBeGreaterThan(8);
    expect(current.semantic).toEqual(evaluateTikzFigure(figure, next, options));
  });

  it("detects changed values in a reused initial-transform object", () => {
    const source = picture();
    const figure = parseTikz(source).figure;
    const initialTransform = { ...worldTransform(1, 0, 0, 1, 0, 0) };
    const options = { initialTransform };
    const session = createIncrementalSemanticSession();
    session.evaluate({ source, figure, options });
    initialTransform.a = 2;
    const current = session.evaluate({ source, figure, options, hints: { changedSourceIds: ["path:16"] } });
    expect(current.stats).toMatchObject({ strategy: "full", fallbackReason: "initial-state-changed" });
    expect(current.semantic).toEqual(evaluateTikzFigure(figure, source, options));
  });

  it.each(["reset", "newer evaluation"])("does not publish a delayed evaluation's cache after %s", async action => {
    const source = picture();
    const session = createIncrementalSemanticSession();
    let resume!: () => void;
    const paused = new Promise<void>(resolve => { resume = resolve; });
    let first = true;
    const pending = session.evaluateAsync({ source, figure: parseTikz(source).figure }, {
      budgetMs: 0, yieldControl: () => { if (!first) return Promise.resolve(); first = false; return paused; }
    });
    const next = picture("blue");
    if (action === "reset") session.reset();
    else session.evaluate({ source: next, figure: parseTikz(next).figure });
    resume();
    await pending;
    const currentSource = action === "reset" ? source : next;
    const figure = parseTikz(currentSource).figure;
    const current = session.evaluate({ source: currentSource, figure, hints: { changedSourceIds: ["path:16"] } });
    expect(current.stats.strategy).toBe(action === "reset" ? "full" : "incremental");
    expect(current.semantic).toEqual(evaluateTikzFigure(figure, currentSource));
  });

  it.each([false, true])("invalidates consumers of a newly produced name (previous provider: %s)", existing => {
    const source = "\\begin{tikzpicture}\n" +
      (existing ? "\\coordinate (b) at (1,1);\n" : "") +
      "\\coordinate (a) at (5,5);\n" +
      Array.from({ length: 24 }, (_, index) => `\\draw (${index},0) -- (${index},1);`).join("\n") +
      "\n\\draw (b) -- (10,10);\n\\end{tikzpicture}";
    const session = createIncrementalSemanticSession();
    const originalFigure = parseTikz(source).figure;
    session.evaluate({ source, figure: originalFigure });
    const next = source.replace("(a) at (5,5)", "(b) at (5,5)");
    const figure = parseTikz(next).figure;
    const changedSourceIds = [originalFigure.body[existing ? 1 : 0].id];
    const current = session.evaluate({ source: next, figure, hints: { changedSourceIds } });
    const full = evaluateTikzFigure(figure, next);
    expect(current.semantic.diagnostics).toEqual(full.diagnostics);
    expect(current.semantic.scene.elements.at(-1)).toEqual(full.scene.elements.at(-1));
    expect(current.semantic).toEqual(full);
  });
});
