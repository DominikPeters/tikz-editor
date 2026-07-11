import { afterEach, describe, expect, it } from "vitest";

import type { SessionSnapshot } from "../packages/app/src/compute.js";
import { resetSharedEditAnalysisManager } from "../packages/app/src/edit-analysis-manager.js";
import { buildEditParseOptions } from "../packages/app/src/edit-parse-options.js";
import { parseTikzForEdit } from "../packages/core/src/edit/parse-options.js";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";

const SOURCE = String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,0);
\end{tikzpicture}`;
const DOCUMENT_ID = "doc-edit-options";
const SOURCE_REVISION = 7;

function makeSnapshot(): { snapshot: SessionSnapshot; sourceFingerprint: string } {
  const rendered = renderTikzToSvg(SOURCE);
  const sourceFingerprint = `source-revision:${DOCUMENT_ID}:${SOURCE_REVISION}:${SOURCE.length}`;
  return {
    sourceFingerprint,
    snapshot: {
      source: SOURCE,
      revision: 11,
      figures: rendered.parse.figures,
      activeFigureId: rendered.parse.activeFigureId,
      editHandles: rendered.semantic.editHandles.map((handle) => ({
        ...handle,
        sourceRef: {
          ...handle.sourceRef,
          sourceFingerprint
        }
      })),
      scene: rendered.semantic.scene,
      svg: rendered.svg,
      svgModel: rendered.svg.model,
      parseResult: rendered.parse,
      semanticResult: rendered.semantic,
      incremental: null
    }
  };
}

afterEach(() => {
  resetSharedEditAnalysisManager();
});

describe("buildEditParseOptions", () => {
  it("normalizes figure selection and validates revision fingerprints", () => {
    const { snapshot, sourceFingerprint } = makeSnapshot();
    expect(snapshot.editHandles.length).toBeGreaterThan(0);

    const options = buildEditParseOptions({
      documentId: DOCUMENT_ID,
      sourceRevision: SOURCE_REVISION,
      source: SOURCE,
      activeFigureId: null,
      snapshot,
      analysis: "none",
      overrides: {
        indentSize: 4,
        propertyWriteMode: "preview"
      }
    });

    expect(options).toEqual({
      activeFigureId: undefined,
      indentSize: 4,
      propertyWriteMode: "preview",
      sourceFingerprint
    });

    const conflictingSnapshot: SessionSnapshot = {
      ...snapshot,
      editHandles: snapshot.editHandles.map((handle, index) =>
        index === 0
          ? {
              ...handle,
              sourceRef: {
                ...handle.sourceRef,
                sourceFingerprint: "source-revision:other:1:1"
              }
            }
          : handle
      )
    };
    expect(buildEditParseOptions({
      documentId: DOCUMENT_ID,
      sourceRevision: SOURCE_REVISION,
      source: SOURCE,
      activeFigureId: null,
      snapshot: conflictingSnapshot,
      analysis: "none"
    }).sourceFingerprint).toBeUndefined();

    const multiFigureSnapshot: SessionSnapshot = {
      ...snapshot,
      figures: [...snapshot.figures, ...snapshot.figures]
    };
    expect(buildEditParseOptions({
      documentId: DOCUMENT_ID,
      sourceRevision: SOURCE_REVISION,
      source: SOURCE,
      activeFigureId: null,
      snapshot: multiFigureSnapshot,
      analysis: "none"
    }).activeFigureId).toBeNull();
  });

  it("uses the same normalized figure key for shared analysis and edit parsing", () => {
    const { snapshot } = makeSnapshot();
    const options = buildEditParseOptions({
      documentId: DOCUMENT_ID,
      sourceRevision: SOURCE_REVISION,
      source: SOURCE,
      activeFigureId: null,
      snapshot,
      analysis: "shared"
    });

    expect(options.activeFigureId).toBeUndefined();
    expect(options.analysisView?.activeFigureId).toBeUndefined();
    expect(options.analysisSession).not.toBeNull();
    expect(parseTikzForEdit(SOURCE, options)).toBe(options.analysisView?.parseResult);
  });
});
