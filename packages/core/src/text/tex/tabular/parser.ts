import { texFragmentParser } from "@tikz-editor/lezer-tex";
import { getTexSyntaxIndex, matchTexSyntaxEnvironments } from "../syntax-index.js";
import type { TexTabular, TexTabularBoundary, TexTabularCell, TexTabularColumn, TexTabularPreamble, TexTabularRow, TexTabularRule, TexTabularSourcePart } from "./types.js";

function skipSpace(source: string, from: number): number {
  let cursor = from;
  while (cursor < source.length) {
    if (/\s/u.test(source[cursor])) cursor++;
    else if (source[cursor] === "%") { const newline = source.indexOf("\n", cursor); cursor = newline < 0 ? source.length : newline + 1; }
    else break;
  }
  return cursor;
}
export function tabularGroup(source: string, from: number, open = "{", close = "}"): { content: string; start: number; end: number } | null {
  const start = skipSpace(source, from);
  if (source[start] !== open) return null;
  let depth = 1;
  for (let i = start + 1; i < source.length; i++) {
    if (source[i] === "\\") { i++; continue; }
    if (source[i] === "%") { i = source.indexOf("\n", i); if (i < 0) return null; continue; }
    if (source[i] === open) depth++;
    if (source[i] === close && --depth === 0) return { content: source.slice(start + 1, i), start: start + 1, end: i + 1 };
  }
  return null;
}

export function parseTexTabularPreamble(source: string, sourceOffset = 0): TexTabularPreamble {
  const columns: TexTabularColumn[] = [];
  const boundaries: TexTabularBoundary[] = [{ rules: 0 }];
  let before = "";
  let beforeParts: TexTabularSourcePart[] = [];
  const mergeBoundary = (left: TexTabularBoundary, right: TexTabularBoundary): TexTabularBoundary => ({
    rules: left.rules + right.rules,
    ...(left.replace !== undefined || right.replace !== undefined ? { replace: (left.replace ?? "") + (right.replace ?? ""), replaceParts: [...left.replaceParts ?? [], ...right.replaceParts ?? []] } : {}),
    ...(left.insert !== undefined || right.insert !== undefined ? { insert: (left.insert ?? "") + (right.insert ?? ""), insertParts: [...left.insertParts ?? [], ...right.insertParts ?? []] } : {}),
  });
  for (let i = 0; i < source.length;) {
    i = skipSpace(source, i);
    if (i >= source.length) break;
    const char = source[i++];
    if (char === "|") { const last = boundaries.length - 1; boundaries[last] = { ...boundaries[last], rules: boundaries[last].rules + 1 }; continue; }
    if (char === "@" || char === "!") {
      const group = tabularGroup(source, i); if (!group) throw new Error("Malformed tabular boundary insert.");
      const last = boundaries.length - 1;
      const part = { text: group.content, sourceStart: sourceOffset + group.start, sourceEnd: sourceOffset + group.end - 1 };
      boundaries[last] = mergeBoundary(boundaries[last], char === "@" ? { rules: 0, replace: group.content, replaceParts: [part] } : { rules: 0, insert: group.content, insertParts: [part] });
      i = group.end; continue;
    }
    if (char === ">" || char === "<") {
      const group = tabularGroup(source, i); if (!group) throw new Error("Malformed tabular column declaration.");
      const part = { text: group.content, sourceStart: sourceOffset + group.start, sourceEnd: sourceOffset + group.end - 1 };
      if (char === ">") { before += group.content; beforeParts.push(part); }
      else { const last = columns.length - 1; if (last < 0) throw new Error("Tabular suffix has no column."); columns[last] = { ...columns[last], after: (columns[last].after ?? "") + group.content, afterParts: [...columns[last].afterParts ?? [], part] }; }
      i = group.end; continue;
    }
    if (char === "*") {
      const count = tabularGroup(source, i); const group = count && tabularGroup(source, count.end);
      if (!count || !group || !/^\d+$/u.test(count.content.trim())) throw new Error("Malformed repeated tabular columns.");
      const n = Number(count.content); if (n > 100) throw new Error("Too many repeated tabular columns.");
      for (let repeat = 0; repeat < n; repeat++) {
        const expanded = parseTexTabularPreamble(group.content, sourceOffset + group.start);
        const last = boundaries.length - 1;
        boundaries[last] = mergeBoundary(boundaries[last], expanded.boundaries[0]);
        columns.push(...expanded.columns.map((column, index) => index === 0 && before ? { ...column, before: before + (column.before ?? ""), beforeParts: [...beforeParts, ...column.beforeParts ?? []] } : column));
        before = ""; beforeParts = [];
        boundaries.push(...expanded.boundaries.slice(1));
      }
      i = group.end; continue;
    }
    const alignment = ({ l: "left", c: "center", r: "right", p: "paragraph", m: "middle", b: "bottom" } as const)[char as "l"];
    if (!alignment) throw new Error(`Unsupported tabular column type ${char}.`);
    const width = "pmb".includes(char) ? tabularGroup(source, i) : null;
    if ("pmb".includes(char) && !width) throw new Error("Missing tabular paragraph column width.");
    columns.push({ alignment, ...(width ? { width: width.content } : {}), ...(before ? { before, beforeParts } : {}) }); before = ""; beforeParts = [];
    boundaries.push({ rules: 0 }); if (width) i = width.end;
  }
  if (!columns.length) throw new Error("Tabular has no columns.");
  return { columns, boundaries };
}

