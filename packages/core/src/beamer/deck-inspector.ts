import { scanBeamerDocument } from "./scan.js";
import {
  beamerOptionalArgumentAfter,
  beamerOverlayArgumentAfter,
  beamerRequiredArgumentAfter,
  createBeamerSyntaxContext,
  type BeamerSyntaxContext,
} from "./syntax.js";
import {
  environmentBoundariesOf,
  readOptionList,
  RENAMEABLE_ENVIRONMENT_GROUPS,
  type OptionListLocation,
} from "./deck-edit-actions.js";
import type { BeamerObjectNode } from "./object-index.js";
import type { Span } from "../ast/types.js";
import type { BeamerDocumentModel } from "./types.js";

/**
 * Inspector models for deck objects and frames (Stage 3b). Builders read
 * current values from source at the object's spans; the app maps a field's
 * `write` plus the new value onto a `DeckEditAction`. Fields are plain data —
 * the same source that the deck edit actions rewrite is the single source of
 * truth for what the inspector shows.
 */
export type DeckInspectorWrite =
  | { kind: "renameEnvironment" }
  | { kind: "setEnvironmentTitle" }
  | { kind: "setOverlaySpec" }
  | {
      kind: "setGraphicsOption";
      key: string;
      /** Reattached after the number (`\textwidth`, `cm`, or empty). */
      suffix: string;
    }
  | { kind: "setEnvironmentOption"; key: string; suffix: string }
  /** A flag in an image's or environment's options: present or absent. */
  | { kind: "setGraphicsFlag"; key: string }
  | { kind: "setEnvironmentFlag"; key: string }
  /** One of a set of exclusive flags (column alignment); "" removes them all. */
  | { kind: "setEnvironmentFlagChoice"; keys: readonly string[] }
  | { kind: "setColumnWidth"; suffix: string }
  | { kind: "setFrameOption"; key: string }
  | { kind: "setFrameAlignment" };

/** What a button field does; the app runs it, there is no source write. */
export type DeckInspectorCommand =
  | { kind: "enterDrawing"; rootId: string }
  | { kind: "revealSource"; span: Span };

/** A resolved color; `expression` is the authored value when the preamble sets it. */
export type DeckInspectorColor = { css: string; expression: string | null };

/**
 * `write: null` marks a field the editor shows but cannot change yet; the
 * panel renders it disabled with its real value.
 */
export type DeckInspectorField =
  | {
      kind: "enum";
      id: string;
      label: string;
      value: string;
      options: ReadonlyArray<{ value: string; label: string }>;
      write: DeckInspectorWrite | null;
    }
  | {
      kind: "text";
      id: string;
      label: string;
      value: string;
      placeholder?: string;
      write: DeckInspectorWrite | null;
    }
  | {
      kind: "number";
      id: string;
      label: string;
      /** `null` renders as unset (placeholder); writing sets the option. */
      value: number | null;
      step: number;
      min?: number;
      max?: number;
      /** Display-only suffix shown beside the input. */
      unit?: string;
      /** Shown while unset; "Auto" when absent. */
      placeholder?: string;
      write: DeckInspectorWrite | null;
    }
  | {
      kind: "boolean";
      id: string;
      label: string;
      value: boolean;
      write: DeckInspectorWrite | null;
    }
  | {
      kind: "color";
      id: string;
      label: string;
      /** Only the sides the role is shown with; null when the role leaves it unset. */
      fg?: DeckInspectorColor | null;
      bg?: DeckInspectorColor | null;
      /** What a role without a fill is painted over: the slide background. */
      backdrop?: string;
      /** Whether a preamble `\setbeamercolor` sets this role, or the theme alone. */
      origin: "theme" | "preamble";
      write: DeckInspectorWrite | null;
    }
  | { kind: "button"; id: string; label: string; command: DeckInspectorCommand; write: null }
  /** A warning about the object, such as why the preview cannot draw it. */
  | { kind: "message"; id: string; text: string; write: null }
  /** Read-only source text, shown verbatim. */
  | { kind: "code"; id: string; label: string; text: string; write: null };

