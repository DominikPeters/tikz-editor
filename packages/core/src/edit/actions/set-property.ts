import type { EditActionResultLike } from "../result-types.js";
import { parseOptionListRaw } from "../../options/parse.js";
import { applyOptionMutationsToTarget, normalizeOptionKey, rewriteOptionListMutations, type OptionMutation } from "../option-mutations.js";
import { TREE_CHILD_LAYOUT_WRITABLE_KEYS } from "../tree-editing.js";
import { resolvePropertyTarget } from "../property-target.js";
import type { PropertyTarget, PropertyTargetOptionsFormat } from "../property-target.js";
import { replaceSpan } from "../patch.js";
import type { Span } from "../../ast/types.js";
import { applyAdornmentSetProperty } from "./adornment-set-property.js";
import { applyPathAttachedNodeInspectorAction } from "./path-attached-node-actions.js";
import type { EditParseOptions } from "../parse-options.js";
import type { SemanticPropertyId } from "../property-registry.js";


export type SetPropertyAction = {
  elementId: string;
  key: string;
  value: string;
  propertyId?: SemanticPropertyId;
  clearKeys?: string[];
  commentMode?: "disable" | "enable";
  commentSourceText?: string;
};

export function applySetPropertyAction(
  source: string,
  action: SetPropertyAction,
  parseOptions: EditParseOptions = {}
): EditActionResultLike {
  return applySetPropertyActionRaw(source, action, parseOptions);
}

export function applySetPropertyActionRaw(
  source: string,
  action: SetPropertyAction,
  parseOptions: EditParseOptions = {}
): EditActionResultLike {
  const resolved = resolvePropertyTarget(source, action.elementId, parseOptions);
  if (resolved.kind === "not-found") {
    return { kind: "unsupported", reason: resolved.reason };
  }

  if (action.commentMode) {
    return applySetPropertyCommentToggle(source, resolved.target, action, parseOptions);
  }

  if (resolved.target.kind === "node-adornment") {
    return applyAdornmentSetProperty(source, resolved.target, action);
  }

  const pathAttachedNodeResult = applyPathAttachedNodeInspectorAction(source, action, parseOptions);
  if (pathAttachedNodeResult) {
    return pathAttachedNodeResult;
  }

  if (resolved.target.kind === "tree-child") {
    return applyTreeChildSetProperty(source, resolved.target, action);
  }

  if (resolved.target.kind === "matrix-cell") {
    return applyMatrixCellSetProperty(source, resolved.target, action);
  }

  const key = normalizeOptionKey(action.key);
  if (key.length === 0) {
    return { kind: "error", message: "Cannot set an empty option key" };
  }

  const normalizedValue = action.value.trim();
  const removePrimaryKey = normalizedValue.length === 0;
  const mutations = new Map<string, OptionMutation>();
  for (const rawClearKey of action.clearKeys ?? []) {
    const clearKey = normalizeOptionKey(rawClearKey);
    if (clearKey.length === 0) {
      continue;
    }
    if (clearKey === key && !removePrimaryKey) {
      continue;
    }
    mutations.set(clearKey, { kind: "remove" });
  }
  if (removePrimaryKey) {
    mutations.set(key, { kind: "remove" });
  } else {
    mutations.set(key, { kind: "set", value: action.value });
  }
  const rewritten = applyOptionMutationsToTarget(source, resolved.target, mutations);
  if (!rewritten) {
    return { kind: "unsupported", reason: "setProperty would not change the source." };
  }

  return {
    kind: "success",
    newSource: rewritten.source,
    patches: [rewritten.patch],
    changedSourceIds: changedSourceIdsForPropertyTarget(resolved.target)
  };
}

type CommentToggleItem =
  | {
      kind: "entry";
      text: string;
      normalizedKey: string | null;
    }
  | {
      kind: "disabled-entry";
      text: string;
      normalizedKey: string | null;
    }
  | {
      kind: "comment";
      text: string;
    };

