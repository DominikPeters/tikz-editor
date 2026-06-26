import { expandTexConditionals } from "../conditionals/expand.js";
import {
  concatMappedText,
  createGeneratedMappedText,
  createIdentityMappedText,
  createMappedText,
  projectInputRange,
  sliceMappedText,
  type MappedText,
  type TextSourceProjection,
  type TextSourceRange
} from "../text/source-map.js";
import type { MacroBinding, MacroOriginFrame } from "./types.js";

const CONTROL_SEQUENCE_REGEX = /\\[A-Za-z@]+/g;
const CONTROL_SEQUENCE_AT_START_REGEX = /^\\[A-Za-z@]+/;
const LETTER_HEAD_REGEX = /^[A-Za-z@]/;
const CONTROL_WORD_TAIL_REGEX = /\\[A-Za-z@]+$/;
const LETTER_CHAR_REGEX = /[A-Za-z@]/;
const DIGIT_REGEX = /[1-9]/;

export const DEFAULT_MACRO_EXPANSION_MAX_DEPTH = 100;

export type MacroExpansionTraceEvent = {
  macroName: string;
  provenance: MacroOriginFrame[];
};

export type MacroExpansionOptions = {
  maxDepth?: number;
  trace?: MacroExpansionTraceEvent[];
  sourceOffset?: number;
};

export function expandMacroBindings(
  input: string,
  bindings: ReadonlyMap<string, MacroBinding>,
  opts: MacroExpansionOptions = {}
): string {
  if (input.length === 0 || bindings.size === 0) {
    return input;
  }

  const maxDepth = Math.max(1, opts.maxDepth ?? DEFAULT_MACRO_EXPANSION_MAX_DEPTH);
  let current = input;
  const seen = new Set<string>([current]);

  for (let depth = 0; depth < maxDepth; depth += 1) {
    const next = expandTexConditionals(substituteSinglePass(current, bindings, opts.trace));
    if (next === current) {
      return next;
    }
    if (seen.has(next)) {
      return next;
    }

    seen.add(next);
    current = next;
  }

  return current;
}

export function expandMacroBindingsMapped(
  input: string | MappedText,
  bindings: ReadonlyMap<string, MacroBinding>,
  opts: MacroExpansionOptions = {}
): MappedText {
  const initial = typeof input === "string"
    ? createIdentityMappedText(input, opts.sourceOffset ?? 0)
    : input;
  if (initial.text.length === 0 || bindings.size === 0) {
    return initial;
  }

  const maxDepth = Math.max(1, opts.maxDepth ?? DEFAULT_MACRO_EXPANSION_MAX_DEPTH);
  let current = initial;
  const seen = new Set<string>([current.text]);

  for (let depth = 0; depth < maxDepth; depth += 1) {
    const substituted = substituteSingleMappedPass(current, bindings, opts.trace);
    const next = expandTexConditionalsMapped(substituted);
    if (next.text === current.text) {
      return next;
    }
    if (seen.has(next.text)) {
      return next;
    }

    seen.add(next.text);
    current = next;
  }

  return current;
}

export function isControlSequenceToken(raw: string): boolean {
  return /^\\[A-Za-z@]+$/.test(raw.trim());
}

function substituteSinglePass(
  input: string,
  bindings: ReadonlyMap<string, MacroBinding>,
  trace: MacroExpansionTraceEvent[] | undefined
): string {
  let output = "";
  let cursor = 0;
  CONTROL_SEQUENCE_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null = CONTROL_SEQUENCE_REGEX.exec(input);
  while (match) {
    const macroName = match[0];
    const matchStart = match.index;
    const matchEnd = matchStart + macroName.length;
    output += input.slice(cursor, matchStart);

    const binding = bindings.get(macroName);
    if (binding == null) {
      output += macroName;
      cursor = matchEnd;
      CONTROL_SEQUENCE_REGEX.lastIndex = cursor;
      match = CONTROL_SEQUENCE_REGEX.exec(input);
      continue;
    }

    let replacement: string | null = null;
    let consumedUntil = matchEnd;

    if (binding.kind === "text") {
      replacement = binding.value;
    } else {
      const args = parseMacroInvocationArgs(
        input,
        matchEnd,
        binding.parameterCount,
        binding.optionalFirstArgDefault
      );
      if (args) {
        replacement = applyMacroArguments(binding.body, args.values);
        consumedUntil = args.nextIndex;
      }
    }

    if (replacement == null) {
      output += macroName;
      cursor = matchEnd;
      CONTROL_SEQUENCE_REGEX.lastIndex = cursor;
      match = CONTROL_SEQUENCE_REGEX.exec(input);
      continue;
    }

    recordTrace(trace, macroName, binding.provenance);
    if (requiresLeadingBoundary(output, replacement)) {
      output += "{}";
    }
    output += replacement;
    const nextChar = input[consumedUntil] ?? "";
    if (requiresTrailingBoundary(replacement, nextChar)) {
      output += "{}";
    }

    cursor = consumedUntil;
    CONTROL_SEQUENCE_REGEX.lastIndex = cursor;
    match = CONTROL_SEQUENCE_REGEX.exec(input);
  }

  output += input.slice(cursor);
  return output;
}

