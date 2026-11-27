/**
 * Expressions over table rows (`x expr`, `y expr`, `restrict expr to
 * domain`): `\thisrow{name}`, `\thisrowno{i}`, `\coordindex` and `\lineno`
 * (manual axis-addplot.tex, "Mathematical Expressions And File Data"),
 * compiled once and evaluated per row in pgfmath float mode (pgfplots
 * evaluates with its floating point unit).
 *
 * Kept small and local on purpose: the pgfplots numeric evaluation is moving
 * to `compilePgfMathExpression` in float mode; this is the table-specific
 * part (column references to variables).
 */
import { compilePgfMathExpression } from "../semantic/pgfmath/evaluator.js";

export type RowValues = { cells: readonly number[]; coordindex: number; lineno: number };

export type CompiledTableExpression =
  | { ok: true; evaluate: (row: RowValues) => number; columns: readonly number[] }
  | { ok: false; message: string };

function letters(index: number): string {
  let out = "";
  let n = index;
  do {
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** `names` are the table's column names (null without a header: names are then the indices). */
export function compileTableExpression(expression: string, names: readonly string[] | null): CompiledTableExpression {
  const columns: number[] = [];
  const variableOf = new Map<number, string>();
  let missing: string | null = null;
  const reference = (index: number): string => {
    let name = variableOf.get(index);
    if (!name) {
      name = `\\pgfplotstablecolumn${letters(columns.length)}`;
      variableOf.set(index, name);
      columns.push(index);
    }
    return ` ${name} `;
  };
  const rewritten = expression
    .replace(/\\thisrowno\s*\{\s*(\d+)\s*\}/gu, (_m, index: string) => reference(Number(index)))
    .replace(/\\thisrow\s*\{([^{}]*)\}/gu, (_m, rawName: string) => {
      const name = rawName.trim();
      const at = names ? names.indexOf(name) : /^\d+$/u.test(name) ? Number(name) : -1;
      if (at < 0) {
        missing ??= name;
        return " 0 ";
      }
      return reference(at);
    });
  if (missing !== null) return { ok: false, message: `the table has no column \`${missing}\`` };
  const variables = [...columns.map((index) => variableOf.get(index) ?? ""), "\\coordindex", "\\lineno"];
  const compiled = compilePgfMathExpression(rewritten, { mode: "float", variables });
  if (!compiled.ok) return { ok: false, message: compiled.message };
  const fn = compiled.fn;
  const bindings: number[] = new Array<number>(variables.length).fill(0);
  return {
    ok: true,
    columns,
    evaluate: (row) => {
      for (let i = 0; i < columns.length; i += 1) bindings[i] = row.cells[columns[i] ?? 0] ?? Number.NaN;
      bindings[columns.length] = row.coordindex;
      bindings[columns.length + 1] = row.lineno;
      const value = fn(bindings);
      return typeof value === "number" ? value : Number.NaN;
    }
  };
}
