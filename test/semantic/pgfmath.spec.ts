import { describe, expect, it } from "vitest";

import {
  convertQuantityToLength,
  evaluatePgfMathExpression,
  formatPgfMathNumber
} from "../../packages/core/src/semantic/pgfmath/evaluator.js";
import { createPgfRandom } from "../../packages/core/src/semantic/pgfmath/rng.js";
import { withPgfMathRuntime } from "../../packages/core/src/semantic/pgfmath/runtime.js";
import { evaluateSemantic, elementsOfKind } from "./helpers.js";

function evaluateScalar(input: string, seed = 1): number {
  const result = evaluatePgfMathExpression(input, { rng: createPgfRandom(seed) });
  expect(result.ok).toBe(true);
  if (!result.ok) {
    return Number.NaN;
  }
  return result.quantity.value;
}

function evaluateLength(input: string): number {
  const result = evaluatePgfMathExpression(input, { rng: createPgfRandom(1) });
  expect(result.ok).toBe(true);
  if (!result.ok) {
    return Number.NaN;
  }
  expect(result.quantity.kind).toBe("length");
  return result.quantity.value;
}

function expectPgfMathFailure(input: string, code: string): void {
  const result = evaluatePgfMathExpression(input, { rng: createPgfRandom(1) });
  expect(result.ok, input).toBe(false);
  if (!result.ok) {
    expect(result.code).toBe(code);
    expect(result.message.length).toBeGreaterThan(0);
  }
}

