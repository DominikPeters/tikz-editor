import { applyFragments, EMPTY_FRAGMENT, layout, sourceSlice, tikz, userText, type TikzFragment } from "../edit/fragment.js";
import { requireArrayValue } from "../utils/collections.js";
import type { EditActionResult } from "../edit/actions.js";
import type { SourcePatch } from "../edit/types.js";
import { parseOptionListRaw } from "../options/parse.js";
import { rewriteBeamerOptions } from "./option-edits.js";
import type { Span } from "../ast/types.js";
import { buildBeamerObjectIndex, type BeamerObjectNode } from "./object-index.js";
import { scanBeamerDocument } from "./scan.js";
import {
  beamerOptionalArgumentAfter,
  beamerOverlayArgumentAfter,
  beamerRequiredArgumentAfter,
  createBeamerSyntaxContext,
  type BeamerSyntaxContext,
} from "./syntax.js";
import {
  beamerObjectDeletionPatch,
  beamerObjectDuplicationPatch,
  type BeamerStructuralEdit,
} from "./structural-edit.js";
import { isDeckDocumentEditAction, planDeckDocumentThemeEdit, type DeckDocumentEditAction } from "./document-theme-edits.js";
import { isDeckPageEditAction, planDeckPageEdit } from "./document-page-edits.js";
import { planDeckColorEdit } from "./document-color-edits.js";
import type { BeamerFrameLayout } from "./types.js";
import { planBeamerListHeadEdit } from "./list-head.js";

/**
 * Deck edit actions: the Beamer analog of the TikZ `EditAction` family
 * (design/beamer-canvas-editing.md, Stage 3b). Every handler is pure —
 * `(source, activeFrameLayout, action) → EditActionResult` — and shares the
 * TikZ result contract so the store's `APPLY_EDIT_ACTION` bookkeeping
 * (history, merge keys, preview mode, warnings) applies unchanged.
 *
 * Object-targeted actions resolve ids against the object index rebuilt from
 * the frame layout; the caller guarantees layout freshness (snapshot source
 * equals the edited source), mirroring the TikZ stale-handle guard.
 */
export type DeckEditAction =
  | { kind: "deckDeleteObject"; frameId: string; objectId: string }
  | { kind: "deckDuplicateObject"; frameId: string; objectId: string }
  | { kind: "deckRenameEnvironment"; frameId: string; objectId: string; name: string }
  | { kind: "deckSetEnvironmentTitle"; frameId: string; objectId: string; title: string }
  | { kind: "deckSetOverlaySpec"; frameId: string; objectId: string; spec: string | null }
  | { kind: "deckSetListDefaultOverlay"; frameId: string; objectId: string; spec: string | null }
  | { kind: "deckSetListLabelTemplate"; frameId: string; objectId: string; template: string | null }
  | { kind: "deckReplaceGraphics"; frameId: string; objectId: string; path: string }
  | { kind: "deckSetGraphicsOption"; frameId: string; objectId: string; key: string; value: string | true | null }
  /**
   * `true` writes a flag. Keys are case-sensitive (`columns` tells `T` from
   * `t`); `exclusive` names flags removed when this one is set (alignment).
   */
  | {
      kind: "deckSetEnvironmentOption";
      frameId: string;
      objectId: string;
      key: string;
      value: string | true | null;
      exclusive?: readonly string[];
    }
  | { kind: "deckSetColumnWidth"; frameId: string; objectId: string; width: string }
  | { kind: "deckSetFrameOption"; frameId: string; key: string; value: string | true | null }
  | DeckDocumentEditAction;

const DECK_EDIT_ACTION_KINDS: ReadonlySet<string> = new Set([
  "deckDeleteObject",
  "deckDuplicateObject",
  "deckRenameEnvironment",
  "deckSetEnvironmentTitle",
  "deckSetOverlaySpec",
  "deckSetListDefaultOverlay",
  "deckSetListLabelTemplate",
  "deckReplaceGraphics",
  "deckSetGraphicsOption",
  "deckSetEnvironmentOption",
  "deckSetColumnWidth",
  "deckSetFrameOption",
  "deckSetPresentationTheme",
  "deckSetThemeOption",
  "deckSetTheme",
  "deckSetClassOption",
  "deckSetNavigationSymbols",
  "deckSetMetadataShort",
  "deckSetColor",
]);

export function isDeckEditAction(action: { kind: string }): action is DeckEditAction {
  return DECK_EDIT_ACTION_KINDS.has(action.kind);
}

