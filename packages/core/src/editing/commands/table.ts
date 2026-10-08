import type { MacroBinding } from "../../macros/types.js";
import {
  SIMPLE_TEX_FONT_COMMAND_NAMES,
  SIMPLE_TEX_FONT_DECLARATION_NAMES,
} from "../../text/tex/ir.js";
import { texMathCommandFamily } from "../../text/tex/math/parser.js";
import { classifyMacro } from "./macro-classes.js";
import type { EditMode, EditNodeKind, EditValue, SlotRole } from "../tree/types.js";

/**
 * The CommandTable (design/canvas-editing-architecture.md, "CommandTable"):
 * how each command binds its arguments and which tree node it becomes.
 * Math commands are classified by the math parser's own command families
 * (texMathCommandFamily), so the parser stays the single source of truth
 * for which math commands exist; this table only adds argument shapes.
 * User macros come from the interpretation environment.
 */

export type ArgSchema = {
  readonly kind: "mandatory" | "optional" | "overlay";
  /** A slot (rendered content) or a value (picker-edited, not rendered as text). */
  readonly rendered: boolean;
  readonly role: SlotRole | EditValue["role"];
  /** Content mode of a rendered slot; defaults to the command's mode. */
  readonly mode?: EditMode;
};

export type CommandCategory =
  | "style"
  | "construct"
  | "symbol"
  | "operator"
  | "atom"
  | "vertical"
  | "spacing"
  | "declaration"
  | "overlay"
  | "link"
  | "break";

export type CommandSchema = {
  readonly name: string;
  readonly category: CommandCategory;
  readonly node: EditNodeKind;
  readonly args: readonly ArgSchema[];
  /** Accepts a `*` right after the name. */
  readonly star?: boolean;
  /** A user macro from the document (bound by arity, rendered opaque). */
  readonly userMacro?: boolean;
};

export type EnvironmentBody = "flow" | "list" | "math" | "math-alignment" | "text-alignment" | "opaque";

export type EnvironmentSchema = {
  readonly name: string;
  readonly node: EditNodeKind;
  readonly body: EnvironmentBody;
  readonly args: readonly ArgSchema[];
  /** For a list body: the command that starts an item and the arguments it takes. */
  readonly item?: { readonly command: string; readonly args: readonly ArgSchema[] };
};

export type CommandTable = {
  command(name: string, mode: EditMode): CommandSchema | null;
  environment(name: string): EnvironmentSchema | null;
};

const content = (mode?: EditMode): ArgSchema => ({ kind: "mandatory", rendered: true, role: "content", mode });
const slot = (role: SlotRole, kind: ArgSchema["kind"] = "mandatory", mode?: EditMode): ArgSchema => ({
  kind,
  rendered: true,
  role,
  mode,
});
const value = (role: EditValue["role"], kind: ArgSchema["kind"] = "mandatory"): ArgSchema => ({
  kind,
  rendered: false,
  role,
});
const overlay = value("overlay", "overlay");

type Entry = Omit<CommandSchema, "name">;

function entries(names: readonly string[], entry: Entry): [string, Entry][] {
  return names.map((name) => [name, entry]);
}

