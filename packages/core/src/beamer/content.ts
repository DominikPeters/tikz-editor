import type { Span } from "../ast/types.js";
import type { Diagnostic } from "../diagnostics/types.js";
import {
  readBeamerRequiredArgument,
  scanBeamerControlSequences,
  scanBeamerEnvironmentTokens,
  type BeamerEnvironmentToken,
} from "./scan.js";
import type {
  BeamerColumnBodyNode,
  BeamerColumnFlowNode,
  BeamerColumnsBodyNode,
  BeamerFrameBodyIr,
  BeamerFrameBodyNode,
  BeamerParagraphBodyNode,
  ParseBeamerFrameBodyParams,
} from "./content-types.js";

const LIST_ENVIRONMENTS = new Set([
  "itemize",
  "enumerate",
  "description",
]);

/**
 * Lower frame-level source structure into a source-backed composition IR.
 *
 * This frontend owns Beamer environments. Text leaves remain exact source
 * spans for the generic TeX paragraph/vlist frontend.
 */
export function parseBeamerFrameBody(
  params: ParseBeamerFrameBodyParams
): BeamerFrameBodyIr {
  const { source, frame } = params;
  const diagnostics: Diagnostic[] = [];
  const tokens = scanBeamerEnvironmentTokens(source, frame.bodySpan);
  const children: BeamerFrameBodyNode[] = [];
  let cursor = frame.bodySpan.from;
  let nodeIndex = 0;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind !== "begin" || token.name !== "columns") {
      continue;
    }
    const endIndex = matchingEnvironmentEnd(tokens, index);
    if (endIndex < 0) {
      diagnostics.push({
        severity: "error",
        code: "beamer-unterminated-columns",
        message: "The columns environment has no matching end.",
        span: token.span,
      });
      break;
    }
    const end = tokens[endIndex];
    pushTextNode(source, { from: cursor, to: token.span.from }, frame.id, children);
    children.push(parseColumns({
      source,
      frameId: frame.id,
      begin: token,
      end,
      tokens: tokens.slice(index + 1, endIndex),
      diagnostics,
      nodeIndex,
    }));
    nodeIndex += 1;
    cursor = end.span.to;
    index = endIndex;
  }

  pushTextNode(source, { from: cursor, to: frame.bodySpan.to }, frame.id, children);
  return {
    kind: "frame-body",
    frameId: frame.id,
    span: frame.bodySpan,
    children,
    diagnostics,
  };
}

function parseColumns(params: {
  source: string;
  frameId: string;
  begin: BeamerEnvironmentToken;
  end: BeamerEnvironmentToken;
  tokens: readonly BeamerEnvironmentToken[];
  diagnostics: Diagnostic[];
  nodeIndex: number;
}): BeamerColumnsBodyNode {
  const {
    source,
    frameId,
    begin,
    end,
    tokens,
    diagnostics,
    nodeIndex,
  } = params;
  const columns: BeamerColumnBodyNode[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind !== "begin" || token.name !== "column") {
      continue;
    }
    const endIndex = matchingEnvironmentEnd(tokens, index);
    if (endIndex < 0) {
      diagnostics.push({
        severity: "error",
        code: "beamer-unterminated-column",
        message: "The column environment has no matching end.",
        span: token.span,
      });
      continue;
    }
    const columnEnd = tokens[endIndex];
    const width = readBeamerRequiredArgument(
      source,
      token.span.to,
      columnEnd.span.from
    );
    if (!width) {
      diagnostics.push({
        severity: "error",
        code: "beamer-column-missing-width",
        message: "A Beamer column requires a width argument.",
        span: token.span,
      });
      index = endIndex;
      continue;
    }
    const bodySpan = {
      from: width.span.to,
      to: columnEnd.span.from,
    };
    columns.push({
      kind: "column",
      id: `${frameId}:columns:${nodeIndex}:column:${columns.length}`,
      span: { from: token.span.from, to: columnEnd.span.to },
      beginSpan: token.span,
      endSpan: columnEnd.span,
      width,
      bodySpan,
      children: parseColumnFlow(
        source,
        frameId,
        columns.length,
        bodySpan,
        tokens.slice(index + 1, endIndex)
      ),
    });
    index = endIndex;
  }
  return {
    kind: "columns",
    id: `${frameId}:columns:${nodeIndex}`,
    span: { from: begin.span.from, to: end.span.to },
    beginSpan: begin.span,
    endSpan: end.span,
    bodySpan: { from: begin.span.to, to: end.span.from },
    columns,
  };
}

