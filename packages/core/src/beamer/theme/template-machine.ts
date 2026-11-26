import type { LaidParagraph } from "../render-model.js";
import type { Span } from "../../ast/types.js";
import { texLength } from "../../text/tex/coordinates.js";
import { evaluateTexLengthExpression } from "../../text/tex/dimensions.js";
import { concatMappedText, createGeneratedMappedText, type MappedText } from "../../text/source-map.js";
import { createBeamerTexTextFontProfile } from "./font.js";
import { beamerNamedFontSizes, beamerTrivlistSpacing } from "./font-sizes.js";
import { resolveBeamerThemeColor } from "./resolve.js";
import {
  EMPTY_FRAG,
  TemplateReader,
  fragConcat,
  fragGenerated,
  fragMappedText,
  fragSlice,
  splitTemplateOptions,
  type TemplateFrag,
  type TemplateToken,
} from "./template-lexer.js";
import type {
  BeamerTemplateElementFont,
  BeamerThemeFont,
  BeamerThemeFontRole,
  ResolvedBeamerTheme,
} from "./types.js";
import type { BeamerDocumentModel, BeamerMetadataFieldModel } from "../types.js";

/** A construct outside the interpreter's vocabulary; the template falls back. */
export class TemplateUnsupported extends Error {
  constructor(readonly command: string) {
    super(`Unsupported template construct ${command}`);
  }
}

export type TemplateParagraphRequest = {
  mapped: MappedText;
  width: number;
  alignment: "left" | "center" | "right";
  justify: boolean;
  font: BeamerThemeFont;
  /** The baseline skip in force when the paragraph ends. */
  baselineSkipPt: number;
  owner: Span;
  id: string;
};

export type TemplateParagraphMeasure = {
  /** Paragraph material from its top to the bottom of its last line. */
  extent: number;
  /** Height of the first line, as baseline glue before the paragraph sees it. */
  firstHeight: number;
  endingDepth: number;
  baselineSkip: number;
  /** First baseline below the paragraph's top. */
  firstBaseline: number;
  naturalWidth: number;
  /** The laid-out paragraph, for hosts that paint it. */
  laid: LaidParagraph;
};

export type TemplateEnvironment = {
  theme: ResolvedBeamerTheme;
  metadata: BeamerDocumentModel["preamble"]["metadata"];
  /** Owner of generated text. */
  owner: Span;
  paperWidth: number;
  paperHeight: number;
  /** `\hsize` and `\textwidth` at the start of the template. */
  width: number;
  leftMargin: number;
  rightMargin: number;
  /** User length registers set in the preamble, in points, by name. */
  registers: ReadonlyMap<string, number>;
  frameNumber: number;
  totalFrames: number;
  idPrefix: string;
  /** The font in force when the template starts. */
  font: BeamerThemeFont;
  measure(request: TemplateParagraphRequest): TemplateParagraphMeasure | null;
  /** `\insertblocktitle`. */
  blockTitle?: TemplateFrag;
  /** Offsets inside the template that map to the main document. */
  blockTitleMapped?: boolean;
};

export type TemplatePaint =
  | { kind: "fill"; x: number; y: number; w: number; h: number; color: string }
  /** Where a block template's body begins. */
  | { kind: "slot"; x: number; y: number; w: number }
  | {
      kind: "text";
      id: string;
      x: number;
      y: number;
      w: number;
      firstBaseline: number;
      height: number;
      mapped: MappedText;
      font: BeamerThemeFont;
      color: string;
      alignment: "left" | "center" | "right";
      justify: boolean;
      baselineSkipPt: number;
      laid: LaidParagraph;
      /** The main-document source the text comes from (inserted metadata), else the owner's. */
      sourceSpan: Span;
    };

export type TemplateBox = {
  w: number;
  h: number;
  d: number;
  /** The height baseline glue sees: a paragraph's first line, else `h`. */
  firstH: number;
  paint: TemplatePaint[];
  /** Depth of the last box in a packed list: the `\prevdepth` the list leaves. */
  lastDepth?: number;
  /** Baseline skip glue before this box uses, when it is not the list's own. */
  baselineSkip?: number;
};

type Glue = { pt: number; fill: number };
type VItem = { kind: "glue"; glue: Glue } | { kind: "box"; box: TemplateBox; x: number };

type Registers = {
  font: BeamerThemeFont;
  fg: string;
  bg: string;
  text: string;
  leftFinite: number;
  rightFinite: number;
  leftInfinite: boolean;
  rightInfinite: boolean;
  parskip: number;
  hsize: number;
  textwidth: number;
  linewidth: number;
  offInterline: boolean;
  normalBaselineSkip: number;
  ignoreSpaces: boolean;
  lengths: Map<string, number>;
  /** `\parshape` of a list: the left edge and width of its paragraphs; null outside lists. */
  parshape: { x: number; w: number } | null;
  /** Whether `\@rightskip` is infinite (`\raggedright`); lists restore `\rightskip` from it. */
  atRightskip: boolean;
  /** `\if@minipage`: nothing has started a paragraph in this box yet, so `\addvspace` does nothing. */
  minipage: boolean;
  /** `\@listdepth`: `\list` environments (changepage's adjustwidth) the text is in. */
  listDepth: number;
};

type Para = {
  id: number;
  pieces: TemplateFrag[];
  content: boolean;
  /** Whether anything but glue (spaces, \\hspace) has been emitted. */
  visible: boolean;
  /** Group depth at which `{` has been emitted for open groups. */
  open: number;
  startFont: BeamerThemeFont;
  startText: string;
  vadjust: Glue[];
  lastSpace: boolean;
};

type Frame = {
  kind: "root" | "colorbox" | "column" | "columns" | "slot-wrapper";
  items: VItem[];
  prevDepth: number;
  para: Para | null;
  startsGroup: boolean;
  options: Record<string, string | null>;
  /** Colour roles for a colour box. */
  role?: string;
  fillColor?: string | undefined;
  colsepStar?: number;
  colsep?: number;
  boxWidth?: number;
  boxHeight?: number | undefined;
  boxDepth?: number | undefined;
  boxAlign?: "c" | "t" | "T" | "b";
  columns?: Array<{ x: number; box: TemplateBox }>;
  columnsAlign?: "c" | "t" | "T" | "b";
};

type Group = { saved: Registers; para: Para | null; frameDepth: number };

type Macro = { params: number; optionalDefault: TemplateFrag | null; body: TemplateFrag };

const NO_PREV = -1000;
const MAX_MACRO_DEPTH = 100;
const MAX_STEPS = 200000;
const LINESKIP_PT = 1;

const SIZE_COMMANDS = new Set([
  "tiny", "scriptsize", "footnotesize", "small", "normalsize", "large", "Large", "LARGE", "huge", "Huge",
  "veryHuge", "VeryHuge", "VERYHuge",
]);

/** Commands copied to the text engine with the number of braced arguments it reads. */
const PASS_PROCESSED: ReadonlySet<string> = new Set([
  "textbf", "textit", "textsc", "textrm", "textsf", "texttt", "textup", "textmd", "textsl", "textnormal",
  "emph", "MakeUppercase", "MakeLowercase", "textsuperscript", "textsubscript", "mbox", "alert", "underline",
]);
const PASS_RAW_ARGS: ReadonlyMap<string, { optional: boolean; raw: number; processed: number }> = new Map([
  ["hspace", { optional: false, raw: 1, processed: 0 }],
  ["rule", { optional: true, raw: 2, processed: 0 }],
  ["includegraphics", { optional: true, raw: 1, processed: 0 }],
  ["textcolor", { optional: true, raw: 1, processed: 1 }],
]);
const PASS_BARE: ReadonlySet<string> = new Set([
  "hfill", "quad", "qquad", "enspace", ",", " ", "ldots", "dots", "today", "textbullet", "&", "%", "$", "#", "_", "{", "}",
  "textbackslash", "/", "-", "newline", "textellipsis", "hfil", "hss",
]);

const FONT_FAMILY_COMMANDS: Readonly<Record<string, "serif" | "sans" | "monospace">> = {
  rmfamily: "serif", sffamily: "sans", ttfamily: "monospace",
};

const ELEMENT_ROLES: Readonly<Record<string, BeamerThemeFontRole>> = {
  "normal text": "normal-text", title: "title", subtitle: "subtitle", author: "author", institute: "institute", date: "date",
  frametitle: "frame-title", framesubtitle: "frame-subtitle",
  "block title": "block-title", "block body": "block-body",
};

const NAMED_SPACING: Readonly<Record<string, Glue>> = {
  smallskip: { pt: 3, fill: 0 }, medskip: { pt: 6, fill: 0 }, bigskip: { pt: 12, fill: 0 },
};

const fontUnitCache = new WeakMap<BeamerThemeFont, { em: number; ex: number }>();

export function templateFontUnits(font: BeamerThemeFont): { em: number; ex: number } {
  const cached = fontUnitCache.get(font);
  if (cached) return cached;
  const profile = createBeamerTexTextFontProfile(font);
  const resolved = profile.resolveTextFont(profile.defaultFontState, texLength(font.sizePt), profile.metricProvider);
  const ex = Math.round(Number(resolved.atPt) * resolved.data.fontdimen.xheight * 65_536) / 65_536;
  const units = { em: font.sizePt, ex };
  fontUnitCache.set(font, units);
  return units;
}

function sameFace(left: BeamerThemeFont, right: BeamerThemeFont): boolean {
  return left.family === right.family && left.typeface === right.typeface;
}

function cloneRegisters(registers: Registers): Registers {
  return { ...registers, lengths: new Map(registers.lengths) };
}

function originSpan(frag: TemplateFrag, fallback: Span): Span {
  let from = Number.POSITIVE_INFINITY; let to = -1;
  for (const origin of frag.origin) if (origin >= 0) { from = Math.min(from, origin); to = Math.max(to, origin + 1); }
  return to < 0 ? fallback : { from, to };
}

export class TemplateMachine {
  readonly macros = new Map<string, Macro>();
  readonly flags = new Map<string, boolean>();
  readonly unsupported = new Set<string>();
  private readonly inputs: TemplateReader[] = [];
  private registers: Registers;
  private readonly groups: Group[] = [];
  private frames: Frame[] = [{ kind: "root", items: [], prevDepth: NO_PREV, para: null, startsGroup: false, options: {} }];
  private conditions: Array<{ seenElse: boolean }> = [];
  private paraCounter = 0;
  private steps = 0;
  private macroDepth = 0;
  private paintCounter = 0;
  private slotHandler: ((context: TemplateSlotContext) => TemplateSlotResult) | null = null;
  slotContext: TemplateSlotContext | null = null;

