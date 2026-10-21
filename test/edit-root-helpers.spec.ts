import { describe, expect, it } from "vitest";
import { parseEditableTargetId, isAdornmentTargetId } from "../packages/core/src/edit/editable-targets.js";
import { isMatrixCellWritableKey } from "../packages/core/src/edit/matrix-editing.js";
import { parseTikzForEdit, sourceFingerprintForEdit } from "../packages/core/src/edit/parse-options.js";
import { formatCoordinate, formatPolarCoordinate } from "../packages/core/src/edit/writer/format.js";

describe("edit root helper coverage", () => {
  it("reuses parse results from analysis views and sessions", () => {
    const parseResult = { ast: { kind: "sentinel" } };
    const source = String.raw`\begin{tikzpicture}\draw (0,0) -- (1,0);\end{tikzpicture}`;

    expect(parseTikzForEdit(source, {
      activeFigureId: "figure-1",
      analysisView: {
        source,
        activeFigureId: "figure-1",
        parseResult
      }
    } as never)).toBe(parseResult);

    const ensured = { parseResult: { ast: { kind: "session" } } };
    const requested: Array<{ source: string; activeFigureId: string | null | undefined }> = [];
    const sessionResult = parseTikzForEdit(source, {
      activeFigureId: "figure-2",
      analysisView: {
        source,
        activeFigureId: "different",
        parseResult
      },
      analysisSession: {
        ensure(nextSource: string, options: { activeFigureId?: string | null }) {
          requested.push({ source: nextSource, activeFigureId: options.activeFigureId });
          return ensured;
        }
      }
    } as never);

    expect(sessionResult).toBe(ensured.parseResult);
    expect(requested).toEqual([{ source, activeFigureId: "figure-2" }]);
    expect(parseTikzForEdit(source).source).toBe(source);
  });

  it("honors supplied source fingerprints", () => {
    const source = "source";

    expect(sourceFingerprintForEdit(source, { sourceFingerprint: "known-fingerprint" })).toBe("known-fingerprint");
    expect(sourceFingerprintForEdit(source)).toBe(sourceFingerprintForEdit(source));
  });

  it("formats cartesian and polar coordinates while preserving original trivia", () => {
    expect(formatCoordinate("( [xshift=1pt]  0 ,  1 )", "2", "3")).toBe("( [xshift=1pt]  2,  3)");
    expect(formatCoordinate("(0, 1)", "2", "3")).toBe("(2, 3)");
    expect(formatCoordinate("(0,1)", "2", "3")).toBe("(2,3)");
    expect(formatCoordinate("invalid, coordinate", "2", "3")).toBe("(2, 3)");
    expect(formatCoordinate("invalid", "2", "3")).toBe("(2,3)");

    expect(formatPolarCoordinate("( [turn]  30 :  1cm )", "45", "2cm")).toBe("( [turn]  45:  2cm)");
    expect(formatPolarCoordinate("(30: 1cm)", "45", "2cm")).toBe("(45: 2cm)");
    expect(formatPolarCoordinate("(30:1cm)", "45", "2cm")).toBe("(45:2cm)");
    expect(formatPolarCoordinate("invalid: polar", "45", "2cm")).toBe("(45: 2cm)");
    expect(formatPolarCoordinate("invalid", "45", "2cm")).toBe("(45:2cm)");
  });

  it("parses editable target ids and matrix cell writability", () => {
    expect(parseEditableTargetId(" path:0 ")).toEqual({ kind: "statement", id: "path:0" });
    expect(parseEditableTargetId("node-adornment:node:0:2:label:3")).toEqual({
      kind: "node-adornment",
      id: "node-adornment:node:0:2:label:3",
      ownerNodeId: "node:0:2",
      adornmentKind: "label",
      adornmentIndex: 3
    });
    expect(parseEditableTargetId("node-adornment:node:0:2:pin:0")).toMatchObject({
      kind: "node-adornment",
      adornmentKind: "pin",
      adornmentIndex: 0
    });
    expect(isAdornmentTargetId("node-adornment:node:0:2:pin:0")).toBe(true);
    expect(isAdornmentTargetId("node:0")).toBe(false);
    expect(isMatrixCellWritableKey()).toBe(true);
  });
});
