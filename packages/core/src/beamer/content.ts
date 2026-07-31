import type { Span } from "../ast/types.js";
import type { Diagnostic } from "../diagnostics/types.js";
import {
  concatMappedText,
  createGeneratedMappedText,
  createIdentityMappedText,
} from "../text/source-map.js";
import {
  beamerSyntaxContext,
  beamerOptionalArgumentAfter,
  beamerOverlayArgumentAfter,
  beamerRequiredArgumentAfter,
  beamerControlSequencesIn,
  beamerEnvironmentBoundariesIn,
  type BeamerSyntaxContext,
  type BeamerEnvironmentBoundary,
} from "./syntax.js";
import type {
  BeamerColumnAlignment,
  BeamerBlockBodyNode,
  BeamerBlockEnvironment,
  BeamerColumnBodyNode,
  BeamerColumnFlowNode,
  BeamerColumnsBodyNode,
  BeamerFrameBodyIr,
  BeamerFrameBodyNode,
  BeamerParagraphBodyNode,
  BeamerTitlePageBodyNode,
  BeamerTheoremBodyNode,
  BeamerTikzBodyNode,
  BeamerVerticalSpaceBodyNode,
  ParseBeamerFrameBodyParams,
} from "./content-types.js";
import { scanBeamerFrameOverlays } from "./overlay.js";
import {
  resolveBeamerTheoremOccurrences,
  type BeamerTheoremOccurrence,
} from "./theorems.js";
import type { BeamerTheoremTemplateVariant } from "./types.js";

const LIST_ENVIRONMENTS = new Set([
  "itemize",
  "enumerate",
  "description",
]);
const BLOCK_ENVIRONMENTS = new Set<BeamerBlockEnvironment>([
  "block",
  "alertblock",
  "exampleblock",
]);
const PROOF_ENVIRONMENTS = new Map<string, string>([
  ["proof", "Proof"],
  ["Proof", "Proof"],
  ["Beweis", "Beweis"],
]);

function isProofEnvironment(name: string): boolean {
  return PROOF_ENVIRONMENTS.has(name);
}

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
  const context = beamerSyntaxContext(source, params.syntax);
  const diagnostics: Diagnostic[] = [];
  const tokens = beamerEnvironmentBoundariesIn(context, frame.bodySpan);
  const theoremOccurrences =
    params.theoremOccurrences ??
    (params.document
      ? resolveBeamerTheoremOccurrences(params.document, context.syntax)
      : new Map<number, BeamerTheoremOccurrence>());
  const theoremTemplate =
    params.document?.preamble.theoremTemplate ?? "default";
  const children: BeamerFrameBodyNode[] = [];
  let cursor = frame.bodySpan.from;
  let nodeIndex = 0;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (
      token.kind !== "begin" ||
      (token.name !== "columns" &&
        token.name !== "tikzpicture" &&
        token.name !== "center" &&
        !isProofEnvironment(token.name) &&
        !theoremOccurrences.has(token.span.from) &&
        !BLOCK_ENVIRONMENTS.has(token.name as BeamerBlockEnvironment))
    ) {
      continue;
    }
    const endIndex = matchingEnvironmentEnd(tokens, index);
    if (endIndex < 0) {
      diagnostics.push({
        severity: "error",
        code: token.name === "columns"
          ? "beamer-unterminated-columns"
          : "beamer-unterminated-block",
        message: `The ${token.name} environment has no matching end.`,
        span: token.span,
      });
      break;
    }
    const end = tokens[endIndex];
    const tikzNode = frameTikzFlowNode({
      source,
      context,
      frameId: frame.id,
      begin: token,
      end,
      nodeIndex,
    });
    if (
      (token.name === "tikzpicture" || token.name === "center") &&
      !tikzNode
    ) {
      // An ordinary center environment remains owned by the generic TeX
      // vlist frontend. Only extract a center whose sole material is one
      // TikZ picture.
      continue;
    }
    pushTextNode(source, { from: cursor, to: token.span.from }, frame.id, children);
    children.push(
      tikzNode ??
      (token.name === "columns"
        ? parseColumns({
            context,
            frameId: frame.id,
            begin: token,
            end,
            tokens: tokens.slice(index + 1, endIndex),
            diagnostics,
            nodeIndex,
            theoremOccurrences,
            theoremTemplate,
          })
        : isProofEnvironment(token.name) ||
            theoremOccurrences.has(token.span.from)
          ? parseTheorem({
              source,
              context,
              ownerId: frame.id,
              begin: token,
              end,
              nodeIndex,
              occurrence: theoremOccurrences.get(token.span.from) ?? null,
              theoremTemplate,
            })
          : parseBlock({
            source,
            context,
            ownerId: frame.id,
            begin: token,
            end,
            nodeIndex,
            diagnostics,
          })
      )
    );
    nodeIndex += 1;
    cursor = end.span.to;
    index = endIndex;
  }

  pushTextNode(source, { from: cursor, to: frame.bodySpan.to }, frame.id, children);
  return {
    kind: "frame-body",
    frameId: frame.id,
    span: frame.bodySpan,
    children: splitStandaloneFrameCommands(context, frame.id, children),
    overlays: scanBeamerFrameOverlays(source, frame, context.syntax),
    diagnostics,
  };
}