  constructor(readonly env: TemplateEnvironment) {
    const theme = env.theme;
    const normal = resolveBeamerThemeColor(theme, "normal text");
    this.registers = {
      font: env.font,
      fg: normal.fg ?? "#000000",
      bg: normal.bg ?? "#ffffff",
      text: normal.fg ?? "#000000",
      leftFinite: 0, rightFinite: 0, leftInfinite: false, rightInfinite: false,
      parskip: 0, hsize: env.width, textwidth: env.width, linewidth: env.width,
      offInterline: false, normalBaselineSkip: env.font.lineHeightPt, ignoreSpaces: false,
      lengths: new Map(env.registers), parshape: null, atRightskip: false, minipage: false, listDepth: 0,
    };
  }

  /** Definitions after the program ran, reusable by a machine for the same theme. */
  snapshotDefinitions(): TemplateDefinitionsSnapshot {
    return { macros: new Map(this.macros), flags: new Map(this.flags), lengths: new Map(this.registers.lengths), unsupported: new Set(this.unsupported) };
  }

  loadDefinitions(snapshot: TemplateDefinitionsSnapshot): void {
    for (const [name, macro] of snapshot.macros) this.macros.set(name, macro);
    for (const [name, value] of snapshot.flags) this.flags.set(name, value);
    this.registers.lengths = new Map(snapshot.lengths);
  }

  /** The user length registers after the program ran. */
  get lengths(): ReadonlyMap<string, number> { return this.registers.lengths; }

  // ---------------------------------------------------------------------
  // Preamble program: definitions and lengths only.

  runProgram(frag: TemplateFrag): void {
    this.inputs.length = 0;
    this.inputs.push(new TemplateReader(frag));
    for (let token = this.nextToken(); token; token = this.nextToken()) {
      if (token.kind === "char" && token.char === "{") { this.pushGroup(); continue; }
      if (token.kind === "char" && token.char === "}") { this.popGroup(); continue; }
      if (token.kind !== "cs") continue;
      if (token.name === "begin" && this.peekGroupText() === "document") return;
      this.programCommand(token);
    }
  }

  private peekGroupText(): string | null {
    const reader = this.top();
    if (!reader) return null;
    const saved = reader.position;
    const group = reader.readGroup();
    reader.position = saved;
    return group ? group.text.trim() : null;
  }

  private programCommand(token: Extract<TemplateToken, { kind: "cs" }>): void {
    const name = token.name;
    if (this.defineCommand(token)) return;
    const reader = this.requireReader();
    switch (name) {
      case "newlength": { const target = reader.readGroup(); if (target) this.registers.lengths.set(this.registerName(target.text), 0); return; }
      case "setlength": case "addtolength": {
        const target = reader.readGroup(); const value = reader.readGroup();
        if (!target || !value) return;
        this.assignLength(name === "addtolength", this.registerName(target.text), value.text);
        return;
      }
      case "settowidth": {
        const target = reader.readGroup(); const content = reader.readGroup();
        if (!target || !content) return;
        this.settowidth(this.registerName(target.text), content);
        return;
      }
      case "newif": {
        const flag = reader.readGroup();
        const match = flag ? /^\\if([A-Za-z@]+)$/u.exec(flag.text.trim()) : null;
        if (match?.[1]) this.flags.set(match[1], false);
        return;
      }
      case "setbeamertemplate": case "defbeamertemplate": case "setbeamerfont": case "setbeamercolor": case "usebeamerfont":
      case "AtBeginSection": case "AtBeginSubsection": case "AtBeginDocument": case "AtEndDocument": case "AtBeginPart":
      case "AtBeginSubsubsection": case "AtBeginLecture": case "setbeamersize": case "setbeamerfont*": {
        reader.readOptional();
        // Only whole groups follow; their contents are not run as program text.
        reader.readGroup();
        if (name === "setbeamertemplate" || name === "defbeamertemplate" || name === "setbeamerfont" || name === "setbeamercolor") {
          reader.readOptional();
          if (reader.peekChar() === "{") reader.readGroup();
        }
        return;
      }
      case "newenvironment": case "renewenvironment": case "providenvironment": {
        reader.readGroup(); reader.readOptional(); reader.readOptional(); reader.readGroup(); reader.readGroup();
        return;
      }
      case "iffalse": this.skipConditional(); return;
      default: {
        const macro = this.macros.get(name);
        if (macro) this.expandMacro(token, macro);
      }
    }
  }

  private registerName(text: string): string {
    return text.trim().replace(/^\\/u, "");
  }

  private defineCommand(token: Extract<TemplateToken, { kind: "cs" }>): boolean {
    const reader = this.requireReader();
    const name = token.name;
    if (name === "newcommand" || name === "renewcommand" || name === "providecommand") {
      if (reader.peekChar() === "*") { reader.skipBlanks(); reader.position += 1; }
      const target = reader.readGroup();
      const count = reader.readOptional();
      const optional = count ? reader.readOptional() : null;
      const body = reader.readGroup();
      const macroName = target ? this.registerName(target.text) : "";
      if (macroName && body) {
        if (!(name === "providecommand" && this.macros.has(macroName))) {
          this.macros.set(macroName, { params: count ? Number(count.text.trim()) || 0 : 0, optionalDefault: optional, body });
        }
      }
      return true;
    }
    if (name === "def" || name === "gdef" || name === "edef" || name === "xdef") {
      const target = reader.next();
      if (target?.kind !== "cs") return true;
      let params = 0;
      for (;;) {
        const saved = reader.position;
        const next = reader.next();
        if (next?.kind === "param") { params += 1; continue; }
        reader.position = saved;
        break;
      }
      const body = reader.readGroup();
      if (body) this.macros.set(target.name, { params, optionalDefault: null, body });
      return true;
    }
    if (name === "makeatletter" || name === "makeatother") return true;
    return false;
  }

  private assignLength(add: boolean, name: string, expression: string): void {
    const value = this.evaluateLength(this.expandMaxMin(expression));
    if (value === null) { this.unsupported.add(`\\setlength{\\${name}}`); return; }
    const next = add ? (this.registers.lengths.get(name) ?? 0) + value : value;
    if (name === "parskip") this.registers.parskip = next;
    else this.registers.lengths.set(name, Math.round(next * 65536) / 65536);
  }

  /** `\maxof{a}{b}` and `\minof{a}{b}` from calc/etoolbox-style helpers. */
  private expandMaxMin(expression: string): string {
    const pattern = /\\(maxof|minof)\s*\{([^{}]*)\}\s*\{([^{}]*)\}/u;
    let text = expression;
    for (let guard = 0; guard < 20; guard += 1) {
      const match = pattern.exec(text);
      if (!match) break;
      const left = this.evaluateLength(match[2] ?? "");
      const right = this.evaluateLength(match[3] ?? "");
      if (left === null || right === null) return text;
      const value = match[1] === "maxof" ? Math.max(left, right) : Math.min(left, right);
      text = text.slice(0, match.index) + `${value}pt` + text.slice(match.index + match[0].length);
    }
    return text;
  }

  evaluateLength(text: string): number | null {
    return evaluateTexLengthExpression(text.trim(), name => this.lookupLength(name), templateFontUnits(this.registers.font));
  }

  private lookupLength(name: string): number | undefined {
    switch (name) {
      case "paperwidth": return this.env.paperWidth;
      case "paperheight": return this.env.paperHeight;
      case "textwidth": return this.registers.textwidth;
      case "linewidth": case "columnwidth": return this.registers.linewidth;
      case "hsize": return this.registers.hsize;
      case "parskip": return this.registers.parskip;
      case "baselineskip": return this.registers.normalBaselineSkip;
      case "parindent": return 0;
      case "smallskipamount": return 3;
      case "medskipamount": return 6;
      case "bigskipamount": return 12;
      case "beamer@leftmargin": return this.env.leftMargin;
      case "beamer@rightmargin": return this.env.rightMargin;
      default: return this.registers.lengths.get(name);
    }
  }

  private settowidth(name: string, content: TemplateFrag): void {
    const expanded = this.expandFrag(content);
    const mapped = fragMappedText(expanded, this.env.owner);
    const measured = this.env.measure({
      mapped, width: 1_000_000, alignment: "left", justify: false, font: this.registers.font,
      baselineSkipPt: this.registers.normalBaselineSkip, owner: this.env.owner, id: `${this.env.idPrefix}:measure`,
    });
    this.registers.lengths.set(name, measured?.naturalWidth ?? 0);
  }

  /** Expand user macros in a fragment, leaving everything else as written. */
  expandFrag(frag: TemplateFrag, depth = 0): TemplateFrag {
    if (depth > 20) return frag;
    const reader = new TemplateReader(frag);
    const parts: TemplateFrag[] = [];
    let last = 0;
    for (let token = reader.next(); token; token = reader.next()) {
      if (token.kind !== "cs") continue;
      const macro = this.macros.get(token.name);
      const meta = this.metadataFrag(token.name);
      if (!macro && !meta) continue;
      parts.push(fragSlice(frag, last, token.from));
      if (macro) {
        const args = this.readMacroArguments(reader, macro);
        parts.push(this.expandFrag(this.substitute(macro.body, args), depth + 1));
      } else if (meta) parts.push(meta);
      last = reader.position;
    }
    parts.push(fragSlice(frag, last, frag.text.length));
    return fragConcat(parts);
  }

  // ---------------------------------------------------------------------
  // Template execution.

  /** Run template text as the contents of a vertical list; returns the packed box. */
  runTemplate(frag: TemplateFrag, options: { slot?: (context: TemplateSlotContext) => TemplateSlotResult; font?: BeamerThemeFont; colorRole?: string; normalBaselines?: boolean } = {}): TemplateBox {
    this.slotHandler = options.slot ?? null;
    this.inputs.length = 0;
    this.frames = [this.newFrame("root", false)];
    const root = this.frames[0];
    if (!root) throw new Error("template root");
    this.groups.length = 0;
    this.conditions = [];
    this.registers = {
      ...cloneRegisters(this.registers),
      hsize: this.env.width, textwidth: this.env.width, linewidth: this.env.width,
      offInterline: options.normalBaselines !== true, leftFinite: 0, rightFinite: 0, leftInfinite: false, rightInfinite: false, parskip: 0,
      parshape: null, atRightskip: false, minipage: false, listDepth: 0,
      ...(options.font ? { font: options.font, normalBaselineSkip: options.font.lineHeightPt } : {}),
    };
    if (options.colorRole) {
      // \usebeamertemplate***: the element's font and colours are in force.
      const resolved = resolveBeamerThemeColor(this.env.theme, options.colorRole);
      this.registers.fg = resolved.fg ?? this.registers.fg;
      this.registers.bg = resolved.bg ?? this.registers.bg;
    }
    this.inputs.push(new TemplateReader(frag));
    this.run();
    this.finishPara();
    if (this.frames.length !== 1) throw new TemplateUnsupported("\\begin without \\end");
    if (this.groups.length > 0) throw new TemplateUnsupported("unbalanced group");
    return this.packFrame(root, this.env.width);
  }

