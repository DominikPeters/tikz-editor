/**
 * The host side of pgfplots table input: tables read by `\pgfplotstableread`
 * (kept in the macro bindings, so TeX's scoping applies) and table files read
 * through the document's resource resolver.
 */
import type { PgfplotsTableReadStatement } from "../ast/types.js";
import type { OptionEntry, OptionListAst } from "../options/types.js";
import { defineContextSymbol, readContextStateBinding, resolveContextSymbol, writeContextStateBinding, type SemanticContext } from "../semantic/context.js";
import type { ReadTableMacro, TableFileRead } from "./data.js";
import { stripBraces } from "./model.js";

const BINDING_PREFIX = "\\pgfplots table ";

/**
 * The options in effect for a `\pgfplotstableread` (the `table/…` keys of the
 * `\pgfplotsset`/`\pgfplotstableset` settings before it, then its own, V11)
 * and whether its argument is inline data rather than a file name.
 */
export function pgfplotsTableReadFormat(statement: PgfplotsTableReadStatement, settings: readonly OptionListAst[] = []): { inline: boolean; options: OptionEntry[] } {
  const contextKeys = settings.flatMap((list) => list.entries).filter((entry) => entry.kind !== "unknown" && /^(?:\/pgfplots\/)?table\//u.test(entry.key.trim()));
  const options = [...contextKeys, ...(statement.options?.entries ?? [])];
  let format = "auto";
  let backslashRows = false;
  for (const entry of options) {
    if (entry.kind !== "kv") continue;
    const key = entry.key.trim().replace(/^\/pgfplots\/table\//u, "").replace(/^table\//u, "");
    if (key === "format") format = stripBraces(entry.valueRaw);
    if (key === "row sep") backslashRows = ["\\\\", "crcr"].includes(stripBraces(entry.valueRaw));
  }
  const inline = format === "inline" || (format !== "file" && (/[\n\r]/u.test(statement.dataRaw) || (backslashRows && statement.dataRaw.includes("\\\\"))));
  return { inline, options };
}

/**
 * `\pgfplotstableread[options]{data}\macro`. With `format=auto` (initial) the
 * argument is inline data when it holds a row separator (a newline, or `\\`
 * with `row sep=\\`), otherwise a file name (manual pgfplotstable.tex,
 * `table/format`; E17 `pgfplotstableread*`).
 */
export function recordPgfplotsTableRead(context: SemanticContext, statement: PgfplotsTableReadStatement, settings: readonly OptionListAst[] = []): void {
  if (!statement.macroName) return;
  const { inline, options } = pgfplotsTableReadFormat(statement, settings);
  const table: ReadTableMacro = { data: statement.dataRaw, offset: statement.dataSpan.from, inline, options };
  // The table itself is internal state; the user macro `\macro` is a symbol defined by this statement,
  // so whatever reads the table depends on it (the standalone export carries it).
  writeContextStateBinding(context, `${BINDING_PREFIX}${statement.macroName}`, JSON.stringify(table));
  defineContextSymbol(context, { kind: "macro", name: statement.macroName, statementId: statement.id, span: statement.span });
}

export function readPgfplotsTableMacro(context: SemanticContext, name: string): ReadTableMacro | null {
  void resolveContextSymbol(context, "macro", name.trim());
  const value = readContextStateBinding(context, `${BINDING_PREFIX}${name.trim()}`);
  if (value === undefined) return null;
  try {
    // Written by recordPgfplotsTableRead above.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const parsed = JSON.parse(value) as { data: string; offset: number; inline: boolean; options: OptionEntry[] };
    return parsed;
  } catch {
    return null;
  }
}

/** A table file through the document's resolver; `unavailable` when the host reads no folder. */
export function readPgfplotsTableFile(context: SemanticContext, name: string): TableFileRead {
  const resolver = context.graphicsResolver;
  if (!resolver?.readTextFile) return { status: "unavailable" };
  const result = resolver.readTextFile(name);
  return result.status === "resolved" ? { status: "resolved", text: result.text } : { status: "missing" };
}
