import { describe, expect, it } from "vitest";

import { worldPoint } from "../packages/core/src/coords/points.js";
import { pt } from "../packages/core/src/coords/scalars.js";
import { worldTransform } from "../packages/core/src/coords/transforms.js";
import { createSemanticContext, writeNamedCoordinate, writeNamedNodeGeometry } from "../packages/core/src/semantic/context.js";
import { evaluateCoordinate, evaluateRawCoordinate } from "../packages/core/src/semantic/coords/evaluate.js";
import {
  parseCoordinateLike,
  parseLength,
  parseLengthWithInfo
} from "../packages/core/src/semantic/coords/parse-length.js";
import { defaultStyle } from "../packages/core/src/semantic/style/defaults.js";
import { evaluateSemantic } from "./semantic/helpers.js";

describe("parseLength units", () => {
  it("treats px as equivalent to bp", () => {
    const bp = parseLength("1bp", "pt");
    const px = parseLength("1px", "pt");

    expect(bp).not.toBeNull();
    expect(px).not.toBeNull();
    if (bp == null || px == null) {
      return;
    }
    expect(px).toBeCloseTo(bp, 10);
  });

  it("accepts xshift lengths in px without invalid-length diagnostics", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[anchor=east, xshift=-5px] at (0,0) {$0$};
\end{tikzpicture}`;
    const result = evaluateSemantic(source);

    expect(result.diagnostics.some((diagnostic) => (diagnostic.code ?? "").startsWith("invalid-xshift"))).toBe(false);
  });

  it("tracks explicit-unit metadata through wrapped expressions and coordinate-like pairs", () => {
    expect(parseLengthWithInfo("{{1.5e2 pt}}", "cm")).toEqual({
      value: 150,
      hasExplicitUnit: true
    });
    expect(parseLengthWithInfo("{1.5e+2}", "pt")?.hasExplicitUnit).toBe(false);
    expect(parseLengthWithInfo("{1.5e+}", "pt")).toBeNull();
    expect(parseLengthWithInfo("{{1pt}{2pt}}", "pt")).toBeNull();
    expect(parseCoordinateLike(" ( {1,2}, {(3,4)} ) ")).toEqual({
      x: "{1,2}",
      y: "{(3,4)}"
    });
    expect(parseCoordinateLike("(only-one-part)")).toBeNull();
    expect(parseCoordinateLike("1,2")).toBeNull();
  });

  it("evaluates defensive raw-coordinate branches with a real semantic context", () => {
    const context = createSemanticContext(defaultStyle(), worldTransform(1, 0, 0, 1, 0, 0));

    const relativeWithoutCurrent = evaluateRawCoordinate("(1,0)", context, "+");
    expect(relativeWithoutCurrent.kind).toBe("invalid");
    expect(relativeWithoutCurrent.diagnostics).toContain("relative-coordinate-without-current-point");

    context.currentPoint = worldPoint(pt(5), pt(7));
    const relative = evaluateRawCoordinate("(1,2)", context, "++");
    expect(relative.world?.x).toBeCloseTo(33.4527559055);
    expect(relative.world?.y).toBeCloseTo(63.905511811);
    expect(relative.advancesCurrentPoint).toBe(true);

    const calc = evaluateRawCoordinate("($ (0,0) + (2,0)!0.25!(2,4) - (1,1) $)", context);
    expect(calc.world?.x).toBeCloseTo(28.4527559055);
    expect(calc.world?.y).toBeCloseTo(0);

    const badPerpendicular = evaluateRawCoordinate(
      "(perpendicular cs:horizontal line through={(missing)}, vertical line through={(0,0)})",
      context
    );
    expect(badPerpendicular.kind).toBe("invalid");
    expect(badPerpendicular.diagnostics).toContain("invalid-explicit-coordinate:(perpendicular cs:horizontal line through={(missing)}, vertical line through={(0,0)})");

    const parallelIntersection = evaluateRawCoordinate(
      "(intersection cs:first line={(0,0)--(1,0)}, second line={(0,1)--(1,1)})",
      context
    );
    expect(parallelIntersection.kind).toBe("invalid");
    expect(parallelIntersection.diagnostics).toContain("invalid-explicit-coordinate:(intersection cs:first line={(0,0)--(1,0)}, second line={(0,1)--(1,1)})");

    const unsupportedSolution = evaluateRawCoordinate(
      "(intersection cs:first line={(0,0)--(1,1)}, second line={(0,1)--(1,0)}, solution=2)",
      context
    );
    expect(unsupportedSolution.diagnostics).toContain("invalid-intersection-solution:2");

    const zCoordinate = evaluateRawCoordinate("(1,2,3)", context);
    expect(zCoordinate.world).toEqual({ x: 28.4527559055, y: 56.905511811 });
    expect(zCoordinate.diagnostics).toContain("unsupported-coordinate-z-component");

    const syntheticXyzWithoutZ = evaluateCoordinate(
      {
        kind: "Coordinate",
        id: "synthetic",
        span: { from: 0, to: 5 },
        raw: "(1,2)",
        form: "xyz",
        x: "1",
        y: "2",
        options: undefined
      } as never,
      context
    );
    expect(syntheticXyzWithoutZ.world).toEqual({ x: 28.4527559055, y: 56.905511811 });

    const badCanvas = evaluateRawCoordinate("(canvas cs:x=nope,y=2cm)", context);
    expect(badCanvas.kind).toBe("invalid");
    expect(badCanvas.diagnostics).toContain("invalid-explicit-coordinate:(canvas cs:x=nope,y=2cm)");

    const badZ = evaluateRawCoordinate("(1,2,nope)", context);
    expect(badZ.kind).toBe("invalid");
    expect(badZ.diagnostics).toContain("invalid-xyz-coordinate:(1,2,nope)");

    const emptyCalc = evaluateRawCoordinate("($ $)", context);
    expect(emptyCalc.kind).toBe("invalid");
    expect(emptyCalc.diagnostics).toContain("invalid-calc-coordinate");

    const emptyNamed = evaluateRawCoordinate("()", context);
    expect(emptyNamed.kind).toBe("invalid");
    expect(emptyNamed.diagnostics.length).toBeGreaterThan(0);

    expect(evaluateRawCoordinate("([red]1,2)", context).kind).toBe("transformed");
  });

  it("evaluates explicit coordinate systems and scoped numeric node anchors", () => {
    const context = createSemanticContext(defaultStyle(), worldTransform(1, 0, 0, 1, 10, -5));

    const canvas = evaluateRawCoordinate("(canvas cs:x=1cm,y={2cm})", context);
    expect(canvas.kind).toBe("transformed");
    expect(canvas.world?.x).toBeCloseTo(38.4527559055);
    expect(canvas.world?.y).toBeCloseTo(51.905511811);

    const perpendicular = evaluateRawCoordinate(
      "(perpendicular cs:horizontal line through={(0,2)}, vertical line through={{(3,0)}})",
      context
    );
    expect(perpendicular.kind).toBe("world-only");
    expect(perpendicular.origin).toBe("perpendicular");
    expect(perpendicular.world?.x).toBeCloseTo(95.3582677165);
    expect(perpendicular.world?.y).toBeCloseTo(51.905511811);

    const intersection = evaluateRawCoordinate(
      "(intersection cs:first line={{(0,0)--(2,2)}}, second line={(0,2)--(2,0)}, solution={1})",
      context
    );
    expect(intersection.kind).toBe("world-only");
    expect(intersection.origin).toBe("intersection");
    expect(intersection.world?.x).toBeCloseTo(38.4527559055);
    expect(intersection.world?.y).toBeCloseTo(23.4527559055);

    expect(evaluateRawCoordinate("(canvas cs:x=1cm)", context).diagnostics).toContain("unsupported-coordinate-form:explicit");
    expect(evaluateRawCoordinate("(perpendicular cs:horizontal line through={}, vertical line through={(0,0)})", context).diagnostics).toContain("unsupported-coordinate-form:explicit");
    expect(evaluateRawCoordinate("(intersection cs:first line={(0,0)}, second line={(1,1)--(2,2)})", context).diagnostics).toContain("unsupported-coordinate-form:explicit");
    expect(evaluateRawCoordinate("(intersection cs:first line={(0,0)--(1,1)})", context).diagnostics).toContain("unsupported-coordinate-form:explicit");

    context.stack[0].namePrefix = "pre-";
    context.stack[0].nameSuffix = "-suf";
    writeNamedNodeGeometry(context, "pre-A-suf", {
      shape: "rectangle",
      center: worldPoint(pt(100), pt(200)),
      anchorHalfWidth: 20,
      anchorHalfHeight: 10,
      anchorRadius: 20
    });

    const scopedAnchor = evaluateRawCoordinate("(A.-90)", context);
    expect(scopedAnchor.kind).toBe("world-only");
    expect(scopedAnchor.origin).toBe("numeric-anchor");
    expect(scopedAnchor.world).toEqual({ x: 100, y: 190 });

    const nonNumericAnchor = evaluateRawCoordinate("(A.east)", context);
    expect(nonNumericAnchor.kind).toBe("invalid");
    expect(nonNumericAnchor.diagnostics).toContain("unknown-named-coordinate:A.east");

    const scopedMissing = evaluateRawCoordinate("(B.0)", context);
    expect(scopedMissing.kind).toBe("invalid");
    expect(scopedMissing.diagnostics).toContain("unknown-named-coordinate:B.0");
  });

  it("evaluates numeric anchors across node border geometry fallbacks", () => {
    const context = createSemanticContext(defaultStyle(), worldTransform(1, 0, 0, 1, 0, 0));
    const center = worldPoint(pt(10), pt(20));

    writeNamedNodeGeometry(context, "C", {
      shape: "circle",
      center,
      anchorHalfWidth: 0,
      anchorHalfHeight: 0,
      anchorRadius: 5
    });
    expect(evaluateRawCoordinate("(C.0)", context).world).toEqual({ x: 15, y: 20 });

    writeNamedNodeGeometry(context, "E", {
      shape: "ellipse",
      center,
      anchorHalfWidth: 8,
      anchorHalfHeight: 4,
      anchorRadius: 8,
      anchorTransform: worldTransform(0, 0, 0, 0, 0, 0)
    });
    // A singular node transform collapses the border to the centre, as the shared
    // border routine does for named coordinates (see nodes-helpers.spec.ts).
    expect(evaluateRawCoordinate("(E.90)", context).world).toEqual({ x: 10, y: 20 });

    writeNamedNodeGeometry(context, "P", {
      shape: "diamond",
      center,
      anchorHalfWidth: 0,
      anchorHalfHeight: 0,
      anchorRadius: 0,
      anchorPolygon: [
        worldPoint(pt(-3), pt(0)),
        worldPoint(pt(0), pt(6)),
        worldPoint(pt(3), pt(0)),
        worldPoint(pt(0), pt(-6))
      ]
    });
    expect(evaluateRawCoordinate("(P.90)", context).world).toEqual({ x: 10, y: 26 });

    writeNamedNodeGeometry(context, "Z", {
      shape: "coordinate",
      center,
      anchorHalfWidth: Number.NaN,
      anchorHalfHeight: Number.NaN,
      anchorRadius: Number.NaN
    });
    expect(evaluateRawCoordinate("(Z.45)", context).world).toEqual(center);
  });

  it("rejects malformed named intersection and perpendicular coordinate expressions", () => {
    const context = createSemanticContext(defaultStyle(), worldTransform(1, 0, 0, 1, 0, 0));
    writeNamedCoordinate(context, "p", worldPoint(pt(0), pt(0)));
    writeNamedCoordinate(context, "q", worldPoint(pt(20), pt(20)));
    writeNamedCoordinate(context, "r", worldPoint(pt(0), pt(20)));
    writeNamedCoordinate(context, "s", worldPoint(pt(20), pt(0)));
    writeNamedCoordinate(context, "u", worldPoint(pt(0), pt(10)));
    writeNamedCoordinate(context, "v", worldPoint(pt(20), pt(10)));

    const missingAnd = evaluateRawCoordinate("({intersection of p--q})", context);
    expect(missingAnd.kind).toBe("invalid");
    expect(missingAnd.diagnostics[0]).toMatch(/(?:invalid-intersection-coordinate|unknown-named-coordinate)/);

    const malformedLine = evaluateRawCoordinate("({intersection of p and q--r})", context);
    expect(malformedLine.kind).toBe("invalid");
    expect(malformedLine.diagnostics[0]).toMatch(/(?:invalid-intersection-coordinate|unknown-named-coordinate)/);

    const missingEndpoint = evaluateRawCoordinate("({intersection of missing--q and r--s})", context);
    expect(missingEndpoint.kind).toBe("invalid");
    expect(missingEndpoint.diagnostics[0]).toMatch(/(?:invalid-intersection-coordinate|unknown-named-coordinate)/);

    const unsupportedNamedSolution = evaluateRawCoordinate("({intersection 2 of p--q and r--s})", context);
    expect(unsupportedNamedSolution.kind).toBe("invalid");
    expect(unsupportedNamedSolution.diagnostics[0]).toMatch(/(?:invalid-intersection-solution:2|unknown-named-coordinate)/);

    const parallelNamed = evaluateRawCoordinate("({intersection of p--s and u--v})", context);
    expect(parallelNamed.kind).toBe("invalid");
    expect(parallelNamed.diagnostics[0]).toMatch(/(?:invalid-intersection-coordinate|unknown-named-coordinate)/);

    const validNamed = evaluateRawCoordinate("({intersection of p--q and r--s})", context);
    expect(validNamed.kind).toBe("world-only");
    expect(validNamed.origin).toBe("intersection");
    expect(validNamed.world?.x).toBeCloseTo(10);
    expect(validNamed.world?.y).toBeCloseTo(10);

    const malformedPerpendicular = evaluateRawCoordinate("({(0,0) |- })", context);
    expect(malformedPerpendicular.kind).toBe("invalid");
    expect(malformedPerpendicular.diagnostics).toContain("unknown-named-coordinate:{(0,0) |- }");
  });
});