  private newFrame(kind: Frame["kind"], startsGroup: boolean): Frame {
    return { kind, items: [], prevDepth: NO_PREV, para: null, startsGroup, options: {} };
  }

  private top(): TemplateReader | undefined { return this.inputs[this.inputs.length - 1]; }
  private requireReader(): TemplateReader {
    const reader = this.top();
    if (!reader) throw new TemplateUnsupported("unexpected end of input");
    return reader;
  }
  private frame(): Frame {
    const frame = this.frames[this.frames.length - 1];
    if (!frame) throw new Error("template frame stack is empty");
    return frame;
  }

  private nextToken(): TemplateToken | null {
    while (this.inputs.length > 0) {
      const reader = this.inputs[this.inputs.length - 1];
      const token = reader?.next() ?? null;
      if (token) return token;
      this.inputs.pop();
    }
    return null;
  }

  private currentSource(token: { from: number; to: number }): TemplateFrag {
    return fragSlice(this.requireReader().frag, token.from, token.to);
  }

  private run(): void {
    for (let token = this.nextToken(); token; token = this.nextToken()) {
      if (++this.steps > MAX_STEPS) throw new TemplateUnsupported("runaway template");
      this.handle(token);
    }
  }

  private handle(token: TemplateToken): void {
    switch (token.kind) {
      case "space":
        if (this.registers.ignoreSpaces) return;
        if (this.frame().para?.content) this.emit(fragGenerated(" "), true);
        return;
      case "par": this.finishPara(); return;
      case "param": throw new TemplateUnsupported(`#${token.index}`);
      case "char": this.handleChar(token); return;
      case "cs": this.registers.ignoreSpaces = false; this.handleControl(token); return;
    }
  }

  private handleChar(token: Extract<TemplateToken, { kind: "char" }>): void {
    this.registers.ignoreSpaces = false;
    if (token.char === "{") { this.pushGroup(); return; }
    if (token.char === "}") { this.popGroup(); return; }
    this.startPara();
    if (token.char === "$") this.inMath = !this.inMath;
    this.emit(this.currentSource(token), false);
  }

  // -- groups ---------------------------------------------------------

  private pushGroup(): void {
    const frame = this.frame();
    const group: Group = { saved: cloneRegisters(this.registers), para: null, frameDepth: this.frames.length };
    this.groups.push(group);
    const para = frame.para;
    if (para) { para.open += 1; group.para = para; this.pieces(para, fragGenerated("{")); }
  }

  private popGroup(): void {
    const group = this.groups.pop();
    if (!group) throw new TemplateUnsupported("unbalanced }");
    if (group.frameDepth !== this.frames.length) throw new TemplateUnsupported("group crossing an environment");
    const frame = this.frame();
    if (group.para && frame.para === group.para) { group.para.open -= 1; this.pieces(group.para, fragGenerated("}")); }
    this.registers = group.saved;
  }

  private pieces(para: Para, frag: TemplateFrag): void {
    para.pieces.push(frag);
  }

  // -- paragraphs ------------------------------------------------------

  private startPara(): void {
    const frame = this.frame();
    if (frame.para) return;
    this.registers.minipage = false;
    if (frame.items.length > 0 && this.registers.parskip !== 0) frame.items.push({ kind: "glue", glue: { pt: this.registers.parskip, fill: 0 } });
    else if (frame.items.length > 0) frame.items.push({ kind: "glue", glue: { pt: 0, fill: 0 } });
    // Groups opened before the paragraph began are open inside it. The engine's base
    // state is that outside the outermost of them; each level restates what it changed.
    const open = this.groups.filter(group => group.frameDepth === this.frames.length);
    const base = open[0]?.saved ?? this.registers;
    const para: Para = {
      id: ++this.paraCounter, pieces: [], content: false, visible: false, open: 0, startFont: base.font,
      startText: base.text, vadjust: [], lastSpace: false,
    };
    frame.para = para;
    open.forEach((group, index) => {
      const next = open[index + 1]?.saved ?? this.registers;
      para.open += 1; group.para = para; para.pieces.push(fragGenerated("{"));
      this.restate(para, group.saved, next);
    });
  }

  /** Declarations that take the engine from one state to another. */
  private restate(para: Para, old: Registers, next: Registers): void {
    const font = next.font; const before = old.font;
    if (before.typeface !== font.typeface) throw new TemplateUnsupported("a font family change inside a paragraph");
    if (!sameFace(before, font)) para.pieces.push(fragGenerated(font.family === "serif" ? "\\rmfamily " : font.family === "monospace" ? "\\ttfamily " : "\\sffamily "));
    if (font.sizePt !== before.sizePt || font.lineHeightPt !== before.lineHeightPt) para.pieces.push(fragGenerated(`\\fontsize{${font.sizePt}pt}{${font.lineHeightPt}pt}\\selectfont `));
    if (font.series !== before.series) para.pieces.push(fragGenerated(font.series === "bold" ? "\\bfseries " : "\\mdseries "));
    if (font.shape !== before.shape) {
      para.pieces.push(fragGenerated(font.shape === "italic" ? "\\itshape " : font.shape === "slanted" ? "\\slshape " : font.shape === "small-caps" ? "\\scshape " : "\\upshape "));
    }
    if (next.text !== old.text) para.pieces.push(fragGenerated(`\\color[HTML]{${next.text.replace(/^#/u, "").toUpperCase()}}`));
  }

  private emit(frag: TemplateFrag, space: boolean): void {
    const para = this.frame().para;
    if (!para) return;
    if (!space && !/^\\(?:hspace|hfill|quad|qquad|enspace)(?![A-Za-z@])/u.test(frag.text)) para.visible = true;
    // Separate space tokens are separate glue, even when commands between them print nothing.
    if (space) { if (para.lastSpace) frag = fragGenerated("\\ "); para.lastSpace = true; } else para.lastSpace = false;
    para.content = true;
    para.pieces.push(frag);
  }

  private emitDeclaration(text: string): void {
    const para = this.frame().para;
    if (para) para.pieces.push(fragGenerated(text));
  }

  /** End the current paragraph, appending its lines (or an empty line) to the list. */
  finishPara(): void {
    const frame = this.frame();
    const para = frame.para;
    if (!para) return;
    frame.para = null;
    for (const group of this.groups) if (group.para === para) group.para = null;
    const registers = this.registers;
    const { x, width } = this.textArea();
    let box: TemplateBox;
    if (!para.content) {
      box = { w: registers.hsize, h: 0, d: 0, firstH: 0, paint: [] };
      this.append(frame, box, 0, registers.normalBaselineSkip);
    } else {
      // Trailing blanks are removed by \par; groups still open are closed for the engine.
      const frag = fragConcat([this.trimTrailingSpace(fragConcat(para.pieces)), ...Array.from({ length: para.open }, () => fragGenerated("}"))]);
      const alignment = registers.leftInfinite && registers.rightInfinite ? "center" : registers.leftInfinite ? "right" : "left";
      const justify = !registers.leftInfinite && !registers.rightInfinite;
      const trimmed = frag;
      const segments = this.splitAtHfill(trimmed);
      const request = (part: TemplateFrag, line: boolean) => {
        const id = `${this.env.idPrefix}:p${++this.paintCounter}`;
        const measured = this.env.measure({
          mapped: fragMappedText(part, this.env.owner),
          width: line ? 1_000_000 : width, alignment: line ? "left" : alignment, justify: line ? false : justify,
          font: para.startFont, baselineSkipPt: registers.normalBaselineSkip, owner: originSpan(part, this.env.owner), id,
        });
        if (!measured) throw new TemplateUnsupported("paragraph layout");
        return { id, measured, mapped: fragMappedText(part, this.env.owner), sourceSpan: originSpan(part, this.env.owner) };
      };
      if (segments.length > 1) {
        // \hfill spreads the pieces of one line over its width (the engine has no \hfill).
        // A trailing glue would be dropped at the end of the measured line; an empty box keeps it.
        const parts = segments.map((part, index) => part.text.trim() === "" ? null
          : request(index === segments.length - 1 && /(?:\\hspace\{[^{}]*\}| |\\ )$/u.test(part.text) ? fragConcat([part, fragGenerated("\\mbox{}")]) : part, true));
        const natural = parts.reduce((sum, part) => sum + (part?.measured.naturalWidth ?? 0), 0);
        if (parts.some(part => part && part.measured.extent - part.measured.endingDepth > part.measured.firstHeight * 3 + 1000)) throw new TemplateUnsupported("\\hfill over several lines");
        const gap = (width - natural) / (segments.length - 1);
        if (gap < 0) throw new TemplateUnsupported("\\hfill in an overfull line");
        const heights = parts.map(part => part ? part.measured.extent - part.measured.endingDepth : 0);
        const h = Math.max(0, ...heights);
        const d = Math.max(0, ...parts.map(part => part?.measured.endingDepth ?? 0));
        const firstH = Math.max(0, ...parts.map(part => part?.measured.firstHeight ?? 0));
        const paint: TemplatePaint[] = [];
        let cursor = x;
        parts.forEach((part, index) => {
          if (part) paint.push({
            kind: "text", id: part.id, x: cursor, y: h - (heights[index] ?? 0), w: part.measured.naturalWidth, firstBaseline: part.measured.firstBaseline,
            height: part.measured.extent, mapped: part.mapped, font: para.startFont, color: para.startText, alignment: "left", justify: false,
            baselineSkipPt: part.measured.baselineSkip, laid: part.measured.laid, sourceSpan: part.sourceSpan,
          });
          cursor += (part?.measured.naturalWidth ?? 0) + gap;
        });
        box = { w: registers.hsize, h, d, firstH, paint };
        this.append(frame, box, 0, registers.normalBaselineSkip, true);
        for (const glue of para.vadjust) frame.items.push({ kind: "glue", glue });
        return;
      }
      const only = request(trimmed, false);
      const measure = only.measured;
      box = {
        w: registers.hsize, h: measure.extent - measure.endingDepth, d: measure.endingDepth, firstH: measure.firstHeight,
        paint: [{
          kind: "text", id: only.id, x, y: 0, w: width, firstBaseline: measure.firstBaseline, height: measure.extent,
          mapped: only.mapped, font: para.startFont, color: para.startText,
          alignment, justify, baselineSkipPt: measure.baselineSkip, laid: measure.laid, sourceSpan: only.sourceSpan,
        }],
      };
      this.append(frame, box, 0, measure.baselineSkip, true);
    }
    for (const glue of para.vadjust) frame.items.push({ kind: "glue", glue });
  }