export type DeckInspectorModel = {
  target: "object" | "frame";
  /** Panel header, e.g. "Block", "Image", "Frame". */
  title: string;
  fields: DeckInspectorField[];
};

/** Splits `0.63\textwidth` / `3cm` / `90` into number + suffix, else null. */
export function splitDeckDimension(
  raw: string
): { value: number; suffix: string } | null {
  const match = /^\s*(-?\d*\.?\d+)\s*(\\[a-zA-Z]+|[a-zA-Z]*)\s*$/u.exec(raw);
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  if (!Number.isFinite(value)) {
    return null;
  }
  return { value, suffix: match[2] ?? "" };
}

function stepForSuffix(suffix: string): number {
  if (suffix.startsWith("\\")) {
    return 0.01;
  }
  if (suffix === "") {
    return 0.05;
  }
  return 0.1;
}

const OBJECT_TITLES: Partial<Record<BeamerObjectNode["kind"], string>> = {
  unsupported: "Unsupported content",
  block: "Block",
  columns: "Columns",
  column: "Column",
  graphics: "Image",
  tikzpicture: "Drawing",
  list: "List",
  item: "Item",
};

/** `message` is the layout's note on an unsupported object, when it has one. */
export function buildDeckObjectInspector(
  source: string,
  node: BeamerObjectNode,
  extra: { message?: string } = {}
): DeckInspectorModel {
  const context = createBeamerSyntaxContext(source);
  const fields: DeckInspectorField[] = [];
  switch (node.kind) {
    case "block":
      fields.push(...blockFields(context, node));
      break;
    case "list":
      fields.push(...listFields(context, node));
      break;
    case "item":
      fields.push(...itemFields(context, node));
      break;
    case "columns":
      fields.push(...columnsFields(context, node));
      break;
    case "column":
      fields.push(...columnFields(context, node));
      break;
    case "graphics":
      fields.push(...graphicsFields(context, node));
      break;
    case "tikzpicture":
      fields.push(...tikzFields(context, node));
      break;
    case "unsupported":
      fields.push(...unsupportedFields(context, node, extra.message));
      break;
  }
  return {
    target: "object",
    title: OBJECT_TITLES[node.kind] ?? "Object",
    fields,
  };
}

function environmentEnumField(
  context: BeamerSyntaxContext,
  node: BeamerObjectNode,
  label: string
): DeckInspectorField | null {
  const pair = environmentBoundariesOf(context, node);
  if (!pair) {
    return null;
  }
  const group = RENAMEABLE_ENVIRONMENT_GROUPS.find((candidates) =>
    candidates.includes(pair.begin.name)
  );
  if (!group) {
    return null;
  }
  return {
    kind: "enum",
    id: "environment",
    label,
    value: pair.begin.name,
    options: group.map((name) => ({ value: name, label: name })),
    write: { kind: "renameEnvironment" },
  };
}

function overlayField(
  context: BeamerSyntaxContext,
  anchor: number,
  limit: number
): DeckInspectorField {
  const overlay = beamerOverlayArgumentAfter(context, anchor, limit);
  return {
    kind: "text",
    id: "overlay",
    label: "Overlay",
    value: overlay?.value ?? "",
    placeholder: "e.g. 2-",
    write: { kind: "setOverlaySpec" },
  };
}

