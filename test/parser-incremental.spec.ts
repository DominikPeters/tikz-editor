import { describe, expect, it } from "vitest";

import type { Span } from "../packages/core/src/ast/types.js";
import type { SourcePatch } from "../packages/core/src/edit/types.js";
import { createIncrementalParseSession, parseTikz } from "../packages/core/src/parser/index.js";

describe("incremental parser session", () => {
  it("reuses a primed parse when callers rely on default options", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const seeded = parseTikz(source, { recover: true });
    const session = createIncrementalParseSession();

    session.prime(seeded);
    const reused = session.evaluate({ source });

    expect(reused.stats.strategy).toBe("reused");
    expect(reused.stats.reusedStatementCount).toBe(1);
    expect(reused.parse.activeFigureId).toBe(seeded.activeFigureId);
  });

  it("patches a single changed statement during drag", () => {
    const source = String.raw`\begin{tikzpicture}
  \coordinate (A) at (0,0);
  \draw (A) -- (1,0);
\end{tikzpicture}`;
    const nextSource = source.replace("(1,0)", "(1.25,0.5)");
    const seeded = parseWithContext(source);
    const full = parseWithContext(nextSource);
    const session = createIncrementalParseSession();
    session.prime(seeded, { activeFigureId: seeded.activeFigureId, includeContextDefinitions: true, sourceRevision: 0 });

    const statementId = seeded.figure.body[1]?.id;
    expect(statementId).toBeTruthy();
    if (!statementId) {
      throw new Error("Expected a second statement to patch");
    }

    const incremental = session.evaluate({
      source: nextSource,
      sourceRevision: 1,
      activeFigureId: seeded.activeFigureId,
      includeContextDefinitions: true,
      patches: [computeSinglePatch(source, nextSource)],
      patchBaseRevision: 0,
      changedSourceIds: [statementId],
      trigger: "drag-element"
    });

    expect(incremental.stats.strategy).toBe("incremental");
    expect(incremental.stats.patchApplication).toBe("direct");
    expect(incremental.stats.reparsedStatementCount).toBe(1);
    expect(normalizeFigureForComparison(incremental.parse.figure)).toEqual(normalizeFigureForComparison(full.figure));
    expect(incremental.parse.figures).toEqual(full.figures);
    expect(incremental.parse.diagnostics).toEqual(full.diagnostics);
  });

  it("rebases a coalesced drag patch against the cached source", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,1) -- (1,2.4);
\end{tikzpicture}`;
    const skippedSource = source.replace("(1,2.4)", "(1.07,2.4)");
    const nextSource = skippedSource.replace("(1.07,2.4)", "(1.14,2.4)");
    const seeded = parseWithContext(source);
    const full = parseWithContext(nextSource);
    const session = createIncrementalParseSession();
    session.prime(seeded, { activeFigureId: seeded.activeFigureId, includeContextDefinitions: true, sourceRevision: 0 });

    const statementId = seeded.figure.body[0]?.id;
    expect(statementId).toBeTruthy();
    if (!statementId) {
      throw new Error("Expected a statement to patch");
    }

    const incremental = session.evaluate({
      source: nextSource,
      sourceRevision: 2,
      activeFigureId: seeded.activeFigureId,
      includeContextDefinitions: true,
      patches: [computeSinglePatch(skippedSource, nextSource)],
      patchBaseRevision: 1,
      changedSourceIds: [statementId],
      trigger: "drag-handle"
    });

    expect(incremental.stats.strategy).toBe("incremental");
    expect(incremental.stats.patchApplication).toBe("rebased");
    expect(incremental.stats.fallbackReason).toBeUndefined();
    expect(normalizeFigureForComparison(incremental.parse.figure)).toEqual(normalizeFigureForComparison(full.figure));
    expect(incremental.parse.diagnostics).toEqual(full.diagnostics);
  });

  it("keeps statement spans stable when snapped coordinates shorten", () => {
    const coordinates = ["(1,2.4)", "(1.03,2.4)", "(1.04,2.4)", "(1.05,2.4)", "(1.06,2.4)", "(1.1,2.4)"];
    const sourceForCoordinate = (coordinate: string) => String.raw`\begin{tikzpicture}
  \draw (0,1) -- ${coordinate};
\end{tikzpicture}`;
    const seeded = parseWithContext(sourceForCoordinate(coordinates[0] ?? "(1,2.4)"));
    const session = createIncrementalParseSession();
    session.prime(seeded, { activeFigureId: seeded.activeFigureId, includeContextDefinitions: true });

    const statementId = seeded.figure.body[0]?.id;
    expect(statementId).toBeTruthy();
    if (!statementId) {
      throw new Error("Expected a statement to patch");
    }

    let previousSource = sourceForCoordinate(coordinates[0] ?? "(1,2.4)");
    for (const coordinate of coordinates.slice(1)) {
      const nextSource = sourceForCoordinate(coordinate);
      const full = parseWithContext(nextSource);
      const incremental = session.evaluate({
        source: nextSource,
        activeFigureId: seeded.activeFigureId,
        includeContextDefinitions: true,
        patches: [computeSinglePatch(previousSource, nextSource)],
        changedSourceIds: [statementId],
        trigger: "drag-handle"
      });

      expect(incremental.stats.strategy).toBe("incremental");
      expect(incremental.stats.fallbackReason).toBeUndefined();
      expect(normalizeFigureForComparison(incremental.parse.figure)).toEqual(normalizeFigureForComparison(full.figure));
      previousSource = nextSource;
    }
  });

  it("patches multiple changed statements with stable source ids", () => {
    const source = String.raw`\begin{tikzpicture}
  \coordinate (A) at (0,0);
  \coordinate (B) at (2,0);
  \draw (A) -- (B);
\end{tikzpicture}`;
    const seeded = parseWithContext(source);
    const session = createIncrementalParseSession();
    session.prime(seeded, { activeFigureId: seeded.activeFigureId, includeContextDefinitions: true });

    const firstStatementId = seeded.figure.body[0]?.id;
    const secondStatementId = seeded.figure.body[1]?.id;
    expect(firstStatementId).toBeTruthy();
    expect(secondStatementId).toBeTruthy();
    if (!firstStatementId || !secondStatementId) {
      throw new Error("Expected both coordinate statements to exist");
    }

    const applied = applyReplacements(source, [
      {
        span: findSpan(source, "(0,0)"),
        replacement: "(0.5,0.25)"
      },
      {
        span: findSpan(source, "(2,0)"),
        replacement: "(2.75,-0.5)"
      }
    ]);
    const full = parseWithContext(applied.source);

    const incremental = session.evaluate({
      source: applied.source,
      activeFigureId: seeded.activeFigureId,
      includeContextDefinitions: true,
      patches: applied.patches,
      changedSourceIds: [firstStatementId, secondStatementId],
      trigger: "drag-element"
    });

    expect(incremental.stats.strategy).toBe("incremental");
    expect(incremental.stats.reparsedStatementCount).toBe(2);
    expect(normalizeFigureForComparison(incremental.parse.figure)).toEqual(normalizeFigureForComparison(full.figure));
    expect(incremental.parse.figures).toEqual(full.figures);
  });

  it("shifts later figure inventory spans when the active figure is not first", () => {
    const source = String.raw`\documentclass{article}
\begin{document}
\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}
\begin{tikzpicture}
  \coordinate (B) at (0.2,0);
  \draw (B) -- (1,0);