const TEXT_COMMANDS = new Map<string, Entry>([
  ...entries([...SIMPLE_TEX_FONT_COMMAND_NAMES, "underline", "alert", "structure"], {
    category: "style",
    node: "style",
    args: [overlay, content("text")],
  }),
  ...entries(["mbox", "fbox", "text"], { category: "style", node: "style", args: [content("text")] }),
  ["makebox", { category: "style", node: "style", args: [value("dimension", "optional"), value("value", "optional"), content("text")] }],
  ["textcolor", { category: "style", node: "style", args: [overlay, value("options", "optional"), value("color"), content("text")] }],
  ["colorbox", { category: "style", node: "style", args: [value("options", "optional"), value("color"), content("text")] }],
  ["fcolorbox", { category: "style", node: "style", args: [value("color"), value("color"), content("text")] }],
  ...entries([...SIMPLE_TEX_FONT_DECLARATION_NAMES, "tiny", "scriptsize", "footnotesize", "small", "normalsize",
    "large", "Large", "LARGE", "huge", "Huge", "centering", "raggedright", "raggedleft", "noindent"], {
    category: "declaration",
    node: "declaration",
    args: [],
  }),
  ["color", { category: "declaration", node: "declaration", args: [overlay, value("options", "optional"), value("color")] }],
  ["onslide", { category: "declaration", node: "declaration", args: [overlay], star: true }],
  ...entries(["only", "uncover", "visible", "invisible"], { category: "overlay", node: "overlay", args: [overlay, content("text")] }),
  ["alt", { category: "overlay", node: "overlay", args: [overlay, content("text"), content("text")] }],
  ["href", { category: "link", node: "link", args: [value("url"), content("text")] }],
  ["hyperlink", { category: "link", node: "link", args: [overlay, value("label-key"), content("text")] }],
  ["url", { category: "link", node: "link", args: [value("url")] }],
  ...entries(["cite", "citep", "citet"], { category: "atom", node: "atom", args: [value("options", "optional"), value("label-key")] }),
  ...entries(["ref", "eqref", "pageref", "autoref", "label"], { category: "atom", node: "atom", args: [value("label-key")] }),
  ["footnote", { category: "atom", node: "atom", args: [overlay, value("options", "optional"), value("value")] }],
  ["includegraphics", { category: "atom", node: "atom", args: [overlay, value("options", "optional"), value("value")], star: true }],
  ...entries(["ldots", "dots", "textbackslash", "LaTeX", "TeX", "today", "textbar", "textasciitilde", "S", "P",
    "copyright", "dag", "ddag", "textbullet", "textendash", "textemdash", "textquoteleft", "textquoteright",
    "ss", "ae", "AE", "oe", "OE", "o", "O", "aa", "AA", "i", "j", "l", "L"], {
    category: "symbol",
    node: "symbol",
    args: [],
  }),
  // Text accents take one argument, usually unbraced: \c c, \v{s}.
  ...entries(["c", "v", "u", "H", "r", "k", "b", "d", "t"], { category: "symbol", node: "symbol", args: [value("value")] }),
  ...entries(["quad", "qquad", "enspace", "enskip", "hfill", "hfil", "thinspace", "negthinspace"], {
    category: "spacing",
    node: "space",
    args: [],
  }),
  ["hspace", { category: "spacing", node: "space", args: [value("dimension")], star: true }],
  ...entries(["medskip", "smallskip", "bigskip", "vfill", "newpage", "clearpage", "par"], {
    category: "vertical",
    node: "vertical",
    args: [],
  }),
  ["pause", { category: "vertical", node: "vertical", args: [value("options", "optional")] }],
  ["vspace", { category: "vertical", node: "vertical", args: [overlay, value("dimension")], star: true }],
  ["newline", { category: "break", node: "break", args: [] }],
  ["newblock", { category: "spacing", node: "space", args: [] }],
  // The optional short caption only appears in a list of figures.
  ["caption", { category: "style", node: "style", args: [overlay, value("value", "optional"), content("text")], star: true }],
  ["framebreak", { category: "vertical", node: "vertical", args: [] }],
  ...entries(["frametitle", "framesubtitle"], { category: "style", node: "style", args: [overlay, value("options", "optional"), content("text")] }),
  ["beamerreturnbutton", { category: "style", node: "style", args: [content("text")] }],
  ["temporal", { category: "overlay", node: "overlay", args: [overlay, content("text"), content("text"), content("text")] }],
  ["hypertarget", { category: "link", node: "link", args: [overlay, value("label-key"), content("text")] }],
  ["scalebox", { category: "style", node: "style", args: [value("value"), value("value", "optional"), content("text")] }],
  ["rotatebox", { category: "style", node: "style", args: [value("options", "optional"), value("value"), content("text")] }],
  ["resizebox", { category: "style", node: "style", args: [value("dimension"), value("dimension"), content("text")], star: true }],
  ["reflectbox", { category: "style", node: "style", args: [content("text")] }],
  ["multicolumn", { category: "style", node: "style", args: [value("value"), value("spec"), content("text")] }],
  ["rule", { category: "atom", node: "atom", args: [value("dimension", "optional"), value("dimension"), value("dimension")] }],
  ...entries(["setlength", "addtolength"], { category: "declaration", node: "declaration", args: [value("value"), value("dimension")] }),
  ...entries(["newcommand", "renewcommand", "providecommand"], {
    category: "atom",
    node: "atom",
    args: [value("value"), value("value", "optional"), value("value", "optional"), value("value")],
    star: true,
  }),
  ["def", { category: "atom", node: "atom", args: [value("value"), value("value")] }],
  ...entries(["titlepage", "tableofcontents"], { category: "atom", node: "atom", args: [value("options", "optional")] }),
  ["emoji", { category: "atom", node: "atom", args: [value("value")] }],
  ["qrcode", { category: "atom", node: "atom", args: [value("options", "optional"), value("value")] }],
  ["linebreak", { category: "break", node: "break", args: [value("value", "optional")] }],
]);

