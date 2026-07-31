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
} from "./deck-edit-actions.js";
import type { BeamerObjectNode } from "./object-index.js";

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
  | { kind: "setColumnWidth"; suffix: string }
  | { kind: "setFrameOption"; key: string }
  | { kind: "setFrameAlignment" };

export type DeckInspectorField =
  | {
      kind: "enum";
      id: string;
      label: string;
      value: string;
      options: ReadonlyArray<{ value: string; label: string }>;
      write: DeckInspectorWrite;
    }
  | {
      kind: "text";
      id: string;
      label: string;
      value: string;
      placeholder?: string;
      write: DeckInspectorWrite;
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
      write: DeckInspectorWrite;
    }
  | {
      kind: "boolean";
      id: string;
      label: string;
      value: boolean;
      write: DeckInspectorWrite;
    };

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
  block: "Block",
  columns: "Columns",
  column: "Column",
  graphics: "Image",
  tikzpicture: "Drawing",
  list: "List",
  item: "Item",
};

export function buildDeckObjectInspector(
  source: string,
  node: BeamerObjectNode
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
    case "column":
      fields.push(...columnFields(context, node));
      break;
    case "graphics":
      fields.push(...graphicsFields(context, node));
      break;
    case "tikzpicture":
      fields.push(...tikzFields(context, node));
      break;
    case "columns":
      // No editable properties yet (per-divider widths live on the columns).
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

function listFields(
  context: BeamerSyntaxContext,
  node: BeamerObjectNode
): DeckInspectorField[] {
  const typeField = environmentEnumField(context, node, "Type");
  return typeField ? [typeField] : [];
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
      unit: parsed.suffix || undefined,
      write: { kind: "setColumnWidth", suffix: parsed.suffix },
    },
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
      unit: args.defaultSuffix || undefined,
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
    unit: parsed.suffix || undefined,
    write: args.write(parsed.suffix),
  };
}

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
  const optional = beamerOptionalArgumentAfter(
    context,
    command.span.to,
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
  const fields: DeckInspectorField[] = [];
  for (const [id, label, defaultSuffix] of [
    ["width", "Width", "\\textwidth"],
    ["height", "Height", "\\textheight"],
    ["scale", "Scale", ""],
  ] as const) {
    const field = optionNumberField({
      id,
      label,
      raw: rawValue(id),
      defaultSuffix,
      write: (suffix) => ({ kind: "setGraphicsOption", key: id, suffix }),
    });
    if (field) {
      fields.push(field);
    }
  }
  return fields;
}

function tikzFields(
  context: BeamerSyntaxContext,
  node: BeamerObjectNode
): DeckInspectorField[] {
  const pair = environmentBoundariesOf(context, node);
  if (!pair) {
    return [];
  }
  const optional = beamerOptionalArgumentAfter(
    context,
    pair.begin.span.to,
    node.sourceSpan.to
  );
  const list = optional ? readOptionList(context.source, optional) : null;
  const entry = list?.entries.find((candidate) => candidate.key === "scale");
  const raw = entry?.valueSpan
    ? context.source.slice(entry.valueSpan.from, entry.valueSpan.to)
    : null;
  const field = optionNumberField({
    id: "scale",
    label: "Scale",
    raw,
    defaultSuffix: "",
    write: (suffix) => ({ kind: "setEnvironmentOption", key: "scale", suffix }),
  });
  return field ? [field] : [];
}

const FRAME_ALIGNMENT_OPTIONS = [
  { value: "c", label: "Center" },
  { value: "t", label: "Top" },
  { value: "b", label: "Bottom" },
] as const;

export function buildDeckFrameInspector(
  source: string,
  frameId: string
): DeckInspectorModel | null {
  const model = scanBeamerDocument(source);
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
  return {
    target: "frame",
    title: "Frame",
    fields: [
      {
        kind: "enum",
        id: "alignment",
        label: "Alignment",
        value: alignment,
        options: [...FRAME_ALIGNMENT_OPTIONS],
        write: { kind: "setFrameAlignment" },
      },
      {
        kind: "boolean",
        id: "fragile",
        label: "Fragile (verbatim content)",
        value: options?.fragile ?? false,
        write: { kind: "setFrameOption", key: "fragile" },
      },
      {
        kind: "boolean",
        id: "plain",
        label: "Plain (no headline/footline)",
        value: options?.plain ?? false,
        write: { kind: "setFrameOption", key: "plain" },
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