  /** Where lines of the current paragraph start and how wide they are: the list's `\parshape`, else `\hsize`, less the finite skips. */
  private textArea(): { x: number; width: number } {
    const registers = this.registers;
    const left = registers.parshape?.x ?? 0;
    const full = registers.parshape?.w ?? registers.hsize;
    return { x: left + registers.leftFinite, width: Math.max(0, full - registers.leftFinite - registers.rightFinite) };
  }

  /** The pieces of a paragraph between its `\hfill`s outside any group. */
  private splitAtHfill(frag: TemplateFrag): TemplateFrag[] {
    const reader = new TemplateReader(frag);
    const parts: TemplateFrag[] = [];
    let last = 0;
    let depth = 0;
    for (let token = reader.next(); token; token = reader.next()) {
      if (token.kind === "char" && token.char === "{") depth += 1;
      else if (token.kind === "char" && token.char === "}") depth -= 1;
      else if (token.kind === "cs" && token.name === "hfill") {
        if (depth !== 0) throw new TemplateUnsupported("\\hfill inside a group");
        const before = fragSlice(frag, last, token.from);
        if (/\\(?:fontsize|color|bfseries|itshape|sffamily|rmfamily|ttfamily|selectfont)/u.test(before.text) && parts.length === 0) throw new TemplateUnsupported("a font change before \\hfill");
        parts.push(before);
        last = token.to;
      }
    }
    if (parts.length === 0) return [frag];
    parts.push(fragSlice(frag, last, frag.text.length));
    return parts;
  }

  /** \par removes the glue that ends a paragraph: spaces and `\hspace` (not `\hspace*`). */
  private trimTrailingSpace(frag: TemplateFrag): TemplateFrag {
    const closing = 0;
    let end = frag.text.length - closing;
    // Exactly the last glue item goes.
    const text = frag.text.slice(0, end);
    if (text.endsWith("\\ ")) end -= 2;
    else if (text.endsWith(" ")) end -= 1;
    else { const hspace = /\\hspace\{[^{}]*\}$/u.exec(text); if (hspace) end -= hspace[0].length; }
    return end === frag.text.length - closing ? frag : fragConcat([fragSlice(frag, 0, end), fragSlice(frag, frag.text.length - closing, frag.text.length)]);
  }

  /** Append a box with TeX's baseline glue. */
  private append(frame: Frame, box: TemplateBox, x: number, baselineSkip: number, isParagraph = false): void {
    if (frame.prevDepth > NO_PREV + 1) {
      const skip = this.registers.offInterline ? Number.NEGATIVE_INFINITY : baselineSkip - frame.prevDepth - box.firstH;
      const limit = this.registers.offInterline ? Number.POSITIVE_INFINITY : 0;
      const lineskip = this.registers.offInterline ? 0 : LINESKIP_PT;
      const glue = skip < limit ? lineskip : skip;
      frame.items.push({ kind: "glue", glue: { pt: glue, fill: 0 } });
    }
    frame.items.push({ kind: "box", box, x });
    frame.prevDepth = box.d;
    void isParagraph;
  }

  private appendGlue(glue: Glue): void {
    this.finishPara();
    this.frame().items.push({ kind: "glue", glue });
  }

  // -- control sequences ----------------------------------------------

  private handleControl(token: Extract<TemplateToken, { kind: "cs" }>): void {
    const name = token.name;
    const macro = this.macros.get(name);
    if (macro) { this.expandMacro(token, macro); return; }
    const meta = this.metadataFrag(name);
    if (meta) { this.inputs.push(new TemplateReader(meta)); return; }
    const reader = this.requireReader();
    switch (name) {
      case "relax": case "makeatletter": case "makeatother": case "protect": case "ignorespaces":
        if (name === "ignorespaces") this.registers.ignoreSpaces = true;
        return;
      case "leavevmode": case "noindent": this.startPara(); return;
      case "par": this.finishPara(); return;
      case "nointerlineskip": this.frame().prevDepth = NO_PREV; return;
      case "vskip": this.appendGlue(this.readGlue(reader)); return;
      case "vspace": {
        const star = reader.peekChar() === "*" ? (reader.skipBlanks(), reader.position += 1, true) : false;
        const argument = reader.readGroup();
        if (!argument) return;
        const glue = this.parseGlue(this.expandFrag(argument).text);
        if (this.frame().para) {
          // In horizontal mode the skip migrates after the line that holds it.
          this.frame().para?.vadjust.push(glue);
        } else {
          const frame = this.frame();
          const depth = frame.prevDepth;
          frame.items.push({ kind: "glue", glue });
          if (star) frame.prevDepth = depth;
        }
        return;
      }
      case "vfill": this.appendGlue({ pt: 0, fill: 1 }); return;
      case "smallskip": case "medskip": case "bigskip": this.appendGlue(NAMED_SPACING[name] ?? { pt: 0, fill: 0 }); return;
      case "parskip": { reader.skipBlanks(); if (reader.peekChar() === "=") reader.position += 1; const glue = this.readGlue(reader); this.registers.parskip = glue.pt; return; }
      case "centering": case "Centering": this.setAlignment(true, true); return;
      case "raggedright": case "RaggedRight": this.setAlignment(false, true); this.registers.atRightskip = true; return;
      case "raggedleft": case "RaggedLeft": this.setAlignment(true, false); return;
      case "justifying": case "justify": case "normalfont":
        if (name === "normalfont") return;
        this.registers.leftFinite = 0; this.registers.rightFinite = 0; this.registers.leftInfinite = false; this.registers.rightInfinite = false;
        this.registers.atRightskip = false;
        return;
      case "begin": this.beginEnvironment(); return;
      case "end": this.endEnvironment(); return;
      case "setlength": case "addtolength": {
        const target = reader.readGroup(); const value = reader.readGroup();
        if (!target || !value) return;
        this.assignLength(name === "addtolength", this.registerName(target.text), this.expandFrag(value).text);
        return;
      }
      case "usebeamerfont": this.useBeamerFont(false); return;
      case "usebeamercolor": this.useBeamerColor(); return;
      case "ifbeamercolorempty": this.ifBeamerColorEmpty(); return;
      case "ifx": this.ifx(); return;
      case "ifdefined": { const target = reader.next(); this.branch(target?.kind === "cs" && this.isDefined(target.name)); return; }
      case "iftrue": this.branch(true); return;
      case "iffalse": this.branch(false); return;
      case "else": this.elseBranch(); return;
      case "fi": this.conditions.pop(); return;
      case "href": {
        // A link is drawn as its text.
        reader.readGroup();
        const text = reader.readGroup();
        if (text) this.inputs.push(new TemplateReader(text));
        return;
      }
      case "\\": this.lineBreak(token); return;
      case "tikzeditorbodyslot": this.bodySlot(); return;
      case "fontsize": {
        const size = reader.readGroup(); const skip = reader.readGroup();
        const sizePt = size ? this.evaluateLength(size.text) : null;
        const lineHeightPt = skip ? this.evaluateLength(skip.text) : null;
        if (sizePt && lineHeightPt) { this.pendingFontSize = { sizePt, lineHeightPt }; }
        return;
      }
      case "selectfont": if (this.pendingFontSize) { this.setFont({ ...this.registers.font, ...this.pendingFontSize }); this.pendingFontSize = null; } return;
      case "bfseries": this.setFont({ ...this.registers.font, series: "bold" }); return;
      case "mdseries": this.setFont({ ...this.registers.font, series: "medium" }); return;
      case "itshape": this.setFont({ ...this.registers.font, shape: "italic" }); return;
      case "slshape": this.setFont({ ...this.registers.font, shape: "slanted" }); return;
      case "scshape": this.setFont({ ...this.registers.font, shape: "small-caps" }); return;
      case "upshape": this.setFont({ ...this.registers.font, shape: "upright" }); return;
      default: break;
    }
    if (SIZE_COMMANDS.has(name) && this.isNamedSize(name)) {
      const entry = beamerNamedFontSizes(this.env.theme).find(([candidate]) => candidate === name);
      if (entry) this.setFont({ ...this.registers.font, sizePt: entry[1], lineHeightPt: entry[2] });
      return;
    }
    const family = FONT_FAMILY_COMMANDS[name];
    if (family) { this.setFont({ ...this.registers.font, family }); return; }
    const flag = /^if([A-Za-z@]+)$/u.exec(name)?.[1];
    if (flag !== undefined && this.flags.has(flag)) { this.branch(this.flags.get(flag) === true); return; }
    if (name === "iftrue" || name === "iffalse") return;
    this.passThrough(token);
  }

  private pendingFontSize: { sizePt: number; lineHeightPt: number } | null = null;

  private isNamedSize(name: string): boolean {
    return beamerNamedFontSizes(this.env.theme).some(([candidate]) => candidate === name);
  }

  private setAlignment(left: boolean, right: boolean): void {
    this.registers.leftFinite = 0; this.registers.rightFinite = 0;
    this.registers.leftInfinite = left; this.registers.rightInfinite = right;
  }

  // -- inline material -------------------------------------------------

  private insertText(frag: TemplateFrag): void {
    // Inserted text enters the stream like text of the template.
    this.startPara();
    this.registers.ignoreSpaces = false;
    this.emit(frag, false);
  }

  private rawCommand(token: Extract<TemplateToken, { kind: "cs" }>, rawArguments: number, optional: boolean): TemplateFrag {
    const reader = this.requireReader();
    const parts: TemplateFrag[] = [fragSlice(reader.frag, token.from, token.to)];
    if (token.name === "hspace" || token.name === "rule" || token.name === "includegraphics") {
      if (reader.peekChar() === "*") { reader.skipBlanks(); parts.push(fragGenerated("*")); reader.position += 1; }
    }
    if (optional) {
      const option = reader.readOptional();
      if (option) parts.push(fragGenerated("["), this.substituteRegisters(option), fragGenerated("]"));
    }
    for (let count = 0; count < rawArguments; count += 1) {
      const group = reader.readGroup();
      if (group) parts.push(fragGenerated("{"), this.substituteRegisters(group), fragGenerated("}"));
    }
    return fragConcat(parts);
  }

  /** Replace uses of the template's own length registers by their values. */
  private substituteRegisters(frag: TemplateFrag): TemplateFrag {
    if (!frag.text.includes("\\")) return frag;
    const reader = new TemplateReader(frag);
    const parts: TemplateFrag[] = [];
    let last = 0;
    let found = false;
    for (let token = reader.next(); token; token = reader.next()) {
      if (token.kind !== "cs") continue;
      const value = this.registers.lengths.get(token.name);
      if (value === undefined) continue;
      found = true;
      parts.push(fragSlice(frag, last, token.from), fragGenerated(`${value}pt `));
      last = token.to;
    }
    if (!found) return frag;
    parts.push(fragSlice(frag, last, frag.text.length));
    return fragConcat(parts);
  }