function cell(source: string, from: number, to: number, sourceOffset: number): TexTabularCell {
  let start = skipSpace(source, from); let end = to;
  while (end > start && /\s/u.test(source[end - 1])) end--;
  let span = 1; let preamble: TexTabularPreamble | undefined;
  if (source.startsWith("\\multicolumn", start)) {
    const count = tabularGroup(source, start + 12); const spec = count && tabularGroup(source, count.end); const body = spec && tabularGroup(source, spec.end);
    if (!count || !spec || !body || skipSpace(source, body.end) !== to || !/^\d+$/u.test(count.content.trim())) throw new Error("Malformed multicolumn cell.");
    span = Number(count.content); preamble = parseTexTabularPreamble(spec.content, sourceOffset + spec.start); if (span < 1 || preamble.columns.length !== 1) throw new Error("Invalid multicolumn span.");
    start = body.start; end = body.end - 1;
  }
  return { text: source.slice(start, end), sourceStart: sourceOffset + start, sourceEnd: sourceOffset + end, span, ...(preamble ? { preamble } : {}) };
}

function rule(source: string, start: number, offset: number): { rule: TexTabularRule; end: number } | null {
  const command = /^\\(hline|cline|toprule|midrule|bottomrule|cmidrule|specialrule|addlinespace|morecmidrules)\b/u.exec(source.slice(start));
  if (!command) return null;
  const name = command[1] as TexTabularRule["command"]; let end = start + command[0].length;
  let width: string | undefined; let above: string | undefined; let below: string | undefined; let trimLeft: string | undefined; let trimRight: string | undefined; let from: number | undefined; let to: number | undefined;
  const optional = tabularGroup(source, end, "[", "]"); if (optional) { end = optional.end; if (name === "addlinespace") below = optional.content; else width = optional.content; }
  if (name === "cmidrule") {
    const trim = tabularGroup(source, end, "(", ")"); if (trim) {
      for (let i = 0; i < trim.content.length;) {
        const side = trim.content[i++]; if (side !== "l" && side !== "r") { if (/\s/u.test(side)) continue; throw new Error("Unsupported cmidrule trimming."); }
        const amount = tabularGroup(trim.content, i); if (amount) i = amount.end;
        if (side === "l") trimLeft = amount?.content ?? "default"; else trimRight = amount?.content ?? "default";
      }
      end = trim.end;
    }
  }
  if (name === "cmidrule" || name === "cline") {
    const range = tabularGroup(source, end); const pair = range && /^(\d+)\s*-\s*(\d+)$/u.exec(range.content);
    if (!range || !pair) throw new Error("Malformed partial table rule."); from = Number(pair[1]); to = Number(pair[2]); end = range.end;
  }
  if (name === "specialrule") {
    const a = tabularGroup(source, end); const b = a && tabularGroup(source, a.end); const c = b && tabularGroup(source, b.end);
    if (!a || !b || !c) throw new Error("Malformed specialrule."); width = a.content; above = b.content; below = c.content; end = c.end;
  }
  return { rule: { kind: "rule", command: name, ...(width ? { width } : {}), ...(above ? { above } : {}), ...(below ? { below } : {}), ...(from ? { from, to } : {}), ...(trimLeft ? { trimLeft } : {}), ...(trimRight ? { trimRight } : {}), sourceStart: offset + start, sourceEnd: offset + end }, end };
}