/** Control symbols in text mode (`\&`, `\'e`, `\ `). */
function textControlSymbol(name: string): Entry | null {
  if ("'\"`^~=.".includes(name)) {
    return { category: "symbol", node: "symbol", args: [value("value")] };
  }
  if (" ,;:!@/".includes(name)) {
    return { category: "spacing", node: "space", args: [] };
  }
  if (name === "-") {
    return { category: "symbol", node: "invisible", args: [] };
  }
  return { category: "symbol", node: "symbol", args: [] };
}

const MATH_COMMANDS = new Map<string, Entry>([
  ["color", { category: "declaration", node: "declaration", args: [value("options", "optional"), value("color")] }],
  ["textcolor", { category: "style", node: "style", args: [value("options", "optional"), value("color"), content()] }],
  ...entries(["boxed", "cancel", "bcancel", "xcancel", "bm", "boldsymbol", "pmb"], { category: "style", node: "style", args: [content()] }),
  ...entries(["label", "tag", "eqref", "ref"], { category: "atom", node: "atom", args: [value("label-key")], star: true }),
  ...entries(["nonumber", "notag", "nolimits", "limits", "displaybreak", "tiny", "scriptsize", "footnotesize",
    "small", "normalsize", "large", "Large", "LARGE", "huge", "Huge"], { category: "declaration", node: "declaration", args: [] }),
  ["substack", { category: "atom", node: "atom", args: [value("value")] }],
  ["sideset", { category: "atom", node: "atom", args: [value("value"), value("value")] }],
  ["genfrac", { category: "atom", node: "atom", args: [value("value"), value("value"), value("value"), value("value"), value("value"), value("value")] }],
  ["hspace", { category: "spacing", node: "space", args: [value("dimension")], star: true }],
  ...entries(["only", "uncover", "visible", "invisible"], { category: "overlay", node: "overlay", args: [overlay, content()] }),
  ["alt", { category: "overlay", node: "overlay", args: [overlay, content(), content()] }],
]);