function blockFields(
  context: BeamerSyntaxContext,
  node: BeamerObjectNode
): DeckInspectorField[] {
  const fields: DeckInspectorField[] = [];
  const typeField = environmentEnumField(context, node, "Type");
  if (typeField) {
    fields.push(typeField);
  }
  const pair = environmentBoundariesOf(context, node);
  if (pair) {
    const overlay = beamerOverlayArgumentAfter(
      context,
      pair.begin.span.to,
      node.sourceSpan.to
    );
    const cursor = overlay?.span.to ?? pair.begin.span.to;
    const title = beamerRequiredArgumentAfter(context, cursor, node.sourceSpan.to);
    fields.push({
      kind: "text",
      id: "title",
      label: "Title",
      value: title?.value ?? "",
      write: { kind: "setEnvironmentTitle" },
    });
    fields.push(overlayField(context, pair.begin.span.to, node.sourceSpan.to));
  }
  return fields;
}

const REVEAL_OPTIONS = [
  { value: "", label: "All at once" },
  { value: "+-", label: "One by one" },
  { value: "+-| alert@+", label: "One by one, highlighted" },
] as const;

/**
 * Beamer lists take a default overlay spec (`[<+->]`) and, for enumerate, a
 * label template (`[(a)]`), as optional arguments after `\begin{…}`.
 */
function listFields(
  context: BeamerSyntaxContext,
  node: BeamerObjectNode
): DeckInspectorField[] {
  const fields: DeckInspectorField[] = [];
  const typeField = environmentEnumField(context, node, "Type");
  if (typeField) {
    fields.push(typeField);
  }
  const pair = environmentBoundariesOf(context, node);
  if (!pair) {
    return fields;
  }
  let reveal = "";
  let template = "";
  let cursor = pair.begin.span.to;
  for (let index = 0; index < 2; index += 1) {
    const argument = beamerOptionalArgumentAfter(context, cursor, node.sourceSpan.to);
    if (!argument) break;
    const text = argument.value.trim();
    if (text.startsWith("<") && text.endsWith(">")) {
      reveal = text.slice(1, -1).trim();
    } else {
      template = text;
    }
    cursor = argument.span.to;
  }
  const revealOptions: Array<{ value: string; label: string }> = [...REVEAL_OPTIONS];
  if (!revealOptions.some((option) => option.value === reveal)) {
    revealOptions.push({ value: reveal, label: `<${reveal}>` });
  }
  fields.push({ kind: "enum", id: "reveal", label: "Reveal", value: reveal, options: revealOptions, write: null });
  if (pair.begin.name === "enumerate") {
    fields.push({ kind: "text", id: "template", label: "Labels", value: template, placeholder: "1.", write: null });
  }
  return fields;
}

function itemFields(
  context: BeamerSyntaxContext,
  node: BeamerObjectNode
): DeckInspectorField[] {
  if (!node.listItem) {
    return [];
  }
  const command = node.listItem.item.commandSpan;
  return [
    overlayField(
      context,
      command.from + "\\item".length,
      node.listItem.item.contentSpan.from
    ),
  ];
}

/** Beamer's vertical alignments for columns, as flag options; the last given wins. */
const ALIGNMENT_FLAGS = ["c", "t", "T", "b"] as const;
const ALIGNMENT_OPTIONS = [
  { value: "c", label: "Center" },
  { value: "T", label: "Top" },
  { value: "t", label: "First baseline" },
  { value: "b", label: "Bottom" },
] as const;

function alignmentFlag(list: OptionListLocation | null): string | null {
  const flags = list?.entries.flatMap((entry) =>
    entry.valueSpan == null && entry.authoredKey != null && (ALIGNMENT_FLAGS as readonly string[]).includes(entry.authoredKey)
      ? [entry.authoredKey] : []) ?? [];
  return flags.at(-1) ?? null;
}

function environmentOptions(
  context: BeamerSyntaxContext,
  node: BeamerObjectNode
): OptionListLocation | null {
  const pair = environmentBoundariesOf(context, node);
  const optional = pair && beamerOptionalArgumentAfter(context, pair.begin.span.to, node.sourceSpan.to);
  return optional ? readOptionList(context.source, optional) : null;
}