\end{tikzpicture}
\begin{tikzpicture}
  \draw (0,0) -- (0,1);
\end{tikzpicture}
\end{document}`;
    const seededDocument = parseTikz(source, { recover: true });
    const activeFigureId = seededDocument.figures[1]?.id ?? null;
    expect(activeFigureId).toBe("figure:1");
    if (!activeFigureId) {
      throw new Error("Expected the middle figure to be addressable");
    }
    const seeded = parseWithContext(source, activeFigureId);
    const session = createIncrementalParseSession();
    session.prime(seeded, { activeFigureId, includeContextDefinitions: true });

    const nextSource = source.replace("(0.2,0)", "(12.345,0)");
    const full = parseWithContext(nextSource, activeFigureId);
    const statementId = seeded.figure.body[0]?.id;
    expect(statementId).toBeTruthy();
    if (!statementId) {
      throw new Error("Expected the active figure statement to exist");
    }

    const incremental = session.evaluate({
      source: nextSource,
      activeFigureId,
      includeContextDefinitions: true,
      patches: [computeSinglePatch(source, nextSource)],
      changedSourceIds: [statementId],
      trigger: "drag-element"
    });

    expect(incremental.stats.strategy).toBe("incremental");
    expect(incremental.parse.figures).toEqual(full.figures);
    expect(incremental.parse.activeFigureId).toBe(activeFigureId);
  });

  it("falls back when a patch touches the tikzpicture delimiter", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const seeded = parseWithContext(source);
    const session = createIncrementalParseSession();
    session.prime(seeded, { activeFigureId: seeded.activeFigureId, includeContextDefinitions: true });

    const beginToken = "\\begin{tikzpicture}";
    const statementId = seeded.figure.body[0]?.id;
    expect(statementId).toBeTruthy();
    if (!statementId) {
      throw new Error("Expected a statement to exist");
    }

    const result = session.evaluate({
      source,
      activeFigureId: seeded.activeFigureId,
      includeContextDefinitions: true,
      patches: [
        {
          oldSpan: { from: 0, to: beginToken.length },
          newSpan: { from: 0, to: beginToken.length },
          replacement: beginToken
        }
      ],
      changedSourceIds: [statementId],
      trigger: "drag-element"
    });

    expect(result.stats.strategy).toBe("full");
    expect(result.stats.fallbackReason).toBe("patch-touches-figure-delimiter");
  });

  it("falls back when the active figure is unresolved during a drag", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}
\begin{tikzpicture}
  \draw (0,0) -- (0,1);
\end{tikzpicture}`;
    const seeded = parseWithContext(source);
    const nextSource = source.replace("(1,0)", "(1.1,0)");
    const session = createIncrementalParseSession();
    session.prime(seeded, { activeFigureId: seeded.activeFigureId, includeContextDefinitions: true });

    const result = session.evaluate({
      source: nextSource,
      activeFigureId: null,
      includeContextDefinitions: true,
      patches: [computeSinglePatch(source, nextSource)],
      changedSourceIds: [seeded.figure.body[0]?.id ?? "path:0"],
      trigger: "drag-element"
    });

    expect(result.stats.strategy).toBe("full");
    expect(result.stats.fallbackReason).toBe("active-figure-unresolved");
  });

  it("falls back when changed source ids do not resolve", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const nextSource = source.replace("(1,0)", "(1.5,0)");
    const seeded = parseWithContext(source);
    const session = createIncrementalParseSession();
    session.prime(seeded, { activeFigureId: seeded.activeFigureId, includeContextDefinitions: true });

    const result = session.evaluate({
      source: nextSource,
      activeFigureId: seeded.activeFigureId,
      includeContextDefinitions: true,
      patches: [computeSinglePatch(source, nextSource)],
      changedSourceIds: ["missing-source-id"],
      trigger: "drag-element"
    });

    expect(result.stats.strategy).toBe("full");
    expect(result.stats.fallbackReason).toBe("patch-source-id-mismatch");
  });

  it("falls back when a changed statement cannot be reparsed as a statement-stable edit", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const replacement = "  \\node at (0,0) {changed};";
    const nextSource = source.replace("  \\draw (0,0) -- (1,0);", replacement);
    const seeded = parseWithContext(source);
    const session = createIncrementalParseSession();
    session.prime(seeded, { activeFigureId: seeded.activeFigureId, includeContextDefinitions: true });

    const statementId = seeded.figure.body[0]?.id;
    expect(statementId).toBeTruthy();
    if (!statementId) {
      throw new Error("Expected a statement to exist");
    }

    const statementSpan = seeded.figure.body[0]?.span;
    expect(statementSpan).toBeTruthy();
    if (!statementSpan) {
      throw new Error("Expected a statement span");
    }

    const result = session.evaluate({
      source: nextSource,
      activeFigureId: seeded.activeFigureId,
      includeContextDefinitions: true,
      patches: [
        {
          oldSpan: { ...statementSpan },
          newSpan: {
            from: statementSpan.from,
            to: statementSpan.from + replacement.length
          },
          replacement
        }
      ],
      changedSourceIds: [statementId],
      trigger: "drag-element"
    });

    expect(result.stats.strategy).toBe("full");
    expect(["statement-structure-changed", "statement-parse-error"]).toContain(result.stats.fallbackReason);
  });

  it("reuses cached parses and falls back for non-incremental session inputs", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const seeded = parseWithContext(source);
    const statementId = seeded.figure.body[0]?.id;
    expect(statementId).toBeTruthy();
    if (!statementId) {
      throw new Error("Expected a statement to exist");
    }

    const cold = createIncrementalParseSession();
    const coldResult = cold.evaluate({
      source,
      activeFigureId: seeded.activeFigureId,
      includeContextDefinitions: true,
      trigger: "drag-element",
      patches: [computeSinglePatch(source, source.replace("(1,0)", "(1.1,0)"))],
      changedSourceIds: [statementId]
    });
    expect(coldResult.stats.strategy).toBe("full");
    expect(coldResult.stats.fallbackReason).toBe("no-previous-cache");

    const session = createIncrementalParseSession();
    session.prime(seeded, { activeFigureId: seeded.activeFigureId, includeContextDefinitions: true, sourceRevision: 4 });
    const reused = session.evaluate({
      source,
      sourceRevision: 5,
      activeFigureId: seeded.activeFigureId,
      includeContextDefinitions: true
    });
    expect(reused.stats.strategy).toBe("reused");
    expect(reused.stats.reusedStatementCount).toBeGreaterThan(0);

    const nextSource = source.replace("(1,0)", "(1.5,0)");
    const patch = computeSinglePatch(source, nextSource);
    const nonDrag = session.evaluate({
      source: nextSource,
      activeFigureId: seeded.activeFigureId,
      includeContextDefinitions: true,
      trigger: "other",
      patches: [patch],
      changedSourceIds: [statementId]
    });
    expect(nonDrag.stats.strategy).toBe("incremental");
    expect(nonDrag.stats.fallbackReason).toBeUndefined();

    session.prime(seeded, { activeFigureId: seeded.activeFigureId, includeContextDefinitions: true });
    expect(session.evaluate({
      source: nextSource,
      activeFigureId: seeded.activeFigureId,
      includeContextDefinitions: true,
      trigger: "drag-element",
      patches: [],
      changedSourceIds: [statementId]
    }).stats.fallbackReason).toBe("missing-patches");

    expect(session.evaluate({
      source: nextSource,
      activeFigureId: seeded.activeFigureId,
      includeContextDefinitions: false,
      trigger: "drag-element",
      patches: [patch],
      changedSourceIds: [statementId]
    }).stats.fallbackReason).toBe("active-figure-mismatch");

    session.reset();
    const afterReset = session.evaluate({
      source,
      activeFigureId: seeded.activeFigureId,
      includeContextDefinitions: true,
      trigger: "drag-handle",
      patches: [patch],
      changedSourceIds: [statementId]
    });
    expect(afterReset.stats.strategy).toBe("full");
    expect(afterReset.stats.fallbackReason).toBe("no-previous-cache");
  });

  it("normalizes duplicate changed ids and discards invalid patches before fallback decisions", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const nextSource = source.replace("(1,0)", "(1.25,0)");
    const seeded = parseWithContext(source);
    const full = parseWithContext(nextSource);
    const statementId = seeded.figure.body[0]?.id;
    expect(statementId).toBeTruthy();
    if (!statementId) {
      throw new Error("Expected statement id");
    }

    const session = createIncrementalParseSession();
    session.prime(seeded, { activeFigureId: seeded.activeFigureId, includeContextDefinitions: true });
    const incremental = session.evaluate({
      source: nextSource,
      activeFigureId: seeded.activeFigureId,
      includeContextDefinitions: true,
      trigger: "drag-element",
      patches: [
        { oldSpan: { from: 10, to: 5 }, newSpan: { from: 10, to: 5 }, replacement: "ignored" },
        computeSinglePatch(source, nextSource)
      ],
      changedSourceIds: [" ", statementId, statementId]
    });

    expect(incremental.stats.strategy).toBe("incremental");
    expect(incremental.stats.reparsedStatementCount).toBe(1);
    expect(normalizeFigureForComparison(incremental.parse.figure)).toEqual(normalizeFigureForComparison(full.figure));

    session.prime(seeded, { activeFigureId: seeded.activeFigureId, includeContextDefinitions: true });
    const discardedOnly = session.evaluate({
      source: nextSource,
      activeFigureId: seeded.activeFigureId,
      includeContextDefinitions: true,
      trigger: "drag-element",
      patches: [{ oldSpan: { from: 10, to: 5 }, newSpan: { from: 10, to: 5 }, replacement: "ignored" }],
      changedSourceIds: [statementId]
    });
    expect(discardedOnly.stats.strategy).toBe("full");
    expect(discardedOnly.stats.fallbackReason).toBe("missing-patches");
  });

  it("falls back distinctly for unresolved single-figure active ids and corrupted nested caches", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
    \draw (0,0) -- (1,0);
  \end{scope}
\end{tikzpicture}`;
    const nextSource = source.replace("(1,0)", "(1.25,0)");
    const seeded = parseWithContext(source);
    const nestedScope = seeded.figure.body[0];
    expect(nestedScope?.kind).toBe("Scope");
    if (!nestedScope || nestedScope.kind !== "Scope") {
      throw new Error("Expected nested scope");
    }
    const nestedId = nestedScope.body[0]?.id;
    expect(nestedId).toBeTruthy();
    if (!nestedId) {
      throw new Error("Expected nested statement id");
    }

    const activeNullSession = createIncrementalParseSession();
    activeNullSession.prime(seeded, { activeFigureId: seeded.activeFigureId, includeContextDefinitions: true });
    const activeNull = activeNullSession.evaluate({
      source: nextSource,
      activeFigureId: null,
      includeContextDefinitions: true,
      trigger: "drag-element",
      patches: [computeSinglePatch(source, nextSource)],
      changedSourceIds: [nestedId]
    });
    expect(activeNull.stats.strategy).toBe("full");
    expect(activeNull.stats.fallbackReason).toBe("active-figure-mismatch");

    const corruptSession = createIncrementalParseSession();
    corruptSession.prime(seeded, { activeFigureId: seeded.activeFigureId, includeContextDefinitions: true });
    const cached = corruptSession.evaluate({
      source,
      activeFigureId: seeded.activeFigureId,
      includeContextDefinitions: true
    });
    const cachedScope = cached.parse.figure.body[0];
    expect(cachedScope?.kind).toBe("Scope");
    if (cachedScope) {
      (cachedScope as { kind: string }).kind = "Path";
    }

    const corrupted = corruptSession.evaluate({
      source: nextSource,
      activeFigureId: seeded.activeFigureId,
      includeContextDefinitions: true,
      trigger: "drag-element",
      patches: [computeSinglePatch(source, nextSource)],
      changedSourceIds: [nestedId]
    });
    expect(corrupted.stats.strategy).toBe("full");
    expect(corrupted.stats.fallbackReason).toBe("runtime-error");
  });

  it("falls back for active figure and patch ownership mismatches", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}
\begin{tikzpicture}
  \draw (0,0) -- (0,1);
\end{tikzpicture}`;
    const seeded = parseWithContext(source, "figure:0");
    const statementId = seeded.figure.body[0]?.id;
    expect(statementId).toBeTruthy();
    if (!statementId) {
      throw new Error("Expected a statement to exist");
    }

    const session = createIncrementalParseSession();
    session.prime(seeded, { activeFigureId: "figure:0", includeContextDefinitions: true });
    const unchangedMismatch = session.evaluate({
      source,
      activeFigureId: "figure:1",
      includeContextDefinitions: true,
      trigger: "drag-element",
      patches: [{ oldSpan: { from: 0, to: 0 }, newSpan: { from: 0, to: 0 }, replacement: "" }],
      changedSourceIds: [statementId]
    });
    expect(unchangedMismatch.stats.fallbackReason).toBe("source-unchanged-active-figure-mismatch");

    const nextSource = source.replace("(1,0)", "(1.2,0)");
    const patch = computeSinglePatch(source, nextSource);
    session.prime(seeded, { activeFigureId: "figure:0", includeContextDefinitions: true });
    expect(session.evaluate({
      source: nextSource,
      activeFigureId: "figure:1",
      includeContextDefinitions: true,
      trigger: "drag-element",
      patches: [patch],
      changedSourceIds: [statementId]
    }).stats.fallbackReason).toBe("active-figure-mismatch");

    session.prime(seeded, { activeFigureId: "figure:0", includeContextDefinitions: true });
    const secondFigureCoordinate = source.lastIndexOf("(0,1)");
    const outsideSource = source.slice(0, secondFigureCoordinate) + "(0,1.2)" + source.slice(secondFigureCoordinate + "(0,1)".length);
    expect(session.evaluate({
      source: outsideSource,
      activeFigureId: "figure:0",
      includeContextDefinitions: true,
      trigger: "drag-element",
      patches: [computeSinglePatch(source, outsideSource)],
      changedSourceIds: [statementId]
    }).stats.fallbackReason).toBe("patch-outside-active-figure");

    const whitespace = findSpan(source, "\n  ", source.indexOf("\\begin{tikzpicture}"));
    session.prime(seeded, { activeFigureId: "figure:0", includeContextDefinitions: true });
    expect(session.evaluate({
      source,
      activeFigureId: "figure:0",
      includeContextDefinitions: true,
      trigger: "drag-element",
      patches: [{ oldSpan: whitespace, newSpan: whitespace, replacement: source.slice(whitespace.from, whitespace.to) }],
      changedSourceIds: [statementId]
    }).stats.fallbackReason).toBe("patch-overlaps-unknown-statement");
  });

  it("patches nested scope statements while preserving source ids", () => {
    const source = String.raw`\begin{tikzpicture}
  \begin{scope}
    \draw (0,0) -- (1,0);
  \end{scope}
  \draw (0,0) -- (0,1);
\end{tikzpicture}`;
    const nextSource = source.replace("(1,0)", "(1.75,0.25)");
    const seeded = parseWithContext(source);
    const full = parseWithContext(nextSource);
    const scope = seeded.figure.body[0];
    expect(scope?.kind).toBe("Scope");
    if (!scope || scope.kind !== "Scope") {
      throw new Error("Expected a scope statement");
    }
    const nestedId = scope.body[0]?.id;
    expect(nestedId).toBeTruthy();
    if (!nestedId) {
      throw new Error("Expected a nested statement id");
    }

    const session = createIncrementalParseSession();
    session.prime(seeded, { activeFigureId: seeded.activeFigureId, includeContextDefinitions: true });
    const incremental = session.evaluate({
      source: nextSource,
      activeFigureId: seeded.activeFigureId,
      includeContextDefinitions: true,
      trigger: "drag-handle",
      patches: [computeSinglePatch(source, nextSource)],
      changedSourceIds: [nestedId]
    });

    expect(incremental.stats.strategy).toBe("incremental");
    expect(incremental.stats.reparsedStatementCount).toBe(1);
    expect(normalizeFigureForComparison(incremental.parse.figure)).toEqual(normalizeFigureForComparison(full.figure));
    const nextScope = incremental.parse.figure.body[0];
    expect(nextScope?.kind).toBe("Scope");
    if (nextScope?.kind === "Scope") {
      expect(nextScope.body[0]?.id).toBe(nestedId);
    }
  });

  it("falls back when a patch is owned by a different statement than the changed source id", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,0) -- (0,1);