function mathFamilyEntry(name: string): Entry | null {
  const family = texMathCommandFamily(name);
  switch (family) {
    case null:
      return null;
    case "symbol":
    case "infix-fraction":
    case "not":
      return { category: "symbol", node: "symbol", args: [] };
    case "modular":
      return name === "pmod"
        ? { category: "operator", node: "operator", args: [content()] }
        : { category: "symbol", node: "symbol", args: [] };
    case "big-delimiter":
      // The delimiter token is part of the symbol: \bigl(.
      return { category: "symbol", node: "symbol", args: [value("value")] };
    case "operator":
      return { category: "operator", node: "operator", args: [] };
    case "operatorname":
      return { category: "operator", node: "operator", args: [content("text")], star: true };
    case "alphabet":
    case "phantom":
    case "atom-class":
      return { category: "style", node: "style", args: [content()] };
    case "alphabet-declaration":
    case "style":
    case "limits":
      return { category: "declaration", node: "declaration", args: [] };
    case "accent":
    case "line":
    case "brace":
      return { category: "construct", node: "accent", args: [content()] };
    case "stack":
      return {
        category: "construct",
        node: "overset",
        args: name === "underset" ? [slot("below"), slot("base")] : [slot("above"), slot("base")],
      };
    case "overunderset":
      return { category: "construct", node: "overset", args: [slot("above"), slot("below"), slot("base")] };
    case "extensible-arrow":
      return { category: "construct", node: "overset", args: [slot("below", "optional"), slot("above")] };
    case "fraction":
      return { category: "construct", node: "fraction", args: [slot("numerator"), slot("denominator")] };
    case "radical":
      return { category: "construct", node: "radical", args: [slot("index", "optional"), slot("radicand")] };
    case "text":
      return {
        category: "construct",
        node: "text-in-math",
        args: name === "makebox" || name === "framebox"
          ? [value("dimension", "optional"), value("value", "optional"), content("text")]
          : [content("text")],
      };
    case "spacing":
      return { category: "spacing", node: "space", args: [] };
    // Bound by the binder itself.
    case "left":
    case "right":
    case "middle":
      return { category: "construct", node: "delimited", args: [] };
  }
}

const LIST_ENVIRONMENTS = ["itemize", "enumerate", "description"];
const TITLED_BLOCKS = ["block", "alertblock", "exampleblock"];
const THEOREM_LIKE = [
  "theorem", "lemma", "corollary", "proposition", "definition", "example", "examples", "proof", "fact",
  "remark", "claim", "observation", "conjecture", "exercise", "problem", "solution", "note", "question",
];
const TEXT_CONTAINERS = ["center", "flushleft", "flushright", "quote", "quotation", "verse",
  "tiny", "scriptsize", "footnotesize", "small", "normalsize", "large", "Large", "LARGE", "huge", "Huge"];
const DISPLAY_SINGLE = ["equation", "equation*", "displaymath"];
const DISPLAY_ALIGNMENT = ["align", "align*", "flalign", "flalign*", "gather", "gather*", "multline", "multline*",
  "eqnarray", "eqnarray*", "alignat", "alignat*"];
const INLINE_MATH_ALIGNMENT = ["aligned", "gathered", "split", "cases", "dcases", "matrix", "pmatrix", "bmatrix",
  "Bmatrix", "vmatrix", "Vmatrix", "smallmatrix", "array", "subarray", "alignedat"];
const TEXT_ALIGNMENT = ["tabular", "tabular*", "tabularx"];
const OPAQUE = ["tikzpicture", "verbatim", "verbatim*", "Verbatim", "BVerbatim", "semiverbatim", "lstlisting",
  "minted", "alltt", "columns", "column", "picture", "pgfpicture"];
const FLOATS = ["figure", "figure*", "table", "table*"];
const LIST_ITEM = { command: "item", args: [overlay, slot("label", "optional", "text")] };

