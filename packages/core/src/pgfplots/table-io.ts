/**
 * The host side of pgfplots table input: tables read by `\pgfplotstableread`
 * (kept in the macro bindings, so TeX's scoping applies) and table files read
 * through the document's resource resolver.
 */
import type { PgfplotsTableReadStatement } from "../ast/types.js";
import type { OptionEntry } from "../options/types.js";
import { readContextMacroBinding, writeContextMacroBinding, type SemanticContext } from "../semantic/context.js";
import type { ReadTableMacro, TableFileRead } from "./data.js";
import { stripBraces } from "./model.js";

const BINDING_PREFIX = "\\pgfplots table ";

/**
 * `\pgfplotstableread[options]{data}\macro`. With `format=auto` (initial) the
 * argument is inline data when it holds a row separator (a newline, or `\\`
 * with `row sep=\\`), otherwise a file name (manual pgfplotstable.tex,
 * `table/format`; E17 `pgfplotstableread*`).
 */
export function recordPgfplotsTableRead(context: SemanticContext, statement: PgfplotsTableReadStatement): void {
  if (!statement.macroName) return;
  const options = statement.options?.entries ?? [];
  let format = "auto";
  let backslashRows = false;
  for (const entry of options) {
    if (entry.kind !== "kv") continue;
    const key = entry.key.trim().replace(/^\/pgfplots\/table\//u, "").replace(/^table\//u, "");
    if (key === "format") format = stripBraces(entry.valueRaw);
    if (key === "row sep") backslashRows = ["\\\\", "crcr"].includes(stripBraces(entry.valueRaw));
  }
  const inline = format === "inline" || (format !== "file" && (/[\n\r]/u.test(statement.dataRaw) || (backslashRows && statement.dataRaw.includes("\\\\"))));
  const table: ReadTableMacro = { data: statement.dataRaw, offset: statement.dataSpan.from, inline, options };
  writeContextMacroBinding(context, `${BINDING_PREFIX}${statement.macroName}`, { kind: "text", value: JSON.stringify(table), provenance: [] });
}

export function readPgfplotsTableMacro(context: SemanticContext, name: string): ReadTableMacro | null {
  const binding = readContextMacroBinding(context, `${BINDING_PREFIX}${name.trim()}`);
  if (binding?.kind !== "text") return null;
  try {
    // Written by recordPgfplotsTableRead above.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    const parsed = JSON.parse(binding.value) as { data: string; offset: number; inline: boolean; options: OptionEntry[] };
    return parsed;
  } catch {
    return null;
  }
}

/** A table file through the document's resolver; `unavailable` when the host reads no folder. */
export function readPgfplotsTableFile(context: SemanticContext, name: string): TableFileRead {
  const reader = context.graphicsResolver?.readTextFile;
  if (!reader) return { status: "unavailable" };
  const result = reader.call(context.graphicsResolver, name);
  return result.status === "resolved" ? { status: "resolved", text: result.text } : { status: "missing" };
}
