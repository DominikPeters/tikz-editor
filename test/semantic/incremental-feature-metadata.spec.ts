import { describe, expect, it } from "vitest";
import { parseTikz } from "../../packages/core/src/parser/index.js";
import { computeMinimalReplacementPatch } from "../../packages/core/src/edit/patch.js";
import { evaluateTikzFigure } from "../../packages/core/src/semantic/evaluate.js";
import { createIncrementalSemanticSession } from "../../packages/core/src/semantic/incremental.js";
import { computeSnapshot } from "../../packages/app/src/compute.js";

const plain = String.raw`\draw (4,0)--(5,0);`;
const diamond = String.raw`\node[draw,diamond] at (0,0) {A};`;
const rectangle = diamond.replace("diamond", "rectangle");
const picture = (body: string[]) => `\\begin{tikzpicture}\n${body.join("\n")}\n\\end{tikzpicture}`;

function change(session: ReturnType<typeof createIncrementalSemanticSession>, source: string, next: string, index: number) {
  const oldParsed = parseTikz(source, { recover: true });
  const parsed = parseTikz(next, { recover: true });
  const actual = session.evaluate({ figure: parsed.figure, source: next,
    hints: { changedSourceIds: [oldParsed.figure.body[index].id], sourcePatches: [computeMinimalReplacementPatch(source, next)] } });
  const fresh = evaluateTikzFigure(parsed.figure, next);
  expect(actual.semantic.featureUsage).toEqual(fresh.featureUsage);
  expect(actual.semantic.scene.requiredTikzLibraries).toEqual(fresh.scene.requiredTikzLibraries);
  expect(actual.semantic.diagnostics).toEqual(fresh.diagnostics);
  expect(actual.stats.replayMode).toBe("selective");
  expect(actual.stats.reusedStatementCount).toBeGreaterThan(0);
  return actual;
}

function seed(source: string) {
  const session = createIncrementalSemanticSession();
  session.evaluate({ figure: parseTikz(source, { recover: true }).figure, source });
  return session;
}