function substituteSingleMappedPass(
  input: MappedText,
  bindings: ReadonlyMap<string, MacroBinding>,
  trace: MacroExpansionTraceEvent[] | undefined
): MappedText {
  const parts: MappedText[] = [];
  let cursor = 0;
  CONTROL_SEQUENCE_REGEX.lastIndex = 0;

  let match: RegExpExecArray | null = CONTROL_SEQUENCE_REGEX.exec(input.text);
  while (match) {
    const macroName = match[0];
    const matchStart = match.index;
    const matchEnd = matchStart + macroName.length;
    if (cursor < matchStart) {
      parts.push(sliceMappedText(input, cursor, matchStart));
    }

    const binding = bindings.get(macroName);
    if (binding == null) {
      parts.push(sliceMappedText(input, matchStart, matchEnd));
      cursor = matchEnd;
      CONTROL_SEQUENCE_REGEX.lastIndex = cursor;
      match = CONTROL_SEQUENCE_REGEX.exec(input.text);
      continue;
    }

    let replacement: MappedText | null = null;
    let consumedUntil = matchEnd;

    if (binding.kind === "text") {
      replacement = createMacroGeneratedText(binding.value, macroName, binding.provenance, {
        from: sourceOffsetForInputOffset(input, matchStart),
        to: sourceOffsetForInputOffset(input, matchEnd)
      });
    } else {
      const args = parseMacroInvocationArgs(
        input.text,
        matchEnd,
        binding.parameterCount,
        binding.optionalFirstArgDefault
      );
      if (args) {
        consumedUntil = args.nextIndex;
        replacement = applyMappedMacroArguments({
          template: binding.body,
          input,
          args: args.args,
          macroName,
          provenance: binding.provenance,
          invocation: sourceRangeForInputRange(input, matchStart, consumedUntil)
        });
      }
    }

    if (replacement == null) {
      parts.push(sliceMappedText(input, matchStart, matchEnd));
      cursor = matchEnd;
      CONTROL_SEQUENCE_REGEX.lastIndex = cursor;
      match = CONTROL_SEQUENCE_REGEX.exec(input.text);
      continue;
    }

    recordTrace(trace, macroName, binding.provenance);
    const invocation = sourceRangeForInputRange(input, matchStart, consumedUntil);
    const outputSoFar = parts.map((part) => part.text).join("");
    if (requiresLeadingBoundary(outputSoFar, replacement.text)) {
      parts.push(createMacroGeneratedText("{}", macroName, binding.provenance, invocation));
    }
    parts.push(replacement);
    const nextChar = input.text[consumedUntil] ?? "";
    if (requiresTrailingBoundary(replacement.text, nextChar)) {
      parts.push(createMacroGeneratedText("{}", macroName, binding.provenance, invocation));
    }

    cursor = consumedUntil;
    CONTROL_SEQUENCE_REGEX.lastIndex = cursor;
    match = CONTROL_SEQUENCE_REGEX.exec(input.text);
  }

  if (cursor < input.text.length) {
    parts.push(sliceMappedText(input, cursor, input.text.length));
  }
  return concatMappedText(parts);
}

function parseMacroInvocationArgs(
  input: string,
  startIndex: number,
  count: number,
  optionalFirstArgDefault: string | undefined
): { values: string[]; args: ParsedMacroArgument[]; nextIndex: number } | null {
  if (count <= 0) {
    return { values: [], args: [], nextIndex: startIndex };
  }

  let cursor = startIndex;
  const values: string[] = [];
  const args: ParsedMacroArgument[] = [];
  if (optionalFirstArgDefault != null) {
    cursor = skipWhitespace(input, cursor);
    if (input[cursor] === "[") {
      const optionalArg = parseOptionalBracketArgument(input, cursor);
      if (!optionalArg) {
        return null;
      }
      values.push(optionalArg.value);
      args.push(optionalArg);
      cursor = optionalArg.nextIndex;
    } else {
      values.push(optionalFirstArgDefault);
      args.push({
        value: optionalFirstArgDefault,
        valueStart: cursor,
        valueEnd: cursor,
        tokenStart: cursor,
        tokenEnd: cursor,
        nextIndex: cursor,
        defaulted: true
      });
    }
  }

  const requiredCount = Math.max(0, count - values.length);
  for (let argIndex = 0; argIndex < requiredCount; argIndex += 1) {
    cursor = skipWhitespace(input, cursor);
    if (cursor >= input.length) {
      return null;
    }

    const parsed = parseSingleMacroArgument(input, cursor);
    if (!parsed) {
      return null;
    }
    values.push(parsed.value);
    args.push(parsed);
    cursor = parsed.nextIndex;
  }

  return {
    values,
    args,
    nextIndex: cursor
  };
}

