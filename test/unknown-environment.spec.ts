import { describe, expect, it } from "vitest";

import { ENVIRONMENTS_WITH_RULES } from "../packages/lezer-tikz/src/grammar/environment-tokens.js";
import { applyEditAction } from "../packages/core/src/edit/actions.js";
import type { Statement, UnknownStatement } from "../packages/core/src/ast/types.js";
import { createIncrementalParseSession, parseTikz } from "../packages/core/src/parser/index.js";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate.js";
import { wp } from "./coords-helpers.js";

const picture = (body: string): string => `\\begin{tikzpicture}\n${body}\n\\end{tikzpicture}`;

function environmentStatement(statement: Statement | undefined): UnknownStatement {
  if (statement?.kind !== "UnknownStatement" || !statement.environment) {
    throw new Error(`Expected an unknown environment statement, got ${statement?.kind ?? "nothing"}`);
  }
  return statement;
}

function errors(source: string, parsed = parseTikz(source)) {
  return parsed.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
}

describe("generic environment fallback", () => {
  // An environment with no rule (pgfplots axes have one now).
  const AXIS = String.raw`  \begin{plotbox}[xmin=0, xmax=1]
    \addplot coordinates {(0,0) (1,1)};
    \addlegendentry{data}
  \end{plotbox}`;

  it("skips an unknown environment as one statement and keeps the statement after it", () => {
    const source = picture(`${AXIS}\n  \\draw (0,0) -- (1,1);`);
    const parsed = parseTikz(source);

    expect(parsed.figure.body.map((statement) => statement.kind)).toEqual(["UnknownStatement", "Path"]);
    const environment = environmentStatement(parsed.figure.body[0]);
    expect(environment.raw).toBe(AXIS.trim());
    expect(environment.environment).toEqual({
      name: "plotbox",
      beginSpan: { from: source.indexOf("\\begin{plotbox}"), to: source.indexOf("\\begin{plotbox}") + "\\begin{plotbox}".length },
      bodySpan: { from: source.indexOf("\\begin{plotbox}") + "\\begin{plotbox}".length, to: source.indexOf("\\end{plotbox}") },
      endSpan: { from: source.indexOf("\\end{plotbox}"), to: source.indexOf("\\end{plotbox}") + "\\end{plotbox}".length },
      terminated: true
    });
    expect(errors(source, parsed)).toEqual([]);

    const semantic = evaluateTikzFigure(parsed.figure, source);
    expect(semantic.scene.elements).toHaveLength(1);
    expect(semantic.diagnostics.filter((diagnostic) => diagnostic.code === "unsupported-statement")).toEqual([]);
    const unsupported = semantic.diagnostics.filter((diagnostic) => diagnostic.code === "unsupported-environment");
    expect(unsupported).toHaveLength(1);
    expect(unsupported[0]?.severity).toBe("warning");
    expect(unsupported[0]?.message).toContain("`plotbox`");
    expect(unsupported[0]?.span).toEqual(environment.environment?.beginSpan);
  });

  it("renders the statements around an unknown environment", () => {
    const source = picture(`  \\draw (0,0) -- (1,0);\n${AXIS}\n  \\draw (0,1) -- (1,1);`);
    const rendered = renderTikzToSvg(source);
    expect(rendered.semantic.scene.elements).toHaveLength(2);
    expect(rendered.svg.svg.match(/<path\b/gu)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("reads semicolons, nested environments, comments and escapes inside the body", () => {
    const body = String.raw`  \begin{foo}[a=b;c]
    \draw (0,0) -- (1,1);
    \begin{bar}{x} \node {;}; \end{bar}
    \begin{foo} inner \begin{foo} deeper \end{foo} \end{foo}
    % a comment that mentions \end{foo} is not the end
    100\% \\ \{ text
  \end{foo}`;
    const source = picture(`${body}\n  \\draw (2,2) -- (3,3);`);
    const parsed = parseTikz(source);

    expect(parsed.figure.body.map((statement) => statement.kind)).toEqual(["UnknownStatement", "Path"]);
    const environment = environmentStatement(parsed.figure.body[0]);
    expect(environment.raw).toBe(body.trim());
    expect(environment.environment?.name).toBe("foo");
    expect(environment.environment?.terminated).toBe(true);
    expect(errors(source, parsed)).toEqual([]);
    expect(evaluateTikzFigure(parsed.figure, source).scene.elements).toHaveLength(1);
  });

  it("accepts space before the name and names with stars, digits and punctuation", () => {
    for (const name of ["myenv", "foo*", "my-env2", "a:b.c"]) {
      const source = picture(`  \\begin {${name}}{background} \\fill (0,0) circle (1); \\end {${name}}\n  \\draw (0,0) -- (1,1);`);
      const parsed = parseTikz(source);
      expect(parsed.figure.body.map((statement) => statement.kind)).toEqual(["UnknownStatement", "Path"]);
      expect(environmentStatement(parsed.figure.body[0]).environment?.name).toBe(name);
      expect(environmentStatement(parsed.figure.body[0]).environment?.terminated).toBe(true);
    }
  });

  it("closes an environment whose inner environment is left open", () => {
    const source = picture(String.raw`  \begin{outer} \begin{inner} ; \end{outer}
  \draw (0,0) -- (1,1);`);
    const parsed = parseTikz(source);
    expect(parsed.figure.body.map((statement) => statement.kind)).toEqual(["UnknownStatement", "Path"]);
    expect(environmentStatement(parsed.figure.body[0]).environment?.terminated).toBe(true);
  });

  it("runs an unterminated environment to the end of the picture and diagnoses it", () => {
    const source = picture(String.raw`  \draw (0,0) -- (1,0);
  \begin{plotbox}
    \addplot coordinates {(0,0)};
    \draw (0,1) -- (1,1);`);
    const parsed = parseTikz(source);

    expect(parsed.figure.body.map((statement) => statement.kind)).toEqual(["Path", "UnknownStatement"]);
    const environment = environmentStatement(parsed.figure.body[1]);
    expect(environment.raw.startsWith("\\begin{plotbox}")).toBe(true);
    expect(environment.raw.endsWith("\\draw (0,1) -- (1,1);")).toBe(true);
    expect(environment.environment?.terminated).toBe(false);
    expect(environment.environment?.endSpan).toBeUndefined();
    expect(environment.environment?.bodySpan.to).toBe(environment.span.to);

    const unterminated = parsed.diagnostics.filter((diagnostic) => diagnostic.code === "unterminated-environment");
    expect(unterminated).toHaveLength(1);
    expect(unterminated[0]?.severity).toBe("error");
    expect(unterminated[0]?.message).toContain("\\end{plotbox}");
    expect(unterminated[0]?.span).toEqual(environment.environment?.beginSpan);
    // The picture itself still closes: nothing else is reported.
    expect(errors(source, parsed).map((diagnostic) => diagnostic.code)).toEqual(["unterminated-environment"]);
    expect(evaluateTikzFigure(parsed.figure, source).scene.elements).toHaveLength(1);
  });

  it("stops an unterminated environment at the end of the scope around it", () => {
    const source = picture(String.raw`  \begin{scope}[xshift=1cm]
    \begin{foo}
    \draw (0,0) -- (1,0);
  \end{scope}
  \draw (0,1) -- (1,1);`);
    const parsed = parseTikz(source);
    expect(parsed.figure.body.map((statement) => statement.kind)).toEqual(["Scope", "Path"]);
    const scope = parsed.figure.body[0];
    if (scope?.kind !== "Scope") throw new Error("Expected a scope");
    expect(scope.body.map((statement) => statement.kind)).toEqual(["UnknownStatement"]);
    expect(environmentStatement(scope.body[0]).environment?.terminated).toBe(false);
    expect(errors(source, parsed).map((diagnostic) => diagnostic.code)).toEqual(["unterminated-environment"]);
  });

  it("does not crash on an environment left open at the end of input", () => {
    for (const source of ["\\begin{tikzpicture}\n\\begin{plotbox}", "\\begin{tikzpicture}\n\\begin{plotbox}\\", "\\begin{tikzpicture}\\begin{plotbox}%", "\\begin{tikzpicture}\\begin{axis"]) {
      expect(() => evaluateTikzFigure(parseTikz(source).figure, source)).not.toThrow();
    }
  });

  it("works inside scopes, overlay bodies and right after the picture options", () => {
    const source = picture(String.raw`  \begin{scope}
    \begin{foo} ; \end{foo}
    \draw (0,0) -- (1,0);
  \end{scope}
  \only<2>{\begin{foo} ; \end{foo} \draw (0,1) -- (1,1);}`);
    const parsed = parseTikz(source);
    expect(errors(source, parsed)).toEqual([]);
    expect(parsed.figure.body.map((statement) => statement.kind)).toEqual(["Scope", "OverlayGroup", "UnknownStatement", "Path"]);

    const first = "\\begin{tikzpicture}\\begin{foo};\\end{foo}\\draw (0,0) -- (1,0);\\end{tikzpicture}";
    expect(parseTikz(first).figure.body.map((statement) => statement.kind)).toEqual(["UnknownStatement", "Path"]);
    const withOptions = "\\begin{tikzpicture}[scale=2]\\begin{foo};\\end{foo}\\draw (0,0) -- (1,0);\\end{tikzpicture}";
    expect(parseTikz(withOptions).figure.body.map((statement) => statement.kind)).toEqual(["UnknownStatement", "Path"]);
  });

  it("skips an environment in a foreach body and draws the loop's paths", () => {
    const source = picture(String.raw`  \foreach \i in {1,2} { \begin{foo} \i; \end{foo} \draw (\i,0) -- (\i,1); }`);
    const parsed = parseTikz(source);
    expect(errors(source, parsed)).toEqual([]);
    expect(evaluateTikzFigure(parsed.figure, source).scene.elements).toHaveLength(2);
  });

  it("leaves environments with their own rules, and environments outside pictures, alone", () => {
    expect([...ENVIRONMENTS_WITH_RULES]).toEqual(expect.arrayContaining(["scope", "tikzpicture"]));
    const scoped = picture("  \\begin{scope}[red] \\draw (0,0) -- (1,0); \\end{scope}");
    expect(parseTikz(scoped).figure.body.map((statement) => statement.kind)).toEqual(["Scope"]);

    // Around the picture an environment is document structure, not a statement.
    const document = String.raw`\documentclass{article}
\usepackage{tikz}
\begin{document}
\tikzset{mine/.style={red}}
\begin{figure}
\begin{center}
\begin{tikzpicture}
  \draw[mine] (0,0) -- (1,1);
\end{tikzpicture}
\end{center}
\end{figure}
\end{document}`;
    const parsed = parseTikz(document, { includeContextDefinitions: true });
    expect(parsed.figure.body.map((statement) => statement.kind)).toEqual(["TikzSet", "Path"]);
    expect(errors(document, parsed)).toEqual([]);
  });
});

describe("generic environment fallback: incremental parsing", () => {
  const BASE = picture(String.raw`  \begin{plotbox}[xmin=0]
    \addplot coordinates {(0,0) (1,1)};
  \end{plotbox}
  \draw (0,0) -- (1,1);
  \foo bar;
  \node at (2,0) {A};`);

  const edits: Array<{ name: string; next: string; strategy?: "incremental" | "full" }> = [
    { name: "a coordinate after the environment", next: BASE.replace("(1,1);\n  \\foo", "(2,3);\n  \\foo"), strategy: "incremental" },
    { name: "the environment's body", next: BASE.replace("(0,0) (1,1)}", "(0,0) (2,2)}"), strategy: "incremental" },
    { name: "the environment's options", next: BASE.replace("xmin=0", "xmin=-1") },
    { name: "the environment's end, deleted", next: BASE.replace("  \\end{plotbox}\n", "") },
    { name: "the environment's name in its end", next: BASE.replace("\\end{plotbox}", "\\end{plotboxes}") },
    { name: "a nested end typed into the body", next: BASE.replace("\\addplot", "\\end{plotbox} \\addplot") },
    { name: "an unknown command made an environment", next: BASE.replace("\\foo bar;", "\\begin{foo} bar;") },
    { name: "an environment typed into a path", next: BASE.replace("\\draw (0,0) -- (1,1);", "\\begin{x}\\draw (0,0) -- (1,1);") }
  ];

  for (const edit of edits) {
    it(`matches a full parse after editing ${edit.name}`, () => {
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

describe("generic environment fallback: source-preserving edits", () => {
  const ENV = String.raw`\begin{plotbox}[xmin=0]
    \addplot coordinates {(0,0) (1,1)};
    \draw (5,5) -- (6,6); % \end{plotbox} in a comment
  \end{plotbox}`;
  const SOURCE = picture(`  \\draw (0,0) -- (1,0);\n  ${ENV}\n  \\draw (0,1) -- (1,1);\n  \\draw (0,2) -- (1,2);`);

  function succeed(result: ReturnType<typeof applyEditAction>): string {
    if (result.kind !== "success") throw new Error(`Expected success, got ${JSON.stringify(result)}`);
    return result.newSource;
  }

  it("numbers the statements after the environment", () => {
    expect(parseTikz(SOURCE).figure.body.map((statement) => statement.id)).toEqual(["path:0", "unknown-statement:1", "path:2", "path:3"]);
  });

  it("deletes a statement after the environment without touching it", () => {
    const next = succeed(applyEditAction(SOURCE, [], { kind: "deleteElement", elementId: "path:2" }));
    expect(next).toContain(ENV);
    expect(next).not.toContain("(0,1) -- (1,1)");
    expect(parseTikz(next).figure.body.map((statement) => statement.kind)).toEqual(["Path", "UnknownStatement", "Path"]);
  });

  it("deletes the statement before the environment without touching it", () => {
    const next = succeed(applyEditAction(SOURCE, [], { kind: "deleteElement", elementId: "path:0" }));
    expect(next).toContain(ENV);
    expect(next).not.toContain("(0,0) -- (1,0)");
  });

  it("reorders a statement past the environment without corrupting it", () => {
    let successes = 0;
    for (const direction of ["sendToBack", "sendBackward", "bringForward", "bringToFront"] as const) {
      for (const elementId of ["path:0", "path:2", "path:3"]) {
        const result = applyEditAction(SOURCE, [], { kind: "reorderElements", elementIds: [elementId], direction });
        if (result.kind !== "success") continue;
        successes += 1;
        expect(result.newSource).toContain(ENV);
        const kinds = parseTikz(result.newSource).figure.body.map((statement) => statement.kind);
        expect(kinds.filter((kind) => kind === "UnknownStatement")).toHaveLength(1);
        expect(kinds.filter((kind) => kind === "Path")).toHaveLength(3);
      }
    }
    expect(successes).toBeGreaterThanOrEqual(6);
  });

  it("moves a statement after the environment without touching it", () => {
    const next = succeed(applyEditAction(SOURCE, renderTikzToSvg(SOURCE).semantic.editHandles, { kind: "moveElements", elementIds: ["path:2"], delta: wp(28.4527559055, 0) }));
    expect(next).toContain(ENV);
    expect(next).toContain("\\draw (1,1) -- (2,1);");
  });
});

describe("PGF environments have rules of their own", () => {
  it("reads a pgfonlayer environment as a container whose statements all draw, not as the fallback", () => {
    const source = "\\begin{tikzpicture}\n  \\begin{pgfonlayer}{background}\n    \\draw (0,0) -- (1,0);\n    \\draw (0,1) -- (1,1);\n  \\end{pgfonlayer}\n  \\draw (0,2) -- (1,2);\n\\end{tikzpicture}\n";
    const parsed = parseTikz(source);
    expect(parsed.figure.body.some((statement) => statement.kind === "UnknownStatement")).toBe(false);
    expect(parsed.figure.body.map((statement) => statement.kind)).toEqual(["Scope", "Path"]);
    const layer = parsed.figure.body[0];
    expect(layer?.kind === "Scope" ? layer.body.map((statement) => statement.kind) : []).toEqual(["Path", "Path"]);
    expect(evaluateTikzFigure(parsed.figure, source).scene.elements).toHaveLength(3);
  });

  it("names every PGF environment among the environments with rules", () => {
    expect([...ENVIRONMENTS_WITH_RULES]).toEqual(expect.arrayContaining([
      "pgfonlayer", "pgfscope", "pgfviewboxscope", "pgfinterruptboundingbox", "pgflowlevelscope", "pgftransparencygroup"
    ]));
    for (const name of ["pgfscope", "pgfinterruptboundingbox", "pgftransparencygroup"]) {
      const source = picture(`  \\begin{${name}}\n    \\draw (0,0) -- (1,0);\n  \\end{${name}}\n  \\draw (0,1) -- (1,1);`);
      const parsed = parseTikz(source);
      expect(parsed.figure.body.map((statement) => statement.kind)).toEqual(["Scope", "Path"]);
      expect(evaluateTikzFigure(parsed.figure, source).scene.elements).toHaveLength(2);
    }
  });
});