/**
 * Environments that may be renamed into each other. Renames never cross
 * groups: turning a block into a columns environment would not preserve the
 * body's meaning.
 */
export const RENAMEABLE_ENVIRONMENT_GROUPS: readonly (readonly string[])[] = [
  ["block", "alertblock", "exampleblock"],
  ["theorem", "lemma", "corollary", "proposition", "definition", "example", "fact", "proof"],
  ["itemize", "enumerate"],
];

/** Mutually exclusive frame alignment flags. */
const FRAME_ALIGNMENT_FLAGS: ReadonlySet<string> = new Set(["t", "b", "c"]);

export function applyDeckEditAction(
  source: string,
  layout: BeamerFrameLayout,
  action: DeckEditAction
): EditActionResult {
  if (isDeckDocumentEditAction(action)) {
    return applyDeckDocumentEditAction(source, action);
  }
  if (layout.frameId !== action.frameId) {
    return { kind: "unsupported", reason: "The targeted frame is not the rendered frame." };
  }
  if (action.kind === "deckSetFrameOption") {
    return applySetFrameOption(source, action);
  }

  const index = buildBeamerObjectIndex({
    items: layout.items,
    paragraphs: layout.paragraphs,
    source,
  });
  const node = index.byId.get(action.objectId);
  if (!node) {
    return { kind: "unsupported", reason: "The targeted object no longer exists." };
  }

  switch (action.kind) {
    case "deckDeleteObject": {
      const patch = beamerObjectDeletionPatch(source, index, node);
      if (!patch) {
        return { kind: "unsupported", reason: "This object cannot be deleted." };
      }
      return finishEdits(source, patch.edits);
    }
    case "deckDuplicateObject": {
      const patch = beamerObjectDuplicationPatch(source, node);
      if (!patch) {
        return { kind: "unsupported", reason: "This object cannot be duplicated." };
      }
      return finishEdits(source, patch.edits);
    }
    case "deckRenameEnvironment":
      return applyRenameEnvironment(source, node, action.name);
    case "deckSetEnvironmentTitle":
      return applySetEnvironmentTitle(source, node, action.title);
    case "deckSetOverlaySpec":
      return applySetOverlaySpec(source, node, action.spec);
    case "deckSetListDefaultOverlay":
    case "deckSetListLabelTemplate": {
      if (node.kind !== "list") return { kind: "unsupported", reason: "Only lists take list defaults." };
      const context = createBeamerSyntaxContext(source);
      const pair = environmentBoundariesOf(context, node);
      if (!pair) return { kind: "unsupported", reason: "The list boundaries were not found." };
      const plan = planBeamerListHeadEdit(context, pair.begin.span.to, pair.end.span.from, pair.begin.name,
        action.kind === "deckSetListDefaultOverlay" ? { kind: "overlay", value: action.spec } : { kind: "label", value: action.template });
      return "reason" in plan ? { kind: "unsupported", reason: plan.reason } : finishEdits(source, plan.edits);
    }
    case "deckReplaceGraphics":
      return applyReplaceGraphics(source, node, action.path);
    case "deckSetGraphicsOption":
      return applySetGraphicsOption(source, node, action.key, action.value);
    case "deckSetEnvironmentOption":
      return applySetEnvironmentOption(source, node, action.key, action.value, action.exclusive ?? []);
    case "deckSetColumnWidth":
      return applySetColumnWidth(source, node, action.width);
  }
}

/** Applies edits and reports them in the shared TikZ result shape. */
function finishEdits(
  source: string,
  edits: readonly BeamerStructuralEdit[]
): EditActionResult {
  const sorted = [...edits].sort((a, b) => a.span.from - b.span.from);
  for (let i = 1; i < sorted.length; i += 1) {
    if (requireArrayValue(sorted, i).span.from < requireArrayValue(sorted, i - 1).span.to) {
      return { kind: "error", message: "Deck edit produced overlapping edits." };
    }
  }
  const effective = sorted.filter(
    (edit) => source.slice(edit.span.from, edit.span.to) !== edit.insert
  );
  const newSource = applyFragments(source, effective.map((edit) => ({ span: edit.span, fragment: edit.insert })));
  let delta = 0;
  const patches: SourcePatch[] = effective.map((edit) => {
    const from = edit.span.from + delta;
    const patch: SourcePatch = {
      oldSpan: edit.span,
      newSpan: { from, to: from + edit.insert.length },
      replacement: edit.insert,
    };
    delta += edit.insert.length - (edit.span.to - edit.span.from);
    return patch;
  });
  return { kind: "success", newSource, patches };
}