  private passThrough(token: Extract<TemplateToken, { kind: "cs" }>): void {
    const name = token.name;
    const reader = this.requireReader();
    if (PASS_PROCESSED.has(name)) {
      this.startPara();
      this.emit(fragSlice(reader.frag, token.from, token.to), false);
      return;
    }
    const word = (): TemplateFrag => /[A-Za-z@]$/u.test(token.name) ? fragConcat([fragSlice(reader.frag, token.from, token.to), fragGenerated(" ")]) : fragSlice(reader.frag, token.from, token.to);
    const raw = PASS_RAW_ARGS.get(name);
    if (raw) {
      this.startPara();
      this.emit(this.rawCommand(token, raw.raw, raw.optional), false);
      if (raw.processed > 0) { /* the processed group follows and is run as a group */ }
      return;
    }
    if (PASS_BARE.has(name)) {
      this.startPara();
      this.emit(word(), false);
      return;
    }
    if (this.inMath) {
      this.emit(fragSlice(reader.frag, token.from, token.to), false);
      return;
    }
    throw new TemplateUnsupported(`\\${name}`);
  }

  private inMath = false;

  private lineBreak(token: Extract<TemplateToken, { kind: "cs" }>): void {
    const frame = this.frame();
    if (!frame.para) throw new TemplateUnsupported("\\\\ outside a paragraph");
    const reader = this.requireReader();
    const raw: TemplateFrag[] = [fragSlice(reader.frag, token.from, token.to)];
    const saved = reader.position;
    const star = reader.peekChar() === "*";
    if (star) { reader.skipBlanks(); reader.position += 1; raw.push(fragGenerated("*")); }
    const option = reader.readOptional();
    if (!option && !star) reader.position = saved;
    if (this.registers.leftInfinite || this.registers.rightInfinite) {
      // \centering, \raggedleft and \raggedright make \\ end the paragraph (\@centercr):
      // \par\addvspace{-\parskip}, then \vskip with the optional length.
      this.finishPara();
      this.addVSpace(-this.registers.parskip);
      if (option) {
        const length = this.parseGlue(this.expandFrag(option).text);
        this.frame().items.push({ kind: "glue", glue: length });
      }
    } else {
      if (option) raw.push(fragGenerated("["), this.substituteRegisters(option), fragGenerated("]"));
      this.emit(fragConcat(raw), false);
    }
    // The blanks after a line break are dropped.
    this.registers.ignoreSpaces = true;
  }

  /** `\addvspace`: space that merges with glue just before it. */
  private addVSpace(amount: number): void {
    if (this.registers.minipage) return;
    const frame = this.frame();
    const last = frame.items[frame.items.length - 1];
    if (last?.kind === "glue" && last.glue.fill === 0) { if (amount > last.glue.pt) last.glue.pt = amount; return; }
    frame.items.push({ kind: "glue", glue: { pt: amount, fill: 0 } });
  }

  // -- fonts and colours ----------------------------------------------

  private setFont(font: BeamerThemeFont): void {
    const old = this.registers.font;
    this.registers.font = font;
    if (font.lineHeightPt !== old.lineHeightPt || font.sizePt !== old.sizePt) this.registers.normalBaselineSkip = font.lineHeightPt;
    const para = this.frame().para;
    if (!para) return;
    if (!para.visible) { para.startFont = font; return; }
    if (!sameFace(old, font)) {
      if (old.typeface !== font.typeface) throw new TemplateUnsupported("a font family change inside a paragraph");
      const family = font.family === "serif" ? "\\rmfamily" : font.family === "monospace" ? "\\ttfamily" : "\\sffamily";
      para.pieces.push(fragGenerated(family));
    }
    if (font.sizePt !== old.sizePt || font.lineHeightPt !== old.lineHeightPt) {
      para.pieces.push(fragGenerated(`\\fontsize{${font.sizePt}pt}{${font.lineHeightPt}pt}\\selectfont `));
    }
    if (font.series !== old.series) para.pieces.push(fragGenerated(font.series === "bold" ? "\\bfseries " : "\\mdseries "));
    if (font.shape !== old.shape) {
      para.pieces.push(fragGenerated(font.shape === "italic" ? "\\itshape " : font.shape === "slanted" ? "\\slshape "
        : font.shape === "small-caps" ? "\\scshape " : "\\upshape "));
    }
  }

  private setTextColor(color: string): void {
    this.registers.text = color;
    const para = this.frame().para;
    if (para && !para.visible) { para.startText = color; return; }
    if (para) para.pieces.push(fragGenerated(`\\color[HTML]{${color.replace(/^#/u, "").toUpperCase()}}`));
  }

  /** `\usebeamerfont{element}`: the element's declarations over the current font. */
  private useBeamerFont(star: boolean): void {
    void star;
    const reader = this.requireReader();
    reader.skipBlanks();
    if (reader.peekChar() === "*") reader.position += 1;
    const argument = reader.readGroup();
    if (!argument) return;
    const element = argument.text.trim();
    const role = ELEMENT_ROLES[element];
    // Elements whose default declaration sets a size replace the font; others change it.
    let font = role ? this.env.theme.fonts[role] : this.registers.font;
    const declared = this.env.theme.elementFonts?.[element];
    if (declared) font = applyElementFont(font, declared);
    this.setFont(font);
  }

  private useBeamerColor(): void {
    const reader = this.requireReader();
    let star = false;
    reader.skipBlanks();
    if (reader.peekChar() === "*") { star = true; reader.position += 1; }
    const option = reader.readOptional();
    const argument = reader.readGroup();
    if (!argument) return;
    const resolved = resolveBeamerThemeColor(this.env.theme, argument.text.trim());
    const fg = resolved.fg ?? this.registers.fg;
    const bg = resolved.bg ?? this.registers.bg;
    this.registers.fg = fg;
    this.registers.bg = bg;
    const which = option ? option.text.trim() : star ? "fg" : "";
    if (which === "fg") this.setTextColor(fg);
    else if (which === "bg") this.setTextColor(bg);
  }

  private ifBeamerColorEmpty(): void {
    const reader = this.requireReader();
    const option = reader.readOptional();
    const argument = reader.readGroup();
    const whenEmpty = reader.readGroup();
    const whenSet = reader.readGroup();
    if (!argument) return;
    const resolved = resolveBeamerThemeColor(this.env.theme, argument.text.trim());
    const which = option?.text.trim() === "bg" ? resolved.bg : resolved.fg;
    const chosen = which === undefined ? whenEmpty : whenSet;
    if (chosen) this.inputs.push(new TemplateReader(chosen));
  }

  // -- conditionals ----------------------------------------------------

  private branch(condition: boolean): void {
    this.conditions.push({ seenElse: false });
    if (!condition) this.skipToElse();
  }

  private elseBranch(): void {
    const condition = this.conditions[this.conditions.length - 1];
    if (!condition) throw new TemplateUnsupported("\\else without \\if");
    condition.seenElse = true;
    this.skipConditional(true);
  }

  /** Skip to the matching \else (running it) or \fi. */
  private skipToElse(): void {
    let depth = 0;
    for (let token = this.nextToken(); token; token = this.nextToken()) {
      if (token.kind !== "cs") continue;
      if (this.opensConditional(token.name)) depth += 1;
      else if (token.name === "fi") {
        if (depth === 0) { this.conditions.pop(); return; }
        depth -= 1;
      } else if (token.name === "else" && depth === 0) {
        const condition = this.conditions[this.conditions.length - 1];
        if (condition) condition.seenElse = true;
        return;
      }
    }
    throw new TemplateUnsupported("\\if without \\fi");
  }

  /** Skip to the matching \fi, dropping the condition. */
  private skipConditional(fromElse = false): void {
    let depth = 0;
    for (let token = this.nextToken(); token; token = this.nextToken()) {
      if (token.kind !== "cs") continue;
      if (this.opensConditional(token.name)) depth += 1;
      else if (token.name === "fi") {
        if (depth === 0) { this.conditions.pop(); return; }
        depth -= 1;
      }
    }
    void fromElse;
    throw new TemplateUnsupported("\\if without \\fi");
  }

  private opensConditional(name: string): boolean {
    if (name === "ifbeamercolorempty") return false;
    if (name === "ifx" || name === "ifdefined" || name === "iftrue" || name === "iffalse" || name === "ifnum" || name === "ifdim"
      || name === "ifcase" || name === "ifvoid" || name === "ifhmode" || name === "ifvmode" || name === "ifmmode"
      || name === "ifinner" || name === "ifodd" || name === "ifcat" || name === "if" || name === "ifcsname"
      || name === "ifundefined") return true;
    const flag = /^if([A-Za-z@]+)$/u.exec(name)?.[1];
    return flag !== undefined && this.flags.has(flag);
  }

  private isDefined(name: string): boolean {
    return this.macros.has(name) || this.metadataFrag(name) !== null || name === "empty" || name === "relax";
  }

  private meaning(token: TemplateToken | null): string | null {
    if (!token) return null;
    if (token.kind !== "cs") return `char:${token.kind === "char" ? token.char : token.kind}`;
    if (token.name === "empty") return "macro:";
    const meta = this.metadataFrag(token.name);
    if (meta) return `macro:${meta.text}`;
    const macro = this.macros.get(token.name);
    if (macro) return `macro:${macro.params}:${macro.body.text}`;
    return `undefined:${token.name === "relax" ? "relax" : "undefined"}`;
  }

  private ifx(): void {
    const left = this.nextNonSpace(); const right = this.nextNonSpace();
    if (left?.kind === "cs" && this.opensConditional(left.name) && left.name !== "ifx") throw new TemplateUnsupported("\\ifx comparison");
    const a = this.meaning(left); const b = this.meaning(right);
    this.branch(a !== null && a === b || (a?.startsWith("undefined:") === true && b?.startsWith("undefined:") === true && left?.kind === "cs" && right?.kind === "cs" && a === b));
  }

  private nextNonSpace(): TemplateToken | null {
    for (let token = this.nextToken(); token; token = this.nextToken()) if (token.kind !== "space") return token;
    return null;
  }

  // -- macros -----------------------------------------------------------

  private readMacroArguments(reader: TemplateReader, macro: Macro): TemplateFrag[] {
    const args: TemplateFrag[] = [];
    let remaining = macro.params;
    if (macro.optionalDefault && remaining > 0) {
      const optional = reader.readOptional();
      args.push(optional ?? macro.optionalDefault);
      remaining -= 1;
    }
    for (; remaining > 0; remaining -= 1) args.push(reader.readGroup() ?? EMPTY_FRAG);
    return args;
  }

