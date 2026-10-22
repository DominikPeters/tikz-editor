import type ts from "typescript";

export type CoordinateWriteRule = "F1" | "F2" | "F3" | "F4" | "F5" | "F6";

export interface CoordinateWriteViolation {
  readonly rule: CoordinateWriteRule;
  readonly symbol?: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly declaration: string;
  readonly hash: string;
  readonly expression: string;
  readonly message: string;
}

export interface CoordinateWriteException {
  readonly rule: CoordinateWriteRule;
  readonly symbol?: string;
  readonly file: string;
  readonly declaration: string;
  readonly hash: string;
  readonly count: number;
  readonly expression: string;
}

export const EXCEPTIONS_FILE: string;
export function createProgram(root: string, rootNames?: readonly string[], extraOptions?: ts.CompilerOptions): ts.Program;
export function collectViolations(program: ts.Program, root: string, files: readonly string[]): CoordinateWriteViolation[];
export function exceptionEntries(violations: readonly CoordinateWriteViolation[]): CoordinateWriteException[];
export function compareWithExceptions(
  violations: readonly CoordinateWriteViolation[],
  listed: readonly CoordinateWriteException[]
): {
  unexpected: CoordinateWriteViolation[];
  stale: Array<CoordinateWriteException & { found: number }>;
  found: CoordinateWriteException[];
};
export function readExceptions(root: string): CoordinateWriteException[];
export function checkCoordinateWrites(root: string): string[];