function columnsFields(
  context: BeamerSyntaxContext,
  node: BeamerObjectNode
): DeckInspectorField[] {
  const list = environmentOptions(context, node);
  const fields: DeckInspectorField[] = [{
    kind: "enum",
    id: "alignment",
    label: "Alignment",
    value: alignmentFlag(list) ?? "c",
    options: [...ALIGNMENT_OPTIONS],
    write: { kind: "setEnvironmentFlagChoice", keys: ALIGNMENT_FLAGS },
  }];
  const totalWidth = list?.entries.find((entry) => entry.key === "totalwidth");
  const totalWidthField = optionNumberField({
    id: "totalwidth",
    label: "Total width",
    raw: totalWidth?.valueSpan ? context.source.slice(totalWidth.valueSpan.from, totalWidth.valueSpan.to) : null,
    defaultSuffix: "\\textwidth",
    write: (suffix) => ({ kind: "setEnvironmentOption", key: "totalwidth", suffix }),
  });
  if (totalWidthField) {
    fields.push(totalWidthField);
  }
  fields.push({
    kind: "boolean",
    id: "onlytextwidth",
    label: "Only text width",
    value: list?.entries.some((entry) => entry.key === "onlytextwidth") ?? false,
    write: { kind: "setEnvironmentFlag", key: "onlytextwidth" },
  });
  return fields;
}

function columnFields(
  context: BeamerSyntaxContext,
  node: BeamerObjectNode
): DeckInspectorField[] {
  const pair = environmentBoundariesOf(context, node);
  if (!pair) {
    return [];
  }
  const placement = beamerOptionalArgumentAfter(
    context,
    pair.begin.span.to,
    node.sourceSpan.to
  );
  const alignment: DeckInspectorField = {
    kind: "enum",
    id: "alignment",
    label: "Alignment",
    value: alignmentFlag(placement ? readOptionList(context.source, placement) : null) ?? "",
    options: [{ value: "", label: "Same as columns" }, ...ALIGNMENT_OPTIONS],
    write: { kind: "setEnvironmentFlagChoice", keys: ALIGNMENT_FLAGS },
  };
  const cursor = placement?.span.to ?? pair.begin.span.to;
  const width = beamerRequiredArgumentAfter(context, cursor, node.sourceSpan.to);
  const raw = width?.value ?? "";
  const parsed = splitDeckDimension(raw);
  if (!parsed) {
    return [
      {
        kind: "text",
        id: "width",
        label: "Width",
        value: raw,
        write: { kind: "setColumnWidth", suffix: "" },
      },
      alignment,
    ];
  }
  return [
    {
      kind: "number",
      id: "width",
      label: "Width",
      value: parsed.value,
      step: stepForSuffix(parsed.suffix),
      min: 0.01,
      ...(parsed.suffix ? { unit: parsed.suffix } : {}),
      write: { kind: "setColumnWidth", suffix: parsed.suffix },
    },
    alignment,
  ];
}

function optionNumberField(args: {
  id: string;
  label: string;
  raw: string | null;
  defaultSuffix: string;
  write: (suffix: string) => DeckInspectorWrite;
}): DeckInspectorField | null {
  if (args.raw == null) {
    return {
      kind: "number",
      id: args.id,
      label: args.label,
      value: null,
      step: stepForSuffix(args.defaultSuffix),
      min: 0.01,
      ...(args.defaultSuffix ? { unit: args.defaultSuffix } : {}),
      write: args.write(args.defaultSuffix),
    };
  }
  const parsed = splitDeckDimension(args.raw);
  if (!parsed) {
    // An authored value the inspector cannot represent — leave it alone.
    return null;
  }
  return {
    kind: "number",
    id: args.id,
    label: args.label,
    value: parsed.value,
    step: stepForSuffix(parsed.suffix),
    min: 0.01,
    ...(parsed.suffix ? { unit: parsed.suffix } : {}),
    write: args.write(parsed.suffix),
  };
}

