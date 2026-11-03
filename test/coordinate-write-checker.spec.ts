import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectViolations,
  compareWithExceptions,
  createProgram,
  exceptionEntries,
  type CoordinateWriteViolation
} from "../scripts/check-coordinate-writes.mjs";

const root = process.cwd();
const fixtureDir = join(root, "test/fixtures/coordinate-checker");
const fixtures = readdirSync(fixtureDir).filter((name) => name.endsWith(".ts")).sort();

/** Each fixture names the diagnostics it must produce, and only those: TypeScript codes or checker rules. */
function expectedDiagnostics(file: string): string[] {
  const header = /^\/\/ expect:(.*)$/m.exec(readFileSync(file, "utf8"));
  if (!header) throw new Error(`${file} has no "// expect:" header`);
  return (header[1] ?? "").trim().split(/\s+/).filter(Boolean).sort();
}

describe("coordinate-write checker", () => {
  const files = fixtures.map((name) => join(fixtureDir, name));
  const program = createProgram(root, files);
  const violations = collectViolations(program, root, files);

  it("keeps all six raw serializers out of the ordinary writer API", () => {
    const file = program.getSourceFile(join(fixtureDir, "raw-writer-methods-removed.ts"));
    if (!file) throw new Error("missing ordinary writer API fixture");
    expect(program.getSemanticDiagnostics(file).filter(diagnostic => diagnostic.code === 2339)).toHaveLength(6);
  });

  it.each(fixtures)("%s produces exactly its expected diagnostics", (name) => {
    const file = join(fixtureDir, name);
    const sourceFile = program.getSourceFile(file);
    if (!sourceFile) throw new Error(`${name} is not in the program`);
    const typeScript = [...program.getSyntacticDiagnostics(sourceFile), ...program.getSemanticDiagnostics(sourceFile)]
      .map((diagnostic) => `TS${diagnostic.code}`);
    const checker = violations.filter((violation) => violation.file === `test/fixtures/coordinate-checker/${name}`)
      .map((violation) => violation.rule);
    expect([...new Set([...typeScript, ...checker])].sort()).toEqual(expectedDiagnostics(file));
  });
});

describe("coordinate-write exceptions", () => {
  const violation = (overrides: Partial<CoordinateWriteViolation> = {}): CoordinateWriteViolation => ({
    rule: "F2", symbol: "legacyText", file: "packages/core/src/edit/example.ts", line: 10, column: 3,
    declaration: "rewrite", hash: "aaaaaaaaaaaa", expression: "legacyText(text)", message: "", ...overrides
  });

  it("matches by fingerprint, not by line", () => {
    const listed = exceptionEntries([violation()]);
    expect(compareWithExceptions([violation({ line: 42, column: 7 })], listed)).toMatchObject({ unexpected: [], stale: [] });
  });

  it("reports a replaced violation as new, and the old entry as stale", () => {
    const listed = exceptionEntries([violation()]);
    const { unexpected, stale } = compareWithExceptions([violation({ hash: "bbbbbbbbbbbb" })], listed);
    expect(unexpected).toHaveLength(1);
    expect(stale).toMatchObject([{ hash: "aaaaaaaaaaaa", count: 1, found: 0 }]);
  });

  it("counts repeated violations in one declaration", () => {
    const listed = exceptionEntries([violation(), violation({ line: 11 })]);
    expect(listed).toMatchObject([{ count: 2 }]);
    expect(compareWithExceptions([violation(), violation(), violation()], listed).unexpected).toHaveLength(1);
    expect(compareWithExceptions([violation()], listed).stale).toMatchObject([{ count: 2, found: 1 }]);
  });
});