function parseTheorem(params: {
  source: string;
  context: BeamerSyntaxContext;
  ownerId: string;
  begin: BeamerEnvironmentBoundary;
  end: BeamerEnvironmentBoundary;
  nodeIndex: number;
  occurrence: BeamerTheoremOccurrence | null;
  theoremTemplate: BeamerTheoremTemplateVariant;
}): BeamerTheoremBodyNode {
  const {
    source,
    context,
    ownerId,
    begin,
    end,
    nodeIndex,
    occurrence,
    theoremTemplate,
  } = params;
  let cursor = begin.span.to;
  let overlay = beamerOverlayArgumentAfter(context, cursor, end.span.from) ??
    undefined;
  if (overlay) {
    cursor = overlay.span.to;
  }
  const addition = beamerOptionalArgumentAfter(
    context,
    cursor,
    end.span.from
  ) ?? undefined;
  if (addition) {
    cursor = addition.span.to;
  }
  if (!overlay) {
    overlay = beamerOverlayArgumentAfter(context, cursor, end.span.from) ??
      undefined;
    if (overlay) {
      cursor = overlay.span.to;
    }
  }
  const proofName = PROOF_ENVIRONMENTS.get(begin.name);
  const proof = proofName != null;
  const declaration = occurrence?.declaration ?? null;
  const titleOwner = { from: begin.span.from, to: cursor };
  const displayName = proof
    ? addition?.value ?? proofName
    : declaration?.displayName.value ?? begin.name;
  const titleParts = [
    createGeneratedMappedText(
      displayName,
      proof
        ? "Beamer proof heading"
        : "Beamer theorem declaration heading",
      titleOwner
    ),
  ];
  if (
    !proof &&
    occurrence?.number &&
    (theoremTemplate === "numbered" || theoremTemplate === "ams-style")
  ) {
    titleParts.push(
      createGeneratedMappedText(
        ` ${occurrence.number}`,
        "Beamer theorem counter",
        titleOwner
      )
    );
  }
  if (!proof && addition) {
    titleParts.push(
      createGeneratedMappedText(" (", "Beamer theorem heading punctuation", titleOwner),
      createIdentityMappedText(addition.value, addition.contentSpan.from),
      createGeneratedMappedText(")", "Beamer theorem heading punctuation", titleOwner)
    );
  }
  if (proof || theoremTemplate === "ams-style") {
    titleParts.push(
      createGeneratedMappedText(".", "Beamer theorem heading punctuation", titleOwner)
    );
  }
  const titleMapped = concatMappedText(titleParts);
  const title = {
    span: titleOwner,
    contentSpan: titleOwner,
    value: titleMapped.text,
  };
  const bodySpan = { from: cursor, to: end.span.from };
  const children: BeamerTheoremBodyNode["children"] = [];
  pushTextNode(
    source,
    bodySpan,
    `${ownerId}:theorem:${nodeIndex}`,
    children
  );
  return {
    kind: "theorem",
    id: `${ownerId}:theorem:${nodeIndex}`,
    environment: begin.name,
    blockEnvironment:
      declaration?.style === "example" ? "exampleblock" : "block",
    theoremStyle: declaration?.style ?? "definition",
    theoremTemplate,
    declaration,
    number: occurrence?.number ?? null,
    proof,
    qed: proof,
    span: { from: begin.span.from, to: end.span.to },
    beginSpan: begin.span,
    endSpan: end.span,
    overlay,
    addition,
    title,
    titleMapped,
    bodySpan,
    children,
  };
}