function applySetPropertyCommentToggle(
  source: string,
  target: PropertyTarget,
  action: SetPropertyAction,
  parseOptions: EditParseOptions
): EditActionResultLike {
  if (target.kind === "node-adornment" || target.kind === "tree-child" || target.kind === "matrix-cell") {
    return { kind: "unsupported", reason: "Property comment toggles are unavailable for this source target." };
  }
  if (!target.optionsSpan) {
    return { kind: "unsupported", reason: "No writable option list is available for comment toggling." };
  }

  const rawSite = source.slice(target.optionsSpan.from, target.optionsSpan.to);
  const format = target.optionsFormat ?? "bracketed";
  const parsedItems = parseCommentToggleItems(rawSite, format);
  const primaryKey = normalizeOptionKey(action.key);
  const commentMode = action.commentMode!;
  if (primaryKey.length === 0) {
    return { kind: "error", message: "Cannot toggle an empty option key" };
  }

  const exactSourceText = normalizeToggleSourceText(action.commentSourceText ?? "");
  const matchingIndex = findToggleItemIndex(parsedItems, commentMode, exactSourceText, primaryKey);
  if (matchingIndex < 0) {
    return { kind: "unsupported", reason: "Could not find a matching declaration to toggle." };
  }

  const replacementItems = parsedItems.map((item, index): CommentToggleItem => {
    if (index !== matchingIndex) {
      return item;
    }
    const toggleItem = item as Extract<CommentToggleItem, { kind: "entry" | "disabled-entry" }>;
    if (commentMode === "disable") {
      return { kind: "disabled-entry", text: toggleItem.text, normalizedKey: toggleItem.normalizedKey };
    }
    return { kind: "entry", text: toggleItem.text, normalizedKey: toggleItem.normalizedKey };
  });

  const replacement = serializeCommentToggleItems(
    replacementItems,
    format,
    resolveCommentToggleSerializationContext(rawSite, format, parseOptions.indentSize)
  );

  const updated = replaceSpan(source, target.optionsSpan, replacement);
  return {
    kind: "success",
    newSource: updated.source,
    patches: [{ oldSpan: target.optionsSpan, newSpan: updated.changedSpan, replacement }]
  };
}

function parseCommentToggleItems(rawSite: string, format: PropertyTargetOptionsFormat): CommentToggleItem[] {
  const inner = unwrapOptionSiteContent(rawSite, format);
  const items: CommentToggleItem[] = [];
  const segments = splitTopLevelOptionSegments(inner);
  for (const segment of segments) {
    const fragments = splitOptionSegmentFragments(segment);
    for (const fragment of fragments) {
      if (fragment.kind === "code") {
        const token = stripTrailingComma(fragment.text.trim());
        items.push({
          kind: "entry",
          text: token,
          normalizedKey: normalizedKeyForOptionToken(token)
        });
        continue;
      }

      const normalizedComment = normalizeCommentLine(fragment.text);
      const disabledToken = disabledTokenFromComment(normalizedComment);
      if (disabledToken) {
        items.push({
          kind: "disabled-entry",
          text: disabledToken,
          normalizedKey: normalizedKeyForOptionToken(disabledToken)
        });
      } else {
        items.push({
          kind: "comment",
          text: normalizedComment
        });
      }
    }
  }
  return items;
}

function unwrapOptionSiteContent(rawSite: string, format: PropertyTargetOptionsFormat): string {
  if (format === "bare") {
    return rawSite;
  }

  const openChar = format === "braced" ? "{" : "[";
  const closeChar = format === "braced" ? "}" : "]";
  const openIndex = rawSite.indexOf(openChar);
  const closeIndex = rawSite.lastIndexOf(closeChar);
  if (openIndex >= 0 && closeIndex > openIndex) {
    return rawSite.slice(openIndex + 1, closeIndex);
  }
  return rawSite;
}

function splitTopLevelOptionSegments(input: string): string[] {
  const parts: string[] = [];
  let tokenStart = 0;
  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  let inComment = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (inComment) {
      if (char === "\n" || char === "\r") {
        inComment = false;
      }
      continue;
    }
    if (char === "%" && !isEscapedAt(input, index)) {
      inComment = true;
      continue;
    }
    if (char === "\\") {
      index += 1;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      continue;
    }
    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if (char === "," && parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      parts.push(input.slice(tokenStart, index));
      tokenStart = index + 1;
    }
  }

  parts.push(input.slice(tokenStart));
  return parts;
}

function splitOptionSegmentFragments(
  segment: string
): Array<{ kind: "code" | "comment"; text: string }> {
  const fragments: Array<{ kind: "code" | "comment"; text: string }> = [];
  let cursor = 0;

  while (cursor < segment.length) {
    const commentIndex = findNextUnescapedPercent(segment, cursor);
    if (commentIndex < 0) {
      const code = segment.slice(cursor);
      if (code.trim().length > 0) {
        fragments.push({ kind: "code", text: code });
      }
      break;
    }

    const code = segment.slice(cursor, commentIndex);
    if (code.trim().length > 0) {
      fragments.push({ kind: "code", text: code });
    }

    let lineEnd = segment.length;
    for (let index = commentIndex + 1; index < segment.length; index += 1) {
      const char = segment[index];
      if (char === "\n" || char === "\r") {
        lineEnd = index;
        break;
      }
    }
    const comment = segment.slice(commentIndex, lineEnd);
    if (comment.trim().length > 0) {
      fragments.push({ kind: "comment", text: comment });
    }

    cursor = lineEnd;
    while (cursor < segment.length && (segment[cursor] === "\n" || segment[cursor] === "\r")) {
      cursor += 1;
    }
  }

  return fragments;
}

