import {
  SIMPLE_TEX_CONTROL_NODE_KINDS,
  SIMPLE_TEX_DISPLAY_MATH_DELIMITERS,
  SIMPLE_TEX_DIMENSION_BOX_COMMAND_NAMES,
  SIMPLE_TEX_FONT_COMMAND_NAMES,
  SIMPLE_TEX_FONT_DECLARATION_NAMES,
  SIMPLE_TEX_INLINE_NODE_KINDS,
  SIMPLE_TEX_TEXT_BOX_COMMAND_NAMES,
} from "@tikz-editor/core/text/tex/index.js";
import type { TexFuzzFeatureId } from "./model.js";

export type TexFuzzFeatureMode = "text" | "math" | "mixed" | "document" | "oracle";
export type TexFuzzFeatureCategory =
  | "literal"
  | "spacing"
  | "structure"
  | "style"
  | "math"
  | "box"
  | "document"
  | "oracle";

export interface TexFuzzFeatureDefinition {
  readonly id: TexFuzzFeatureId;
  /** Production registry entries for which this feature accounts. */
  readonly productionKeys: readonly string[];
  readonly nodeKinds: readonly string[];
  readonly mode: TexFuzzFeatureMode;
  readonly category: TexFuzzFeatureCategory;
  readonly support: "native" | "oracle-canary";
}

const SIZE_DECLARATIONS = [
  "tiny", "scriptsize", "footnotesize", "small", "normalsize", "large", "Large", "LARGE", "huge", "Huge",
] as const;
const ALIGNMENTS = ["centering", "raggedright", "raggedleft"] as const;
const ENVIRONMENTS = [
  "quote", "quotation", "center", "flushleft", "flushright", "itemize", "enumerate", "description",
] as const;
const VERTICAL_GLUE_COMMANDS = ["smallskip", "medskip", "bigskip", "vfill", "vspace", "vskip"] as const;
const MATH_NODE_KINDS = ["atom", "group", "sequence", "fraction", "radical", "script", "accent", "alphabet", "line", "left-right", "operator", "stackrel", "xarrow", "matrix", "text"] as const;
const MATH_FRACTION_COMMANDS = ["frac", "dfrac", "tfrac", "binom"] as const;
const MATH_ACCENT_COMMANDS = ["hat", "bar", "tilde", "vec", "dot", "ddot", "widehat", "widetilde"] as const;
const MATH_ALPHABET_COMMANDS = ["mathrm", "mathbf", "mathit", "mathsf", "mathtt", "mathcal", "mathbb", "mathfrak", "boldsymbol"] as const;
const MATH_LINE_COMMANDS = ["overline", "underline", "overbrace", "underbrace"] as const;
const MATH_OPERATOR_COMMANDS = ["sum", "prod", "int", "lim", "bigcup", "bigcap"] as const;
const MATH_ARROW_COMMANDS = ["xleftarrow", "xrightarrow"] as const;
const MATH_MATRIX_ENVIRONMENTS = ["matrix", "pmatrix", "bmatrix", "smallmatrix", "cases"] as const;
const MATH_TEXT_COMMANDS = ["text", "mathrm", "mathbf"] as const;

const BASE_FEATURE_DEFINITIONS = {
  "text.literal": definition("text.literal", ["inline-kind:text"], ["text"], "text", "literal"),
  "text.space": definition("text.space", ["inline-kind:space"], ["space"], "text", "spacing"),
  "text.group": definition("text.group", ["inline-kind:group"], ["group"], "text", "structure"),
  "text.bold": definition("text.bold", [], ["font:textbf"], "text", "style"),
  "text.italic": definition("text.italic", [], ["font:textit"], "text", "style"),
  "text.color": definition("text.color", ["inline-kind:color-command"], ["color"], "text", "style"),
  "text.accent": definition("text.accent", [], ["accent"], "text", "literal"),
  "math.inline": definition("math.inline", ["inline-kind:math"], ["math"], "mixed", "math"),
  "box.fbox": definition("box.fbox", [], ["box:fbox"], "text", "box"),
  "text.line-break": definition("text.line-break", ["inline-kind:line-break"], ["line-break"], "text", "structure"),
  "box.raisebox": definition("box.raisebox", ["inline-kind:raisebox"], ["raisebox"], "text", "box"),
  "box.rule": definition("box.rule", ["inline-kind:rule"], ["rule"], "text", "box"),
  "document.paragraph-break": definition("document.paragraph-break", ["control-kind:paragraph-break"], ["paragraph-break"], "document", "document"),
  "document.noindent": definition("document.noindent", ["control-kind:noindent"], ["noindent"], "document", "document"),
  "document.item": definition("document.item", ["control-kind:item"], ["item"], "document", "document"),
  "document.penalty": definition("document.penalty", ["control-kind:penalty"], ["penalty"], "document", "document"),
  "document.vertical-rule": definition("document.vertical-rule", ["control-kind:vertical-rule"], ["vertical-rule"], "document", "document"),
  "oracle.supported-command": {
    id: "oracle.supported-command",
    productionKeys: [],
    nodeKinds: ["oracle-command:TeX"],
    mode: "oracle",
    category: "oracle",
    support: "oracle-canary",
  },
} satisfies Readonly<Partial<Record<TexFuzzFeatureId, TexFuzzFeatureDefinition>>>;