/**
 * `\includegraphics[options]{file}`. Offers the options the text engine
 * draws (text/tex/ir.ts); `angle` and friends are not drawn, so not offered.
 * Nor is an overlay spec: the preview does not draw `\includegraphics<2->`
 * yet. Reading still steps over one, so such an image keeps its options.
 */
function graphicsFields(
  context: BeamerSyntaxContext,
  node: BeamerObjectNode
): DeckInspectorField[] {
  const command = context.syntax
    .controlsIn(node.sourceSpan)
    .find((control) => control.name === "includegraphics");
  if (!command) {
    return [];
  }
  const overlay = beamerOverlayArgumentAfter(context, command.span.to, node.sourceSpan.to);
  const optional = beamerOptionalArgumentAfter(
    context,
    overlay?.span.to ?? command.span.to,
    node.sourceSpan.to
  );
  const file = beamerRequiredArgumentAfter(
    context,
    optional?.span.to ?? overlay?.span.to ?? command.span.to,
    node.sourceSpan.to
  );
  const list = optional ? readOptionList(context.source, optional) : null;
  const rawValue = (key: string): string | null => {
    const entry = list?.entries.find((candidate) => candidate.key === key);
    if (!entry?.valueSpan) {
      return null;
    }
    return context.source.slice(entry.valueSpan.from, entry.valueSpan.to);
  };
  const hasFlag = (key: string): boolean =>
    list?.entries.some((entry) => entry.key === key && entry.valueSpan == null) ?? false;
  const path = file?.value.trim() ?? "";
  const fields: DeckInspectorField[] = [
    { kind: "text", id: "file", label: "File", value: path, write: null },
  ];
  const numberFields: Array<readonly [string, string, string]> = [
    ["width", "Width", "\\textwidth"],
    ["height", "Height", "\\textheight"],
    ["scale", "Scale", ""],
  ];
  if (/\.pdf$/iu.test(path)) {
    numberFields.push(["page", "Page", ""]);
  }
  for (const [id, label, defaultSuffix] of numberFields) {
    const field = optionNumberField({
      id,
      label,
      raw: rawValue(id),
      defaultSuffix,
      write: (suffix) => ({ kind: "setGraphicsOption", key: id, suffix }),
    });
    if (field) {
      fields.push(field.kind === "number" && id === "page" ? { ...field, step: 1, min: 1 } : field);
    }
  }
  fields.push(
    {
      kind: "boolean",
      id: "keepaspectratio",
      label: "Keep aspect ratio",
      value: hasFlag("keepaspectratio"),
      write: { kind: "setGraphicsFlag", key: "keepaspectratio" },
    },
    {
      kind: "text",
      id: "trim",
      label: "Trim",
      value: rawValue("trim") ?? "",
      placeholder: "left bottom right top",
      write: { kind: "setGraphicsOption", key: "trim", suffix: "" },
    },
    {
      kind: "boolean",
      id: "clip",
      label: "Clip to trim",
      value: hasFlag("clip"),
      write: { kind: "setGraphicsFlag", key: "clip" },
    },
  );
  return fields;
}

function tikzFields(
  context: BeamerSyntaxContext,
  node: BeamerObjectNode
): DeckInspectorField[] {
  const list = environmentOptions(context, node);
  const entry = list?.entries.find((candidate) => candidate.key === "scale");
  const raw = entry?.valueSpan
    ? context.source.slice(entry.valueSpan.from, entry.valueSpan.to)
    : null;
  const fields: DeckInspectorField[] = [];
  const field = optionNumberField({
    id: "scale",
    label: "Scale",
    raw,
    defaultSuffix: "",
    write: (suffix) => ({ kind: "setEnvironmentOption", key: "scale", suffix }),
  });
  if (field) {
    fields.push(field);
  }
  if (node.rootId) {
    fields.push({
      kind: "button",
      id: "edit-drawing",
      label: "Edit Drawing",
      command: { kind: "enterDrawing", rootId: node.rootId },
      write: null,
    });
  }
  return fields;
}