function findNextUnescapedPercent(input: string, from: number): number {
  for (let index = from; index < input.length; index += 1) {
    if (input[index] === "%" && !isEscapedAt(input, index)) {
      return index;
    }
  }
  return -1;
}

function isEscapedAt(input: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && input[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function normalizeCommentLine(raw: string): string {
  return raw.trim();
}

function disabledTokenFromComment(commentLine: string): string | null {
  const body = commentLine.trim().slice(1).trim();
  if (!body.endsWith(",")) {
    return null;
  }
  const candidate = stripTrailingComma(body).trim();
  if (candidate.length === 0) {
    return null;
  }
  return candidate;
}

function stripTrailingComma(value: string): string {
  return value.replace(/,\s*$/u, "");
}

function normalizedKeyForOptionToken(token: string): string | null {
  const parsed = parseOptionListRaw(`[${token}]`);
  const first = parsed.entries[0];
  if (!first || (first.kind !== "kv" && first.kind !== "flag")) {
    return null;
  }
  const key = normalizeOptionKey(first.key);
  return key.length > 0 ? key : null;
}

function normalizeToggleSourceText(value: string): string {
  return stripTrailingComma(value.trim().replace(/^%\s*/u, "")).trim();
}

function findToggleItemIndex(
  items: readonly CommentToggleItem[],
  mode: "disable" | "enable",
  exactSourceText: string,
  normalizedKey: string
): number {
  const targetKind = mode === "disable" ? "entry" : "disabled-entry";
  if (exactSourceText.length > 0) {
    const exactIndex = items.findIndex((item) =>
      item.kind === targetKind && normalizeToggleSourceText(item.text) === exactSourceText
    );
    if (exactIndex >= 0) {
      return exactIndex;
    }
  }

  return items.findIndex((item) =>
    item.kind === targetKind && item.normalizedKey === normalizedKey
  );
}

type CommentToggleSerializationContext = {
  lineIndent: string;
  hadNewline: boolean;
};

function resolveCommentToggleSerializationContext(
  rawSite: string,
  format: PropertyTargetOptionsFormat,
  indentSize: 2 | 4 | undefined
): CommentToggleSerializationContext {
  const preferredIndent = " ".repeat(indentSize ?? 2);
  const inner = unwrapOptionSiteContent(rawSite, format).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const hadNewline = inner.includes("\n");
  if (!hadNewline) {
    return { lineIndent: preferredIndent, hadNewline: false };
  }

  const lines = inner.split("\n");
  for (const line of lines) {
    if (line.trim().length === 0) {
      continue;
    }
    const indentMatch = line.match(/^[\t ]*/u);
    return { lineIndent: indentMatch![0], hadNewline: true };
  }
  return { lineIndent: preferredIndent, hadNewline: true };
}

function serializeCommentToggleItems(
  items: readonly CommentToggleItem[],
  format: PropertyTargetOptionsFormat,
  context: CommentToggleSerializationContext
): string {
  const withIndent = (line: string): string =>
    context.lineIndent.length > 0 ? `${context.lineIndent}${line}` : line;
  const lines: string[] = [];
  const entryIndexes = items
    .map((item, index) => ({ item, index }))
    .filter((entry) => entry.item.kind === "entry" || entry.item.kind === "disabled-entry")
    .map((entry) => entry.index);
  const lastEntryIndex = entryIndexes.length > 0 ? entryIndexes[entryIndexes.length - 1] : -1;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.kind === "comment") {
      lines.push(withIndent(normalizeCommentLine(item.text)));
      continue;
    }

    const token = stripTrailingComma(item.text.trim());
    if (token.length === 0) {
      continue;
    }
    if (item.kind === "disabled-entry") {
      lines.push(withIndent(`% ${token},`));
      continue;
    }

    const suffix = index === lastEntryIndex ? "" : ",";
    lines.push(withIndent(`${token}${suffix}`));
  }

  if (format === "bare") {
    if (lines.length === 0) {
      return "";
    }
    const serialized = lines.join("\n");
    return `\n${serialized}\n`;
  }
  if (lines.length === 0) {
    return "[]";
  }
  return `[\n${lines.join("\n")}\n]`;
}