export type EnvironmentBoundaries = {
  begin: { span: Span; nameSpan: Span; name: string };
  end: { span: Span; nameSpan: Span; name: string };
};

/**
 * The `\begin`/`\end` boundary pair of an environment-backed object node.
 * Env layout items span begin through end inclusive, so the pair is the
 * boundary starting at the node's start and the one ending at its end.
 */
export function environmentBoundariesOf(
  context: BeamerSyntaxContext,
  node: BeamerObjectNode
): EnvironmentBoundaries | null {
  const boundaries = context.syntax.environmentBoundariesIn(node.sourceSpan);
  const begin = boundaries.find(
    (boundary) => boundary.kind === "begin" && boundary.span.from === node.sourceSpan.from
  );
  const end = boundaries.find(
    (boundary) => boundary.kind === "end" && boundary.span.to === node.sourceSpan.to
  );
  if (!begin || !end) {
    return null;
  }
  if (begin.name !== end.name) {
    return null;
  }
  return { begin, end };
}

function isSingleLine(value: string): boolean {
  return !value.includes("\n") && !value.includes("\r");
}

/** Balanced `{}` check ignoring `\{`/`\}` escapes. */
function hasBalancedBraces(value: string): boolean {
  let depth = 0;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char === "\\") {
      i += 1;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

function applyRenameEnvironment(
  source: string,
  node: BeamerObjectNode,
  name: string
): EditActionResult {
  if (node.kind !== "block" && node.kind !== "list") {
    return { kind: "unsupported", reason: "Only block-style environments and lists can be renamed." };
  }
  const context = createBeamerSyntaxContext(source);
  const pair = environmentBoundariesOf(context, node);
  if (!pair) {
    return { kind: "unsupported", reason: "Environment boundaries were not found." };
  }
  const group = RENAMEABLE_ENVIRONMENT_GROUPS.find((candidates) =>
    candidates.includes(pair.begin.name)
  );
  if (!group?.includes(name)) {
    return {
      kind: "unsupported",
      reason: `Cannot rename ${pair.begin.name} to ${name}.`,
    };
  }
  // The name is one of the environments in the table above.
  const renamed = userText(name, "beamer-text");
  const head = pair.begin.name === "enumerate" && name === "itemize"
    ? planBeamerListHeadEdit(createBeamerSyntaxContext(source), pair.begin.span.to, pair.end.span.from, "enumerate", { kind: "label", value: null }) : { edits: [] };
  if ("reason" in head) return { kind: "unsupported", reason: head.reason };
  return finishEdits(source, [
    { span: pair.begin.nameSpan, insert: renamed },
    { span: pair.end.nameSpan, insert: renamed },
    ...head.edits,
  ]);
}

function applySetEnvironmentTitle(
  source: string,
  node: BeamerObjectNode,
  title: string
): EditActionResult {
  if (node.kind !== "block") {
    return { kind: "unsupported", reason: "Only block-style environments carry a title." };
  }
  if (!isSingleLine(title) || !hasBalancedBraces(title)) {
    return { kind: "unsupported", reason: "The title must be a single line with balanced braces." };
  }
  const context = createBeamerSyntaxContext(source);
  const pair = environmentBoundariesOf(context, node);
  if (!pair) {
    return { kind: "unsupported", reason: "Environment boundaries were not found." };
  }
  const overlay = beamerOverlayArgumentAfter(context, pair.begin.span.to, node.sourceSpan.to);
  const cursor = overlay?.span.to ?? pair.begin.span.to;
  const existing = beamerRequiredArgumentAfter(context, cursor, node.sourceSpan.to);
  const typed = userText(title, "beamer-text");
  if (existing) {
    return finishEdits(source, [{ span: existing.contentSpan, insert: typed }]);
  }
  return finishEdits(source, [{ span: { from: cursor, to: cursor }, insert: tikz`{${typed}}` }]);
}

function applySetOverlaySpec(
  source: string,
  node: BeamerObjectNode,
  spec: string | null
): EditActionResult {
  const normalized = normalizeOverlaySpec(spec);
  if (normalized.kind === "invalid") {
    return { kind: "unsupported", reason: "The overlay specification must be a single line without angle brackets." };
  }
  const context = createBeamerSyntaxContext(source);
  let anchor: number;
  let limit: number;
  if (node.kind === "item" && node.listItem) {
    const command = node.listItem.item.commandSpan;
    anchor = command.from + "\\item".length;
    limit = node.listItem.item.contentSpan.from;
  } else if (node.kind === "block") {
    const pair = environmentBoundariesOf(context, node);
    if (!pair) {
      return { kind: "unsupported", reason: "Environment boundaries were not found." };
    }
    anchor = pair.begin.span.to;
    limit = node.sourceSpan.to;
  } else {
    return { kind: "unsupported", reason: "This object does not take an overlay specification." };
  }

  const optionalLabel = node.kind === "item" ? beamerOptionalArgumentAfter(context, anchor, limit) : null;
  const existing = beamerOverlayArgumentAfter(context, anchor, limit) ??
    (optionalLabel ? beamerOverlayArgumentAfter(context, optionalLabel.span.to, limit) : null);
  if (normalized.kind === "remove") {
    if (!existing) {
      return finishEdits(source, []);
    }
    return finishEdits(source, [{ span: existing.span, insert: EMPTY_FRAGMENT }]);
  }
  if (existing) {
    return finishEdits(source, [{ span: existing.contentSpan, insert: normalized.spec }]);
  }
  return finishEdits(source, [
    { span: { from: anchor, to: anchor }, insert: tikz`<${normalized.spec}>` },
  ]);
}

function normalizeOverlaySpec(
  spec: string | null
): { kind: "remove" } | { kind: "set"; spec: TikzFragment } | { kind: "invalid" } {
  if (spec == null) {
    return { kind: "remove" };
  }
  let trimmed = spec.trim();
  if (trimmed.startsWith("<") && trimmed.endsWith(">") && trimmed.length >= 2) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  if (trimmed.length === 0) {
    return { kind: "remove" };
  }
  if (!isSingleLine(trimmed) || trimmed.includes("<") || trimmed.includes(">")) {
    return { kind: "invalid" };
  }
  return { kind: "set", spec: userText(trimmed, "beamer-text") };
}

/** A parsed `[...]` option list with absolute entry spans. */
export type OptionListLocation = {
  /** Span including the brackets. */
  span: Span;
  /** Span of the source between the brackets. */
  contentSpan: Span;
  /**
   * `key` is lowercased, as the TikZ option parser normalizes it;
   * `authoredKey` is the spelling in the source, for case-sensitive keys
   * such as `columns`' `T` and `t`.
   */
  entries: readonly { span: Span; key: string | null; authoredKey: string | null; valueSpan: Span | null }[];
};

export function readOptionList(
  source: string,
  argument: { span: Span; contentSpan: Span }
): OptionListLocation {
  const ast = parseOptionListRaw(
    source.slice(argument.span.from, argument.span.to),
    argument.span.from
  );
  return {
    span: argument.span,
    contentSpan: argument.contentSpan,
    entries: ast.entries.map((entry) => {
      const named = entry.kind === "kv" || entry.kind === "flag";
      const keySpan = named ? entry.keySpan : undefined;
      return {
        span: entry.span,
        key: named ? entry.key : null,
        authoredKey: !named ? null : keySpan ? source.slice(keySpan.from, keySpan.to).trim() : entry.raw.split("=")[0]?.trim() ?? entry.key,
        valueSpan: entry.kind === "kv" ? entry.valueSpan ?? null : null,
      };
    }),
  };
}

function isValidOptionValue(value: string): boolean {
  if (!isSingleLine(value) || !hasBalancedBraces(value)) {
    return false;
  }
  if (!value.includes("]")) {
    return true;
  }
  // A raw `]` would close the option list early unless brace-protected.
  return value.startsWith("{") && value.endsWith("}");
}

type OptionListEditContext = {
  list: OptionListLocation | null;
  /** Insertion point for a fresh `[...]` group when none exists. */
  insertAt: number;
};

function buildOptionEdits(
  source: string,
  context: OptionListEditContext,
  key: string,
  value: string | true | null,
  removeKeys: readonly string[] = [],
  caseSensitive = false
): { edits: BeamerStructuralEdit[] } | { error: string } {
  const normalizedKey = caseSensitive ? key.trim() : key.trim().toLowerCase();
  if (normalizedKey.length === 0 || !isSingleLine(normalizedKey)) {
    return { error: "Option keys must be single-line and non-empty." };
  }
  if (typeof value === "string" && !isValidOptionValue(value.trim())) {
    return { error: "Option values must be single-line with balanced braces." };
  }
  const typedKey = userText(normalizedKey, "beamer-text");
  const entryText: TikzFragment | null =
    value === true ? typedKey : value != null ? tikz`${typedKey}=${userText(value.trim(), "beamer-text")}` : null;

  const { list } = context;
  if (!list) {
    if (entryText == null) {
      return { edits: [] };
    }
    return {
      edits: [
        { span: { from: context.insertAt, to: context.insertAt }, insert: tikz`[${entryText}]` },
      ],
    };
  }

  const keyOf = (entry: OptionListLocation["entries"][number]): string | null =>
    caseSensitive ? entry.authoredKey : entry.key;
  const targetIndex = list.entries.map(entry => keyOf(entry) === normalizedKey).lastIndexOf(true);
  const removedKeys = new Set([...removeKeys, normalizedKey]);
  return { edits: rewriteBeamerOptions(source, list,
    (_entry, index) => !removedKeys.has(keyOf(requireArrayValue(list.entries, index)) ?? "") ||
      (index === targetIndex && entryText !== null),
    targetIndex >= 0 && entryText !== null ? { index: targetIndex, text: entryText } : undefined,
    targetIndex < 0 && entryText !== null ? entryText : undefined) };
}

function applySetGraphicsOption(
  source: string,
  node: BeamerObjectNode,
  key: string,
  value: string | true | null
): EditActionResult {
  if (node.kind !== "graphics") {
    return { kind: "unsupported", reason: "Only graphics take image options." };
  }
  const context = createBeamerSyntaxContext(source);
  const command = context.syntax
    .controlsIn(node.sourceSpan)
    .find((control) => control.name === "includegraphics");
  if (!command) {
    return { kind: "unsupported", reason: "The graphics command was not found." };
  }
  // Options follow an overlay spec: `\includegraphics<2->[width=…]{file}`.
  const commandEnd = command.starSpan?.to ?? command.span.to;
  const afterOverlay = beamerOverlayArgumentAfter(context, commandEnd, node.sourceSpan.to)?.span.to ?? commandEnd;
  const optional = beamerOptionalArgumentAfter(context, afterOverlay, node.sourceSpan.to);
  const result = buildOptionEdits(
    source,
    {
      list: optional ? readOptionList(source, optional) : null,
      insertAt: afterOverlay,
    },
    key,
    value ?? null
  );
  if ("error" in result) {
    return { kind: "unsupported", reason: result.error };
  }
  return finishEdits(source, result.edits);
}

function applyReplaceGraphics(source: string, node: BeamerObjectNode, path: string): EditActionResult {
  if (node.kind !== "graphics") return { kind: "unsupported", reason: "Only images can be replaced." };
  if (!path.trim() || /[\\{}%#$^&\r\n]/u.test(path) || !/\.(?:png|jpe?g|svg|pdf)$/iu.test(path)) return { kind: "unsupported", reason: "Choose a PNG, JPEG, SVG or PDF with a literal TeX-compatible path." };
  const context = createBeamerSyntaxContext(source);
  const command = context.syntax.controlsIn(node.sourceSpan).find(command => command.name === "includegraphics");
  if (!command) return { kind: "unsupported", reason: "The image command was not found." };
  const at = command.starSpan?.to ?? command.span.to;
  const overlay = beamerOverlayArgumentAfter(context, at, node.sourceSpan.to);
  const options = beamerOptionalArgumentAfter(context, overlay?.span.to ?? at, node.sourceSpan.to);
  const file = beamerRequiredArgumentAfter(context, options?.span.to ?? overlay?.span.to ?? at, node.sourceSpan.to);
  if (!file) return { kind: "unsupported", reason: "The image filename was not found." };
  const edits: BeamerStructuralEdit[] = [{ span: file.contentSpan, insert: userText(path, "inspector-value") }];
  for (const comment of context.syntax.comments.filter(comment => file.contentSpan.from <= comment.from && comment.to <= file.contentSpan.to)) {
    const newline = layout(source.includes("\r\n") ? "\r\n" : "\n");
    edits.push({ span: { from: file.span.to, to: file.span.to }, insert: tikz`${newline}${sourceSlice(source, comment)}${newline}` });
  }
  // A page selection belongs to the old PDF. Replacement PDFs begin on page 1;
  // non-PDF images must not retain a PDF-only option.
  if (options) {
    const plan = buildOptionEdits(source, { list: readOptionList(source, options), insertAt: at }, "page", null);
    if ("error" in plan) return { kind: "unsupported", reason: plan.error };
    edits.push(...plan.edits);
  }
  return finishEdits(source, edits);
}

/**
 * Option-list edits on an environment's first `[...]`: embedded tikz
 * `scale=`, and the alignment and width options of `columns` and `column`.
 */
function applySetEnvironmentOption(
  source: string,
  node: BeamerObjectNode,
  key: string,
  value: string | true | null,
  exclusive: readonly string[]
): EditActionResult {
  if (node.kind !== "tikzpicture" && node.kind !== "columns" && node.kind !== "column") {
    return { kind: "unsupported", reason: "This object does not take environment options." };
  }
  const context = createBeamerSyntaxContext(source);
  const pair = environmentBoundariesOf(context, node);
  if (!pair) {
    return { kind: "unsupported", reason: "Environment boundaries were not found." };
  }
  const optional = beamerOptionalArgumentAfter(context, pair.begin.span.to, node.sourceSpan.to);
  const result = buildOptionEdits(
    source,
    {
      list: optional ? readOptionList(source, optional) : null,
      insertAt: pair.begin.span.to,
    },
    key,
    value ?? null,
    value === null ? exclusive : exclusive.filter((flag) => flag !== key),
    true
  );
  if ("error" in result) {
    return { kind: "unsupported", reason: result.error };
  }
  return finishEdits(source, result.edits);
}

function applySetColumnWidth(
  source: string,
  node: BeamerObjectNode,
  width: string
): EditActionResult {
  if (node.kind !== "column") {
    return { kind: "unsupported", reason: "Only columns carry a width argument." };
  }
  const trimmed = width.trim();
  if (trimmed.length === 0 || !isSingleLine(trimmed) || !hasBalancedBraces(trimmed)) {
    return { kind: "unsupported", reason: "The width must be a single-line TeX dimension." };
  }
  const context = createBeamerSyntaxContext(source);
  const pair = environmentBoundariesOf(context, node);
  if (!pair) {
    return { kind: "unsupported", reason: "Environment boundaries were not found." };
  }
  const placement = beamerOptionalArgumentAfter(context, pair.begin.span.to, node.sourceSpan.to);
  const cursor = placement?.span.to ?? pair.begin.span.to;
  const existing = beamerRequiredArgumentAfter(context, cursor, node.sourceSpan.to);
  const typed = userText(trimmed, "beamer-text");
  if (existing) {
    return finishEdits(source, [{ span: existing.contentSpan, insert: typed }]);
  }
  return finishEdits(source, [{ span: { from: cursor, to: cursor }, insert: tikz`{${typed}}` }]);
}

export function applyDeckDocumentEditAction(source: string, action: DeckDocumentEditAction): EditActionResult {
  const document = scanBeamerDocument(source);
  const plan = action.kind === "deckSetColor" ? planDeckColorEdit(document, action) : isDeckPageEditAction(action) ? planDeckPageEdit(document, action) : planDeckDocumentThemeEdit(document, action);
  return "reason" in plan ? { kind: "unsupported", reason: plan.reason } : finishEdits(source, plan.edits);
}

function applySetFrameOption(
  source: string,
  action: Extract<DeckEditAction, { kind: "deckSetFrameOption" }>
): EditActionResult {
  const model = scanBeamerDocument(source);
  const frame = model.frames.find((candidate) => candidate.id === action.frameId);
  if (!frame) {
    return { kind: "unsupported", reason: "The targeted frame was not found." };
  }
  const normalizedKey = action.key.trim().toLowerCase();
  const removeKeys =
    action.value === true && FRAME_ALIGNMENT_FLAGS.has(normalizedKey)
      ? [...FRAME_ALIGNMENT_FLAGS].filter((flag) => flag !== normalizedKey)
      : [];
  const result = buildOptionEdits(
    source,
    {
      list: frame.options
        ? readOptionList(source, {
            span: frame.options.source.span,
            contentSpan: frame.options.source.contentSpan,
          })
        : null,
      insertAt: frame.overlay?.span.to ?? frame.beginSpan.to,
    },
    action.key,
    action.value,
    removeKeys
  );
  if ("error" in result) {
    return { kind: "unsupported", reason: result.error };
  }
  return finishEdits(source, result.edits);
}