const GENERATED_FEATURE_DEFINITIONS: readonly (readonly [TexFuzzFeatureId, TexFuzzFeatureDefinition])[] = [
  ...MATH_NODE_KINDS.map((kind) => {
    const id = `math.node.${kind}` as const;
    return [id, definition(id, [], [`math:${kind}`], "math", "math")] as const;
  }),
  ...MATH_FRACTION_COMMANDS.map((command) => mathCommandDefinition("fraction", command)),
  ...MATH_ACCENT_COMMANDS.map((command) => mathCommandDefinition("accent", command)),
  ...MATH_ALPHABET_COMMANDS.map((command) => mathCommandDefinition("alphabet", command)),
  ...MATH_LINE_COMMANDS.map((command) => mathCommandDefinition("line", command)),
  ...MATH_OPERATOR_COMMANDS.map((command) => mathCommandDefinition("operator", command)),
  ...MATH_ARROW_COMMANDS.map((command) => mathCommandDefinition("xarrow", command)),
  ...MATH_MATRIX_ENVIRONMENTS.map((environment) => mathCommandDefinition("matrix", environment)),
  ...MATH_TEXT_COMMANDS.map((command) => mathCommandDefinition("text", command)),
  ...SIMPLE_TEX_FONT_COMMAND_NAMES.map((command) => {
    const id = `text.font-command.${command}` as const;
    return [id, definition(id, ["inline-kind:font-command", `font-command:${command}`], [`font:${command}`], "text", "style")] as const;
  }),
  ...SIMPLE_TEX_FONT_DECLARATION_NAMES.map((command) => {
    const id = `text.font-declaration.${command}` as const;
    return [id, definition(id, ["inline-kind:font-declaration", `font-declaration:${command}`], [`font-declaration:${command}`], "text", "style")] as const;
  }),
  ...SIZE_DECLARATIONS.map((command) => {
    const id = `text.style-declaration.${command}` as const;
    return [id, definition(id, ["inline-kind:style-declaration"], [`style-declaration:${command}`], "text", "style")] as const;
  }),
  ...(["color", "fontsize"] as const).map((command) => {
    const id = `text.style-declaration.${command}` as const;
    return [id, definition(id, ["inline-kind:style-declaration"], [`style-declaration:${command}`], "text", "style")] as const;
  }),
  ...SIMPLE_TEX_TEXT_BOX_COMMAND_NAMES.map((command) => {
    const id = `box.text.${command}` as const;
    return [id, definition(id, ["inline-kind:mbox", `text-box-command:${command}`], [`box:${command}`], "text", "box")] as const;
  }),
  ...SIMPLE_TEX_DIMENSION_BOX_COMMAND_NAMES.map((command) => {
    const id = `box.dimension.${command}` as const;
    return [id, definition(id, ["inline-kind:dimension-box", `dimension-box-command:${command}`], [`dimension-box:${command}`], "text", "box")] as const;
  }),
  ...SIMPLE_TEX_DISPLAY_MATH_DELIMITERS.map((delimiter) => {
    const id = `math.display.${delimiter}` as const;
    return [id, definition(id, ["control-kind:display-math", `display-delimiter:${delimiter}`], [`display-math:${delimiter}`], "math", "math")] as const;
  }),
  ...ALIGNMENTS.map((command) => {
    const id = `document.alignment.${command}` as const;
    return [id, definition(id, ["control-kind:alignment"], [`alignment:${command}`], "document", "document")] as const;
  }),
  ...ENVIRONMENTS.map((name) => {
    const id = `document.environment.${name}` as const;
    return [id, definition(id, ["control-kind:environment-boundary"], [`environment:${name}`], "document", "document")] as const;
  }),
  ...VERTICAL_GLUE_COMMANDS.map((command) => {
    const id = `document.vertical-glue.${command}` as const;
    return [id, definition(id, ["control-kind:vertical-glue"], [`vertical-glue:${command}`], "document", "document")] as const;
  }),
  ...(["parbox", "minipage"] as const).map((command) => {
    const id = `document.box.${command}` as const;
    return [id, definition(id, ["control-kind:box"], [`document-box:${command}`], "document", "box")] as const;
  }),
];

