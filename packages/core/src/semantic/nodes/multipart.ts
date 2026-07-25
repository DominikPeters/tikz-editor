import type { OptionListAst } from "../../options/types.js";
import { texFragmentParser } from "@tikz-editor/lezer-tex";
import { normalizeOptionValue } from "./utils.js";

export type NodePartText = {
  name: string;
  text: string;
};

const RECTANGLE_SPLIT_CARDINALS = [
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty"
] as const;

const RECTANGLE_SPLIT_ORDINALS = [
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
  "eleventh",
  "twelfth",
  "thirteenth",
  "fourteenth",
  "fifteenth",
  "sixteenth",
  "seventeenth",
  "eighteenth",
  "nineteenth",
  "twentieth"
] as const;

export function parseNodeParts(text: string): NodePartText[] {
  const parts: NodePartText[] = [];
  let currentName = "text";
  let contentStart = 0;

  const pushCurrent = (contentEnd: number): void => {
    parts.push({
      name: currentName,
      text: text.slice(contentStart, contentEnd).trim(),
    });
  };

  for (const directive of collectNodePartDirectives(text)) {
    pushCurrent(directive.start);
    currentName = directive.name.length > 0 ? directive.name : "text";
    contentStart = directive.end;
  }

  pushCurrent(text.length);
  return mergeNodeParts(parts);
}

interface NodePartDirective {
  readonly start: number;
  readonly end: number;
  readonly name: string;
}

function collectNodePartDirectives(text: string): readonly NodePartDirective[] {
  const items = texFragmentParser
    .parse(text)
    .topNode
    .getChildren("FragmentItem")
    .map((fragment) => fragment.getChild("TexItem")?.firstChild)
    .filter((item) => item !== null && item !== undefined);
  const directives: NodePartDirective[] = [];

  for (let index = 0; index < items.length; index += 1) {
    const command = items[index];
    if (
      command?.name !== "GenericCommand" ||
      text.slice(command.from, command.to) !== String.raw`\nodepart`
    ) {
      continue;
    }

    let argumentIndex = index + 1;
    while (
      items[argumentIndex]?.name === "Whitespace" ||
      items[argumentIndex]?.name === "Comment"
    ) {
      argumentIndex += 1;
    }
    if (items[argumentIndex]?.name === "OptionalArgument") {
      argumentIndex += 1;
      while (
        items[argumentIndex]?.name === "Whitespace" ||
        items[argumentIndex]?.name === "Comment"
      ) {
        argumentIndex += 1;
      }
    }

    const nameGroup = items[argumentIndex];
    if (nameGroup?.name !== "Group") {
      continue;
    }
    const rawName = text.slice(nameGroup.from + 1, nameGroup.to - 1);
    directives.push({
      start: command.from,
      end: nameGroup.to,
      name: normalizePartName(rawName),
    });
    index = argumentIndex;
  }
  return directives;
}

function mergeNodeParts(parts: NodePartText[]): NodePartText[] {
  const merged = new Map<string, string>();
  const order: string[] = [];
  for (const part of parts) {
    const existing = merged.get(part.name);
    if (existing == null) {
      order.push(part.name);
      merged.set(part.name, part.text);
    } else {
      merged.set(part.name, `${existing}${existing.length > 0 ? " " : ""}${part.text}`.trim());
    }
  }
  return order.map((name) => ({ name, text: merged.get(name) ?? "" }));
}

function normalizePartName(raw: string): string {
  return normalizeOptionValue(raw).trim().toLowerCase().replaceAll("_", " ").replace(/\s+/gu, " ");
}

export function isMultipartShape(shape: string): boolean {
  return (
    shape === "circle split" ||
    shape === "circle solidus" ||
    shape === "ellipse split" ||
    shape === "diamond split" ||
    shape === "rectangle split"
  );
}

export function resolveRectangleSplitParts(options: OptionListAst | undefined): number {
  const fallback = 4;
  if (!options) {
    return fallback;
  }
  let parts = fallback;
  for (const entry of options.entries) {
    if (entry.kind !== "kv" || entry.key !== "rectangle split parts") {
      continue;
    }
    const parsed = Number.parseInt(normalizeOptionValue(entry.valueRaw), 10);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 20) {
      parts = parsed;
    }
  }
  return parts;
}

export function resolveRectangleSplitHorizontal(options: OptionListAst | undefined): boolean {
  if (!options) {
    return false;
  }
  let horizontal = false;
  for (const entry of options.entries) {
    if (entry.kind === "flag" && entry.key === "rectangle split horizontal") {
      horizontal = true;
      continue;
    }
    if (entry.kind === "kv" && entry.key === "rectangle split horizontal") {
      const normalized = normalizeOptionValue(entry.valueRaw).trim().toLowerCase();
      if (normalized === "false" || normalized === "off" || normalized === "no" || normalized === "0") {
        horizontal = false;
      } else {
        horizontal = true;
      }
    }
  }
  return horizontal;
}

export function resolveRectangleSplitIgnoreEmptyParts(options: OptionListAst | undefined): boolean {
  if (!options) {
    return false;
  }
  let ignore = false;
  for (const entry of options.entries) {
    if (entry.kind === "flag" && entry.key === "rectangle split ignore empty parts") {
      ignore = true;
      continue;
    }
    if (entry.kind === "kv" && entry.key === "rectangle split ignore empty parts") {
      const normalized = normalizeOptionValue(entry.valueRaw).trim().toLowerCase();
      if (normalized === "false" || normalized === "off" || normalized === "no" || normalized === "0") {
        ignore = false;
      } else {
        ignore = true;
      }
    }
  }
  return ignore;
}

export function resolveRectangleSplitPartTexts(parts: NodePartText[], partCount: number): string[] {
  const resolved = Array.from<string>({ length: Math.max(1, partCount) }).fill("");
  const first = parts.find((part) => part.name === "text");
  if (first) {
    resolved[0] = first.text;
  }

  let nextFallbackIndex = 1;
  for (const part of parts) {
    if (part.name === "text") {
      continue;
    }
    const namedIndex = rectangleSplitPartNameToIndex(part.name);
    let targetIndex = namedIndex != null ? namedIndex - 1 : -1;
    if (targetIndex < 0 || targetIndex >= resolved.length) {
      while (nextFallbackIndex < resolved.length && resolved[nextFallbackIndex] !== "") {
        nextFallbackIndex += 1;
      }
      targetIndex = nextFallbackIndex < resolved.length ? nextFallbackIndex : -1;
    }
    if (targetIndex < 0 || targetIndex >= resolved.length) {
      continue;
    }
    const existing = resolved[targetIndex];
    resolved[targetIndex] = existing.length > 0 ? `${existing} ${part.text}`.trim() : part.text;
  }

  return resolved;
}

function rectangleSplitPartNameToIndex(name: string): number | null {
  const numeric = name.match(/^(\d{1,2})$/u);
  if (numeric) {
    const index = Number.parseInt(numeric[1] ?? "", 10);
    return Number.isFinite(index) && index >= 1 && index <= 20 ? index : null;
  }
  if (name === "text") {
    return 1;
  }
  const cardinalIndex = RECTANGLE_SPLIT_CARDINALS.findIndex((value) => value === name);
  if (cardinalIndex >= 0) {
    return cardinalIndex + 1;
  }
  const ordinalIndex = RECTANGLE_SPLIT_ORDINALS.findIndex((value) => value === name);
  if (ordinalIndex >= 0) {
    return ordinalIndex + 1;
  }
  return null;
}