const UNSUPPORTED_EXCERPT_LIMIT = 600;

function unsupportedFields(
  context: BeamerSyntaxContext,
  node: BeamerObjectNode,
  message: string | undefined
): DeckInspectorField[] {
  const text = context.source.slice(node.sourceSpan.from, node.sourceSpan.to).trim();
  return [
    ...(message ? [{ kind: "message" as const, id: "reason", text: message, write: null }] : []),
    {
      kind: "code",
      id: "source",
      label: "Source",
      text: text.length > UNSUPPORTED_EXCERPT_LIMIT ? `${text.slice(0, UNSUPPORTED_EXCERPT_LIMIT)}…` : text,
      write: null,
    },
    {
      kind: "button",
      id: "show-in-source",
      label: "Show in Source",
      command: { kind: "revealSource", span: node.sourceSpan },
      write: null,
    },
  ];
}

const FRAME_ALIGNMENT_OPTIONS = [
  { value: "c", label: "Center" },
  { value: "t", label: "Top" },
  { value: "b", label: "Bottom" },
] as const;

/** `document` is the scan of `source` when the caller has one already. */
export function buildDeckFrameInspector(
  source: string,
  frameId: string,
  document?: BeamerDocumentModel
): DeckInspectorModel | null {
  const model = document?.source === source ? document : scanBeamerDocument(source);
  const frame = model.frames.find((candidate) => candidate.id === frameId);
  if (!frame) {
    return null;
  }
  const options = frame.options;
  const hasFlag = (key: string): boolean =>
    options?.entries.some((entry) => entry.key === key && entry.value == null) ?? false;
  const alignment = hasFlag("t") ? "t" : hasFlag("b") ? "b" : "c";
  const label =
    options?.entries.find((entry) => entry.key === "label")?.value ?? "";
  // The last `shrink` wins, as in resolveBeamerFrameShrink; a bare flag is 0%.
  const shrinkEntry = [...options?.entries ?? []].reverse().find((entry) => entry.key === "shrink");
  const shrinkValue = shrinkEntry == null ? null : Number(shrinkEntry.value?.trim() ?? 0);
  return {
    target: "frame",
    title: "Frame",
    fields: [
      // Layout first, then the slide's chrome, then technical options.
      {
        kind: "enum",
        id: "alignment",
        label: "Alignment",
        value: alignment,
        options: [...FRAME_ALIGNMENT_OPTIONS],
        write: { kind: "setFrameAlignment" },
      },
      {
        kind: "number",
        id: "shrink",
        label: "Shrink to fit",
        value: shrinkValue != null && Number.isFinite(shrinkValue) ? shrinkValue : null,
        step: 1,
        min: 0,
        max: 99,
        unit: "%",
        placeholder: "Off",
        write: { kind: "setFrameOption", key: "shrink" },
      },
      {
        kind: "boolean",
        id: "allowframebreaks",
        label: "Continue on more slides",
        value: options?.allowFrameBreaks != null,
        write: { kind: "setFrameOption", key: "allowframebreaks" },
      },
      {
        kind: "boolean",
        id: "plain",
        label: "Plain (no headline or footline)",
        value: options?.plain ?? false,
        write: { kind: "setFrameOption", key: "plain" },
      },
      {
        kind: "boolean",
        id: "noframenumbering",
        label: "Skip in frame numbering",
        value: options?.noFrameNumbering ?? false,
        write: { kind: "setFrameOption", key: "noframenumbering" },
      },
      {
        kind: "boolean",
        id: "fragile",
        label: "Fragile (verbatim content)",
        value: options?.fragile ?? false,
        write: { kind: "setFrameOption", key: "fragile" },
      },
      {
        kind: "text",
        id: "label",
        label: "Label",
        value: label,
        placeholder: "For \\againframe references",
        write: { kind: "setFrameOption", key: "label" },
      },
    ],
  };
}