function applyTreeChildSetProperty(
  source: string,
  target: PropertyTarget,
  action: SetPropertyAction
): EditActionResultLike {
  if (target.treeChildForeach) {
    return { kind: "unsupported", reason: "Tree child property editing is read-only for child foreach expansions." };
  }

  const key = normalizeOptionKey(action.key);
  if (key.length === 0) {
    return { kind: "error", message: "Cannot set an empty option key" };
  }
  const childOptionSite = TREE_CHILD_LAYOUT_WRITABLE_KEYS.has(key);

  const mutations = createOptionMutationsFromSetProperty(action, key);
  const removePrimaryKey = action.value.trim().length === 0;

  if (childOptionSite) {
    const result = applyOptionMutationsAtSite(source, mutations, removePrimaryKey, {
      options: target.treeChildOptions,
      optionsSpan: target.treeChildOptionsSpan,
      insertOffset: target.treeChildInsertOffset
    });
    return addTreeChildFallbackWarningIfNeeded(withChangedSourceIdsForTarget(result, target), target);
  }

  const result = applyOptionMutationsAtSite(source, mutations, removePrimaryKey, {
    options: target.treeNodeOptions,
    optionsSpan: target.treeNodeOptionsSpan,
    insertOffset: target.treeNodeInsertOffset
  });
  return addTreeChildFallbackWarningIfNeeded(withChangedSourceIdsForTarget(result, target), target);
}

function addTreeChildFallbackWarningIfNeeded(
  result: EditActionResultLike,
  target: PropertyTarget
): EditActionResultLike {
  if (!target.treeChildNodeSpanFallbackUsed || (result.kind !== "success" && result.kind !== "partial")) {
    return result;
  }
  return {
    kind: "partial",
    newSource: result.newSource,
    patches: result.patches,
    skippedHandles: [],
    reason: "Tree child edit applied using a source-span fallback. Verify the updated source.",
    changedSourceIds: result.changedSourceIds
  };
}

function applyMatrixCellSetProperty(
  source: string,
  target: PropertyTarget,
  action: SetPropertyAction
): EditActionResultLike {
  if (!target.matrixOfNodes) {
    return { kind: "unsupported", reason: "Cell property editing is only available for matrix node cells." };
  }

  const key = normalizeOptionKey(action.key);
  if (key.length === 0) {
    return { kind: "error", message: "Cannot set an empty option key" };
  }

  const mutations = createOptionMutationsFromSetProperty(action, key);

  const cellSpan = target.cellSpan!;
  const textSpan = target.textSpan!;

  if (target.optionSpan) {
    const optionSpan = target.optionSpan;
    const currentOptions = parseOptionListRaw(source.slice(optionSpan.from, optionSpan.to), optionSpan.from);
    const replacement = rewriteOptionListMutations(currentOptions, mutations, undefined, "bracketed");
    if (replacement.length > 0) {
      if (source.slice(optionSpan.from, optionSpan.to) === replacement) {
        return { kind: "unsupported", reason: "setProperty would not change the source." };
      }
      const updated = replaceSpan(source, optionSpan, replacement);
      return {
        kind: "success",
        newSource: updated.source,
        patches: [{ oldSpan: optionSpan, newSpan: updated.changedSpan, replacement }],
        changedSourceIds: changedSourceIdsForPropertyTarget(target)
      };
    }

    const prefixSpan = resolveMatrixCellOptionPrefixSpan(source, optionSpan, cellSpan, textSpan);
    const updated = replaceSpan(source, prefixSpan, "");
    return {
      kind: "success",
      newSource: updated.source,
      patches: [{ oldSpan: prefixSpan, newSpan: updated.changedSpan, replacement: "" }],
      changedSourceIds: changedSourceIdsForPropertyTarget(target)
    };
  }

  const setMutations = new Map<string, OptionMutation>();
  for (const [mutationKey, mutation] of mutations.entries()) {
    if (mutation.kind === "set") {
      setMutations.set(mutationKey, mutation);
    }
  }
  if (setMutations.size === 0) {
    return { kind: "unsupported", reason: "setProperty would not change the source." };
  }

  const seedOptions = parseOptionListRaw("[]", textSpan.from);
  const serializedOptions = rewriteOptionListMutations(seedOptions, setMutations, undefined, "bracketed");
  const insertion = `|${serializedOptions}| `;
  const insertionSpan: Span = { from: textSpan.from, to: textSpan.from };
  const updated = replaceSpan(source, insertionSpan, insertion);
  return {
    kind: "success",
    newSource: updated.source,
    patches: [{ oldSpan: insertionSpan, newSpan: updated.changedSpan, replacement: insertion }],
    changedSourceIds: changedSourceIdsForPropertyTarget(target)
  };
}