function splitStandaloneFrameCommands(
  context: BeamerSyntaxContext,
  frameId: string,
  children: readonly BeamerFrameBodyNode[]
): BeamerFrameBodyNode[] {
  return splitStandaloneVerticalSpaces(
    context,
    frameId,
    splitVerticalFillCommands(
      context,
      stripFrameTitleCommands(
        context,
        splitTitlePageCommands(context, frameId, children)
      )
    )
  );
}

/**
 * `\frametitle`/`\framesubtitle` commands are frame header material: the
 * scanner lifts their values into the frame model, and Beamer never
 * typesets the commands as body prose. Remove them (with their arguments)
 * from paragraph flow so they are neither rendered literally nor editable
 * as body text.
 */
function stripFrameTitleCommands(
  context: BeamerSyntaxContext,
  children: readonly BeamerFrameBodyNode[]
): BeamerFrameBodyNode[] {
  const { source } = context;
  const result: BeamerFrameBodyNode[] = [];
  for (const child of children) {
    if (child.kind !== "paragraph") {
      result.push(child);
      continue;
    }
    const removals: Span[] = [];
    for (const command of beamerControlSequencesIn(context, child.span)) {
      if (
        (command.name !== "frametitle" && command.name !== "framesubtitle") ||
        !hasBalancedBraces(source, { from: child.span.from, to: command.from })
      ) {
        continue;
      }
      let cursor = command.to;
      const overlay = beamerOverlayArgumentAfter(context, cursor, child.span.to);
      if (overlay) {
        cursor = overlay.span.to;
      }
      const optional = beamerOptionalArgumentAfter(
        context,
        cursor,
        child.span.to
      );
      if (optional) {
        cursor = optional.span.to;
      }
      const value = beamerRequiredArgumentAfter(context, cursor, child.span.to);
      if (value) {
        removals.push({ from: command.from, to: value.span.to });
      }
    }
    if (removals.length === 0) {
      result.push(child);
      continue;
    }
    emitParagraphPieces(source, child, removals, result);
  }
  return result;
}

/**
 * TeX ends the current paragraph when it reaches vertical glue like
 * `\vfill` in horizontal mode. The generic text frontend only supports
 * vertical glue at paragraph-block starts (mid-paragraph `\vspace` gets
 * the LaTeX `\vadjust` lowering; other glue aborts the whole chunk), so
 * cut body chunks in front of each `\vfill` — the glue then leads its own
 * chunk, which the frontend supports, and the surrounding prose survives.
 */
function splitVerticalFillCommands(
  context: BeamerSyntaxContext,
  children: readonly BeamerFrameBodyNode[]
): BeamerFrameBodyNode[] {
  const { source } = context;
  const result: BeamerFrameBodyNode[] = [];
  for (const child of children) {
    if (child.kind !== "paragraph") {
      result.push(child);
      continue;
    }
    const cuts: Span[] = [];
    let pieceStart = child.span.from;
    for (const command of beamerControlSequencesIn(context, child.span)) {
      if (command.name !== "vfill") {
        continue;
      }
      const before = trimSpan(source, { from: pieceStart, to: command.from });
      if (
        before.to <= before.from ||
        !hasBalancedBraces(source, { from: pieceStart, to: command.from })
      ) {
        continue;
      }
      cuts.push({ from: command.from, to: command.from });
      pieceStart = command.from;
    }
    if (cuts.length === 0) {
      result.push(child);
      continue;
    }
    emitParagraphPieces(source, child, cuts, result);
  }
  return result;
}

/**
 * Re-emit one paragraph node as the trimmed non-empty pieces around the
 * given disjoint ordered spans. The first piece keeps the original node id
 * so untouched siblings never collide; later pieces derive from it.
 */
function emitParagraphPieces(
  source: string,
  child: BeamerParagraphBodyNode,
  removals: readonly Span[],
  target: BeamerFrameBodyNode[]
): void {
  let cursor = child.span.from;
  let pieceIndex = 0;
  const pushPiece = (span: Span) => {
    const trimmed = trimSpan(source, span);
    if (trimmed.to <= trimmed.from) {
      return;
    }
    target.push({
      kind: "paragraph",
      id: pieceIndex === 0 ? child.id : `${child.id}:${pieceIndex}`,
      span: trimmed,
    });
    pieceIndex += 1;
  };
  for (const removal of removals) {
    if (removal.from < cursor) {
      continue;
    }
    pushPiece({ from: cursor, to: removal.from });
    cursor = removal.to;
  }
  pushPiece({ from: cursor, to: child.span.to });
}

