import type { Span } from "../../ast/types.js";
import { parseOptionListRaw } from "../../options/parse.js";
import { preambleCommandScope } from "../preamble-edit-context.js";
import { beamerControlSequencesIn, beamerOptionalArgumentAfter, beamerRequiredArgumentAfter, beamerSourceValueTokens, createBeamerSyntaxContext } from "../syntax.js";
import type { BeamerDocumentModel } from "../types.js";

/** The four faces of a fontspec family, as font file name candidates. */
export type BeamerFontspecFaces = {
  readonly upright: readonly string[];
  readonly italic: readonly string[];
  readonly bold: readonly string[];
  readonly boldItalic: readonly string[];
};

export type BeamerFontspecEvent = {
  kind: "fontspec";
  span: Span;
  /** `\setmainfont` (main), `\setsansfont` (sans), `\setmonofont` (mono), or a `\newfontfamily` command. */
  target: "main" | "sans" | "mono" | { command: string };
  /** The font name as written, for diagnostics. */
  name: string;
  faces: BeamerFontspecFaces;
  /** Folder of `Path=`, relative to the document. */
  path?: string;
  /**
   * Whether the font was named by file (an extension, or `Extension=`). A
   * family name is looked up as luaotfload does by default, system fonts
   * before the TeX tree; a file name is found in the TeX tree first.
   */
  byFileName: boolean;
  unsupportedOptions: readonly string[];
};

// Option keys are compared in lower case: the option parser folds them.
const FACE_OPTIONS = {
  upright: "uprightfont", italic: "italicfont", bold: "boldfont", boldItalic: "bolditalicfont",
} as const;
const DEFAULT_SUFFIXES = { upright: ["-Regular", ""], italic: ["-Italic"], bold: ["-Bold"], boldItalic: ["-BoldItalic"] } as const;
// Options that do not change which font files are used, or that the editor
// already behaves as: TeX ligatures are applied by the text layer.
const NEUTRAL_OPTIONS = new Set(["ligatures", "path", "extension", "uprightfont", "italicfont", "boldfont", "bolditalicfont", "numbers", "renderer"]);

/**
 * fontspec's font selection commands in a preamble, in source order. Face
 * names follow fontspec: `*` in a face option stands for the font name, a
 * name with an extension (or `Extension=`) is a file, and a family name
 * looks for its Regular, Italic, Bold and BoldItalic files.
 */
export function scanBeamerFontspecDeclarations(document: BeamerDocumentModel): BeamerFontspecEvent[] {
  const preamble = document.source.slice(document.preamble.span.from, document.preamble.span.to);
  if (!/\\(?:setmainfont|setsansfont|setmonofont|newfontfamily|renewfontfamily|setfontfamily)(?![A-Za-z@])/u.test(preamble)) return [];
  const context = createBeamerSyntaxContext(document.source);
  const limit = document.preamble.span.to;
  const events: BeamerFontspecEvent[] = [];
  const commands = { setmainfont: "main", setsansfont: "sans", setmonofont: "mono" } as const;
  for (const command of beamerControlSequencesIn(context, document.preamble.span)) {
    const fixed = command.name === "setmainfont" || command.name === "setsansfont" || command.name === "setmonofont" ? commands[command.name] : undefined;
    const family = command.name === "newfontfamily" || command.name === "renewfontfamily" || command.name === "setfontfamily";
    if (!fixed && !family) continue;
    if (preambleCommandScope(document, { from: command.from, to: command.to }, context) === "macro") continue;
    let cursor = command.to;
    let target: BeamerFontspecEvent["target"];
    if (family) {
      const after = document.source.slice(cursor, limit);
      const direct = /^\s*(\\[A-Za-z@]+)/u.exec(after);
      const braced = direct ? null : beamerRequiredArgumentAfter(context, cursor, limit);
      const name = direct?.[1] ?? (braced ? beamerSourceValueTokens(context, braced).trim() : "");
      if (!/^\\[A-Za-z@]+$/u.test(name)) continue;
      target = { command: name };
      cursor = direct ? cursor + direct[0].length : braced?.span.to ?? cursor;
    } else {
      target = fixed ?? "sans";
    }
    const before = beamerOptionalArgumentAfter(context, cursor, limit);
    const nameArg = beamerRequiredArgumentAfter(context, before?.span.to ?? cursor, limit);
    if (!nameArg) continue;
    const afterOptions = beamerOptionalArgumentAfter(context, nameArg.span.to, limit);
    const options = new Map<string, string>();
    for (const value of [before, afterOptions]) {
      if (!value) continue;
      for (const entry of parseOptionListRaw(document.source.slice(value.span.from, value.span.to)).entries) {
        if (entry.kind === "kv") options.set(entry.key.trim().toLowerCase(), unbrace(entry.valueRaw));
        else if (entry.kind === "flag") options.set(entry.key.trim().toLowerCase(), "");
      }
    }
    const name = beamerSourceValueTokens(context, nameArg).trim();
    const span = { from: command.from, to: (afterOptions ?? nameArg).span.to };
    const path = options.get("path");
    events.push({
      kind: "fontspec", span, target, name,
      byFileName: options.has("extension") || /\.(?:otf|ttf)$/iu.test(name),
      faces: fontspecFaces(name, options),
      ...(path ? { path } : {}),
      unsupportedOptions: [...options.keys()].filter(key => !NEUTRAL_OPTIONS.has(key)),
    });
  }
  return events;
}

function fontspecFaces(name: string, options: ReadonlyMap<string, string>): BeamerFontspecFaces {
  const extension = options.get("extension") ?? /\.(?:otf|ttf)$/iu.exec(name)?.[0];
  const base = extension && name.toLowerCase().endsWith(extension.toLowerCase()) ? name.slice(0, -extension.length) : name;
  const files = (stem: string): string[] => {
    // A face option may name the file with its extension already.
    if (/\.(?:otf|ttf)$/iu.test(stem)) return [stem];
    const stems = [...new Set([stem, stem.replace(/\s+/gu, "-"), stem.replace(/\s+/gu, "")])];
    return extension ? stems.map(candidate => `${candidate}${extension}`) : stems.flatMap(candidate => [`${candidate}.otf`, `${candidate}.ttf`]);
  };
  const face = (key: keyof typeof FACE_OPTIONS): string[] => {
    const option = options.get(FACE_OPTIONS[key]);
    if (option !== undefined) return files(option.replaceAll("*", base));
    // A file name given for the upright face is only that face.
    if (extension && key === "upright") return files(base);
    return DEFAULT_SUFFIXES[key].flatMap(suffix => files(`${base}${suffix}`));
  };
  return { upright: face("upright"), italic: face("italic"), bold: face("bold"), boldItalic: face("boldItalic") };
}

function unbrace(raw: string): string {
  const value = raw.trim();
  return value.startsWith("{") && value.endsWith("}") ? value.slice(1, -1).trim() : value;
}

/** Every font file name a document's fontspec declarations may load. */
export type BeamerFontFileRequest = { names: readonly string[]; path?: string; byFileName: boolean };

export function beamerFontspecFileRequests(events: readonly BeamerFontspecEvent[]): BeamerFontFileRequest[] {
  return events.flatMap(event => Object.values(event.faces).map(names => ({ names, byFileName: event.byFileName, ...(event.path ? { path: event.path } : {}) })));
}