function withChangedSourceIdsForTarget(
  result: EditActionResultLike,
  target: PropertyTarget
): EditActionResultLike {
  if (result.kind !== "success" && result.kind !== "partial") {
    return result;
  }
  if (result.changedSourceIds !== undefined) {
    return result;
  }
  return {
    ...result,
    changedSourceIds: changedSourceIdsForPropertyTarget(target)
  };
}

function changedSourceIdsForPropertyTarget(target: PropertyTarget): string[] {
  const sourceId =
    target.ownerSourceId ??
    target.matrixSourceId ??
    target.treeRootSourceId ??
    target.id;
  const normalized = sourceId.trim();
  return normalized.length > 0 ? [normalized] : [];
}

function createOptionMutationsFromSetProperty(
  action: SetPropertyAction,
  normalizedPrimaryKey: string
): Map<string, OptionMutation> {
  const normalizedValue = action.value.trim();
  const removePrimaryKey = normalizedValue.length === 0;
  const mutations = new Map<string, OptionMutation>();
  for (const rawClearKey of action.clearKeys ?? []) {
    const clearKey = normalizeOptionKey(rawClearKey);
    if (clearKey.length === 0) {
      continue;
    }
    if (clearKey === normalizedPrimaryKey && !removePrimaryKey) {
      continue;
    }
    mutations.set(clearKey, { kind: "remove" });
  }
  if (removePrimaryKey) {
    mutations.set(normalizedPrimaryKey, { kind: "remove" });
  } else {
    mutations.set(normalizedPrimaryKey, { kind: "set", value: action.value });
  }
  return mutations;
}

function applyOptionMutationsAtSite(
  source: string,
  mutations: Map<string, OptionMutation>,
  removePrimaryKey: boolean,
  site: {
    options?: PropertyTarget["options"];
    optionsSpan?: Span;
    insertOffset?: number;
  }
): EditActionResultLike {
  const { options, optionsSpan, insertOffset } = site;
  if (optionsSpan) {
    const parsedOptions = options ?? parseOptionListRaw(source.slice(optionsSpan.from, optionsSpan.to), optionsSpan.from);
    const replacement = rewriteOptionListMutations(parsedOptions, mutations, undefined, "bracketed");
    if (source.slice(optionsSpan.from, optionsSpan.to) === replacement) {
      return { kind: "unsupported", reason: "setProperty would not change the source." };
    }
    const updated = replaceSpan(source, optionsSpan, replacement);
    return {
      kind: "success",
      newSource: updated.source,
      patches: [{ oldSpan: optionsSpan, newSpan: updated.changedSpan, replacement }]
    };
  }

  if (insertOffset == null) {
    return { kind: "unsupported", reason: "No writable option site available for this target." };
  }

  if (removePrimaryKey) {
    return { kind: "unsupported", reason: "setProperty would not change the source." };
  }

  const setMutations = new Map<string, OptionMutation>();
  for (const [mutationKey, mutation] of mutations.entries()) {
    if (mutation.kind === "set") {
      setMutations.set(mutationKey, mutation);
    }
  }

  const seedOptions = parseOptionListRaw("[]", insertOffset);
  const serializedOptions = rewriteOptionListMutations(seedOptions, setMutations, undefined, "bracketed");
  const updated = replaceSpan(source, { from: insertOffset, to: insertOffset }, serializedOptions);
  return {
    kind: "success",
    newSource: updated.source,
    patches: [{ oldSpan: { from: insertOffset, to: insertOffset }, newSpan: updated.changedSpan, replacement: serializedOptions }]
  };
}

function resolveMatrixCellOptionPrefixSpan(
  source: string,
  optionSpan: Span,
  cellSpan: Span,
  textSpan: Span
): Span {
  let leftPipe = optionSpan.from - 1;
  while (leftPipe >= cellSpan.from && /\s/u.test(source[leftPipe] ?? "")) {
    leftPipe -= 1;
  }

  let rightPipe = optionSpan.to;
  while (rightPipe < cellSpan.to && /\s/u.test(source[rightPipe] ?? "")) {
    rightPipe += 1;
  }

  let removalTo = rightPipe + 1;
  while (removalTo < textSpan.from && /\s/u.test(source[removalTo] ?? "")) {
    removalTo += 1;
  }
  return {
    from: leftPipe,
    to: removalTo
  };
}