function hasBalancedBraces(source: string, span: Span): boolean {
  let depth = 0;
  for (let index = span.from; index < span.to; index += 1) {
    const char = source[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth < 0) {
        return false;
      }
    }
  }
  return depth === 0;
}

function splitTitlePageCommands(
  context: BeamerSyntaxContext,
  frameId: string,
  children: readonly BeamerFrameBodyNode[]
): BeamerFrameBodyNode[] {
  const { source } = context;
  const result: BeamerFrameBodyNode[] = [];
  let titlePageIndex = 0;
  let paragraphIndex = 0;
  for (const child of children) {
    if (child.kind !== "paragraph") {
      result.push(child);
      continue;
    }
    const commands = beamerControlSequencesIn(context, child.span).filter(
      (command) => command.name === "titlepage"
    );
    if (commands.length === 0) {
      result.push(child);
      continue;
    }
    let cursor = child.span.from;
    for (const command of commands) {
      const before = trimSpan(source, { from: cursor, to: command.from });
      if (before.to > before.from) {
        result.push({
          kind: "paragraph",
          id: `${frameId}:paragraph:${paragraphIndex}`,
          span: before,
        });
        paragraphIndex += 1;
      }
      const titlePage: BeamerTitlePageBodyNode = {
        kind: "title-page",
        id: `${frameId}:title-page:${titlePageIndex}`,
        span: { from: command.from, to: command.to },
        commandSpan: { from: command.from, to: command.to },
      };
      result.push(titlePage);
      titlePageIndex += 1;
      cursor = command.to;
    }
    const after = trimSpan(source, { from: cursor, to: child.span.to });
    if (after.to > after.from) {
      result.push({
        kind: "paragraph",
        id: `${frameId}:paragraph:${paragraphIndex}`,
        span: after,
      });
      paragraphIndex += 1;
    }
  }
  return result;
}

function splitStandaloneVerticalSpaces(
  context: BeamerSyntaxContext,
  frameId: string,
  children: readonly BeamerFrameBodyNode[]
): BeamerFrameBodyNode[] {
  const result: BeamerFrameBodyNode[] = [];
  let verticalSpaceIndex = 0;
  for (const child of children) {
    if (child.kind !== "paragraph") {
      result.push(child);
      continue;
    }
    const nodes = standaloneVerticalSpaceNodes(
      context,
      frameId,
      child.span,
      verticalSpaceIndex
    );
    if (!nodes) {
      result.push(child);
      continue;
    }
    result.push(...nodes);
    verticalSpaceIndex += nodes.length;
  }
  return result;
}

function standaloneVerticalSpaceNodes(
  context: BeamerSyntaxContext,
  frameId: string,
  span: Span,
  firstIndex: number
): BeamerVerticalSpaceBodyNode[] | null {
  const { source } = context;
  const result: BeamerVerticalSpaceBodyNode[] = [];
  let cursor = span.from;
  for (const command of beamerControlSequencesIn(context, span)) {
    if (
      command.name !== "vspace" ||
      !isIgnorableFrameSource(source, { from: cursor, to: command.from })
    ) {
      return null;
    }
    const value = beamerRequiredArgumentAfter(context, command.to, span.to);
    if (!value) {
      return null;
    }
    const nodeSpan = { from: command.from, to: value.span.to };
    result.push({
      kind: "vertical-space",
      id: `${frameId}:vspace:${firstIndex + result.length}`,
      span: nodeSpan,
      starred: command.starred,
      value,
    });
    cursor = nodeSpan.to;
  }
  return result.length > 0 &&
      isIgnorableFrameSource(source, { from: cursor, to: span.to })
    ? result
    : null;
}

function isIgnorableFrameSource(source: string, span: Span): boolean {
  return source
    .slice(span.from, span.to)
    .replace(/%[^\r\n]*(?:\r?\n|$)/gu, "")
    .trim() === "";
}