function environmentEntry(name: string): EnvironmentSchema | null {
  if (LIST_ENVIRONMENTS.includes(name)) {
    return { name, node: "list", body: "list", args: [overlay, value("options", "optional")], item: LIST_ITEM };
  }
  if (name === "thebibliography") {
    // The argument is the widest label, used only to size the label column.
    return {
      name,
      node: "list",
      body: "list",
      args: [value("value")],
      item: { command: "bibitem", args: [slot("label", "optional", "text"), value("label-key")] },
    };
  }
  if (FLOATS.includes(name)) {
    return { name, node: "container", body: "flow", args: [value("options", "optional")] };
  }
  if (TITLED_BLOCKS.includes(name)) {
    return { name, node: "container", body: "flow", args: [overlay, slot("title", "mandatory", "text")] };
  }
  if (THEOREM_LIKE.includes(name)) {
    return { name, node: "container", body: "flow", args: [overlay, slot("title", "optional", "text")] };
  }
  if (TEXT_CONTAINERS.includes(name)) {
    return { name, node: "container", body: "flow", args: [] };
  }
  if (name === "tcolorbox" || name === "overprint") {
    return { name, node: "container", body: "flow", args: [value("options", "optional")] };
  }
  if (["onlyenv", "uncoverenv", "visibleenv", "invisibleenv"].includes(name)) {
    return { name, node: "container", body: "flow", args: [overlay] };
  }
  if (name === "minipage") {
    return { name, node: "container", body: "flow", args: [value("options", "optional"), value("dimension")] };
  }
  if (DISPLAY_SINGLE.includes(name)) {
    return { name, node: "display", body: "math", args: [] };
  }
  if (DISPLAY_ALIGNMENT.includes(name)) {
    return { name, node: "alignment", body: "math-alignment", args: name.startsWith("alignat") ? [value("value")] : [] };
  }
  if (INLINE_MATH_ALIGNMENT.includes(name)) {
    const args = name === "array" || name === "subarray"
      ? [value("options", "optional"), value("spec")]
      : name === "alignedat" ? [value("value")] : [];
    return { name, node: "alignment", body: "math-alignment", args };
  }
  if (TEXT_ALIGNMENT.includes(name)) {
    const args = name === "tabular"
      ? [value("options", "optional"), value("spec")]
      : [value("dimension"), value("options", "optional"), value("spec")];
    return { name, node: "alignment", body: "text-alignment", args };
  }
  if (OPAQUE.includes(name)) {
    return { name, node: "atom", body: "opaque", args: [] };
  }
  return null;
}

/**
 * The command table for a scope. `macros` are the user definitions in
 * effect (preamble and body definitions before the frame); they shadow
 * built-ins, as in TeX. `theorems` adds the document's theorem-like
 * environment names.
 */
export function createCommandTable(
  options: {
    readonly macros?: ReadonlyMap<string, MacroBinding>;
    readonly theorems?: readonly string[];
  } = {}
): CommandTable {
  const macros = options.macros;
  const theorems = new Set(options.theorems ?? []);
  return {
    command(name, mode) {
      const macro = macros?.get(`\\${name}`);
      if (macro) {
        if (macro.provenance.at(-1)?.commandRaw === "\\DeclareMathOperator") {
          return { name, category: "operator", node: "operator", args: [], userMacro: true };
        }
        const macroClass = classifyMacro(macro);
        if (macroClass.kind === "style") {
          return { name, category: "style", node: "style", args: [content(macroClass.mode)], userMacro: true };
        }
        const args: ArgSchema[] = [];
        if (macro.kind === "callable") {
          const optional = macro.optionalFirstArgDefault != null;
          if (optional) {
            args.push(value("value", "optional"));
          }
          for (let index = optional ? 1 : 0; index < macro.parameterCount; index += 1) {
            args.push(value("value"));
          }
        }
        return { name, category: "atom", node: "atom", args, userMacro: true };
      }
      const isWord = /^[A-Za-z@]+$/u.test(name);
      const entry = mode === "math"
        ? MATH_COMMANDS.get(name) ?? mathFamilyEntry(`\\${name}`) ??
          (isWord ? null : { category: "symbol", node: "symbol", args: [] })
        : TEXT_COMMANDS.get(name) ?? (isWord ? null : textControlSymbol(name));
      return entry ? { name, ...entry } : null;
    },
    environment(name) {
      const entry = environmentEntry(name);
      if (entry) {
        return entry;
      }
      return theorems.has(name)
        ? { name, node: "container", body: "flow", args: [overlay, slot("title", "optional", "text")] }
        : null;
    },
  };
}