describe("semantic evaluator / pgfmath", () => {
  it("respects unary and exponent precedence", () => {
    expect(evaluateScalar("-2^2")).toBe(-4);
    expect(evaluateScalar("(-2)^2")).toBe(4);
    expect(evaluateScalar("2^3^2")).toBe(512);
  });

  it("supports comparisons, logical operators, and ternary expressions", () => {
    expect(evaluateScalar("1 < 2 ? 7 : 9")).toBe(7);
    expect(evaluateScalar("1 > 2 ? 7 : 9")).toBe(9);
    expect(evaluateScalar("(1 > 2) || (3 == 3) ? 5 : 6")).toBe(5);
    expect(evaluateScalar("(1 != 2) && (3 >= 3) && (2 <= 2)")).toBe(1);
    expect(evaluateScalar("!0 ? 11 : 12")).toBe(11);
  });

  it("supports scalar math functions and constants", () => {
    expect(evaluateScalar("sin(30)")).toBeCloseTo(0.5, 6);
    expect(evaluateScalar("cos(60) + tan(45)")).toBeCloseTo(1.5, 6);
    expect(evaluateScalar("atan2(1,1)")).toBeCloseTo(45, 6);
    expect(evaluateScalar("acos(0) + atan(1)")).toBeCloseTo(135, 6);
    expect(evaluateScalar("sqrt(9) + abs(-2) + ln(e)")).toBeCloseTo(6, 6);
    expect(evaluateScalar("log10(100) + log2(8)")).toBe(5);
    expect(evaluateScalar("round(1.5) + floor(1.9) + ceil(1.1) + int(-1.9)")).toBe(4);
    expect(evaluateScalar("frac(1.25) + sign(-4) + sign(0) + sign(4)")).toBeCloseTo(0.25, 6);
    expect(evaluateScalar("deg(pi) + rad(180)")).toBeCloseTo(180 + Math.PI, 6);
    expect(evaluateScalar("scalar(5pt)")).toBe(5);
    expect(evaluateScalar("pow(2,3) + mod(7,4)")).toBe(11);
    expect(evaluateScalar("min(4,2,8) + max(1,6,3)")).toBe(8);
    expect(evaluateScalar("Mod(-3,5)")).toBe(2);
    expect(evaluateScalar("5!")).toBe(120);
  });

  it("supports length units and scalar/length operations", () => {
    expect(evaluateLength("1cm + 2mm")).toBeCloseTo(34.1433070866, 6);
    expect(evaluateLength("2 * 5pt")).toBe(10);
    expect(evaluateLength("5pt * 2")).toBe(10);
    expect(evaluateLength("6pt / 2")).toBe(3);
    expect(evaluateScalar("6pt / 3pt")).toBe(2);
    expect(evaluateLength("(2pt)^3")).toBe(8);
    expect(evaluateScalar("3.5r")).toBeCloseTo((3.5 * 180) / Math.PI, 6);
    expect(evaluateScalar("(3)r")).toBeCloseTo((3 * 180) / Math.PI, 6);
    expect(evaluateScalar("3 r")).toBeCloseTo((3 * 180) / Math.PI, 6);
  });

  it("formats finite pgfmath numbers without negative zero or floating noise", () => {
    expect(formatPgfMathNumber(Number.POSITIVE_INFINITY)).toBe("0");
    expect(formatPgfMathNumber(-0)).toBe("0");
    expect(formatPgfMathNumber(1.0000000001)).toBe("1");
    expect(formatPgfMathNumber(1.2345000000001)).toBe("1.2345");
  });

  it("converts scalar and length quantities to target lengths", () => {
    expect(convertQuantityToLength({ kind: "length", value: 12 }, "cm")).toBe(12);
    expect(convertQuantityToLength({ kind: "scalar", value: 2 }, "cm")).toBeCloseTo(56.905511811, 6);
    expect(convertQuantityToLength({ kind: "scalar", value: 2 }, "pt")).toBe(2);
    expect(convertQuantityToLength({ kind: "scalar", value: 2 }, "zz" as "cm")).toBeNull();
  });

  it("supports seeded random functions with deterministic sequences", () => {
    const rng = createPgfRandom(1);
    expect(rng.nextRaw()).toBe(69621);
    expect(rng.nextRaw()).toBe(552116347);
    expect(rng.nextRaw()).toBe(1082396834);

    const randomA = evaluatePgfMathExpression("rnd", { rng: createPgfRandom(1) });
    const randomB = evaluatePgfMathExpression("random(1,10)", { rng: createPgfRandom(1) });
    expect(randomA.ok).toBe(true);
    expect(randomB.ok).toBe(true);
    if (randomA.ok && randomB.ok) {
      expect(randomA.quantity.value).toBeCloseTo(0.69621, 6);
      expect(randomB.quantity.value).toBeGreaterThanOrEqual(1);
      expect(randomB.quantity.value).toBeLessThanOrEqual(10);
    }

    const swapped = evaluatePgfMathExpression("random(10,1)", { rng: createPgfRandom(1) });
    const bareCall = evaluatePgfMathExpression("random()", { rng: createPgfRandom(1) });
    const randIdent = evaluatePgfMathExpression("rand", { rng: createPgfRandom(1) });
    const randCall = evaluatePgfMathExpression("rand()", { rng: createPgfRandom(1) });
    expect(swapped.ok).toBe(true);
    expect(bareCall.ok).toBe(true);
    expect(randIdent.ok).toBe(true);
    expect(randCall.ok).toBe(true);
    if (swapped.ok && bareCall.ok && randIdent.ok && randCall.ok) {
      expect(swapped.quantity.value).toBeGreaterThanOrEqual(1);
      expect(swapped.quantity.value).toBeLessThanOrEqual(10);
      expect(bareCall.quantity.value).toBeCloseTo(0.69621, 6);
      expect(randIdent.quantity.value).toBeCloseTo(-0.30379, 6);
      expect(randCall.quantity.value).toBeCloseTo(-0.30379, 6);
    }

    expect(createPgfRandom(Number.POSITIVE_INFINITY).getSeed()).toBe(1);
    expect(createPgfRandom(0).getSeed()).toBe(1);
    expect(createPgfRandom(2147483647).getSeed()).toBe(1);
    expect(createPgfRandom(30845).nextRaw()).toBe(2147459745);
  });

  it("uses the active pgfmath runtime RNG when no explicit RNG is supplied", () => {
    const rng = createPgfRandom(1);

    const result = withPgfMathRuntime({ rng }, () => evaluatePgfMathExpression("random(1,10)"));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.quantity.value).toBeGreaterThanOrEqual(1);
      expect(result.quantity.value).toBeLessThanOrEqual(10);
      expect(rng.getSeed()).toBe(69621);
    }
  });

  it("evaluates standalone pgfmath commands and reports malformed command inputs", () => {
    const result = evaluateSemantic(String.raw`\begin{tikzpicture}
\pgfmathsetseed{random(1,10)};
\pgfmathsetseed{1+};
\pgfmathparse{rand()};
\pgfmathparse{1+};
\pgfmathsetmacro{bad-target}{1};
\pgfmathsetmacro{\good}{random(1,2)};
\pgfmathsetmacro{\bad}{1+};
\node at (\good,0) {\pgfmathresult};
\end{tikzpicture}`);

    expect(result.featureUsage.pgfmath_expression).toBe("used-supported");
    expect(result.featureUsage.pgfmath_random_functions).toBe("used-supported");
    expect(result.featureUsage.pgfmath_seed_commands).toBe("used-supported");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      expect.stringMatching(/^invalid-pgfmathsetseed:/),
      expect.stringMatching(/^invalid-pgfmathparse:/),
      "invalid-pgfmathsetmacro-target",
      expect.stringMatching(/^invalid-pgfmathsetmacro:/)
    ]));
  });

  it("reports unsupported syntax for quoted expressions", () => {
    const result = evaluatePgfMathExpression("\"foo\"");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("unsupported-syntax");
    }
  });

  it("reports parse, arity, domain, and type errors precisely", () => {
    const failures = [
      ["", "empty"],
      ["{1+2}{3}", "unsupported-syntax"],
      ["1 + @", "token"],
      [".", "token"],
      ["1..2", "unexpected-token"],
      ["1e+", "invalid-domain"],
      ["1 +", "unexpected-token"],
      ["(1+2", "unexpected-token"],
      ["(@)", "token"],
      ["1 ? 2", "unexpected-token"],
      ["1 ? @ : 2", "token"],
      ["0 ? 1 : @", "token"],
      ["1 || @", "token"],
      ["1 && @", "token"],
      ["1 < @", "token"],
      ["1 * @", "token"],
      ["2 ^ @", "token"],
      ["+@", "token"],
      ["-@", "token"],
      ["!@", "token"],
      ["foo", "unknown-function"],
      ["pi()", "unexpected-token"],
      ["sin(1,2)", "invalid-arity"],
      ["min()", "invalid-arity"],
      ["min(2pt)", "invalid-operation"],
      ["random(1,2,3)", "invalid-arity"],
      ["random(2pt)", "invalid-operation"],
      ["random(1,2pt)", "invalid-operation"],
      ["rnd(1)", "invalid-arity"],
      ["rand(1)", "invalid-arity"],
      ["1 / 0", "division-by-zero"],
      ["sqrt(-1)", "invalid-domain"],
      ["asin(2)", "invalid-domain"],
      ["exp(1000)", "invalid-domain"],
      ["171!", "invalid-domain"],
      ["2.5!", "invalid-domain"],
      ["2pt + 3", "invalid-operation"],
      ["2pt * 3pt", "invalid-operation"],
      ["3 / 2pt", "invalid-operation"],
      ["2pt ^ 0.5", "invalid-operation"],
      ["2pt ^ 2pt", "invalid-operation"],
      ["2pt!", "invalid-operation"],
      ["2pt r", "invalid-operation"],
      ["2pt < 3", "invalid-operation"],
      ["sin(2pt)", "invalid-operation"],
      ["atan2(1)", "invalid-arity"],
      ["atan2(1pt,2)", "invalid-operation"],
      ["atan2(1,2pt)", "invalid-operation"],
      ["mod(1,0)", "invalid-domain"],
      ["scalar()", "invalid-arity"],
      ["unknown(1)", "unknown-function"],
      ["foo(1 2)", "unexpected-token"]
    ] as const;

    for (const [input, code] of failures) {
      expectPgfMathFailure(input, code);
    }

    for (const input of ["rnd", "rand", "rnd()", "rand()", "random()"]) {
      const result = evaluatePgfMathExpression(input);
      expect(result.ok, input).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("unsupported-random");
      }
    }
  });

  it("supports pgfmath standalone commands and seeded foreach evaluation", () => {
    const source = String.raw`\begin{tikzpicture}
  \pgfmathsetseed{7};
  \pgfmathparse{1<2 ? 9 : 4};
  \pgfmathsetmacro{\m}{2+3};
  \node at (0,0) {\pgfmathresult/\m};
  \foreach \x [evaluate=\x as \r using random(1,9)] in {1,2,3}
    \node at (\x,1) {\r};
\end{tikzpicture}`;

    const first = evaluateSemantic(source);
    const second = evaluateSemantic(source);
    const textsFirst = elementsOfKind(first.scene.elements, "Text").map((entry) => entry.text);
    const textsSecond = elementsOfKind(second.scene.elements, "Text").map((entry) => entry.text);

    expect(textsFirst).toContain("9/5");
    expect(textsFirst).toEqual(textsSecond);
    expect(first.diagnostics.some((diagnostic) => (diagnostic.code ?? "").startsWith("invalid-pgfmath"))).toBe(false);
  });

  it("applies multiple pgfmathsetmacro commands from one parsed block", () => {
    const source = String.raw`\begin{tikzpicture}
  \pgfmathsetmacro{\rm}{3};
  \pgfmathsetmacro{\rc}{\rm *2/3};
  \draw (0,0) -- (\rm cm,\rc cm);
\end{tikzpicture}`;

    const result = evaluateSemantic(source);
    expect(result.diagnostics.some((diagnostic) => (diagnostic.code ?? "").startsWith("invalid-pgfmathsetmacro"))).toBe(false);

    const path = elementsOfKind(result.scene.elements, "Path").find((entry) => entry.kind === "Path");
    expect(path?.kind).toBe("Path");
    if (path?.kind === "Path") {
      const line = path.commands.find((command) => command.kind === "L");
      expect(line?.kind).toBe("L");
      if (line?.kind === "L") {
        expect(line.to.x).toBeGreaterThan(0);
        expect(line.to.y).toBeGreaterThan(0);
      }
    }
  });

  it("evaluates semicolonless pgfmathsetmacro statements inside nested foreach bodies", () => {
    const source = String.raw`\begin{tikzpicture}
\foreach \i in {0,1,2}{\foreach \j in {0,1,2}{%
    \pgfmathsetmacro{\xx}{12.86+\i*0.16}%
    \pgfmathsetmacro{\yy}{1.60+\j*0.16}%
    \draw[black!55,line width=0.25pt,fill=black!12] (\xx,\yy) rectangle ++(0.15,0.15);
  }}
\end{tikzpicture}`;

    const result = evaluateSemantic(source);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "foreach-body-parse-error")).toBe(false);
    expect(result.diagnostics.some((diagnostic) => (diagnostic.code ?? "").startsWith("invalid-pgfmathsetmacro"))).toBe(false);

    const paths = elementsOfKind(result.scene.elements, "Path");
    expect(paths).toHaveLength(9);
  });

  it("accepts xcolor named rgb components with omitted channels defaulting to zero", () => {
    const source = String.raw`\begin{tikzpicture}
  \node[circle,draw,fill={rgb:blue,115;green,158},text=white] {54};
  \node[circle,draw,fill={rgb:blue,178;green,114},text=white] {154};
  \node[circle,draw,fill={rgb:red,213;green,94},text=white] {155};
\end{tikzpicture}`;

    const result = evaluateSemantic(source);
    expect(result.diagnostics.some((diagnostic) => (diagnostic.code ?? "").includes("invalid"))).toBe(false);

    const circles = elementsOfKind(result.scene.elements, "Circle");
    expect(circles).toHaveLength(3);
    for (const circle of circles) {
      expect(circle.style.fill).not.toBe("black");
      expect(circle.style.fill).not.toBe("#000000");
    }
  });
});