function frameTikzFlowNode(params: {
  source: string;
  context: BeamerSyntaxContext;
  frameId: string;
  begin: BeamerEnvironmentBoundary;
  end: BeamerEnvironmentBoundary;
  nodeIndex: number;
}): BeamerTikzBodyNode | null {
  const { source, context, frameId, begin, end, nodeIndex } = params;
  if (begin.name === "tikzpicture") {
    const roots = scanTikzRootsInSpan(context, frameId, {
      from: begin.span.from,
      to: end.span.to,
    });
    const root = roots[0];
    return root
      ? {
          kind: "tikzpicture",
          id: `${frameId}:tikz:${nodeIndex}`,
          span: root.span,
          root,
          horizontalAlignment: "left",
        }
      : null;
  }
  if (begin.name !== "center") {
    return null;
  }
  const innerSpan = { from: begin.span.to, to: end.span.from };
  const roots = scanTikzRootsInSpan(context, frameId, innerSpan);
  if (roots.length !== 1) {
    return null;
  }
  const root = roots[0];
  const surroundingMaterial =
    source.slice(innerSpan.from, root.span.from) +
    source.slice(root.span.to, innerSpan.to);
  if (surroundingMaterial.trim() !== "") {
    return null;
  }
  return {
    kind: "tikzpicture",
    id: `${frameId}:tikz:${nodeIndex}`,
    span: { from: begin.span.from, to: end.span.to },
    root,
    horizontalAlignment: "center",
  };
}

function parseBlock(params: {
  source: string;
  context: BeamerSyntaxContext;
  ownerId: string;
  begin: BeamerEnvironmentBoundary;
  end: BeamerEnvironmentBoundary;
  nodeIndex: number;
  diagnostics: Diagnostic[];
}): BeamerBlockBodyNode {
  const {
    source,
    context,
    ownerId,
    begin,
    end,
    nodeIndex,
    diagnostics,
  } = params;
  // An action spec (`\begin{block}<2->`) precedes the title; visibility is
  // handled by the frame overlay model, the parser only skips past it.
  const overlay = beamerOverlayArgumentAfter(
    context,
    begin.span.to,
    end.span.from
  );
  const options = beamerOptionalArgumentAfter(
    context,
    overlay?.span.to ?? begin.span.to,
    end.span.from
  ) ?? undefined;
  const title = beamerRequiredArgumentAfter(
    context,
    options?.span.to ?? overlay?.span.to ?? begin.span.to,
    end.span.from
  );
  if (!title) {
    diagnostics.push({
      severity: "error",
      code: "beamer-block-missing-title",
      message: `A Beamer ${begin.name} requires a title argument.`,
      span: begin.span,
    });
  }
  const fallbackTitle: BeamerBlockBodyNode["title"] = title ?? {
    span: { from: begin.span.to, to: begin.span.to },
    contentSpan: { from: begin.span.to, to: begin.span.to },
    value: "",
  };
  const bodySpan = {
    from: fallbackTitle.span.to,
    to: end.span.from,
  };
  const children: BeamerBlockBodyNode["children"] = [];
  pushTextNode(source, bodySpan, `${ownerId}:block:${nodeIndex}`, children);
  return {
    kind: "block",
    id: `${ownerId}:block:${nodeIndex}`,
    environment: begin.name as BeamerBlockEnvironment,
    span: { from: begin.span.from, to: end.span.to },
    beginSpan: begin.span,
    endSpan: end.span,
    options,
    title: fallbackTitle,
    bodySpan,
    children,
  };
}

