import { describe, expect, it } from "vitest";

import {
  compilePgfMathExpression,
  evaluatePgfMathExpression,
  evaluatePgfMathText,
  parsePgfMathFunctionDeclarations
} from "../../packages/core/src/semantic/pgfmath/evaluator.js";

function scalar(input: string, mode: "fixed" | "float" = "fixed"): number {
  const result = evaluatePgfMathExpression(input, { mode });
  if (!result.ok) throw new Error(`${input}: ${result.message}`);
  return result.quantity.value;
}

describe("pgfmath PGF semantics", () => {
  it("groups operators like PGF's operator stack", () => {
    expect(scalar("1?2:3?4:5")).toBe(4);
    expect(scalar("1||0&&0")).toBe(0);
    expect(scalar("3r^2")).toBeCloseTo((9 * 180) / Math.PI, 9);
    expect(scalar("2*3r")).toBeCloseTo((6 * 180) / Math.PI, 9);
    expect(scalar("sin 30^2")).toBeCloseTo(0.25, 12);
    expect(scalar("2^-1*4")).toBeCloseTo(2 ** -4, 12);
    expect(scalar("010+0")).toBe(8);
    expect(scalar("010")).toBe(10);
    expect(scalar("0x1F+0b11")).toBe(34);
  });

  it("tracks declared units like \\ifpgfmathunitsdeclared", () => {
    expect(evaluatePgfMathExpression("2pt+3")).toEqual({ ok: true, quantity: { kind: "length", value: 5 } });
    expect(evaluatePgfMathExpression("1cm/1cm")).toEqual({ ok: true, quantity: { kind: "length", value: 1 } });
    expect(evaluatePgfMathExpression("scalar(1cm)+1")).toMatchObject({ ok: true, quantity: { kind: "scalar" } });
    expect(evaluatePgfMathExpression("gcd(12,18)")).toEqual({ ok: true, quantity: { kind: "length", value: 6 } });
  });

  it("applies PGF's integer and rounding rules", () => {
    expect(scalar("mod(-7,3)")).toBe(-1);
    expect(scalar("Mod(-7,3)")).toBe(2);
    expect(scalar("Mod(-7,-3)")).toBe(-4);
    expect(scalar("div(-7,2)")).toBe(-3);
    expect(scalar("round(-2.5)")).toBe(-3);
    expect(scalar("frac(-3.25)")).toBe(0.25);
    expect(scalar("factorial(4.9)")).toBe(24);
    expect(scalar("isprime(97)+iseven(-4)+isodd(7)")).toBe(3);
    expect(scalar("0^-1")).toBe(0);
  });

  it("separates the fixed and float engines", () => {
    // Past TeX's range fixed mode keeps the double and warns (TeX: "Dimension too large"); float has no limit.
    expect(evaluatePgfMathExpression("100*200")).toEqual({ ok: true, quantity: { kind: "scalar", value: 20000 }, warnings: ["overflow"] });
    expect(evaluatePgfMathExpression("100*200", { mode: "float" })).toEqual({ ok: true, quantity: { kind: "scalar", value: 20000 } });
    expect(evaluatePgfMathExpression("100*100")).toEqual({ ok: true, quantity: { kind: "scalar", value: 10000 } });
    expect(scalar("100*200", "float")).toBe(20000);
    expect(evaluatePgfMathExpression("1/0")).toMatchObject({ ok: false, code: "division-by-zero" });
    expect(scalar("1/0", "float")).toBe(Number.POSITIVE_INFINITY);
    expect(Number.isNaN(scalar("sqrt(-1)", "float"))).toBe(true);
    expect(scalar("0^-1", "float")).toBe(Number.POSITIVE_INFINITY);
    // fpu's mod truncates both operands before dividing.
    expect(scalar("mod(4,1.5)", "float")).toBe(-2);
    // fpu's equality is relative to 1e-4.
    expect(scalar("1==1.00001", "float")).toBe(1);
    expect(scalar("1==1.00001")).toBe(0);
    expect(scalar("sin(30)", "float")).toBe(0.5);
    expect(evaluatePgfMathExpression("frac(1.5)", { mode: "float" })).toMatchObject({ ok: false });
  });

  it("evaluates text results", () => {
    expect(evaluatePgfMathText("Hex(3054)")).toMatchObject({ ok: true, text: "BEE" });
    expect(evaluatePgfMathText("{1,2,3}")).toMatchObject({ ok: true, text: "{1}{2}{3}" });
    expect(evaluatePgfMathText("{{1,2},{3,4}}[1][0]")).toMatchObject({ ok: true, text: "3" });
    expect(evaluatePgfMathText("dim({1,2,3})+array({4,5},1)")).toMatchObject({ ok: true, text: "8" });
    expect(evaluatePgfMathText("ifthenelse(0,\"a\",\"b\")")).toMatchObject({ ok: true, text: "b" });
  });

  it("measures text through the supplied measurer", () => {
    const measureText = (text: string) => ({ width: text.length * 5, height: 7, depth: 2 });
    expect(evaluatePgfMathExpression("width(\"abc\")+depth(\"x\")", { measureText })).toEqual({
      ok: true,
      quantity: { kind: "scalar", value: 17 }
    });
    expect(evaluatePgfMathExpression("width(\"abc\")")).toMatchObject({ ok: false, code: "unsupported-text-measure" });
  });
});