type ParsedMacroArgument = {
  readonly value: string;
  readonly valueStart: number;
  readonly valueEnd: number;
  readonly tokenStart: number;
  readonly tokenEnd: number;
  readonly nextIndex: number;
  readonly defaulted?: boolean;
};

function parseOptionalBracketArgument(input: string, startIndex: number): ParsedMacroArgument | null {
  return readBracketContent(input, startIndex);
}

function parseSingleMacroArgument(input: string, startIndex: number): ParsedMacroArgument | null {
  const first = input[startIndex] ?? "";
  if (first.length === 0) {
    return null;
  }

  if (first === "{") {
    return readBracedContent(input, startIndex);
  }

  if (first === "\\") {
    const match = CONTROL_SEQUENCE_AT_START_REGEX.exec(input.slice(startIndex));
    if (match) {
      return {
        value: match[0],
        valueStart: startIndex,
        valueEnd: startIndex + match[0].length,
        tokenStart: startIndex,
        tokenEnd: startIndex + match[0].length,
        nextIndex: startIndex + match[0].length
      };
    }
  }

  return {
    value: first,
    valueStart: startIndex,
    valueEnd: startIndex + 1,
    tokenStart: startIndex,
    tokenEnd: startIndex + 1,
    nextIndex: startIndex + 1
  };
}

function readBracedContent(input: string, startIndex: number): ParsedMacroArgument | null {
  let depth = 0;
  let index = startIndex;
  while (index < input.length) {
    const char = input[index];
    if (char === "\\") {
      index += 2;
      continue;
    }

    if (char === "{") {
      depth += 1;
      index += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          value: input.slice(startIndex + 1, index),
          valueStart: startIndex + 1,
          valueEnd: index,
          tokenStart: startIndex,
          tokenEnd: index + 1,
          nextIndex: index + 1
        };
      }
    }
    index += 1;
  }

  return null;
}

function readBracketContent(input: string, startIndex: number): ParsedMacroArgument | null {
  let depth = 0;
  let index = startIndex;
  while (index < input.length) {
    const char = input[index];
    if (char === "\\") {
      index += 2;
      continue;
    }

    if (char === "[") {
      depth += 1;
      index += 1;
      continue;
    }
    if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        return {
          value: input.slice(startIndex + 1, index),
          valueStart: startIndex + 1,
          valueEnd: index,
          tokenStart: startIndex,
          tokenEnd: index + 1,
          nextIndex: index + 1
        };
      }
    }
    index += 1;
  }

  return null;
}

function applyMacroArguments(template: string, args: string[]): string {
  let output = "";
  for (let index = 0; index < template.length; index += 1) {
    const char = template[index] ?? "";
    if (char !== "#") {
      output += char;
      continue;
    }

    const next = template[index + 1] ?? "";
    if (next === "#") {
      output += "#";
      index += 1;
      continue;
    }

    if (DIGIT_REGEX.test(next)) {
      const argIndex = Number.parseInt(next, 10) - 1;
      output += args[argIndex] ?? `#${next}`;
      index += 1;
      continue;
    }

    output += "#";
  }
  return output;
}

function applyMappedMacroArguments(params: {
  readonly template: string;
  readonly input: MappedText;
  readonly args: readonly ParsedMacroArgument[];
  readonly macroName: string;
  readonly provenance: MacroOriginFrame[];
  readonly invocation: TextSourceRange;
}): MappedText {
  const parts: MappedText[] = [];
  let literalStart = 0;
  for (let index = 0; index < params.template.length; index += 1) {
    const char = params.template[index] ?? "";
    if (char !== "#") {
      continue;
    }

    if (literalStart < index) {
      parts.push(createMacroGeneratedText(
        params.template.slice(literalStart, index),
        params.macroName,
        params.provenance,
        params.invocation
      ));
    }

    const next = params.template[index + 1] ?? "";
    if (next === "#") {
      parts.push(createMacroGeneratedText("#", params.macroName, params.provenance, params.invocation));
      index += 1;
      literalStart = index + 1;
      continue;
    }

    if (DIGIT_REGEX.test(next)) {
      const argIndex = Number.parseInt(next, 10) - 1;
      const arg = params.args[argIndex];
      parts.push(arg
        ? mappedMacroArgument(params.input, arg, params.invocation, params.macroName, params.provenance)
        : createMacroGeneratedText(`#${next}`, params.macroName, params.provenance, params.invocation));
      index += 1;
      literalStart = index + 1;
      continue;
    }

    parts.push(createMacroGeneratedText("#", params.macroName, params.provenance, params.invocation));
    literalStart = index + 1;
  }

  if (literalStart < params.template.length) {
    parts.push(createMacroGeneratedText(
      params.template.slice(literalStart),
      params.macroName,
      params.provenance,
      params.invocation
    ));
  }

  return concatMappedText(parts);
}