  private substitute(body: TemplateFrag, args: readonly TemplateFrag[]): TemplateFrag {
    if (!body.text.includes("#")) return body;
    const parts: TemplateFrag[] = [];
    let last = 0;
    for (let index = 0; index < body.text.length; index += 1) {
      if (body.text.charAt(index) === "\\") { index += 1; continue; }
      if (body.text.charAt(index) !== "#") continue;
      const digit = Number(body.text.charAt(index + 1));
      if (!(digit >= 1)) continue;
      parts.push(fragSlice(body, last, index), args[digit - 1] ?? EMPTY_FRAG);
      last = index + 2;
      index += 1;
    }
    parts.push(fragSlice(body, last, body.text.length));
    return fragConcat(parts);
  }

  private expandMacro(token: Extract<TemplateToken, { kind: "cs" }>, macro: Macro): void {
    if (++this.macroDepth > MAX_MACRO_DEPTH * 100) throw new TemplateUnsupported("macro recursion");
    const reader = this.requireReader();
    const args = this.readMacroArguments(reader, macro);
    void token;
    this.inputs.push(new TemplateReader(this.substitute(macro.body, args)));
  }

  /** A macro-like read-only value: `\inserttitle` and its kin. */
  private metadataFrag(name: string): TemplateFrag | null {
    const frag = this.rawMetadataFrag(name);
    if (!frag || !/\\(?:inst|and)(?![A-Za-z@])/u.test(frag.text)) return frag;
    // beamerbasetitle.sty: \inst is a superscript; \and is \quad in authors, a line break in institutes.
    const and = name.includes("institute") ? "\\\\[1em]" : "\\quad ";
    const reader = new TemplateReader(frag);
    const parts: TemplateFrag[] = [];
    let last = 0;
    for (let token = reader.next(); token; token = reader.next()) {
      if (token.kind !== "cs" || (token.name !== "inst" && token.name !== "and")) continue;
      parts.push(fragSlice(frag, last, token.from), fragGenerated(token.name === "inst" ? "\\textsuperscript" : and));
      last = token.to;
    }
    parts.push(fragSlice(frag, last, frag.text.length));
    return fragConcat(parts);
  }

  private rawMetadataFrag(name: string): TemplateFrag | null {
    const metadata = this.env.metadata;
    const value = (field: BeamerMetadataFieldModel | undefined, short = false): TemplateFrag => {
      const chosen = short && field?.shortValue ? field.shortValue : field?.value;
      if (!chosen) return EMPTY_FRAG;
      return { text: chosen.value, origin: Array.from({ length: chosen.value.length }, (_, index) => chosen.contentSpan.from + index) };
    };
    switch (name) {
      case "inserttitle": return value(metadata.title);
      case "insertshorttitle": return value(metadata.title, true);
      case "insertsubtitle": return value(metadata.subtitle);
      case "insertauthor": return value(metadata.author);
      case "insertshortauthor": case "beamer@shortauthor": return value(metadata.author, true);
      case "insertinstitute": return value(metadata.institute);
      case "insertshortinstitute": return value(metadata.institute, true);
      case "insertdate": return metadata.date ? value(metadata.date) : fragGenerated("\\today");
      case "insertshortdate": return metadata.date ? value(metadata.date, true) : fragGenerated("\\today");
      case "insertframenumber": case "insertpagenumber": return fragGenerated(String(this.env.frameNumber));
      case "inserttotalframenumber": return fragGenerated(String(this.env.totalFrames));
      case "insertblocktitle": return this.env.blockTitle ?? null;
      default: return null;
    }
  }

  // -- glue -------------------------------------------------------------

  private readGlue(reader: TemplateReader): Glue {
    // `\vskip` reads a dimension and optional plus/minus parts as tokens.
    reader.skipBlanks();
    const start = reader.position;
    const text = reader.frag.text;
    let at = start;
    const dimension = /^\s*[+-]*\s*(?:\d*\.?\d+|\d+\.?)?\s*(?:[A-Za-z]{2}|\\[A-Za-z@]+)?/u;
    const first = dimension.exec(text.slice(at));
    at += first ? first[0].length : 0;
    let cursor = at;
    const stretch = /^\s*plus\s*[+-]?\s*(?:\d*\.?\d+|\d+\.?)?\s*(?:fill+|fil+|[A-Za-z]{2}|\\[A-Za-z@]+)/u;
    const shrink = /^\s*minus\s*[+-]?\s*(?:\d*\.?\d+|\d+\.?)?\s*(?:fill+|fil+|[A-Za-z]{2}|\\[A-Za-z@]+)/u;
    const plus = stretch.exec(text.slice(cursor));
    if (plus) cursor += plus[0].length;
    const minus = shrink.exec(text.slice(cursor));
    if (minus) cursor += minus[0].length;
    reader.position = cursor;
    return this.parseGlue(text.slice(start, cursor));
  }

  parseGlue(text: string): Glue {
    let natural = text;
    let fill = 0;
    const plus = /\bplus\s*([+-]?\s*\d*\.?\d*)\s*(fill+|fil+)?/u.exec(text);
    if (plus) {
      natural = text.slice(0, plus.index);
      if (plus[2]) fill = (Number(plus[1]?.replace(/\s+/gu, "") ?? "1") || 1) * (plus[2].length >= 4 ? 100 : plus[2].length === 3 ? 10 : 1);
    }
    natural = natural.replace(/\bminus[\s\S]*$/u, "");
    if (/^\s*\\fill\s*$/u.test(natural)) return { pt: 0, fill: 1 };
    if (/^\s*\\fil\s*$/u.test(natural)) return { pt: 0, fill: 1 };
    const stripped = natural.trim();
    if (stripped === "") return { pt: 0, fill };
    const value = this.evaluateLength(this.expandMaxMin(stripped.replace(/^([+-])\s+/u, "$1")));
    if (value === null) throw new TemplateUnsupported(`the length ${stripped}`);
    return { pt: value, fill };
  }

  // -- environments -----------------------------------------------------

  private beginEnvironment(): void {
    const reader = this.requireReader();
    const nameFrag = reader.readGroup();
    const name = nameFrag?.text.trim() ?? "";
    switch (name) {
      case "beamercolorbox": this.beginColorBox(); return;
      case "columns": this.beginColumns(); return;
      case "column": this.beginColumn(); return;
      case "adjustwidth": this.beginList("adjustwidth"); return;
      case "center": case "Center": this.beginList("center"); return;
      case "flushleft": case "FlushLeft": this.beginList("flushleft"); return;
      case "flushright": case "FlushRight": this.beginList("flushright"); return;
      default: throw new TemplateUnsupported(`\\begin{${name}}`);
    }
  }

  private endEnvironment(): void {
    const reader = this.requireReader();
    const name = reader.readGroup()?.text.trim() ?? "";
    switch (name) {
      case "beamercolorbox": this.endColorBox(); return;
      case "columns": this.endColumns(); return;
      case "column": this.endColumn(); return;
      case "adjustwidth": this.endList("adjustwidth"); return;
      case "center": case "Center": this.endList("center"); return;
      case "flushleft": case "FlushLeft": this.endList("flushleft"); return;
      case "flushright": case "FlushRight": this.endList("flushright"); return;
      default: throw new TemplateUnsupported(`\\end{${name}}`);
    }
  }

  // -- trivlist environments ---------------------------------------------

  private readonly lists: Array<{ kind: string; topsepadd: number; outerParskip: number; paragraphs: number; frameDepth: number }> = [];

  /**
   * `center`, `flushleft`, `flushright` (`\trivlist\centering\item\relax` and kin)
   * and changepage's `adjustwidth` (`\list` with `\topsep0pt`, `\parsep\parskip`
   * and margins, then `\item[]`). The list's glue is `\addvspace` of
   * `\@topsep` (its topsep plus the outer `\parskip`) and of `-\parskip`; its
   * paragraphs run on the list's `\parshape`; `\leftskip` is reset and
   * `\rightskip` comes from `\@rightskip`.
   */
  private beginList(kind: "adjustwidth" | "center" | "flushleft" | "flushright"): void {
    const reader = this.requireReader();
    let left = 0; let right = 0;
    if (kind === "adjustwidth") {
      const leftArg = reader.readGroup(); const rightArg = reader.readGroup();
      const evaluate = (arg: TemplateFrag | null): number => {
        const text = arg ? this.expandFrag(arg).text.trim() : "";
        if (text === "") return 0;
        const value = this.evaluateLength(text);
        if (value === null) throw new TemplateUnsupported(`adjustwidth length ${text}`);
        return value;
      };
      left = evaluate(leftArg); right = evaluate(rightArg);
    }
    // \@trivlist: \unskip\par when in horizontal mode.
    this.finishPara();
    this.pushGroup();
    const registers = this.registers;
    const topsep = kind === "adjustwidth" ? 0 : beamerTrivlistSpacing(this.env.theme).naturalPt;
    const outerParskip = registers.parskip;
    this.lists.push({ kind, topsepadd: topsep, outerParskip, paragraphs: this.paraCounter, frameDepth: this.frames.length });
    registers.leftFinite = 0; registers.rightFinite = 0; registers.leftInfinite = false; registers.rightInfinite = registers.atRightskip;
    if (kind === "adjustwidth") {
      const base = registers.parshape ?? { x: 0, w: registers.linewidth };
      registers.parshape = { x: base.x + left, w: Math.max(0, base.w - left - right) };
      registers.listDepth += 1;
      registers.linewidth = registers.parshape.w;
    } else if (kind === "center") this.setAlignment(true, true);
    else if (kind === "flushleft") { this.setAlignment(false, true); registers.atRightskip = true; }
    else this.setAlignment(true, false);
    // \item: \addvspace\@topsep, then \addvspace{-\parskip} (both inside \addvspace's merge rules).
    this.addVSpace(topsep + outerParskip);
    this.addVSpace(-registers.parskip);
    this.registers.ignoreSpaces = true;
  }

  private endList(kind: string): void {
    const list = this.lists.pop();
    if (list?.kind !== kind || list.frameDepth !== this.frames.length) throw new TemplateUnsupported(`\\end{${kind}}`);
    // \endtrivlist: \leavevmode when no paragraph carried the label, then \unskip\par.
    if (this.paraCounter === list.paragraphs && !this.frame().para) this.startPara();
    this.finishPara();
    const frame = this.frame();
    const last = frame.items[frame.items.length - 1];
    if (last?.kind === "glue" && last.glue.fill === 0 && last.glue.pt > 0) last.glue = { pt: last.glue.pt + this.registers.parskip - list.outerParskip, fill: 0 };
    this.addVSpace(list.topsepadd);
    this.popGroup();
  }