describe("compiled pgfmath expressions", () => {
  it("binds identifiers and macros by name or position", () => {
    const compiled = compilePgfMathExpression("x^2 + \\t", { variables: ["x", "\\t"] });
    if (!compiled.ok) throw new Error(compiled.message);
    expect(compiled.fn({ x: 3, "\\t": 1 })).toBe(10);
    expect(compiled.fn([-2, 0.5])).toBe(4.5);
    expect(compiled.fn.variables).toEqual(["x", "\\t"]);
  });

  it("reads a negative macro value as inserted text, an identifier as a value", () => {
    const macro = compilePgfMathExpression("\\x^2", { variables: ["\\x"] });
    const ident = compilePgfMathExpression("x^2", { variables: ["x"] });
    if (!macro.ok || !ident.ok) throw new Error("compile failed");
    expect(macro.fn([-2])).toBe(-4);
    expect(ident.fn([-2])).toBe(4);
    const spine = compilePgfMathExpression("3*\\x^2 + \\x^\\x", { variables: ["\\x"] });
    if (!spine.ok) throw new Error(spine.message);
    // Textually: 3*-2^2 + -2^-2 = -12 - 0.25.
    expect(spine.fn([-2])).toBeCloseTo(-12.25, 12);
  });

  it("uses declared functions, macros and the trig format", () => {
    const declared = parsePgfMathFunctionDeclarations(String.raw`f(\x)=\x*\x; g(\a,\b)=f(\a)+\b;`);
    if (!declared) throw new Error("bad declarations");
    const functions = new Map(declared.map((definition) => [definition.name, definition]));
    const compiled = compilePgfMathExpression("g(x,\\k)+sin(pi/2)", {
      variables: ["x"],
      functions,
      macros: { "\\k": "2*5" },
      trigFormat: "rad",
      mode: "float"
    });
    if (!compiled.ok) throw new Error(compiled.message);
    expect(compiled.fn({ x: 3 })).toBeCloseTo(20, 12);
    expect(compiled.fn.evaluate({ x: 1 })).toEqual({ ok: true, quantity: { kind: "scalar", value: 12 } });
  });

  it("reports compile and evaluation errors", () => {
    expect(compilePgfMathExpression("foo(x)", { variables: ["x"] })).toMatchObject({ ok: false, code: "unknown-function" });
    const compiled = compilePgfMathExpression("1/x", { variables: ["x"] });
    if (!compiled.ok) throw new Error(compiled.message);
    expect(compiled.fn([0])).toMatchObject({ ok: false, code: "division-by-zero" });
    expect(compiled.fn([4])).toBe(0.25);
  });

  it("evaluates exp(-x^2/2)*sin(deg(x)) 10k times quickly", () => {
    const compiled = compilePgfMathExpression("exp(-x^2/2)*sin(deg(x))", { variables: ["x"], mode: "float" });
    if (!compiled.ok) throw new Error(compiled.message);
    const fn = compiled.fn;
    const values = [0];
    let checksum = 0;
    // Warm the JIT with one pass, then time 10k samples on [-5, 5].
    for (let index = 0; index < 10_000; index += 1) {
      values[0] = index / 1000 - 5;
      checksum += fn(values) as number;
    }
    const start = performance.now();
    for (let index = 0; index < 10_000; index += 1) {
      values[0] = index / 1000 - 5;
      checksum += fn(values) as number;
    }
    const elapsed = performance.now() - start;
    expect(Number.isFinite(checksum)).toBe(true);
    expect(fn([1])).toBeCloseTo(Math.exp(-0.5) * Math.sin(1), 12);
    console.info(`pgfmath compiled: 10k evaluations of exp(-x^2/2)*sin(deg(x)) took ${elapsed.toFixed(2)} ms`);
    // The target is well under 20 ms; the bound leaves room for loaded CI machines.
    expect(elapsed).toBeLessThan(60);
  });
});
