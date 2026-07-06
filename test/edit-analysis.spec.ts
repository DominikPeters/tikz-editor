import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { makeEmptySnapshot } from "../packages/app/src/compute.js";
import {
  getSharedEditAnalysisView,
  resetSharedEditAnalysisManager
} from "../packages/app/src/edit-analysis-manager.js";
import { createEditAnalysisSession } from "../packages/core/src/edit/analysis.js";
import { getInspectorDescriptor } from "../packages/core/src/edit/inspector.js";
import { resolvePropertyTarget } from "../packages/core/src/edit/property-target.js";
import { parseStatementSnapshot } from "../packages/core/src/edit/statement-ops.js";
import { parseTikz } from "../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate.js";
import { buildStylesCascadeModel } from "../packages/core/src/edit/styles-cascade.js";
import * as parserModule from "../packages/core/src/parser/index.js";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";

const SOURCE = String.raw`\begin{tikzpicture}
  \node[draw, fill=blue!20] (A) at (0,0) {A};
  \draw[thick, red] (A) -- (2,0);
\end{tikzpicture}`;

afterEach(() => {
  resetSharedEditAnalysisManager();
  vi.restoreAllMocks();
});

describe("edit analysis session", () => {
  it("reuses one parse across property-target, statement, inspector, and styles queries", () => {
    const parseSpy = vi.spyOn(parserModule, "parseTikz");
    const rendered = renderTikzToSvg(SOURCE, {
      parse: { recover: true, activeFigureId: "figure:0" }
    });
    const nodeElement = rendered.semantic.scene.elements.find((element) => element.sourceRef.sourceId === "path:0");
    expect(nodeElement).toBeDefined();
    if (!nodeElement) {
      throw new Error("Expected node element for path:0");
    }

    parseSpy.mockClear();

    const session = createEditAnalysisSession();
    const analysisView = session.ensure(SOURCE, { activeFigureId: "figure:0" });

    resolvePropertyTarget(SOURCE, "path:0", {
      activeFigureId: "figure:0",
      analysisView
    });
    parseStatementSnapshot(SOURCE, {
      activeFigureId: "figure:0",
      analysisView
    });
    const descriptor = getInspectorDescriptor(nodeElement, {
      source: SOURCE,
      editHandles: rendered.semantic.editHandles,
      parseOptions: {
        activeFigureId: "figure:0",
        analysisView
      }
    });
    buildStylesCascadeModel(
      nodeElement,
      {
        source: SOURCE,
        editHandles: rendered.semantic.editHandles,
        parseOptions: {
          activeFigureId: "figure:0",
          analysisView
        }
      },
      descriptor
    );

    expect(parseSpy).toHaveBeenCalledTimes(1);
  });

  it("uses primed parse results without falling back to another edit parse", () => {
    const parseSpy = vi.spyOn(parserModule, "parseTikz");
    const parseResult = parserModule.parseTikz(SOURCE, {
      recover: true,
      activeFigureId: "figure:0"
    });
    parseSpy.mockClear();

    const session = createEditAnalysisSession();
    const analysisView = session.primeFromParse(parseResult, SOURCE, {
      activeFigureId: "figure:0"
    });

    resolvePropertyTarget(SOURCE, "path:1", {
      activeFigureId: "figure:0",
      analysisView
    });
    expect(parseSpy).not.toHaveBeenCalled();
  });

  it("keeps primed parse results attached to the source they parsed", () => {
    const parsedSource = String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle (1.34,1.1);
\end{tikzpicture}`;
    const newerSource = String.raw`\begin{tikzpicture}
  \draw (0,0) rectangle (1.35,1.09);
\end{tikzpicture}`;
    const parseResult = parserModule.parseTikz(parsedSource, {
      recover: true,
      activeFigureId: "figure:0"
    });
    const session = createEditAnalysisSession();

    const primed = session.primeFromParse(parseResult, newerSource);

    expect(primed.source).toBe(parsedSource);
    expect(session.ensure(newerSource, { activeFigureId: "figure:0" })).not.toBe(primed);
  });

  it("memoizes cached analysis lookups and reuses the previous source entry", () => {
    const scopedSource = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \begin{scope}
    \draw (0,0) -- (0,1);
  \end{scope}
\end{tikzpicture}`;
    const otherSource = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (2,0);
\end{tikzpicture}`;
    const parseResult = parserModule.parseTikz(scopedSource, {
      recover: true,
      activeFigureId: "figure:0"
    });
    const session = createEditAnalysisSession();

    const primed = session.primeFromParse(parseResult, scopedSource);
    expect(session.primeFromParse(parseResult, scopedSource)).toBe(primed);

    const firstTarget = primed.resolvePropertyTarget("path:0");
    expect(primed.resolvePropertyTarget("path:0")).toBe(firstTarget);
    const figureTarget = primed.resolveFigurePropertyTarget();
    expect(primed.resolveFigurePropertyTarget()).toBe(figureTarget);

    const topLevelPath = primed.findPathStatement("path:0");
    expect(topLevelPath?.kind).toBe("Path");
    expect(primed.findPathStatement("path:0")).toBe(topLevelPath);
    const nestedPath = primed.statementSnapshot.all.find(
      (ref) => ref.parentKey !== "root" && ref.statement.kind === "Path"
    );
    expect(nestedPath).toBeDefined();
    if (nestedPath) {
      expect(primed.findPathStatement(nestedPath.id)).toBe(nestedPath.statement);
    }
    expect(primed.findPathStatement("path:missing")).toBeNull();

    const other = session.ensure(otherSource, { activeFigureId: "figure:0" });
    expect(other).not.toBe(primed);
    expect(session.ensure(scopedSource, { activeFigureId: "figure:0" })).toBe(primed);

    session.reset();
    expect(session.ensure(scopedSource, { activeFigureId: "figure:0" })).not.toBe(primed);
  });
});

describe("shared edit analysis manager", () => {
  it("seeds from the current snapshot parse result before any fallback parse", () => {
    const parseSpy = vi.spyOn(parserModule, "parseTikz");
    const parseResult = parserModule.parseTikz(SOURCE, {
      recover: true,
      activeFigureId: "figure:0"
    });
    const snapshot = {
      ...makeEmptySnapshot(SOURCE),
      source: SOURCE,
      revision: 42,
      activeFigureId: "figure:0",
      parseResult
    };

    parseSpy.mockClear();

    const analysisView = getSharedEditAnalysisView({
      documentId: "doc-1",
      sourceRevision: 7,
      source: SOURCE,
      activeFigureId: "figure:0",
      snapshot
    });
    resolvePropertyTarget(SOURCE, "path:0", {
      activeFigureId: "figure:0",
      analysisView
    });

    expect(parseSpy).not.toHaveBeenCalled();
  });

  it("invalidates the shared session when sourceRevision or activeFigureId changes", () => {
    const multiFigureSource = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}
\begin{tikzpicture}
  \draw (0,0) -- (0,1);
\end{tikzpicture}`;
    const parseResult0 = parserModule.parseTikz(multiFigureSource, {
      recover: true,
      activeFigureId: "figure:0"
    });
    const parseResult1 = parserModule.parseTikz(multiFigureSource, {
      recover: true,
      activeFigureId: "figure:1"
    });
    const snapshot0 = {
      ...makeEmptySnapshot(multiFigureSource),
      source: multiFigureSource,
      revision: 43,
      activeFigureId: "figure:0",
      parseResult: parseResult0
    };
    const snapshot1 = {
      ...makeEmptySnapshot(multiFigureSource),
      source: multiFigureSource,
      revision: 44,
      activeFigureId: "figure:1",
      parseResult: parseResult1
    };

    const first = getSharedEditAnalysisView({
      documentId: "doc-1",
      sourceRevision: 1,
      source: multiFigureSource,
      activeFigureId: "figure:0",
      snapshot: snapshot0
    });
    const second = getSharedEditAnalysisView({
      documentId: "doc-1",
      sourceRevision: 2,
      source: multiFigureSource,
      activeFigureId: "figure:0",
      snapshot: snapshot0
    });
    const third = getSharedEditAnalysisView({
      documentId: "doc-1",
      sourceRevision: 2,
      source: multiFigureSource,
      activeFigureId: "figure:1",
      snapshot: snapshot1
    });

    // Same source + activeFigureId → session reuses cached view (optimization).
    expect(second).toBe(first);
    // Different activeFigureId → different view.
    expect(third).not.toBe(second);
  });
});