\end{tikzpicture}`;
    const nextSource = source.replace("(0,1)", "(0,1.5)");
    const seeded = parseWithContext(source);
    const firstId = seeded.figure.body[0]?.id;
    expect(firstId).toBeTruthy();
    if (!firstId) {
      throw new Error("Expected first statement id");
    }

    const session = createIncrementalParseSession();
    session.prime(seeded, { activeFigureId: seeded.activeFigureId, includeContextDefinitions: true });
    const result = session.evaluate({
      source: nextSource,
      activeFigureId: seeded.activeFigureId,
      includeContextDefinitions: true,
      trigger: "drag-element",
      patches: [computeSinglePatch(source, nextSource)],
      changedSourceIds: [firstId]
    });

    expect(result.stats.strategy).toBe("full");
    expect(result.stats.fallbackReason).toBe("patch-source-id-mismatch");
  });

  it("preserves and shifts local diagnostics for unchanged statements during incremental replacement", () => {
    const source = String.raw`\begin{tikzpicture}
  \node (A) at (0,0) {bad};
  \draw (A) -- (1,0);
\end{tikzpicture}`;
    const seeded = parseTikz(source, {
      recover: true,
      includeContextDefinitions: true,
      nodeTextValidator: ({ node }) => node.text === "bad" ? { code: "bad-node-text", message: "bad text" } : null
    });
    const drawId = seeded.figure.body[1]?.id;
    expect(drawId).toBeTruthy();
    if (!drawId) {
      throw new Error("Expected draw statement id");
    }

    const nextSource = source.replace("(1,0)", "(1.25,0.5)");
    const session = createIncrementalParseSession();
    session.prime(seeded, { activeFigureId: seeded.activeFigureId, includeContextDefinitions: true });
    const result = session.evaluate({
      source: nextSource,
      activeFigureId: seeded.activeFigureId,
      includeContextDefinitions: true,
      trigger: "drag-element",
      patches: [computeSinglePatch(source, nextSource)],
      changedSourceIds: [drawId]
    });

    expect(result.stats.strategy).toBe("incremental");
    expect(result.parse.diagnostics).toEqual([
      expect.objectContaining({ code: "bad-node-text", message: "bad text" })
    ]);
    expect(result.parse.diagnostics[0]?.span).toEqual(seeded.diagnostics[0]?.span);
  });

  it("falls back when the cached parse has global diagnostics", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const seeded = parseWithContext(source);
    const statementId = seeded.figure.body[0]?.id;
    expect(statementId).toBeTruthy();
    if (!statementId) {
      throw new Error("Expected statement id");
    }
    const withGlobalDiagnostic = {
      ...seeded,
      diagnostics: [
        ...seeded.diagnostics,
        {
          severity: "error" as const,
          code: "synthetic-global",
          message: "global problem",
          span: { from: 0, to: 1 }
        }
      ]
    };

    const nextSource = source.replace("(1,0)", "(1.2,0)");
    const session = createIncrementalParseSession();
    session.prime(withGlobalDiagnostic, { activeFigureId: seeded.activeFigureId, includeContextDefinitions: true });
    const result = session.evaluate({
      source: nextSource,
      activeFigureId: seeded.activeFigureId,
      includeContextDefinitions: true,
      trigger: "drag-element",
      patches: [computeSinglePatch(source, nextSource)],
      changedSourceIds: [statementId]
    });

    expect(result.stats.strategy).toBe("full");
    expect(result.stats.fallbackReason).toBe("global-diagnostics");
  });

  it("keeps nested path item ids stable for to, edge, and child operations", () => {
    const source = String.raw`\begin{tikzpicture}
  \path (0,0) to node[midway] {x} (1,0) edge node {y} (2,0);
  \node {root} child { node {a} };
