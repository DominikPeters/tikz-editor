import { EMPTY_FRAGMENT, joinFragments, sourceSlice, tikz, layout, userText, type TikzFragment } from "../fragment.js";
import { requireArrayValue } from "../../utils/collections.js";
import type { EditActionResultLike } from "../result-types.js";
import { replaceSpan } from "../patch.js";
import { resolvePropertyTarget } from "../property-target.js";
import type { EditParseOptions } from "../parse-options.js";
import { parseMatrixRowsForEdit, resolveMatrixMode } from "../../semantic/nodes/matrix.js";
import type { Span } from "../../ast/types.js";


type MatrixStructureTarget = {
  matrixSourceId: string;
  source: string;
  matrixText: string;
  matrixTextSpan: Span;
  cellSeparator: TikzFragment;
};

export type AddMatrixRowAction = {
  matrixSourceId: string;
  rowIndex: number;
};

export type RemoveMatrixRowAction = {
  matrixSourceId: string;
  rowIndex: number;
};

export type AddMatrixColumnAction = {
  matrixSourceId: string;
  columnIndex: number;
};

export type RemoveMatrixColumnAction = {
  matrixSourceId: string;
  columnIndex: number;
};

export type TransposeMatrixAction = {
  matrixSourceId: string;
};

export function applyAddMatrixRowAction(
  source: string,
  action: AddMatrixRowAction,
  parseOptions: EditParseOptions = {}
): EditActionResultLike {
  const target = resolveMatrixStructureTarget(source, action.matrixSourceId, parseOptions);
  if (target.kind !== "ok") {
    return target;
  }
  const { rows, rowCount, colCount } = parseMatrixGrid(target.value);
  if (!Number.isInteger(action.rowIndex) || action.rowIndex < 1 || action.rowIndex > rowCount + 1) {
    return { kind: "unsupported", reason: `addMatrixRow rowIndex must be in 1..${rowCount + 1}.` };
  }
  rows.splice(action.rowIndex - 1, 0, Array.from<TikzFragment>({ length: colCount }).fill(EMPTY_FRAGMENT));
  return rewriteMatrixText(source, target.value.matrixTextSpan, serializeMatrixRows(rows, target.value.cellSeparator), [
    action.matrixSourceId
  ]);
}

export function applyRemoveMatrixRowAction(
  source: string,
  action: RemoveMatrixRowAction,
  parseOptions: EditParseOptions = {}
): EditActionResultLike {
  const target = resolveMatrixStructureTarget(source, action.matrixSourceId, parseOptions);
  if (target.kind !== "ok") {
    return target;
  }
  const { rows, rowCount } = parseMatrixGrid(target.value);
  if (rowCount <= 1) {
    return { kind: "unsupported", reason: "Cannot remove the last matrix row." };
  }
  if (!Number.isInteger(action.rowIndex) || action.rowIndex < 1 || action.rowIndex > rowCount) {
    return { kind: "unsupported", reason: `removeMatrixRow rowIndex must be in 1..${rowCount}.` };
  }
  rows.splice(action.rowIndex - 1, 1);
  return rewriteMatrixText(source, target.value.matrixTextSpan, serializeMatrixRows(rows, target.value.cellSeparator), [
    action.matrixSourceId
  ]);
}

export function applyAddMatrixColumnAction(
  source: string,
  action: AddMatrixColumnAction,
  parseOptions: EditParseOptions = {}
): EditActionResultLike {
  const target = resolveMatrixStructureTarget(source, action.matrixSourceId, parseOptions);
  if (target.kind !== "ok") {
    return target;
  }
  const { rows, colCount } = parseMatrixGrid(target.value);
  if (!Number.isInteger(action.columnIndex) || action.columnIndex < 1 || action.columnIndex > colCount + 1) {
    return { kind: "unsupported", reason: `addMatrixColumn columnIndex must be in 1..${colCount + 1}.` };
  }
  for (const row of rows) {
    row.splice(action.columnIndex - 1, 0, EMPTY_FRAGMENT);
  }
  return rewriteMatrixText(source, target.value.matrixTextSpan, serializeMatrixRows(rows, target.value.cellSeparator), [
    action.matrixSourceId
  ]);
}

export function applyRemoveMatrixColumnAction(
  source: string,
  action: RemoveMatrixColumnAction,
  parseOptions: EditParseOptions = {}
): EditActionResultLike {
  const target = resolveMatrixStructureTarget(source, action.matrixSourceId, parseOptions);
  if (target.kind !== "ok") {
    return target;
  }
  const { rows, colCount } = parseMatrixGrid(target.value);
  if (colCount <= 1) {
    return { kind: "unsupported", reason: "Cannot remove the last matrix column." };
  }
  if (!Number.isInteger(action.columnIndex) || action.columnIndex < 1 || action.columnIndex > colCount) {
    return { kind: "unsupported", reason: `removeMatrixColumn columnIndex must be in 1..${colCount}.` };
  }
  for (const row of rows) {
    row.splice(action.columnIndex - 1, 1);
  }
  return rewriteMatrixText(source, target.value.matrixTextSpan, serializeMatrixRows(rows, target.value.cellSeparator), [
    action.matrixSourceId
  ]);
}