function parseColumnFlow(
  source: string,
  frameId: string,
  columnIndex: number,
  bodySpan: Span,
  tokens: readonly BeamerEnvironmentToken[]
): BeamerColumnFlowNode[] {
  const structural: Array<{
    span: Span;
    node: BeamerColumnFlowNode;
  }> = [];
  let nodeIndex = 0;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (
      token.kind !== "begin" ||
      !LIST_ENVIRONMENTS.has(token.name)
    ) {
      continue;
    }
    const endIndex = matchingEnvironmentEnd(tokens, index);
    if (endIndex < 0) {
      continue;
    }
    const end = tokens[endIndex];
    const span = { from: token.span.from, to: end.span.to };
    structural.push({
      span,
      node: {
        kind: "list",
        id: `${frameId}:column:${columnIndex}:list:${nodeIndex}`,
        environment: token.name as "itemize" | "enumerate" | "description",
        span,
      },
    });
    nodeIndex += 1;
    index = endIndex;
  }

  for (const root of scanTikzRootsInSpan(source, frameId, bodySpan)) {
    structural.push({
      span: root.span,
      node: {
        kind: "tikzpicture",
        id: `${frameId}:column:${columnIndex}:tikz:${nodeIndex}`,
        span: root.span,
        root,
      },
    });
    nodeIndex += 1;
  }

  for (const command of scanBeamerControlSequences(source, bodySpan)) {
    if (command.name !== "vspace") {
      continue;
    }
    const value = readBeamerRequiredArgument(source, command.to, bodySpan.to);
    if (!value) {
      continue;
    }
    const span = { from: command.from, to: value.span.to };
    structural.push({
      span,
      node: {
        kind: "vertical-space",
        id: `${frameId}:column:${columnIndex}:vspace:${nodeIndex}`,
        span,
        starred: command.starred,
        value,
      },
    });
    nodeIndex += 1;
  }

  structural.sort((left, right) => left.span.from - right.span.from);
  const result: BeamerColumnFlowNode[] = [];
  let cursor = bodySpan.from;
  for (const entry of structural) {
    if (entry.span.from < cursor) {
      continue;
    }
    pushTextNode(
      source,
      { from: cursor, to: entry.span.from },
      `${frameId}:column:${columnIndex}`,
      result
    );
    result.push(entry.node);
    cursor = entry.span.to;
  }
  pushTextNode(
    source,
    { from: cursor, to: bodySpan.to },
    `${frameId}:column:${columnIndex}`,
    result
  );
  return result;
}

function scanTikzRootsInSpan(
  source: string,
  frameId: string,
  span: Span
) {
  const tokens = scanBeamerEnvironmentTokens(source, span);
  const roots: Array<{
    kind: "tikzpicture";
    id: string;
    span: Span;
    beginSpan: Span;
    endSpan: Span;
  }> = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind !== "begin" || token.name !== "tikzpicture") {
      continue;
    }
    const endIndex = matchingEnvironmentEnd(tokens, index);
    if (endIndex < 0) {
      continue;
    }
    const end = tokens[endIndex];
    roots.push({
      kind: "tikzpicture",
      id: `${frameId}:tikz:${roots.length}`,
      span: { from: token.span.from, to: end.span.to },
      beginSpan: token.span,
      endSpan: end.span,
    });
    index = endIndex;
  }
  return roots;
}

function matchingEnvironmentEnd(
  tokens: readonly BeamerEnvironmentToken[],
  beginIndex: number
): number {
  const begin = tokens[beginIndex];
  if (begin?.kind !== "begin") {
    return -1;
  }
  let depth = 0;
  for (let index = beginIndex; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.name !== begin.name) {
      continue;
    }
    depth += token.kind === "begin" ? 1 : -1;
    if (depth === 0) {
      return index;
    }
  }
  return -1;
}

function pushTextNode(
  source: string,
  span: Span,
  ownerId: string,
  target: { length: number; push(node: BeamerParagraphBodyNode): unknown }
): void {
  const trimmed = trimSpan(source, span);
  if (trimmed.to <= trimmed.from) {
    return;
  }
  target.push({
    kind: "paragraph",
    id: `${ownerId}:paragraph:${target.length}`,
    span: trimmed,
  });
}

function trimSpan(source: string, span: Span): Span {
  let { from, to } = span;
  while (from < to && /\s/u.test(source[from])) {
    from += 1;
  }
  while (to > from && /\s/u.test(source[to - 1])) {
    to -= 1;
  }
  return { from, to };
}