export const TEX_FUZZ_FEATURE_DEFINITIONS: Readonly<Partial<Record<TexFuzzFeatureId, TexFuzzFeatureDefinition>>> = {
  ...BASE_FEATURE_DEFINITIONS,
  ...Object.fromEntries(GENERATED_FEATURE_DEFINITIONS),
};

/** Compatibility view used by drift checks and simple generator consumers. */
export const TEX_FUZZ_FEATURE_REGISTRY: Readonly<Partial<Record<TexFuzzFeatureId, readonly string[]>>> =
  Object.fromEntries(
    Object.values(TEX_FUZZ_FEATURE_DEFINITIONS).map((entry) => [entry.id, entry.productionKeys])
  );

function definition(
  id: TexFuzzFeatureId,
  productionKeys: readonly string[],
  nodeKinds: readonly string[],
  mode: TexFuzzFeatureMode,
  category: TexFuzzFeatureCategory
): TexFuzzFeatureDefinition {
  return { id, productionKeys, nodeKinds, mode, category, support: "native" };
}

function mathCommandDefinition(
  family: "fraction" | "accent" | "alphabet" | "line" | "operator" | "xarrow" | "matrix" | "text",
  command: string
): readonly [TexFuzzFeatureId, TexFuzzFeatureDefinition] {
  const id = `math.${family}.${command}` as TexFuzzFeatureId;
  return [id, definition(id, [], [`math:${family}:${command}`], "math", "math")];
}

export const TEX_FUZZ_EXPLICIT_EXCLUSIONS: Readonly<Record<string, string>> = {
  "inline-kind:includegraphics": "Requires a controlled asset resolver.",
  "inline-kind:literal": "Produced by malformed parsing rather than valid AST generation.",
  "control-kind:unsupported-command": "Used only as an oracle classification canary.",
};

export function productionTexFuzzRegistryKeys(): readonly string[] {
  return [
    ...SIMPLE_TEX_INLINE_NODE_KINDS.map((kind) => `inline-kind:${kind}`),
    ...SIMPLE_TEX_CONTROL_NODE_KINDS.map((kind) => `control-kind:${kind}`),
    ...SIMPLE_TEX_DISPLAY_MATH_DELIMITERS.map((delimiter) => `display-delimiter:${delimiter}`),
    ...SIMPLE_TEX_FONT_COMMAND_NAMES.map((name) => `font-command:${name}`),
    ...SIMPLE_TEX_FONT_DECLARATION_NAMES.map((name) => `font-declaration:${name}`),
    ...SIMPLE_TEX_TEXT_BOX_COMMAND_NAMES.map((name) => `text-box-command:${name}`),
    ...SIMPLE_TEX_DIMENSION_BOX_COMMAND_NAMES.map((name) => `dimension-box-command:${name}`),
  ].sort();
}

export function texFuzzRegistryDrift(): { readonly missing: readonly string[]; readonly staleExclusions: readonly string[] } {
  const production = new Set(productionTexFuzzRegistryKeys());
  const generated = new Set(Object.values(TEX_FUZZ_FEATURE_DEFINITIONS).flatMap((entry) => entry.productionKeys));
  const excluded = new Set(Object.keys(TEX_FUZZ_EXPLICIT_EXCLUSIONS));
  return {
    missing: [...production].filter((key) => !generated.has(key) && !excluded.has(key)).sort(),
    staleExclusions: [...excluded].filter((key) => !production.has(key)).sort(),
  };
}

export interface TexFuzzRegistryAccounting {
  readonly production: readonly string[];
  readonly generated: readonly string[];
  readonly excluded: readonly string[];
  readonly missing: readonly string[];
  readonly staleExclusions: readonly string[];
}

/** Returns the complete, reviewable partition used by the vertical drift gate. */
export function texFuzzRegistryAccounting(): TexFuzzRegistryAccounting {
  const production = productionTexFuzzRegistryKeys();
  const generated = [...new Set(
    Object.values(TEX_FUZZ_FEATURE_DEFINITIONS).flatMap((entry) => entry.productionKeys)
  )].sort();
  const excluded = Object.keys(TEX_FUZZ_EXPLICIT_EXCLUSIONS).sort();
  return { production, generated, excluded, ...texFuzzRegistryDrift() };
}