  private lengthOption(options: Record<string, string | null>, key: string): number | null | undefined {
    const raw = options[key];
    if (raw === undefined) return undefined;
    if (raw === null || raw === "") return null;
    const value = this.evaluateLength(this.expandFrag(fragGenerated(raw)).text);
    if (value === null) throw new TemplateUnsupported(`beamercolorbox ${key}=${raw}`);
    return value;
  }

  private beginColorBox(): void {
    const reader = this.requireReader();
    const optionFrag = reader.readOptional();
    const roleFrag = reader.readGroup();
    const role = roleFrag?.text.trim() ?? "";
    const options: Record<string, string | null> = {};
    for (const [key, value] of splitTemplateOptions(optionFrag?.text ?? "")) options[key] = value;
    const resolved = resolveBeamerThemeColor(this.env.theme, role);
    const parent = this.frame();
    // An empty paragraph left by \leavevmode (and nothing else) ends before the box.
    if (parent.para && !parent.para.content) this.finishPara();
    else if (parent.para) throw new TemplateUnsupported("a colour box inside a paragraph");
    const frame = this.newFrame("colorbox", true);
    frame.role = role;
    frame.options = options;
    this.pushGroup();
    const registers = this.registers;
    const width = this.lengthOption(options, "wd") ?? registers.textwidth;
    const sep = this.lengthOption(options, "sep") ?? 0;
    const colsep = this.lengthOption(options, "colsep") ?? 0;
    const colsepStar = this.lengthOption(options, "colsep*") ?? 0;
    const ignoreBackground = "ignorebg" in options && options.ignorebg !== "false";
    const painted = resolved.bg !== undefined && !ignoreBackground;
    frame.fillColor = painted ? resolved.bg : undefined;
    frame.boxWidth = width;
    frame.boxHeight = this.lengthOption(options, "ht") ?? undefined;
    frame.boxDepth = this.lengthOption(options, "dp") ?? undefined;
    frame.colsepStar = painted ? Math.max(0, colsepStar) : 0;
    frame.colsep = Math.max(0, colsep);
    // usebeamercolor[fg]: text takes the role's foreground inside the box.
    const fg = resolved.fg ?? registers.fg;
    registers.fg = fg; registers.bg = resolved.bg ?? registers.bg;
    registers.text = fg;
    registers.hsize = width;
    registers.parshape = null;
    registers.offInterline = false;
    registers.normalBaselineSkip = registers.font.lineHeightPt;
    let leftFinite = 0; let rightFinite = 0; let leftInfinite = false; let rightInfinite = true;
    for (const key of ["left", "center", "right"] as const) {
      if (!(key in options)) continue;
      const offset = options[key] ? this.evaluateLength(options[key] ?? "") ?? 0 : 0;
      leftInfinite = key !== "left"; rightInfinite = key !== "right";
      leftFinite = key === "left" ? 0 : offset; rightFinite = key === "right" ? 0 : offset;
    }
    const explicitLeft = this.lengthOption(options, "leftskip"); const explicitRight = this.lengthOption(options, "rightskip");
    if (explicitLeft !== undefined && explicitLeft !== null) { leftFinite = explicitLeft; leftInfinite = false; }
    if (explicitRight !== undefined && explicitRight !== null) { rightFinite = explicitRight; rightInfinite = false; }
    if (sep > 0) { leftFinite += sep; rightFinite += sep; }
    if (painted && colsep > 0) { leftFinite += colsep; rightFinite += colsep; }
    registers.leftFinite = leftFinite; registers.rightFinite = rightFinite;
    registers.leftInfinite = leftInfinite; registers.rightInfinite = rightInfinite;
    this.frames.push(frame);
    const skip = (amount: number) => { if (amount > 0) frame.items.push({ kind: "glue", glue: { pt: amount, fill: 0 } }); };
    if (painted) { skip(colsep); skip(colsepStar); }
    skip(sep);
    frame.options.__sep = String(sep);
    if (!("vmode" in options)) { this.startPara(); }
    this.registers.ignoreSpaces = true;
  }

  private endColorBox(): void {
    this.finishPara();
    const frame = this.frame();
    if (frame.kind !== "colorbox") throw new TemplateUnsupported("\\end{beamercolorbox}");
    const sep = Number(frame.options.__sep ?? 0);
    const painted = frame.fillColor !== undefined;
    const skip = (amount: number) => { if (amount > 0) frame.items.push({ kind: "glue", glue: { pt: amount, fill: 0 } }); };
    skip(sep);
    if (painted) { skip(frame.colsep ?? 0); skip(frame.colsepStar ?? 0); }
    const width = frame.boxWidth ?? this.registers.hsize;
    const packed = this.packFrame(frame, width);
    this.frames.pop();
    this.popGroup();
    const h = frame.boxHeight ?? packed.h;
    const d = frame.boxDepth ?? packed.d;
    const star = frame.colsepStar ?? 0;
    const paint: TemplatePaint[] = [];
    if (frame.fillColor !== undefined) paint.push({ kind: "fill", x: -star, y: 0, w: width + 2 * star, h: h + d, color: frame.fillColor });
    // The height override moves the baseline, not the content.
    const shift = h - packed.h;
    paint.push(...packed.paint.map(item => item.kind === "fill" ? { ...item, y: item.y + shift } : { ...item, y: item.y + shift }));
    this.placeBox({ w: width, h, d, firstH: h, paint });
  }

  /** Put a finished box into the enclosing list. */
  private placeBox(box: TemplateBox, x = 0): void {
    const parent = this.frame();
    if (parent.para?.content) throw new TemplateUnsupported("a box inside a paragraph");
    if (parent.para) {
      // An empty paragraph (only \leavevmode) is a line holding just this box.
      parent.para = null;
      for (const group of this.groups) group.para = null;
    }
    this.append(parent, box, x, this.registers.normalBaselineSkip);
  }

  private beginColumns(): void {
    const reader = this.requireReader();
    const optionFrag = reader.readOptional();
    this.finishPara();
    const frame = this.newFrame("columns", true);
    frame.columns = [];
    const options = splitTemplateOptions(optionFrag?.text ?? "");
    let align: Frame["columnsAlign"] = this.centeredColumns ? "c" : "t";
    for (const [key] of options) {
      if (key === "c" || key === "t" || key === "T" || key === "b") align = key;
      else if (key === "onlytextwidth") frame.options.onlytextwidth = "true";
      else throw new TemplateUnsupported(`columns option ${key}`);
    }
    frame.columnsAlign = align;
    this.pushGroup();
    this.frames.push(frame);
  }

  /** Beamer's `\ifbeamer@centered` at the time the headline is typeset. */
  centeredColumns = true;

  private beginColumn(): void {
    const reader = this.requireReader();
    const optionFrag = reader.readOptional();
    const widthFrag = reader.readGroup();
    const columns = this.frame();
    if (columns.kind !== "columns") throw new TemplateUnsupported("\\begin{column} outside columns");
    const width = widthFrag ? this.evaluateLength(this.expandFrag(widthFrag).text) : null;
    if (width === null) throw new TemplateUnsupported("the column width");
    const frame = this.newFrame("column", true);
    let align = columns.columnsAlign ?? "c";
    for (const [key] of splitTemplateOptions(optionFrag?.text ?? "")) {
      if (key === "c" || key === "t" || key === "T" || key === "b") align = key;
      else throw new TemplateUnsupported(`column option ${key}`);
    }
    frame.boxAlign = align;
    frame.boxWidth = width;
    this.pushGroup();
    const registers = this.registers;
    registers.hsize = width; registers.textwidth = width; registers.linewidth = width;
    registers.parshape = null; registers.minipage = true;
    registers.offInterline = false;
    registers.normalBaselineSkip = registers.font.lineHeightPt;
    registers.leftFinite = 0; registers.rightFinite = 0; registers.leftInfinite = false; registers.rightInfinite = true;
    this.frames.push(frame);
    if (align === "T") { this.startPara(); }
    else this.startPara();
    this.registers.ignoreSpaces = true;
    if (align === "T") {
      // \beamer@colheadskip: \vskip-1ex\nointerlineskip after the head paragraph starts.
      this.finishPara();
      frame.items.push({ kind: "glue", glue: { pt: -templateFontUnits(this.registers.font).ex, fill: 0 } });
      frame.prevDepth = NO_PREV;
    }
  }

  private endColumn(): void {
    this.finishPara();
    const frame = this.frame();
    if (frame.kind !== "column") throw new TemplateUnsupported("\\end{column}");
    // \endminipage: \par\unskip.
    if (frame.items[frame.items.length - 1]?.kind === "glue") frame.items.pop();
    const width = frame.boxWidth ?? 0;
    const packed = this.packFrame(frame, width);
    this.frames.pop();
    this.popGroup();
    const outerFont = this.registers.font;
    const total = packed.h + packed.d;
    let box: TemplateBox;
    const align = frame.boxAlign ?? "c";
    const first = frame.items[0];
    if (align === "c") {
      const axis = 0.25 * outerFont.sizePt;
      const h = total / 2 + axis;
      box = { ...packed, h, d: total - h, firstH: h };
    } else if (align === "b") box = { ...packed, firstH: packed.h };
    else {
      const h = first?.kind === "box" ? first.box.h : 0;
      box = { ...packed, h, d: total - h, firstH: h };
    }
    // Content paints from the packed top; the box's own top is above its baseline by `h`.
    const columns = this.frame();
    columns.columns?.push({ x: 0, box: { ...box, paint: packed.paint } });
  }

  private endColumns(): void {
    this.finishPara();
    const frame = this.frame();
    if (frame.kind !== "columns") throw new TemplateUnsupported("\\end{columns}");
    this.frames.pop();
    this.popGroup();
    const columns = frame.columns ?? [];
    const textwidth = this.registers.textwidth;
    const total = columns.reduce((sum, column) => sum + column.box.w, 0);
    const extra = frame.options.onlytextwidth === "true" ? 0 : this.env.leftMargin + this.env.rightMargin;
    const span = textwidth + extra;
    const gap = (span - total) / (columns.length + 1);
    const h = Math.max(0, ...columns.map(column => column.box.h));
    const d = Math.max(0, ...columns.map(column => column.box.d));
    const paint: TemplatePaint[] = [];
    let x = (frame.options.onlytextwidth === "true" ? 0 : -this.env.leftMargin) + gap;
    for (const column of columns) {
      const top = h - column.box.h;
      paint.push(...column.box.paint.map(item => ({ ...item, x: item.x + x, y: item.y + top })));
      x += column.box.w + gap;
    }
    this.placeBox({ w: textwidth, h, d, firstH: h, paint });
  }