\end{tikzpicture}`;
    const nextSource = source
      .replace("(1,0)", "(1.2,0.4)")
      .replace("{root}", "{root!}");
    const seeded = parseWithContext(source);
    const full = parseWithContext(nextSource);
    const firstId = seeded.figure.body[0]?.id;
    const secondId = seeded.figure.body[1]?.id;
    expect(firstId).toBeTruthy();
    expect(secondId).toBeTruthy();
    if (!firstId || !secondId) {
      throw new Error("Expected path statement ids");
    }

    const applied = applyReplacements(source, [
      { span: findSpan(source, "(1,0)"), replacement: "(1.2,0.4)" },
      { span: findSpan(source, "{root}"), replacement: "{root!}" }
    ]);
    expect(applied.source).toBe(nextSource);

    const session = createIncrementalParseSession();
    session.prime(seeded, { activeFigureId: seeded.activeFigureId, includeContextDefinitions: true });
    const result = session.evaluate({
      source: nextSource,
      activeFigureId: seeded.activeFigureId,
      includeContextDefinitions: true,
      trigger: "drag-element",
      patches: applied.patches,
      changedSourceIds: [firstId, secondId]
    });

    expect(result.stats.strategy).toBe("incremental");
    expect(normalizeFigureForComparison(result.parse.figure)).toEqual(normalizeFigureForComparison(full.figure));
    expect(result.parse.figure.body[0]?.id).toBe(firstId);
    expect(result.parse.figure.body[1]?.id).toBe(secondId);
  });
});

function parseWithContext(source: string, activeFigureId?: string | null) {
  return parseTikz(source, {
    recover: true,
    activeFigureId,
    includeContextDefinitions: true
  });
}

function computeSinglePatch(oldSource: string, newSource: string): SourcePatch {
  let prefix = 0;
  const limit = Math.min(oldSource.length, newSource.length);
  while (prefix < limit && oldSource.charCodeAt(prefix) === newSource.charCodeAt(prefix)) {
    prefix += 1;
  }

  let oldSuffix = oldSource.length;
  let newSuffix = newSource.length;
  while (
    oldSuffix > prefix &&
    newSuffix > prefix &&
    oldSource.charCodeAt(oldSuffix - 1) === newSource.charCodeAt(newSuffix - 1)
  ) {
    oldSuffix -= 1;
    newSuffix -= 1;
  }

  return {
    oldSpan: { from: prefix, to: oldSuffix },
    newSpan: { from: prefix, to: newSuffix },
    replacement: newSource.slice(prefix, newSuffix)
  };
}

function findSpan(source: string, text: string, fromIndex = 0): Span {
  const from = source.indexOf(text, fromIndex);
  if (from < 0) {
    throw new Error(`Could not find "${text}" in source`);
  }
  return {
    from,
    to: from + text.length
  };
}

function applyReplacements(
  source: string,
  replacements: Array<{ span: Span; replacement: string }>
): { source: string; patches: SourcePatch[] } {
  const sorted = [...replacements].sort((left, right) => left.span.from - right.span.from);
  const patches: SourcePatch[] = [];
  let cursor = 0;
  let delta = 0;
  let output = "";

  for (const replacement of sorted) {
    output += source.slice(cursor, replacement.span.from);
    output += replacement.replacement;
    const newFrom = replacement.span.from + delta;
    const newTo = newFrom + replacement.replacement.length;
    patches.push({
      oldSpan: { ...replacement.span },
      newSpan: { from: newFrom, to: newTo },
      replacement: replacement.replacement
    });
    delta += replacement.replacement.length - (replacement.span.to - replacement.span.from);
    cursor = replacement.span.to;
  }

  output += source.slice(cursor);
  return {
    source: output,
    patches
  };
}

function normalizeFigureForComparison<T>(value: T): T {
  const clone = structuredClone(value);
  const visit = (current: unknown, parentKind: string | null): void => {
    if (!current || typeof current !== "object") {
      return;
    }
    if (Array.isArray(current)) {
      for (const entry of current) {
        visit(entry, parentKind);
      }
      return;
    }
    const record = current as Record<string, unknown>;
    const kind = typeof record.kind === "string" ? record.kind : parentKind;
    if (typeof record.id === "string" && kind !== "Path" && kind !== "Scope") {
      delete record.id;
    }
    for (const child of Object.values(record)) {
      visit(child, kind);
    }
  };
  visit(clone, null);
  return clone;
}