export function applyTransposeMatrixAction(
  source: string,
  action: TransposeMatrixAction,
  parseOptions: EditParseOptions = {}
): EditActionResultLike {
  const target = resolveMatrixStructureTarget(source, action.matrixSourceId, parseOptions);
  if (target.kind !== "ok") {
    return target;
  }
  const { rows, rowCount, colCount } = parseMatrixGrid(target.value);
  const transposed: TikzFragment[][] = [];
  for (let column = 0; column < colCount; column += 1) {
    const nextRow: TikzFragment[] = [];
    for (let row = 0; row < rowCount; row += 1) {
      nextRow.push(requireArrayValue(requireArrayValue(rows, row), column));
    }
    transposed.push(trimTrailingEmptyCells(nextRow));
  }

  return rewriteMatrixText(source, target.value.matrixTextSpan, serializeMatrixRows(transposed, target.value.cellSeparator), [
    action.matrixSourceId
  ]);
}

function resolveMatrixStructureTarget(
  source: string,
  matrixSourceId: string,
  parseOptions: EditParseOptions
): { kind: "ok"; value: MatrixStructureTarget } | { kind: "unsupported"; reason: string } {
  const resolved = resolvePropertyTarget(source, matrixSourceId, parseOptions);
  if (resolved.kind === "not-found" || resolved.target.kind !== "matrix-statement") {
    return { kind: "unsupported", reason: `Could not resolve matrix statement ${matrixSourceId}.` };
  }

  const matrixTextSpan = resolved.target.matrixTextSpan;
  if (!matrixTextSpan || matrixTextSpan.to <= matrixTextSpan.from) {
    return { kind: "unsupported", reason: "Matrix text span is unavailable for structural editing." };
  }

  const mode = resolveMatrixMode(resolved.target.options);
  if (!mode.enabled) {
    return { kind: "unsupported", reason: "Matrix structural actions require a matrix statement target." };
  }

  return {
    kind: "ok",
    value: {
      matrixSourceId,
      source,
      matrixText: source.slice(matrixTextSpan.from, matrixTextSpan.to),
      matrixTextSpan,
      // The separator the matrix's own options chose (`&` unless the user replaced it).
      cellSeparator: userText(mode.cellSeparator, "source-editor")
    }
  };
}

function parseMatrixGrid(target: MatrixStructureTarget): { rows: TikzFragment[][]; rowCount: number; colCount: number } {
  const parsed = parseMatrixRowsForEdit(target.matrixText, target.cellSeparator, target.matrixTextSpan.from);
  const rowCount = Math.max(1, parsed.rows.length);
  const colCount = Math.max(
    1,
    parsed.rows.reduce((max, row) => Math.max(max, row.cells.length), 0)
  );
  const rows = parsed.rows.map((row) => {
    // Each cell is the document text at its span.
    const values = row.cells.map((cell) => sourceSlice(target.source, cell.span));
    while (values.length < colCount) {
      values.push(EMPTY_FRAGMENT);
    }
    return values;
  });
  while (rows.length < rowCount) {
    rows.push(Array.from<TikzFragment>({ length: colCount }).fill(EMPTY_FRAGMENT));
  }
  return { rows, rowCount, colCount };
}

function trimTrailingEmptyCells(row: TikzFragment[]): TikzFragment[] {
  let lastNonEmpty = -1;
  for (let index = row.length - 1; index >= 0; index -= 1) {
    if ((row[index] ?? "").trim().length > 0) {
      lastNonEmpty = index;
      break;
    }
  }
  if (lastNonEmpty < 0) {
    return [EMPTY_FRAGMENT];
  }
  return row.slice(0, lastNonEmpty + 1);
}

function serializeMatrixRows(rows: ReadonlyArray<ReadonlyArray<TikzFragment>>, separator: TikzFragment): TikzFragment {
  const joiner = tikz` ${separator} `;
  return joinFragments(
    rows.map((row) => joinFragments([...row], joiner)),
    tikz` \\${layout("\n")}`
  );
}

function rewriteMatrixText(
  source: string,
  matrixTextSpan: Span,
  replacement: TikzFragment,
  changedSourceIds: string[]
): EditActionResultLike {
  const updated = replaceSpan(source, matrixTextSpan, replacement);
  if (updated.source === source) {
    return { kind: "unsupported", reason: "Matrix structural edit would not change the source." };
  }
  return {
    kind: "success",
    newSource: updated.source,
    patches: [
      {
        oldSpan: matrixTextSpan,
        newSpan: updated.changedSpan,
        replacement
      }
    ],
    changedSourceIds
  };
}
