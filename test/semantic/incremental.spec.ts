import { describe, expect, it } from "vitest";

import { applyEditAction } from "../../packages/core/src/edit/actions.js";
import { parseTikz } from "../../packages/core/src/parser/index.js";
import {
  createSemanticEvaluationRun,
  evaluateSemanticStatementByIndex,
  evaluateTikzFigure
} from "../../packages/core/src/semantic/evaluate.js";
import { createIncrementalSemanticSession } from "../../packages/core/src/semantic/incremental.js";
import type { EditHandle, EvaluateOptions } from "../../packages/core/src/semantic/types.js";
import type { Statement } from "../../packages/core/src/ast/types.js";
import { wp } from "../coords-helpers.js";

describe("semantic incremental evaluation", () => {
  it("rejects direct statement evaluation indexes outside the expanded body", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source, { recover: true });
    const run = createSemanticEvaluationRun(parsed.figure, source);

    expect(() => evaluateSemanticStatementByIndex(run, -1)).toThrow("Statement index -1 is out of bounds");
    expect(() => evaluateSemanticStatementByIndex(run, run.expandedFigureBody.length)).toThrow("is out of bounds");
  });

  it("reports full-evaluation fallback reasons for public incremental preconditions", () => {
    const source = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source, { recover: true });

    const cold = createIncrementalSemanticSession().evaluate({
      figure: parsed.figure,
      source,
      hints: {
        trigger: "drag-element",
        changedSourceIds: ["path:0"]
      }
    });
    expect(cold.stats).toMatchObject({
      strategy: "full",
      fallbackReason: "no-previous-cache"
    });

    const missingIds = createIncrementalSemanticSession();
    missingIds.evaluate({ figure: parsed.figure, source, hints: { trigger: "other" } });
    const missing = missingIds.evaluate({
      figure: parsed.figure,
      source,
      hints: { trigger: "drag-element" }
    });
    expect(missing.stats).toMatchObject({
      strategy: "full",
      fallbackReason: "missing-changed-source-ids"
    });

    const nonDrag = createIncrementalSemanticSession();
    nonDrag.evaluate({ figure: parsed.figure, source, hints: { trigger: "other" } });
    const nonDragResult = nonDrag.evaluate({
      figure: parsed.figure,
      source,
      hints: {
        trigger: "other",
        changedSourceIds: ["path:0"]
      }
    });
    expect(nonDragResult.stats).toMatchObject({
      strategy: "full",
      fallbackReason: "non-drag-trigger"
    });

    const structure = createIncrementalSemanticSession();
    structure.evaluate({ figure: parsed.figure, source, hints: { trigger: "other" } });
    const nextSource = source.replace("\\end{tikzpicture}", "  \\draw (1,0) -- (2,0);\n\\end{tikzpicture}");
    const nextParsed = parseTikz(nextSource, { recover: true });
    const changedStructure = structure.evaluate({
      figure: nextParsed.figure,
      source: nextSource,
      hints: {
        trigger: "drag-element",
        changedSourceIds: ["path:0"]
      }
    });
    expect(changedStructure.stats).toMatchObject({
      strategy: "full",
      fallbackReason: "statement-structure-changed"
    });
  });

  it("keeps stateful graphics on the full-evaluation path", () => {
    const source = String.raw`\begin{tikzpicture}
  \clip (0,0) rectangle (1,1);
  \draw (0,0) -- (2,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source, { recover: true });
    const result = createIncrementalSemanticSession().evaluate({
      figure: parsed.figure,
      source,
      hints: {
        trigger: "drag-element",
        changedSourceIds: ["path:1"],
        sourcePatches: [{ replacement: "\\clip" }]
      }
    });

    expect(result.stats).toMatchObject({
      strategy: "full",
      fallbackReason: "stateful-graphics-state"
    });
  });

  it("keeps backgrounds library sources on the full-evaluation path", () => {
    const source = String.raw`\begin{tikzpicture}[framed]
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
    const parsed = parseTikz(source, { recover: true });
    const result = createIncrementalSemanticSession().evaluate({
      figure: parsed.figure,
      source,
      hints: {
        trigger: "drag-element",
        changedSourceIds: ["path:0"],
        sourcePatches: [{ replacement: "framed" }]
      }
    });

    expect(result.stats).toMatchObject({
      strategy: "full",
      fallbackReason: "stateful-graphics-state"
    });
  });

  it("matches full evaluation for repeated move-element drag updates", () => {
    const session = createIncrementalSemanticSession();
    let source = STARTUP_SOURCE;
    const seededParsed = parseTikz(source, { recover: true });
    const seeded = session.evaluate({
      figure: seededParsed.figure,
      source,
      hints: { trigger: "other" }
    });
    expect(seeded.stats.strategy).toBe("full");

    for (let step = 0; step < 20; step += 1) {
      const current = evaluateFull(source);
      const targetSourceId = pickMoveSourceId(current.semantic.editHandles);
      const actionResult = applyEditAction(source, current.semantic.editHandles, {
        kind: "moveElements",
        elementIds: [targetSourceId],
        delta: wp(0.05, -0.02)
      });
      expect(actionResult.kind === "success" || actionResult.kind === "partial").toBe(true);
      if (!(actionResult.kind === "success" || actionResult.kind === "partial")) {
        throw new Error(`moveElements failed: ${actionResult.kind}`);
      }
      source = actionResult.newSource;

      const parsed = parseTikz(source, { recover: true });
      const incremental = session.evaluate({
        figure: parsed.figure,
        source,
        hints: {
          trigger: "drag-element",
          changedSourceIds: actionResult.changedSourceIds ?? [targetSourceId]
        }
      });
      const full = evaluateTikzFigure(parsed.figure, source);
      expect(incremental.semantic).toEqual(full);
      expect(incremental.stats.strategy).toBe("incremental");
      expect(incremental.stats.recomputeFromStatementIndex).not.toBeNull();
    }
  });

  it("matches full evaluation for repeated move-handle drag updates", () => {
    const session = createIncrementalSemanticSession();
    let source = STARTUP_SOURCE;
    const seededParsed = parseTikz(source, { recover: true });
    session.evaluate({
      figure: seededParsed.figure,
      source,
      hints: { trigger: "other" }
    });

    for (let step = 0; step < 12; step += 1) {
      const current = evaluateFull(source);
      const handle = pickHandleForDrag(current.semantic.editHandles);
      const actionResult = applyEditAction(source, current.semantic.editHandles, {
        kind: "moveHandle",
        handleId: handle.id,
        newWorld: wp(handle.world.x + 0.04, handle.world.y + 0.03)
      });
      expect(actionResult.kind === "success" || actionResult.kind === "partial").toBe(true);
      if (!(actionResult.kind === "success" || actionResult.kind === "partial")) {
        throw new Error(`moveHandle failed: ${actionResult.kind}`);
      }
      source = actionResult.newSource;

      const parsed = parseTikz(source, { recover: true });
      const incremental = session.evaluate({
        figure: parsed.figure,
        source,
        hints: {
          trigger: "drag-handle",
          changedSourceIds: actionResult.changedSourceIds ?? [handle.sourceRef.sourceId]
        }
      });
      const full = evaluateTikzFigure(parsed.figure, source);
      expect(incremental.semantic).toEqual(full);
      expect(incremental.stats.strategy).toBe("incremental");
    }
  });

  it("matches full evaluation for multi-hop named resource dependencies", () => {
    const source = String.raw`\begin{tikzpicture}
  \coordinate (A) at (0,0);
  \coordinate (B) at (2,0);
  \path[name path=ab] (A) -- (B);
  \path[name path=vertical] (1,-1) -- (1,1);
  \path [name intersections={of=ab and vertical, by=P}];
  \draw (P) -- (2,2);
\end{tikzpicture}`;
    const session = createIncrementalSemanticSession();
    const seededParsed = parseTikz(source, { recover: true });
    session.evaluate({
      figure: seededParsed.figure,
      source,
      hints: { trigger: "other" }
    });

    const current = evaluateFull(source);
    const targetSourceId = pickMoveSourceId(current.semantic.editHandles);
    const actionResult = applyEditAction(source, current.semantic.editHandles, {
      kind: "moveElements",
      elementIds: [targetSourceId],
      delta: wp(0.08, 0.01)
    });
    expect(actionResult.kind === "success" || actionResult.kind === "partial").toBe(true);
    if (!(actionResult.kind === "success" || actionResult.kind === "partial")) {
      throw new Error(`moveElements failed: ${actionResult.kind}`);
    }
    const nextSource = actionResult.newSource;
    const parsed = parseTikz(nextSource, { recover: true });
    const incremental = session.evaluate({
      figure: parsed.figure,
      source: nextSource,
      hints: {
        trigger: "drag-element",
        changedSourceIds: actionResult.changedSourceIds ?? [targetSourceId]
      }
    });
    const full = evaluateTikzFigure(parsed.figure, nextSource);
    expect(incremental.semantic).toEqual(full);
    expect(incremental.stats.strategy).toBe("incremental");
  });

  it("uses selective replay for a small dependency closure with a long unrelated suffix", () => {
    const source = makeClosureFigureWithLongTail(200);
    const session = createIncrementalSemanticSession();
    const seededParsed = parseTikz(source, { recover: true });
    session.evaluate({
      figure: seededParsed.figure,
      source,
      hints: { trigger: "other" }
    });

    const changedSourceId = seededParsed.figure.body[1]?.id;
    expect(changedSourceId).toBeDefined();
    if (!changedSourceId) {
      throw new Error("Expected the B node statement");
    }

    const nextSource = source.replace("(1.5, -0.5)", "(2.1, -0.1)");
    const parsed = parseTikz(nextSource, { recover: true });
    const incremental = session.evaluate({
      figure: parsed.figure,
      source: nextSource,
      hints: {
        trigger: "drag-element",
        changedSourceIds: [changedSourceId]
      }
    });
    const full = evaluateTikzFigure(parsed.figure, nextSource);

    expect(incremental.semantic).toEqual(full);
    expect(incremental.stats.strategy).toBe("incremental");
    expect(incremental.stats.replayMode).toBe("selective");
    expect(incremental.stats.affectedStatementCount).toBe(2);
    expect(incremental.stats.corridorEndStatementIndex).toBe(3);
    expect(incremental.stats.recomputedStatementCount).toBe(4);
    expect(incremental.stats.reusedStatementCount).toBe(200);
  });

  it("advances the semantic cache after repeated selective replays", () => {
    let source = makeClosureFigureWithLongTail(80);
    const session = createIncrementalSemanticSession();
    const seededParsed = parseTikz(source, { recover: true });
    session.evaluate({
      figure: seededParsed.figure,
      source,
      hints: { trigger: "other" }
    });

    const changedSourceId = seededParsed.figure.body[1]?.id;
    expect(changedSourceId).toBeDefined();
    if (!changedSourceId) {
      throw new Error("Expected the B node statement");
    }

    for (const coordinate of ["(2.1, -0.1)", "(2.25, -0.2)", "(2.4, -0.35)"]) {
      source = source.replace(/\([^)]*, -?0\.[^)]+\)|\(1\.5, -0\.5\)/, coordinate);
      const parsed = parseTikz(source, { recover: true });
      const incremental = session.evaluate({
        figure: parsed.figure,
        source,
        hints: {
          trigger: "drag-element",
          changedSourceIds: [changedSourceId]
        }
      });
      const full = evaluateTikzFigure(parsed.figure, source);

      expect(incremental.semantic).toEqual(full);
      expect(incremental.stats.strategy).toBe("incremental");
      expect(incremental.stats.replayMode).toBe("selective");
      expect(incremental.stats.fallbackReason).toBeUndefined();
    }
  });

  it("refreshes dependency state after selective replay changes a producer name", () => {
    const source = makeClosureFigureWithLongTail(80);
    const session = createIncrementalSemanticSession();
    const seededParsed = parseTikz(source, { recover: true });
    session.evaluate({
      figure: seededParsed.figure,
      source,
      hints: { trigger: "other" }
    });

    const changedSourceId = findStatementIdBySourceSnippet(seededParsed.figure.body, source, "\\node[draw] (B)");
    const nextSource = source.replace("\\node[draw] (B)", "\\node[draw] (D)");
    const parsed = parseTikz(nextSource, { recover: true });
    const incremental = session.evaluate({
      figure: parsed.figure,
      source: nextSource,
      hints: {
        trigger: "drag-element",
        changedSourceIds: [changedSourceId]
      }
    });
    const full = evaluateTikzFigure(parsed.figure, nextSource);

    expect(incremental.semantic).toEqual(full);
    expect(incremental.stats.strategy).toBe("incremental");
    expect(incremental.stats.replayMode).toBe("suffix");
    expect(incremental.stats.fallbackReason).toBe("selective-replay-error");
    expect(incremental.semantic.dependencies).toEqual(full.dependencies);
  });

  it("uses a one-statement selective corridor for an isolated supported node", () => {
    const source = makeIsolatedNodeFigure();
    const session = createIncrementalSemanticSession();
    const seededParsed = parseTikz(source, { recover: true });
    session.evaluate({
      figure: seededParsed.figure,
      source,
      hints: { trigger: "other" }
    });

    const changedSourceId = seededParsed.figure.body[8]?.id;
    expect(changedSourceId).toBeDefined();
    if (!changedSourceId) {
      throw new Error("Expected isolated node statement");
    }

    const nextSource = source.replace("(10,10)", "(10.4,10.2)");
    const parsed = parseTikz(nextSource, { recover: true });
    const incremental = session.evaluate({
      figure: parsed.figure,
      source: nextSource,
      hints: {
        trigger: "drag-element",
        changedSourceIds: [changedSourceId]
      }
    });
    const full = evaluateTikzFigure(parsed.figure, nextSource);

    expect(incremental.semantic).toEqual(full);
    expect(incremental.stats.strategy).toBe("incremental");
    expect(incremental.stats.replayMode).toBe("selective");
    expect(incremental.stats.affectedStatementCount).toBe(1);
    expect(incremental.stats.recomputeFromStatementIndex).toBe(8);
    expect(incremental.stats.corridorEndStatementIndex).toBe(8);
    expect(incremental.stats.recomputedStatementCount).toBe(1);
    expect(incremental.stats.reusedStatementCount).toBe(8);
  });

  it("keeps later graphical scopes on the selective path", () => {
    const source = makeLaterScopeFigure();
    const session = createIncrementalSemanticSession();
    const seededParsed = parseTikz(source, { recover: true });
    session.evaluate({
      figure: seededParsed.figure,
      source,
      hints: { trigger: "other" }
    });

    const changedSourceId = findStatementIdBySourceSnippet(seededParsed.figure.body, source, "(B) at (2,0)");
    const nextSource = source.replace("(2,0)", "(2.4,0.5)");
    const parsed = parseTikz(nextSource, { recover: true });
    const incremental = session.evaluate({
      figure: parsed.figure,
      source: nextSource,
      hints: {
        trigger: "drag-element",
        changedSourceIds: [changedSourceId]
      }
    });
    const full = evaluateTikzFigure(parsed.figure, nextSource);

    expect(incremental.semantic).toEqual(full);
    expect(incremental.stats.replayMode).toBe("selective");
  });

  it("keeps nested graphical scopes on the selective path", () => {
    const source = makeNestedScopeFigure();
    const session = createIncrementalSemanticSession();
    const seededParsed = parseTikz(source, { recover: true });
    session.evaluate({
      figure: seededParsed.figure,
      source,
      hints: { trigger: "other" }
    });

    const changedSourceId = findStatementIdBySourceSnippet(seededParsed.figure.body, source, "(B) at (2,0)");
    const nextSource = source.replace("(2,0)", "(2.35,0.45)");
    const parsed = parseTikz(nextSource, { recover: true });
    const incremental = session.evaluate({
      figure: parsed.figure,
      source: nextSource,
      hints: {
        trigger: "drag-element",
        changedSourceIds: [changedSourceId]
      }
    });
    const full = evaluateTikzFigure(parsed.figure, nextSource);

    expect(incremental.semantic).toEqual(full);
    expect(incremental.stats.replayMode).toBe("selective");
  });

  it("falls back to suffix replay when a later scope contains unsupported commands", () => {
    const source = makeLaterScopeWithCommandFigure();
    const session = createIncrementalSemanticSession();
    const seededParsed = parseTikz(source, { recover: true });
    session.evaluate({
      figure: seededParsed.figure,
      source,
      hints: { trigger: "other" }
    });

    const changedSourceId = findStatementIdBySourceSnippet(seededParsed.figure.body, source, "(B) at (2,0)");
    const nextSource = source.replace("(2,0)", "(2.4,0.3)");
    const parsed = parseTikz(nextSource, { recover: true });
    const incremental = session.evaluate({
      figure: parsed.figure,
      source: nextSource,
      hints: {
        trigger: "drag-element",
        changedSourceIds: [changedSourceId]
      }
    });
    const full = evaluateTikzFigure(parsed.figure, nextSource);

    expect(incremental.semantic).toEqual(full);
    expect(incremental.stats.replayMode).toBe("suffix");
  });

  it("keeps unrelated later foreach-origin fragments on the selective path", () => {
    const source = makeLaterForeachFigure();
    const session = createIncrementalSemanticSession();
    const seededParsed = parseTikz(source, { recover: true });
    session.evaluate({
      figure: seededParsed.figure,
      source,
      hints: { trigger: "other" }
    });

    const changedSourceId = findStatementIdBySourceSnippet(seededParsed.figure.body, source, "(B) at (2,0)");
    const nextSource = source.replace("(2,0)", "(2.3,0.35)");
    const parsed = parseTikz(nextSource, { recover: true });
    const incremental = session.evaluate({
      figure: parsed.figure,
      source: nextSource,
      hints: {
        trigger: "drag-element",
        changedSourceIds: [changedSourceId]
      }
    });
    const full = evaluateTikzFigure(parsed.figure, nextSource);

    expect(incremental.semantic).toEqual(full);
    expect(incremental.stats.replayMode).toBe("selective");
  });

  it("keeps later macro-origin fragments out of the selective path", () => {
    const source = makeLaterMacroOriginFigure();
    const session = createIncrementalSemanticSession();
    const seededParsed = parseTikz(source, { recover: true });
    session.evaluate({
      figure: seededParsed.figure,
      source,
      hints: { trigger: "other" }
    });

    const changedSourceId = findStatementIdBySourceSnippet(seededParsed.figure.body, source, "(B) at (2,0)");
    const nextSource = source.replace("(2,0)", "(2.25,0.4)");
    const parsed = parseTikz(nextSource, { recover: true });
    const incremental = session.evaluate({
      figure: parsed.figure,
      source: nextSource,
      hints: {
        trigger: "drag-element",
        changedSourceIds: [changedSourceId]
      }
    });
    const full = evaluateTikzFigure(parsed.figure, nextSource);

    expect(incremental.semantic).toEqual(full);
    expect(incremental.stats.replayMode).toBe("suffix");
  });

  it("falls back to full strategy when opaque dependencies are reached", () => {
    const source = String.raw`\begin{tikzpicture}
  \foreach \x in {0,1}
    \draw (\x,0) -- (\x,1);
  \coordinate (A) at (0,2);
  \draw (A) -- (1,2);
\end{tikzpicture}`;
    const session = createIncrementalSemanticSession();
    const seededParsed = parseTikz(source, { recover: true });
    const seeded = session.evaluate({
      figure: seededParsed.figure,
      source,
      hints: { trigger: "other" }
    });
    const opaqueSourceId = seeded.semantic.dependencies.nodes
      .filter((node): node is Extract<(typeof seeded.semantic.dependencies.nodes)[number], { kind: "source" }> => node.kind === "source")
      .find((node) => node.opaque)?.sourceId;
    expect(opaqueSourceId).toBeDefined();
    if (!opaqueSourceId) {
      throw new Error("Expected an opaque source id");
    }

    const nextSource = source.replace("(0,2)", "(0.1,2)");
    const parsed = parseTikz(nextSource, { recover: true });
    const evaluated = session.evaluate({
      figure: parsed.figure,
      source: nextSource,
      hints: {
        trigger: "drag-element",
        changedSourceIds: [opaqueSourceId]
      }
    });
    expect(evaluated.stats.strategy).toBe("full");
    expect(evaluated.stats.fallbackReason).toBe("opaque-dependency");
  });

  it("falls back to full strategy when expanded statement structure changes", () => {
    const session = createIncrementalSemanticSession();
    const source = STARTUP_SOURCE;
    const seededParsed = parseTikz(source, { recover: true });
    session.evaluate({
      figure: seededParsed.figure,
      source,
      hints: { trigger: "other" }
    });

    const nextSource = source.replace(
      "\\end{tikzpicture}",
      "  \\draw (0,0) -- (1,1);\n\\end{tikzpicture}"
    );
    const parsed = parseTikz(nextSource, { recover: true });
    const evaluated = session.evaluate({
      figure: parsed.figure,
      source: nextSource,
      hints: {
        trigger: "drag-element",
        changedSourceIds: ["path:0"]
      }
    });
    expect(evaluated.stats.strategy).toBe("full");
    expect(evaluated.stats.fallbackReason).toBe("statement-structure-changed");
  });

  it("falls back to full strategy for unknown changed source ids", () => {
    const session = createIncrementalSemanticSession();
    const source = STARTUP_SOURCE;
    const seededParsed = parseTikz(source, { recover: true });
    session.evaluate({
      figure: seededParsed.figure,
      source,
      hints: { trigger: "other" }
    });

    const nextSource = source.replace("(1.5, -0.5)", "(1.55, -0.5)");
    const parsed = parseTikz(nextSource, { recover: true });
    const evaluated = session.evaluate({
      figure: parsed.figure,
      source: nextSource,
      hints: {
        trigger: "drag-element",
        changedSourceIds: ["unknown-source-id"]
      }
    });
    expect(evaluated.stats.strategy).toBe("full");
    expect(evaluated.stats.fallbackReason).toBe("unmapped-affected-source");
  });

  it("matches full evaluation when normal edits occur beside generated content", () => {
    const sources = [
      String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \foreach \x in {0,1} \draw[red] (\x,1) -- ++(1,0);
\end{tikzpicture}`,
      String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \draw (0,1) foreach \x in {1,2} { -- (\x,1) };
\end{tikzpicture}`,
      String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
  \newcommand{\mypath}{\draw (0,1) foreach \x in {1,2} { -- (\x,1) };}
  \mypath
\end{tikzpicture}`
    ];

    for (const source of sources) {
      expectFullAndIncrementalEqualAfterMove(source);
    }
  });

  it("does not shift generated identity spans when original source moves before generated content", () => {
    const source = String.raw`\begin{tikzpicture}
  \foreach \x in {0,1} \draw[red] (\x,0) -- ++(1,0);
  \draw (0,1) foreach \x in {1,2} { -- (\x,1) };
\end{tikzpicture}`;
    const movedSource = source.replace("\\begin{tikzpicture}\n", "\\begin{tikzpicture}\n  % inserted prefix\n");
    const before = evaluateFull(source).semantic;
    const after = evaluateFull(movedSource).semantic;

    const beforeIdentitySpans = [
      ...before.scene.elements.map((element) => element.identityRef?.sourceSpan),
      ...before.editHandles.map((handle) => handle.identityRef?.sourceSpan)
    ].filter(Boolean);
    const afterIdentitySpans = [
      ...after.scene.elements.map((element) => element.identityRef?.sourceSpan),
      ...after.editHandles.map((handle) => handle.identityRef?.sourceSpan)
    ].filter(Boolean);

    expect(afterIdentitySpans).toEqual(beforeIdentitySpans);
  });
});

function expectFullAndIncrementalEqualAfterMove(source: string): void {
  const session = createIncrementalSemanticSession();
  session.evaluate({
    figure: parseTikz(source, { recover: true }).figure,
    source,
    hints: { trigger: "other" }
  });

  const current = evaluateFull(source);
  const handle = current.semantic.editHandles.find((candidate) => !candidate.identityRef && candidate.rewriteMode !== "unsupported");
  expect(handle).toBeDefined();
  if (!handle) {
    return;
  }

  const actionResult = applyEditAction(source, current.semantic.editHandles, {
    kind: "moveHandle",
    handleId: handle.id,
    newWorld: wp(handle.world.x + 2, handle.world.y + 1)
  });
  expect(actionResult.kind === "success" || actionResult.kind === "partial").toBe(true);
  if (!(actionResult.kind === "success" || actionResult.kind === "partial")) {
    return;
  }

  const parsed = parseTikz(actionResult.newSource, { recover: true });
  const incremental = session.evaluate({
    figure: parsed.figure,
    source: actionResult.newSource,
    hints: {
      trigger: "drag-handle",
      changedSourceIds: actionResult.changedSourceIds ?? [handle.sourceRef.sourceId]
    }
  });
  const full = evaluateTikzFigure(parsed.figure, actionResult.newSource);
  expect(incremental.semantic).toEqual(full);
  expect(incremental.stats.strategy).toBe("incremental");
}

function evaluateFull(
  source: string,
  options: EvaluateOptions = {}
): {
  parsed: ReturnType<typeof parseTikz>;
  semantic: ReturnType<typeof evaluateTikzFigure>;
} {
  const parsed = parseTikz(source, { recover: true });
  const semantic = evaluateTikzFigure(parsed.figure, source, options);
  return {
    parsed,
    semantic
  };
}

function pickMoveSourceId(handles: readonly EditHandle[]): string {
  const candidate =
    handles.find((handle) => handle.kind === "node-position" && handle.rewriteMode !== "unsupported") ??
    handles.find((handle) => handle.rewriteMode !== "unsupported");
  if (!candidate) {
    throw new Error("Expected at least one rewritable handle");
  }
  return candidate.sourceRef.sourceId;
}

function pickHandleForDrag(handles: readonly EditHandle[]): EditHandle {
  const candidate =
    handles.find((handle) => handle.kind === "path-point" && handle.rewriteMode !== "unsupported") ??
    handles.find((handle) => handle.kind === "node-position" && handle.rewriteMode !== "unsupported") ??
    handles.find((handle) => handle.rewriteMode !== "unsupported");
  if (!candidate) {
    throw new Error("Expected at least one rewritable handle");
  }
  return candidate;
}

const STARTUP_SOURCE = String.raw`\begin{tikzpicture}[every node/.style={fill=blue!10}]
  \draw (-3,-3) rectangle (3,3);

  \draw (-2.5, 2.5) -- (2.5, 2.5);

  \node[draw] (A) at (-1, -1) {A};
  \node[draw] (B) at (1.5, -0.5) {B};
  \node[draw] (C) at (0, 1.5) {C};
  \draw (A) edge (B)
        (B) edge (C)
        (C) edge (A);
\end{tikzpicture}`;

function makeClosureFigureWithLongTail(unrelatedPathCount: number): string {
  const lines = [
    "\\begin{tikzpicture}",
    "  \\node[draw] (A) at (-1, -1) {A};",
    "  \\node[draw] (B) at (1.5, -0.5) {B};",
    "  \\node[draw] (C) at (0, 1.5) {C};",
    "  \\draw (A) edge (B)",
    "        (B) edge (C)",
    "        (C) edge (A);"
  ];
  for (let index = 0; index < unrelatedPathCount; index += 1) {
    lines.push(`  \\draw (${index},0) -- (${index + 1},1);`);
  }
  lines.push("\\end{tikzpicture}");
  return lines.join("\n");
}

function makeIsolatedNodeFigure(): string {
  const lines = ["\\begin{tikzpicture}"];
  for (let index = 0; index < 8; index += 1) {
    lines.push(`  \\draw (${index},0) -- (${index + 1},1);`);
  }
  lines.push("  \\node[draw] (Solo) at (10,10) {Solo};");
  lines.push("\\end{tikzpicture}");
  return lines.join("\n");
}

function makeLaterScopeFigure(): string {
  return String.raw`\begin{tikzpicture}
  \node[draw] (A) at (0,0) {A};
  \node[draw] (B) at (2,0) {B};
  \draw (A) -- (B);
  \begin{scope}[shift={(10,0)}]
    \draw (0,0) rectangle (2,1);
    \node[draw] at (1,0.5) {Box};
  \end{scope}
\end{tikzpicture}`;
}

function makeNestedScopeFigure(): string {
  return String.raw`\begin{tikzpicture}
  \node[draw] (A) at (0,0) {A};
  \node[draw] (B) at (2,0) {B};
  \draw (A) -- (B);
  \begin{scope}[shift={(10,0)}]
    \draw (0,0) rectangle (2,1);
    \begin{scope}[rotate=20]
      \node[draw] at (1,2) {Nested};
    \end{scope}
  \end{scope}
\end{tikzpicture}`;
}

function makeLaterScopeWithCommandFigure(): string {
  return String.raw`\begin{tikzpicture}
  \node[draw] (A) at (0,0) {A};
  \node[draw] (B) at (2,0) {B};
  \draw (A) -- (B);
  \begin{scope}[shift={(10,0)}]
    \tikzset{every node/.style={fill=red!20}}
    \node[draw] at (1,0.5) {Box};
  \end{scope}
\end{tikzpicture}`;
}

function makeLaterForeachFigure(): string {
  return String.raw`\begin{tikzpicture}
  \node[draw] (A) at (0,0) {A};
  \node[draw] (B) at (2,0) {B};
  \draw (A) -- (B);
  \foreach \x in {0,1,2,3} {
    \draw (\x,3) circle (0.2);
  }
\end{tikzpicture}`;
}

function makeLaterMacroOriginFigure(): string {
  return String.raw`\begin{tikzpicture}
  \def\laterbox{\draw (5,0) rectangle (6,1);}
  \node[draw] (A) at (0,0) {A};
  \node[draw] (B) at (2,0) {B};
  \draw (A) -- (B);
  \laterbox
\end{tikzpicture}`;
}

function findStatementIdBySourceSnippet(
  statements: readonly Statement[],
  source: string,
  snippet: string
): string {
  const statement = statements.find((candidate) =>
    source.slice(candidate.span.from, candidate.span.to).includes(snippet)
  );
  if (!statement) {
    throw new Error(`Could not find statement containing snippet: ${snippet}`);
  }
  return statement.id;
}