  // -- block body slot ---------------------------------------------------

  private bodySlot(): void {
    this.finishPara();
    const frame = this.frame();
    const registers = this.registers;
    const { x: slotX, width } = this.textArea();
    const context: TemplateSlotContext = {
      x: slotX, width, font: registers.font, color: registers.text,
      justify: !registers.leftInfinite && !registers.rightInfinite,
      alignment: registers.leftInfinite && registers.rightInfinite ? "center" : registers.leftInfinite ? "right" : "left",
      parskip: registers.parskip, baselineSkip: registers.normalBaselineSkip, listDepth: registers.listDepth,
      labelPending: this.lists.some(list => list.kind === "adjustwidth" && list.paragraphs === this.paraCounter),
    };
    this.slotContext = context;
    // The body's paragraphs start here: they carry a pending list label.
    this.paraCounter += 1;
    registers.minipage = false;
    const handled: TemplateSlotResult = this.slotHandler ? this.slotHandler(context) : { w: width, h: 0, d: 0, firstH: 0, paint: [] };
    // A body that starts with a paragraph gets its \parskip; one that starts with a box in vertical mode (columns) does not.
    if (frame.items.length > 0 && handled.noLeadingParskip !== true) frame.items.push({ kind: "glue", glue: { pt: registers.parskip, fill: 0 } });
    const box: TemplateBox = { ...handled, paint: [{ kind: "slot", x: 0, y: 0, w: width }, ...handled.paint] };
    this.append(frame, box, context.x, handled.baselineSkip ?? registers.normalBaselineSkip);
  }

  // -- packing ------------------------------------------------------------

  /** vpack the frame's items at natural size. */
  private packFrame(frame: Frame, width: number): TemplateBox {
    let x = 0;
    let d = 0;
    let lastDepth = 0;
    let firstBox: TemplateBox | undefined;
    const paint: TemplatePaint[] = [];
    for (const item of frame.items) {
      if (item.kind === "glue") { x += d + item.glue.pt; d = 0; continue; }
      firstBox ??= item.box;
      lastDepth = item.box.d;
      x += d + item.box.h;
      const top = x - item.box.h;
      for (const entry of item.box.paint) paint.push(entry.kind === "fill"
        ? { ...entry, x: entry.x + item.x, y: entry.y + top }
        : { ...entry, x: entry.x + item.x, y: entry.y + top });
      d = item.box.d;
    }
    return { w: width, h: x, d, firstH: firstBox?.h ?? x, paint, lastDepth };
  }
}

export type TemplateDefinitionsSnapshot = {
  macros: Map<string, Macro>;
  flags: Map<string, boolean>;
  lengths: Map<string, number>;
  unsupported: Set<string>;
};

export type TemplateSlotResult = TemplateBox & { noLeadingParskip?: boolean };

export type TemplateSlotContext = {
  x: number;
  width: number;
  font: BeamerThemeFont;
  color: string;
  justify: boolean;
  alignment: "left" | "center" | "right";
  parskip: number;
  baselineSkip: number;
  /** Lists the body sits in (`\@listdepth`): lists in the body take the registers of the deeper levels. */
  listDepth: number;
  /** A list's `\item[]` label is still pending: a list the body starts with inherits it and has no topsep. */
  labelPending: boolean;
};

export function applyElementFont(font: BeamerThemeFont, declared: BeamerTemplateElementFont): BeamerThemeFont {
  const result: BeamerThemeFont = { ...font };
  if (declared.family) result.family = declared.family;
  if (declared.typeface) result.typeface = declared.typeface;
  if (declared.series) result.series = declared.series;
  if (declared.shape) result.shape = declared.shape;
  if (declared.sizePt !== undefined) { result.sizePt = declared.sizePt; result.lineHeightPt = declared.lineHeightPt ?? result.lineHeightPt; }
  return result;
}

export function concatParagraphText(parts: readonly MappedText[]): MappedText {
  return parts.length === 0 ? createGeneratedMappedText("", "Beamer template", { from: 0, to: 0 }) : concatMappedText(parts);
}

/** Names of the commands the machine itself handles. */
const HANDLED_COMMANDS: ReadonlySet<string> = new Set([
  "relax", "makeatletter", "makeatother", "protect", "ignorespaces", "leavevmode", "noindent", "par", "nointerlineskip",
  "vskip", "vspace", "vfill", "smallskip", "medskip", "bigskip", "parskip", "centering", "Centering", "raggedright",
  "RaggedRight", "raggedleft", "RaggedLeft", "justifying", "justify", "normalfont", "begin", "end", "setlength", "addtolength",
  "usebeamerfont", "usebeamercolor", "ifbeamercolorempty", "ifx", "ifdefined", "iftrue", "iffalse", "else", "fi", "href",
  "\\", "fontsize", "selectfont", "bfseries", "mdseries", "itshape", "slshape", "scshape", "upshape", "empty",
  "inserttitle", "insertshorttitle", "insertsubtitle", "insertauthor", "insertshortauthor", "beamer@shortauthor",
  "insertinstitute", "insertshortinstitute", "insertdate", "insertshortdate", "insertframenumber", "insertpagenumber",
  "inserttotalframenumber", "insertblocktitle", "tikzeditorbodyslot", "rmfamily", "sffamily", "ttfamily", "newcommand",
  "renewcommand", "providecommand", "def", "gdef", "newlength", "settowidth", "newif", "maxof", "minof", "dimexpr", "fill",
  "paperwidth", "textwidth", "linewidth", "columnwidth",
]);
const ENVIRONMENTS: ReadonlySet<string> = new Set(["beamercolorbox", "columns", "column", "adjustwidth", "center", "Center", "flushleft", "FlushLeft", "flushright", "FlushRight"]);

export type TemplateDefinitions = { macros: Map<string, string>; flags: Set<string>; lengths: Set<string> };

/** Macros, flags and lengths a piece of theme or preamble text defines, at any depth. */
export function collectTemplateDefinitions(texts: readonly string[]): TemplateDefinitions {
  const result: TemplateDefinitions = { macros: new Map(), flags: new Set(), lengths: new Set() };
  for (const text of texts) {
    const reader = new TemplateReader({ text, origin: Array.from({ length: text.length }, () => -1) });
    for (let token = reader.next(); token; token = reader.next()) {
      if (token.kind !== "cs") continue;
      if (token.name === "newcommand" || token.name === "renewcommand" || token.name === "providecommand") {
        if (reader.peekChar() === "*") { reader.skipBlanks(); reader.position += 1; }
        const target = reader.readGroup();
        const count = reader.readOptional();
        if (count) reader.readOptional();
        const body = reader.readGroup();
        if (target && body) result.macros.set(target.text.trim().replace(/^\\/u, ""), body.text);
        reader.position = Math.min(reader.position, text.length);
        // Definitions inside the body are found by scanning on from its start.
        if (body) reader.position -= body.text.length + 1;
      } else if (token.name === "def" || token.name === "gdef" || token.name === "edef" || token.name === "xdef") {
        const target = reader.next();
        if (target?.kind !== "cs") continue;
        for (;;) { const saved = reader.position; const next = reader.next(); if (next?.kind === "param") continue; reader.position = saved; break; }
        const body = reader.readGroup();
        if (body) { result.macros.set(target.name, body.text); reader.position -= body.text.length + 1; }
      } else if (token.name === "newif") {
        const flag = reader.readGroup();
        const match = flag ? /^\\if([A-Za-z@]+)$/u.exec(flag.text.trim()) : null;
        if (match?.[1]) result.flags.add(match[1]);
      } else if (token.name === "newlength") {
        const target = reader.readGroup();
        if (target) result.lengths.add(target.text.trim().replace(/^\\/u, ""));
      }
    }
  }
  return result;
}

/**
 * The first command in a template body that the interpreter cannot lay out,
 * after theme-defined macros are followed; null when it is all in the
 * vocabulary. Command names are checked, not their arguments' values.
 */
export function findUnsupportedTemplateCommand(body: string, definitions: TemplateDefinitions): string | null {
  const seen = new Set<string>();
  const check = (text: string, depth: number): string | null => {
    if (depth > 12) return "macro recursion";
    const reader = new TemplateReader({ text, origin: Array.from({ length: text.length }, () => -1) });
    let math = false;
    for (let token = reader.next(); token; token = reader.next()) {
      if (token.kind === "char" && token.char === "$") { math = !math; continue; }
      if (token.kind !== "cs" || math) continue;
      const name = token.name;
      if (name === "begin" || name === "end") {
        const environment = reader.readGroup()?.text.trim() ?? "";
        if (!ENVIRONMENTS.has(environment)) return `\\${name}{${environment}}`;
        if (name === "begin") {
          if (environment === "adjustwidth") { reader.readGroup(); reader.readGroup(); continue; }
          if (environment === "center" || environment === "Center" || environment === "flushleft" || environment === "FlushLeft" || environment === "flushright" || environment === "FlushRight") continue;
          reader.readOptional();
          if (environment !== "columns") reader.readGroup();
        }
        continue;
      }
      if (name === "setlength" || name === "addtolength" || name === "vspace" || name === "hspace") { if (reader.peekChar() === "*") { reader.skipBlanks(); reader.position += 1; } reader.readGroup(); if (name === "setlength" || name === "addtolength") reader.readGroup(); continue; }
      if (name === "rule" || name === "includegraphics") { reader.readOptional(); reader.readGroup(); if (name === "rule") reader.readGroup(); continue; }
      if (name === "usebeamerfont" || name === "usebeamercolor") { reader.readOptional(); reader.skipBlanks(); if (reader.peekChar() === "*") reader.position += 1; reader.readOptional(); reader.readGroup(); continue; }
      if (name === "ifbeamercolorempty") { reader.readOptional(); reader.readGroup(); continue; }
      if (name === "newcommand" || name === "renewcommand" || name === "providecommand" || name === "def" || name === "newlength" || name === "settowidth" || name === "newif") return `\\${name} inside a template`;
      const macro = definitions.macros.get(name);
      if (macro !== undefined) {
        if (seen.has(name)) continue;
        seen.add(name);
        const inner = check(macro, depth + 1);
        if (inner) return inner;
        continue;
      }
      if (HANDLED_COMMANDS.has(name) || SIZE_COMMANDS.has(name) || PASS_PROCESSED.has(name) || PASS_RAW_ARGS.has(name) || PASS_BARE.has(name)) continue;
      const flag = /^if([A-Za-z@]+)$/u.exec(name)?.[1];
      if (flag !== undefined && definitions.flags.has(flag)) continue;
      return `\\${name}`;
    }
    return null;
  };
  return check(body, 0);
}