function mappedMacroArgument(
  input: MappedText,
  arg: ParsedMacroArgument,
  invocation: TextSourceRange,
  macroName: string,
  provenance: MacroOriginFrame[]
): MappedText {
  if (arg.defaulted) {
    return createGeneratedMappedText(arg.value, "macro optional default", invocation);
  }
  const sliced = sliceMappedText(input, arg.valueStart, arg.valueEnd);
  const definition = definitionRangeFromProvenance(provenance);
  const charOrigins = sliced.sourceMap.charOrigins.map((origin): TextSourceProjection => {
    if (origin.kind === "direct" || origin.kind === "macro-argument") {
      return {
        kind: "macro-argument",
        from: origin.from,
        to: origin.to,
        invocation,
        macroName,
        ...(definition ? { definition } : {})
      };
    }
    return origin;
  });
  return createMappedText(sliced.text, charOrigins, sliced.sourceMap.boundaryOrigins);
}

function createMacroGeneratedText(
  text: string,
  macroName: string,
  provenance: MacroOriginFrame[],
  invocation: TextSourceRange
): MappedText {
  const definition = definitionRangeFromProvenance(provenance);
  const projection: TextSourceProjection = {
    kind: "macro-generated",
    invocation,
    macroName,
    ...(definition ? { definition } : {})
  };
  return createMappedText(
    text,
    Array.from({ length: text.length }, () => projection)
  );
}

function expandTexConditionalsMapped(mapped: MappedText): MappedText {
  const expanded = expandTexConditionals(mapped.text);
  if (expanded === mapped.text) {
    return mapped;
  }
  const hit = projectInputRange(mapped.sourceMap, 0, mapped.text.length);
  const owner = hit.kind === "source-range" ? { from: hit.from, to: hit.to } : undefined;
  return createGeneratedMappedText(expanded, "tex conditional expansion", owner);
}

function sourceRangeForInputRange(input: MappedText, start: number, end: number): TextSourceRange {
  const hit = projectInputRange(input.sourceMap, start, end);
  if (hit.kind === "source-offset") {
    return { from: hit.offset, to: hit.offset };
  }
  if (hit.kind === "source-range") {
    return { from: hit.from, to: hit.to };
  }
  return { from: start, to: end };
}

function sourceOffsetForInputOffset(input: MappedText, offset: number): number {
  const hit = projectInputRange(input.sourceMap, offset, offset);
  if (hit.kind === "source-offset") {
    return hit.offset;
  }
  if (hit.kind === "source-range") {
    return hit.from;
  }
  return offset;
}

function definitionRangeFromProvenance(provenance: MacroOriginFrame[]): TextSourceRange | undefined {
  const definitionSpan = provenance[0]?.definitionSpan;
  return definitionSpan ? { from: definitionSpan.from, to: definitionSpan.to } : undefined;
}

function recordTrace(trace: MacroExpansionTraceEvent[] | undefined, macroName: string, provenance: MacroOriginFrame[]): void {
  if (!trace) {
    return;
  }
  trace.push({
    macroName,
    provenance: cloneProvenance(provenance)
  });
}

function cloneProvenance(provenance: MacroOriginFrame[]): MacroOriginFrame[] {
  return provenance.map((entry) => ({
    macroName: entry.macroName,
    definitionId: entry.definitionId,
    definitionSpan: {
      from: entry.definitionSpan.from,
      to: entry.definitionSpan.to
    },
    commandRaw: entry.commandRaw
  }));
}

function skipWhitespace(input: string, startIndex: number): number {
  let cursor = startIndex;
  while (cursor < input.length) {
    if (!/\s/.test(input[cursor] ?? "")) {
      break;
    }
    cursor += 1;
  }
  return cursor;
}

function requiresLeadingBoundary(outputSoFar: string, replacement: string): boolean {
  return LETTER_HEAD_REGEX.test(replacement) && CONTROL_WORD_TAIL_REGEX.test(outputSoFar);
}

function requiresTrailingBoundary(replacement: string, nextChar: string): boolean {
  return nextChar.length > 0 && LETTER_CHAR_REGEX.test(nextChar) && CONTROL_WORD_TAIL_REGEX.test(replacement);
}
