import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseTikz } from "../packages/core/src/parser/index.js";
import { documentKindForSource } from "../packages/app/src/store/workspace-state.js";
import { computeSnapshot, type SessionSnapshot } from "../packages/app/src/compute.js";

it("keeps actual paper visual edits equivalent to fresh source and geometry", async () => {
  const source = readFileSync(new URL("./papers/equal_shares_arxiv_v2.tex", import.meta.url), "utf8");
  const target = String.raw`\draw[thick,->,magenta] (0.0, 0.0) -- (0.0, 4.5);`;
  const offset = source.indexOf(target);
  expect(offset).toBeGreaterThan(0);
  const activeRootId = parseTikz(source, { recover: true, includeContextDefinitions: true }).figures
    .find(figure => offset >= figure.span.from && offset < figure.span.to)!.id;
  const documentId = "classification-paper-parity";
  const seed = await computeSnapshot({ id: "seed", documentId, source, sourceRevision: 0, activeRootId });
  const paths = (snapshot: SessionSnapshot) => snapshot.scene?.elements
    .filter(element => element.kind === "Path").map(element => element.commands);
  const handles = (snapshot: SessionSnapshot) => snapshot.editHandles.map(handle => ({
    ...handle, sourceRef: { ...handle.sourceRef, sourceFingerprint: undefined }
  }));
  for (const [index, endpoint] of ["4.6", "4.7"].entries()) {
    const edited = source.replace(target, target.replace("4.5", endpoint));
    expect(documentKindForSource(edited)).toBe("tikz");
    const actual = await computeSnapshot({ id: `edit-${index}`, documentId, source: edited,
      sourceRevision: index + 1, activeRootId, inferSourceChanges: true });
    const fresh = await computeSnapshot({ id: `fresh-${index}`, documentId: `${documentId}-fresh-${index}`,
      source: edited, sourceRevision: index + 1, activeRootId });
    if (index === 0) {
      expect(actual.snapshot.incremental?.reusedStatementCount).toBeGreaterThan(0);
    }
    expect(actual.snapshot.source).toBe(edited);
    expect(actual.snapshot.scene).not.toBeNull();
    expect(actual.snapshot.figures).toEqual(fresh.snapshot.figures);
    expect(paths(actual.snapshot)).not.toEqual(paths(seed.snapshot));
    expect(paths(actual.snapshot)).toEqual(paths(fresh.snapshot));
    expect(handles(actual.snapshot)).toEqual(handles(fresh.snapshot));
    expect(actual.snapshot.svg?.viewBox).toEqual(fresh.snapshot.svg?.viewBox);
    expect(actual.snapshot.semanticResult?.featureUsage).toBeDefined();
    expect(actual.snapshot.semanticResult?.featureUsage).toEqual(fresh.snapshot.semanticResult?.featureUsage);
    expect(actual.diagnostics).toEqual(fresh.diagnostics);
  }
}, 30_000);