describe("incremental feature and library contributions", () => {
  it.each([
    [diamond, rectangle],
    [diamond.replace("diamond", "star"), rectangle],
    [String.raw`\draw[-{Stealth}] (0,0)--(1,0);`, String.raw`\draw (0,0)--(1,0);`],
    [String.raw`\path[pattern=north east lines] (0,0) rectangle (1,1);`, String.raw`\path[fill=red] (0,0) rectangle (1,1);`],
    [String.raw`\draw[cm={1,0,0,1,(0,0)}] (0,0)--(1,0);`, String.raw`\draw[thick] (0,0)--(1,0);`]
  ])("removes the last contribution from %s", (before, after) => {
    const source = picture([before, plain]);
    change(seed(source), source, picture([after, plain]), 0);
  });

  it.each([0, 1, 9, 16])("retains an unchanged provider when editing index %i", index => {
    const body = Array.from({ length: 20 }, () => plain);
    body[index] = diamond;
    body[index < 10 ? 18 : 1] = diamond;
    const source = picture(body); const session = seed(source);
    body[index] = rectangle;
    const actual = change(session, source, picture(body), index);
    expect(actual.semantic.featureUsage.shape_diamond).toBe("used-supported");
    expect(actual.semantic.scene.requiredTikzLibraries).toContain("shapes.geometric");
  });

  it.each([9, 16])("removes the last provider beyond checkpoint %i", index => {
    const body = Array.from({ length: 20 }, () => plain); body[index] = diamond;
    const source = picture(body); const session = seed(source); body[index] = rectangle;
    const actual = change(session, source, picture(body), index);
    expect(actual.stats.recomputeFromStatementIndex).toBeGreaterThan(0);
    expect(actual.semantic.featureUsage.shape_diamond).toBe("unused");
    expect(actual.semantic.scene.requiredTikzLibraries).not.toContain("shapes.geometric");
  });

  it("keeps current contributions through repeated edits using later checkpoints", () => {
    const body = Array.from({ length: 24 }, () => rectangle); body[0] = diamond; body[17] = diamond;
    let source = picture(body); const session = seed(source);
    for (const [index, replacement] of [[0, rectangle], [17, rectangle], [9, diamond], [9, rectangle], [17, diamond], [0, diamond], [17, rectangle], [0, rectangle]] as const) {
      body[index] = replacement; const next = picture(body); change(session, source, next, index); source = next;
    }
  });

  it.each(["north east lines", "unknown pattern"])("rebuilds support status when changing pattern %s", replacement => {
    const first = String.raw`\path[pattern=unknown pattern] (0,0) rectangle (1,1);`;
    const suffix = String.raw`\path[pattern=north east lines] (3,0) rectangle (4,1);`;
    const source = picture([first, suffix, plain]);
    const next = source.replace("pattern=unknown pattern", `pattern=${replacement}`);
    change(seed(source), source, next, 0);
  });

  it("removes unsupported usage while preserving a supported suffix provider", () => {
    const source = picture([String.raw`\path[pattern=unknown pattern] (0,0) rectangle (1,1);`, String.raw`\path[pattern=north east lines] (3,0) rectangle (4,1);`, plain]);
    const actual = change(seed(source), source, source.replace("pattern=unknown pattern", "fill=blue"), 0);
    expect(actual.semantic.featureUsage.path_patterns).toBe("used-supported");
  });

  it("leaves a fork's provider inventory independent", () => {
    const source = picture([diamond, plain, plain]); const session = seed(source); const fork = session.fork();
    const next = picture([rectangle, plain, plain]); change(fork, source, next, 0);
    const actual = change(session, source, source.replace("(4,0)", "(4.2,0)"), 1);
    expect(actual.semantic.featureUsage.shape_diamond).toBe("used-supported");
  });

  it("updates actual app compute metadata without dropping selective reuse", async () => {
    const source = picture([diamond, plain]); const next = picture([rectangle, plain]);
    await computeSnapshot({ id: "metadata-seed", documentId: "metadata", source, sourceRevision: 0 });
    const actual = await computeSnapshot({ id: "metadata-next", documentId: "metadata", source: next, sourceRevision: 1, inferSourceChanges: true });
    const fresh = await computeSnapshot({ id: "metadata-fresh", documentId: "metadata-fresh", source: next, sourceRevision: 1 });
    expect(actual.snapshot.incremental?.replayMode).toBe("selective");
    expect(actual.snapshot.incremental?.reusedStatementCount).toBeGreaterThan(0);
    expect(actual.snapshot.semanticResult?.featureUsage).toEqual(fresh.snapshot.semanticResult?.featureUsage);
    expect(actual.snapshot.scene?.requiredTikzLibraries).toEqual(fresh.snapshot.scene?.requiredTikzLibraries);
  });

  it("does not turn a loaded library definition into a stale inferred requirement", () => {
    const source = String.raw`\usetikzlibrary{shapes.geometric}` + "\n" + picture([diamond, plain]);
    const parsed = parseTikz(source, { recover: true, includeContextDefinitions: true });
    expect(parsed.figure.body.some(statement => statement.kind === "TikzLibrary")).toBe(true);
    const session = createIncrementalSemanticSession();
    session.evaluate({ figure: parsed.figure, source });
    const next = source.replace("diamond", "rectangle");
    const nextParsed = parseTikz(next, { recover: true, includeContextDefinitions: true });
    const actual = session.evaluate({ figure: nextParsed.figure, source: next,
      hints: { changedSourceIds: [parsed.figure.body.find(statement => statement.kind === "Path")!.id], sourcePatches: [computeMinimalReplacementPatch(source, next)] }
    });
    const fresh = evaluateTikzFigure(nextParsed.figure, next);
    expect(actual.semantic.featureUsage).toEqual(fresh.featureUsage);
    expect(actual.semantic.scene.requiredTikzLibraries).toEqual(fresh.scene.requiredTikzLibraries);
    expect(actual.semantic.scene.requiredTikzLibraries).not.toContain("shapes.geometric");
    expect(actual.stats.replayMode).toBe("selective");
  });

  it("keeps its committed feature inventory after cooperative prefix reconstruction is aborted", async () => {
    const body = Array.from({ length: 24 }, () => rectangle); body[17] = diamond;
    const source = picture(body); const session = seed(source); body[17] = rectangle;
    const next = picture(body); const parsed = parseTikz(next, { recover: true }); const controller = new AbortController();
    await expect(session.evaluateAsync({ figure: parsed.figure, source: next,
      hints: { changedSourceIds: [parseTikz(source, { recover: true }).figure.body[17].id], sourcePatches: [computeMinimalReplacementPatch(source, next)] }
    }, { signal: controller.signal, budgetMs: 0, yieldControl: async () => { controller.abort(); } })).rejects.toMatchObject({ name: "AbortError" });
    const actual = change(session, source, source.replace("(0,0)", "(0.2,0)"), 0);
    expect(actual.semantic.featureUsage.shape_diamond).toBe("used-supported");
    change(session, source.replace("(0,0)", "(0.2,0)"), next.replace("(0,0)", "(0.2,0)"), 17);
  });


  it("reconstructs metadata for suffix replay past a retained prefix checkpoint", () => {
    const body = Array.from({ length: 20 }, () => rectangle); body[9] = diamond; body.push(String.raw`\unknowncommand`);
    const source = picture(body); const session = seed(source); body[9] = rectangle; const next = picture(body);
    const parsed = parseTikz(next, { recover: true });
    const actual = session.evaluate({ figure: parsed.figure, source: next,
      hints: { changedSourceIds: [parseTikz(source, { recover: true }).figure.body[9].id], sourcePatches: [computeMinimalReplacementPatch(source, next)] }
    });
    const fresh = evaluateTikzFigure(parsed.figure, next);
    expect(actual.stats.replayMode).toBe("suffix");
    expect(actual.stats.reusedStatementCount).toBeGreaterThan(0);
    expect(actual.semantic.featureUsage).toEqual(fresh.featureUsage);
    expect(actual.semantic.scene.requiredTikzLibraries).toEqual(fresh.scene.requiredTikzLibraries);
  });

});