describe("property target resolution", () => {
  it("uses the same statement ids as the main compute path for active figures in large papers", () => {
    const paperSource = readFileSync("test/papers/equal_shares_arxiv_v2.tex", "utf8");
    const parseResult = parseTikz(paperSource, {
      recover: true,
      activeFigureId: "figure:11",
      includeContextDefinitions: true
    });
    const semantic = evaluateTikzFigure(parseResult.figure, parseResult.source, {});
    const magentaAxis = semantic.scene.elements.find(
      (element) => element.kind === "Path" && element.style.stroke === "#ff00ff"
    );

    expect(magentaAxis).toBeDefined();
    if (!magentaAxis) {
      throw new Error("Expected the magenta axis line to resolve to a path source id");
    }
    expect(magentaAxis.sourceRef.sourceId.startsWith("path:")).toBe(true);

    const resolved = resolvePropertyTarget(paperSource, magentaAxis.sourceRef.sourceId, {
      activeFigureId: "figure:11"
    });

    expect(resolved.kind).toBe("found");
    if (resolved.kind !== "found") {
      throw new Error(`Expected a property target for ${magentaAxis.sourceRef.sourceId}`);
    }

    expect(resolved.target.pathCommand).toBe("draw");
    expect(paperSource.slice(resolved.target.span.from, resolved.target.span.to)).toBe(
      "\\draw[thick,->,magenta] (0.0, 0.0) -- (0.0, 4.5);"
    );
  });
});