export function parseTexTabular(source: string, from: number, bodyEnd: number, offset = 0): TexTabular {
  let cursor = from; const position = tabularGroup(source, cursor, "[", "]"); if (position) cursor = position.end;
  const preamble = tabularGroup(source, cursor); if (!preamble) throw new Error("Missing tabular preamble."); cursor = preamble.end;
  const nestedEnvironments = new Map([...matchTexSyntaxEnvironments(getTexSyntaxIndex(source, texFragmentParser)).values()].filter((env) => env.span.from >= cursor && env.span.to <= bodyEnd).map((env) => [env.span.from, env.span.to]));
  const items: (TexTabularRow | TexTabularRule)[] = []; let cells: TexTabularCell[] = []; let cellStart = cursor; let depth = 0; let math = false;
  for (let i = cursor; i < bodyEnd;) {
    if (!cells.length && depth === 0 && !math && skipSpace(source, cellStart) === i) {
      const found = rule(source, i, offset); if (found) { items.push(found.rule); i = found.end; cellStart = i; continue; }
    }
    if (source[i] === "%") { const n = source.indexOf("\n", i); i = n < 0 ? bodyEnd : n + 1; continue; }
    if (source[i] === "$") { math = !math; i++; continue; }
    if (source[i] === "{") depth++;
    if (source[i] === "}") depth--;
    if (source[i] === "\\") {
      const nestedEnd = nestedEnvironments.get(i); if (nestedEnd !== undefined) { i = nestedEnd; continue; }
      const rowBreak = depth === 0 && !math ? /^(?:\\\\\*?|\\tabularnewline)\s*/u.exec(source.slice(i)) : null;
      if (rowBreak) {
        cells.push(cell(source, cellStart, i, offset)); i += rowBreak[0].length;
        const leading = tabularGroup(source, i, "[", "]"); if (leading) i = leading.end;
        items.push({ kind: "row", cells, ...(leading ? { extraDepth: leading.content } : {}) }); cells = []; cellStart = i; continue;
      }
      i += 2; continue;
    }
    if (source[i] === "&" && depth === 0 && !math) { cells.push(cell(source, cellStart, i, offset)); cellStart = i + 1; }
    i++;
  }
  if (cells.length || skipSpace(source, cellStart) < bodyEnd) { cells.push(cell(source, cellStart, bodyEnd, offset)); items.push({ kind: "row", cells }); }
  const alignment = position?.content.trim() ?? "c"; if (!["t", "c", "b"].includes(alignment)) throw new Error("Unsupported tabular vertical alignment.");
  return { preamble: parseTexTabularPreamble(preamble.content, offset + preamble.start), alignment: alignment === "t" ? "top" : alignment === "b" ? "bottom" : "center", items, contentStart: offset + cursor, contentEnd: offset + bodyEnd };
}