function parseColumns(params: {
  context: BeamerSyntaxContext;
  frameId: string;
  begin: BeamerEnvironmentBoundary;
  end: BeamerEnvironmentBoundary;
  tokens: readonly BeamerEnvironmentBoundary[];
  diagnostics: Diagnostic[];
  nodeIndex: number;
  theoremOccurrences: ReadonlyMap<number, BeamerTheoremOccurrence>;
  theoremTemplate: BeamerTheoremTemplateVariant;
}): BeamerColumnsBodyNode {
  const {
    context,
    frameId,
    begin,
    end,
    tokens,
    diagnostics,
    nodeIndex,
    theoremOccurrences,
    theoremTemplate,
  } = params;
  const options = beamerOptionalArgumentAfter(
    context,
    begin.span.to,
    end.span.from
  ) ?? undefined;
  // beamer.cls executes its `c` class option by default. The columns
  // environment then inherits that class default before applying its keys.
  const alignment = resolveColumnAlignment(options?.value, "center");
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
    const columnOptions = beamerOptionalArgumentAfter(
      context,
      token.span.to,
      columnEnd.span.from
    ) ?? undefined;
    const width = beamerRequiredArgumentAfter(
      context,
      columnOptions?.span.to ?? token.span.to,
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
      options: columnOptions,
      alignment: resolveColumnAlignment(columnOptions?.value, alignment),
      width,
      bodySpan,
      children: parseColumnFlow(
        context,
        frameId,
        columns.length,
        bodySpan,
        tokens.slice(index + 1, endIndex),
        diagnostics,
        theoremOccurrences,
        theoremTemplate
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
    options,
    alignment,
    bodySpan: {
      from: options?.span.to ?? begin.span.to,
      to: end.span.from,
    },
    columns,
  };
}

function resolveColumnAlignment(
  optionSource: string | undefined,
  fallback: BeamerColumnAlignment
): BeamerColumnAlignment {
  if (!optionSource) {
    return fallback;
  }
  let result = fallback;
  for (const entry of splitTopLevelOptions(optionSource)) {
    const key = entry.split("=", 1)[0]?.trim();
    if (key === "T") {
      result = "T";
    } else if (key === "t") {
      result = "top";
    } else if (key === "c") {
      result = "center";
    } else if (key === "b") {
      result = "bottom";
    }
  }
  return result;
}

function splitTopLevelOptions(value: string): string[] {
  const entries: string[] = [];
  let start = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value.charAt(index);
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
    } else if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
    } else if (char === "[") {
      bracketDepth += 1;
    } else if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
    } else if (char === "," && braceDepth === 0 && bracketDepth === 0) {
      entries.push(value.slice(start, index));
      start = index + 1;
    }
  }
  entries.push(value.slice(start));
  return entries;
}

function parseColumnFlow(
  context: BeamerSyntaxContext,
  frameId: string,
  columnIndex: number,
  bodySpan: Span,
  tokens: readonly BeamerEnvironmentBoundary[],
  diagnostics: Diagnostic[],
  theoremOccurrences: ReadonlyMap<number, BeamerTheoremOccurrence>,
  theoremTemplate: BeamerTheoremTemplateVariant
): BeamerColumnFlowNode[] {
  const { source } = context;
  const structural: Array<{
    span: Span;
    node: BeamerColumnFlowNode;
  }> = [];
  let nodeIndex = 0;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (
      token.kind !== "begin" ||
      (
        !isProofEnvironment(token.name) &&
        !theoremOccurrences.has(token.span.from) &&
        !BLOCK_ENVIRONMENTS.has(token.name as BeamerBlockEnvironment)
      )
    ) {
      continue;
    }
    const endIndex = matchingEnvironmentEnd(tokens, index);
    if (endIndex < 0) {
      continue;
    }
    const end = tokens[endIndex];
    const node = isProofEnvironment(token.name) ||
        theoremOccurrences.has(token.span.from)
      ? parseTheorem({
          source,
          context,
          ownerId: `${frameId}:column:${columnIndex}`,
          begin: token,
          end,
          nodeIndex,
          occurrence: theoremOccurrences.get(token.span.from) ?? null,
          theoremTemplate,
        })
      : parseBlock({
          source,
          context,
          ownerId: `${frameId}:column:${columnIndex}`,
          begin: token,
          end,
          nodeIndex,
          diagnostics,
        });
    structural.push({ span: node.span, node });
    nodeIndex += 1;
    index = endIndex;
  }

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

  for (const root of scanTikzRootsInSpan(context, frameId, bodySpan)) {
    structural.push({
      span: root.span,
      node: {
        kind: "tikzpicture",
        id: `${frameId}:column:${columnIndex}:tikz:${nodeIndex}`,
        span: root.span,
        root,
        horizontalAlignment: "left",
      },
    });
    nodeIndex += 1;
  }

  for (const command of beamerControlSequencesIn(context, bodySpan)) {
    if (command.name !== "vspace") {
      continue;
    }
    const value = beamerRequiredArgumentAfter(context, command.to, bodySpan.to);
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
  context: BeamerSyntaxContext,
  frameId: string,
  span: Span
) {
  const tokens = beamerEnvironmentBoundariesIn(context, span);
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
  tokens: readonly BeamerEnvironmentBoundary[],
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
