import { SIMPLE_TEX_DISPLAY_MATH_DELIMITERS } from "@tikz-editor/core/text/tex/index.js";
import {
  TEX_FUZZ_GENERATOR_VERSION,
  TEX_FUZZ_SCHEMA_VERSION,
  type TexFuzzCase,
  type TexFuzzDimension,
  type TexFuzzDimensionBoxCommand,
  type TexFuzzEnvironment,
  type TexFuzzFeatureId,
  type TexFuzzFontCommand,
  type TexFuzzFontDeclaration,
  type TexFuzzNode,
  type TexFuzzSizeDeclaration,
} from "./model.js";
import { generateTexFuzzMathNode, texFuzzMathFeatureIds } from "./generate-math.js";
import { printTexFuzzAst } from "./print.js";
import {
  adaptTexFuzzWeights,
  pickWeightedTexFuzzValue,
  sampleTexFuzzProfileBudget,
  TEX_FUZZ_PROFILES,
} from "./profiles.js";
import { TexFuzzRandom } from "./random.js";

const WORDS = ["Alpha", "Beta", "café", "naïve", "über", "Ωmega", "façade", "coöperate"] as const;
const FONT_COMMANDS = ["textnormal", "textit", "textbf", "textmd", "textsl", "texttt", "textup", "textrm", "textsf", "textsc", "emph"] as const satisfies readonly TexFuzzFontCommand[];
const FONT_DECLARATIONS = ["normalfont", "bfseries", "mdseries", "rmfamily", "sffamily", "ttfamily", "itshape", "slshape", "upshape", "scshape", "it", "bf", "rm", "sf", "sl", "sc", "tt", "em"] as const satisfies readonly TexFuzzFontDeclaration[];
const SIZE_DECLARATIONS = ["tiny", "scriptsize", "footnotesize", "small", "normalsize", "large", "Large", "LARGE", "huge", "Huge"] as const satisfies readonly TexFuzzSizeDeclaration[];
const DIMENSION_BOX_COMMANDS = ["hphantom", "vphantom", "phantom", "smash"] as const satisfies readonly TexFuzzDimensionBoxCommand[];
const COLORS = ["red", "blue", "teal"] as const;
const MAX_DESCENDANTS_PER_ROOT = 12;

interface GenerationContext {
  readonly weights: Readonly<Partial<Record<TexFuzzFeatureId, number>>>;
  remainingDescendants: number;
}

function featureWeight(context: GenerationContext, feature: TexFuzzFeatureId): number {
  return context.weights[feature] ?? 0;
}

function featureWeightSum(context: GenerationContext, features: readonly TexFuzzFeatureId[]): number {
  return features.reduce((sum, feature) => sum + featureWeight(context, feature), 0);
}

function weightedFeature<T extends string>(
  random: TexFuzzRandom,
  path: string,
  context: GenerationContext,
  choices: readonly { readonly value: T; readonly feature: TexFuzzFeatureId }[]
): T {
  return pickWeightedTexFuzzValue(random, path, choices
    .map(({ value, feature }) => ({ value, weight: featureWeight(context, feature) }))
    .filter(({ weight }) => weight > 0));
}

function enterNode(context: GenerationContext): boolean {
  if (context.remainingDescendants <= 0) return false;
  context.remainingDescendants -= 1;
  return true;
}

function dimension(random: TexFuzzRandom, path: string, options: { readonly nonNegative?: boolean } = {}): TexFuzzDimension {
  const magnitude = random.pick(`${path}/magnitude`, [0, 1, 2, 5, 10, 25, 100, 32767] as const);
  return {
    amount: options.nonNegative === true || random.boolean(`${path}/sign`) ? magnitude : -magnitude,
    unit: random.pick(`${path}/unit`, ["pt", "em", "ex", "sp", "bp"] as const),
  };
}

function leaf(random: TexFuzzRandom, path: string): TexFuzzNode {
  switch (random.int(`${path}/leaf-kind`, 4)) {
    case 0:
      return { kind: "text", value: random.pick(`${path}/word`, WORDS) };
    case 1:
      return { kind: "accent", command: random.pick(`${path}/accent`, ["'", "`", "^"] as const), base: "e" };
    case 2:
      return { kind: "math", body: generateTexFuzzMathNode(random, `${path}/math`, 2), delimiter: random.boolean(`${path}/math-delimiter`) ? "dollar" : "paren" };
    default:
      return { kind: "space", nonBreaking: random.boolean(`${path}/tie`) };
  }
}

function inlineChildren(random: TexFuzzRandom, path: string, depth: number, context: GenerationContext): readonly TexFuzzNode[] {
  if (context.remainingDescendants <= 0) {
    return [leaf(random, `${path}/budget-leaf`)];
  }
  const count = Math.min(1 + random.int(`${path}/count`, 4), context.remainingDescendants);
  return Array.from({ length: count }, (_, index) => inlineNode(random, `${path}/${index}`, depth - 1, context));
}

function verticalSliceNode(random: TexFuzzRandom, path: string, depth: number, context: GenerationContext, allowLineBreak = true): TexFuzzNode {
  if (depth <= 0 || !enterNode(context)) return leaf(random, path);
  const candidates = [
    { value: "leaf", weight: featureWeightSum(context, ["text.literal", "text.space", "text.accent", "math.inline"]) },
    { value: "group", weight: featureWeight(context, "text.group") },
    { value: "bold", weight: featureWeight(context, "text.font-command.textbf") },
    { value: "italic", weight: featureWeight(context, "text.font-command.textit") },
    { value: "color", weight: featureWeight(context, "text.color") },
    { value: "fbox", weight: featureWeight(context, "box.text.fbox") },
    { value: "math", weight: featureWeight(context, "math.inline") },
    { value: "accent", weight: featureWeight(context, "text.accent") },
    { value: "space", weight: featureWeight(context, "text.space") },
    { value: "line-break", weight: allowLineBreak ? featureWeight(context, "text.line-break") : 0 },
    { value: "oracle", weight: featureWeight(context, "oracle.supported-command") },
  ].filter(({ weight }) => weight > 0);
  const kind = pickWeightedTexFuzzValue(random, `${path}/vertical-kind`, candidates);
  switch (kind) {
    case "leaf": return leaf(random, path);
    case "group": return { kind: "group", children: [verticalSliceNode(random, `${path}/group`, depth - 1, context, false)] };
    case "bold": return { kind: "font", command: "textbf", children: [verticalSliceNode(random, `${path}/bold`, depth - 1, context, false)] };
    case "italic": return { kind: "font", command: "textit", children: [verticalSliceNode(random, `${path}/italic`, depth - 1, context, false)] };
    case "color": return { kind: "color", color: random.pick(`${path}/color`, COLORS), children: [verticalSliceNode(random, `${path}/color-body`, depth - 1, context, false)] };
    case "fbox": return { kind: "box", command: "fbox", children: [verticalSliceNode(random, `${path}/fbox`, depth - 1, context, false)] };
    case "math": return { kind: "math", body: generateTexFuzzMathNode(random, `${path}/math`, Math.min(4, Math.max(1, depth - 1))), delimiter: random.boolean(`${path}/math-delimiter`) ? "dollar" : "paren" };
    case "accent": return { kind: "accent", command: random.pick(`${path}/accent`, ["'", "`", "^"] as const), base: "e" };
    case "space": return { kind: "space", nonBreaking: random.boolean(`${path}/tie`) };
    case "line-break": return { kind: "line-break", command: "\\", starred: false };
    case "oracle": return { kind: "oracle-command", command: "TeX" };
  }
  throw new Error(`Unhandled vertical TeX fuzz node kind ${kind}.`);
}

function inlineNode(random: TexFuzzRandom, path: string, depth: number, context: GenerationContext): TexFuzzNode {
  if (depth <= 0 || !enterNode(context)) {
    return leaf(random, path);
  }
  const kind = pickWeightedTexFuzzValue(random, `${path}/node-kind`, [
    { value: "leaf", weight: featureWeightSum(context, ["text.literal", "text.space", "text.accent"]) },
    { value: "group", weight: featureWeight(context, "text.group") },
    { value: "font", weight: featureWeightSum(context, FONT_COMMANDS.map((command) => `text.font-command.${command}` as const)) },
    { value: "font-declaration", weight: featureWeightSum(context, FONT_DECLARATIONS.map((command) => `text.font-declaration.${command}` as const)) },
    { value: "size-declaration", weight: featureWeightSum(context, SIZE_DECLARATIONS.map((command) => `text.style-declaration.${command}` as const)) },
    { value: "color-declaration", weight: featureWeight(context, "text.style-declaration.color") },
    { value: "fontsize", weight: featureWeight(context, "text.style-declaration.fontsize") },
    { value: "color", weight: featureWeight(context, "text.color") },
    { value: "natural-box", weight: featureWeightSum(context, (["underline", "mbox", "fbox", "llap", "rlap"] as const).map((command) => `box.text.${command}` as const)) },
    { value: "sized-box", weight: featureWeightSum(context, ["box.text.makebox", "box.text.framebox"]) },
    { value: "colorbox", weight: featureWeight(context, "box.text.colorbox") },
    { value: "fcolorbox", weight: featureWeight(context, "box.text.fcolorbox") },
    { value: "dimension-box", weight: featureWeightSum(context, DIMENSION_BOX_COMMANDS.map((command) => `box.dimension.${command}` as const)) },
    { value: "raisebox", weight: featureWeight(context, "box.raisebox") },
    { value: "rule", weight: featureWeight(context, "box.rule") },
    { value: "math", weight: featureWeight(context, "math.inline") },
    { value: "accent", weight: featureWeight(context, "text.accent") },
    { value: "line-break", weight: featureWeight(context, "text.line-break") },
  ].filter(({ weight }) => weight > 0));
  switch (kind) {
    case "leaf": return leaf(random, path);
    case "group": return { kind: "group", children: inlineChildren(random, `${path}/group`, depth, context) };
    case "font": {
      const command = weightedFeature(random, `${path}/font-command`, context, FONT_COMMANDS.map((value) => ({ value, feature: `text.font-command.${value}` as const })));
      return { kind: "font", command, children: inlineChildren(random, `${path}/font`, depth, context) };
    }
    case "font-declaration": {
      const command = weightedFeature(random, `${path}/font-declaration`, context, FONT_DECLARATIONS.map((value) => ({ value, feature: `text.font-declaration.${value}` as const })));
      return { kind: "font-declaration", command, children: inlineChildren(random, `${path}/font-declaration-body`, depth, context) };
    }
    case "size-declaration": {
      const command = weightedFeature(random, `${path}/size-command`, context, SIZE_DECLARATIONS.map((value) => ({ value, feature: `text.style-declaration.${value}` as const })));
      return { kind: "style-declaration", command, children: inlineChildren(random, `${path}/size-body`, depth, context) };
    }
    case "color-declaration": return { kind: "style-declaration", command: "color", color: random.pick(`${path}/declaration-color`, COLORS), children: inlineChildren(random, `${path}/color-declaration-body`, depth, context) };
    case "fontsize":
      return {
        kind: "style-declaration",
        command: "fontsize",
        size: dimension(random, `${path}/font-size`, { nonNegative: true }),
        baselineSkip: dimension(random, `${path}/baseline-skip`, { nonNegative: true }),
        children: inlineChildren(random, `${path}/fontsize-body`, depth, context),
      };
    case "color": return { kind: "color", color: random.pick(`${path}/color-name`, COLORS), children: inlineChildren(random, `${path}/color`, depth, context) };
    case "natural-box": {
      const commands = ["underline", "mbox", "fbox", "llap", "rlap"] as const;
      const command = weightedFeature(random, `${path}/natural-box`, context, commands.map((value) => ({ value, feature: `box.text.${value}` as const })));
      return { kind: "box", command, children: inlineChildren(random, `${path}/box`, depth, context) };
    }
    case "sized-box": {
      const width = random.boolean(`${path}/box-width`)
        ? dimension(random, `${path}/width`, { nonNegative: true })
        : undefined;
      const command = weightedFeature(random, `${path}/sized-box-command`, context, [
        { value: "makebox", feature: "box.text.makebox" },
        { value: "framebox", feature: "box.text.framebox" },
      ] as const);
      return {
        kind: "box",
        command,
        width,
        alignment: width ? random.pick(`${path}/box-alignment`, ["l", "c", "r", "s"] as const) : undefined,
        children: inlineChildren(random, `${path}/sized-box`, depth, context),
      };
    }
    case "colorbox":
      return {
        kind: "box",
        command: "colorbox",
        backgroundColor: random.pick(`${path}/background`, COLORS),
        children: inlineChildren(random, `${path}/colorbox`, depth, context),
      };
    case "fcolorbox":
      return {
        kind: "box",
        command: "fcolorbox",
        frameColor: random.pick(`${path}/frame`, COLORS),
        backgroundColor: random.pick(`${path}/background`, COLORS),
        children: inlineChildren(random, `${path}/fcolorbox`, depth, context),
      };
    case "dimension-box": {
      const command = weightedFeature(random, `${path}/dimension-box`, context, DIMENSION_BOX_COMMANDS.map((value) => ({ value, feature: `box.dimension.${value}` as const })));
      return { kind: "dimension-box", command, children: inlineChildren(random, `${path}/dimension-box-body`, depth, context) };
    }
    case "raisebox":
      return {
        kind: "raisebox",
        lift: dimension(random, `${path}/lift`),
        height: random.boolean(`${path}/height-present`) ? dimension(random, `${path}/height`) : undefined,
        depth: random.boolean(`${path}/depth-present`) ? dimension(random, `${path}/depth`) : undefined,
        children: inlineChildren(random, `${path}/raise-body`, depth, context),
      };
    case "rule": return { kind: "rule", raise: random.boolean(`${path}/raise-present`) ? dimension(random, `${path}/raise`) : undefined, width: dimension(random, `${path}/rule-width`, { nonNegative: true }), height: dimension(random, `${path}/rule-height`, { nonNegative: true }) };
    case "math": return { kind: "math", body: generateTexFuzzMathNode(random, `${path}/math`, Math.min(4, Math.max(1, depth - 1))), delimiter: random.boolean(`${path}/math-delimiter`) ? "dollar" : "paren" };
    case "accent": return { kind: "accent", command: random.pick(`${path}/accent`, ["'", "`", "^"] as const), base: "e" };
    case "line-break":
      return random.boolean(`${path}/linebreak-kind`)
        ? { kind: "line-break", command: "\\", starred: random.boolean(`${path}/linebreak-star`), leading: random.boolean(`${path}/line-leading`) ? dimension(random, `${path}/leading`) : undefined }
        : { kind: "line-break", command: random.boolean(`${path}/linebreak-control`) ? "newline" : "linebreak", priority: random.pick(`${path}/linebreak-priority`, [0, 1, 2, 3, 4] as const) };
  }
  throw new Error(`Unhandled inline TeX fuzz node kind ${kind}.`);
}

function listEnvironmentChildren(random: TexFuzzRandom, path: string, depth: number, context: GenerationContext): readonly TexFuzzNode[] {
  const count = 1 + random.int(`${path}/items`, 3);
  return Array.from({ length: count }, (_, index) => [
    // OT1 list-label attachment metrics currently accept only the encoded
    // label repertoire; Unicode prose remains exercised in the item body.
    { kind: "item", label: random.boolean(`${path}/label-${index}`) ? [{ kind: "text", value: "Label" }] : undefined } satisfies TexFuzzNode,
    ...inlineChildren(random, `${path}/item-body-${index}`, depth, context),
  ]).flat();
}

function documentNode(random: TexFuzzRandom, path: string, depth: number, context: GenerationContext): TexFuzzNode {
  enterNode(context);
  const alignments = ["centering", "raggedright", "raggedleft"] as const;
  const environments = ["quote", "quotation", "center", "flushleft", "flushright", "itemize", "enumerate", "description"] as const satisfies readonly TexFuzzEnvironment[];
  const displayDelimiters = SIMPLE_TEX_DISPLAY_MATH_DELIMITERS;
  const kind = pickWeightedTexFuzzValue(random, `${path}/document-kind`, [
    { value: "inline", weight: featureWeightSum(context, ["text.literal", "text.group", "math.inline"]) },
    { value: "paragraph-break", weight: featureWeight(context, "document.paragraph-break") },
    { value: "noindent", weight: featureWeight(context, "document.noindent") },
    { value: "alignment", weight: featureWeightSum(context, alignments.map((command) => `document.alignment.${command}` as const)) },
    { value: "environment", weight: featureWeightSum(context, environments.map((name) => `document.environment.${name}` as const)) },
    { value: "preset-glue", weight: featureWeightSum(context, ["document.vertical-glue.smallskip", "document.vertical-glue.medskip", "document.vertical-glue.bigskip", "document.vertical-glue.vfill"]) },
    { value: "vspace", weight: featureWeight(context, "document.vertical-glue.vspace") },
    { value: "vskip", weight: featureWeight(context, "document.vertical-glue.vskip") },
    { value: "penalty", weight: featureWeight(context, "document.penalty") },
    { value: "vertical-rule", weight: featureWeight(context, "document.vertical-rule") },
    { value: "parbox", weight: featureWeight(context, "document.box.parbox") },
    { value: "minipage", weight: featureWeight(context, "document.box.minipage") },
    { value: "display-math", weight: featureWeightSum(context, displayDelimiters.map((delimiter) => `math.display.${delimiter}` as const)) },
  ].filter(({ weight }) => weight > 0));
  switch (kind) {
    case "inline": return inlineNode(random, `${path}/inline`, depth, context);
    case "paragraph-break": return { kind: "paragraph-break", command: random.boolean(`${path}/paragraph-kind`) ? "par" : "blank-line" };
    case "noindent": return { kind: "noindent" };
    case "alignment": {
      const command = weightedFeature(random, `${path}/alignment`, context, alignments.map((value) => ({ value, feature: `document.alignment.${value}` as const })));
      return { kind: "alignment", command };
    }
    case "environment": {
      const name = weightedFeature(random, `${path}/environment-name`, context, environments.map((value) => ({ value, feature: `document.environment.${value}` as const })));
      return {
        kind: "environment",
        name,
        children: name === "itemize" || name === "enumerate" || name === "description"
          ? listEnvironmentChildren(random, `${path}/list`, Math.max(1, depth - 1), context)
          : inlineChildren(random, `${path}/environment-body`, Math.max(1, depth - 1), context),
      };
    }
    case "preset-glue": {
      const commands = ["smallskip", "medskip", "bigskip", "vfill"] as const;
      const command = weightedFeature(random, `${path}/preset-glue`, context, commands.map((value) => ({ value, feature: `document.vertical-glue.${value}` as const })));
      return { kind: "vertical-glue", command };
    }
    case "vspace": return { kind: "vertical-glue", command: "vspace", starred: random.boolean(`${path}/vspace-star`), size: dimension(random, `${path}/vspace`) };
    case "vskip": return { kind: "vertical-glue", command: "vskip", size: dimension(random, `${path}/vskip`) };
    case "penalty": return { kind: "penalty", value: random.pick(`${path}/penalty`, [-10000, -50, 0, 50, 10000] as const) };
    case "vertical-rule":
      return {
        kind: "vertical-rule",
        width: random.boolean(`${path}/vrule-width`) ? dimension(random, `${path}/vrule-width-value`, { nonNegative: true }) : undefined,
        height: random.boolean(`${path}/vrule-height`) ? dimension(random, `${path}/vrule-height-value`, { nonNegative: true }) : undefined,
        depth: random.boolean(`${path}/vrule-depth`) ? dimension(random, `${path}/vrule-depth-value`) : undefined,
      };
    case "parbox":
      return {
        kind: "document-box",
        command: "parbox",
        position: random.pick(`${path}/parbox-position`, ["t", "c", "b"] as const),
        width: dimension(random, `${path}/parbox-width`, { nonNegative: true }),
        children: inlineChildren(random, `${path}/parbox-body`, Math.max(1, depth - 1), context),
      };
    case "minipage":
      return {
        kind: "document-box",
        command: "minipage",
        position: random.pick(`${path}/minipage-position`, ["t", "c", "b"] as const),
        width: dimension(random, `${path}/minipage-width`, { nonNegative: true }),
        children: inlineChildren(random, `${path}/minipage-body`, Math.max(1, depth - 1), context),
      };
    case "display-math": {
      const delimiter = weightedFeature(random, `${path}/display-delimiter`, context, displayDelimiters.map((value) => ({ value, feature: `math.display.${value}` as const })));
      return {
        kind: "display-math",
        delimiter,
        body: generateTexFuzzMathNode(random, `${path}/display-content`, Math.min(4, Math.max(1, depth - 1))),
      };
    }
  }
  throw new Error(`Unhandled document TeX fuzz node kind ${kind}.`);
}

function nodeFeatures(node: TexFuzzNode, features: Set<TexFuzzFeatureId>): void {
  switch (node.kind) {
    case "text": features.add("text.literal"); break;
    case "space": features.add("text.space"); break;
    case "group": features.add("text.group"); break;
    case "font":
      features.add(`text.font-command.${node.command}`);
      if (node.command === "textbf") features.add("text.bold");
      if (node.command === "textit") features.add("text.italic");
      break;
    case "font-declaration": features.add(`text.font-declaration.${node.command}`); break;
    case "style-declaration": features.add(`text.style-declaration.${node.command}`); break;
    case "color": features.add("text.color"); break;
    case "accent": features.add("text.accent"); break;
    case "math":
      features.add("math.inline");
      if (node.body) texFuzzMathFeatureIds(node.body).forEach((feature) => { features.add(feature); });
      break;
    case "display-math":
      features.add(`math.display.${node.delimiter}`);
      if (node.body) texFuzzMathFeatureIds(node.body).forEach((feature) => { features.add(feature); });
      break;
    case "line-break": features.add("text.line-break"); break;
    case "box":
      features.add(`box.text.${node.command}`);
      if (node.command === "fbox") features.add("box.fbox");
      break;
    case "dimension-box": features.add(`box.dimension.${node.command}`); break;
    case "raisebox": features.add("box.raisebox"); break;
    case "rule": features.add("box.rule"); break;
    case "paragraph-break": features.add("document.paragraph-break"); break;
    case "noindent": features.add("document.noindent"); break;
    case "alignment": features.add(`document.alignment.${node.command}`); break;
    case "environment": features.add(`document.environment.${node.name}`); break;
    case "item": features.add("document.item"); break;
    case "vertical-glue": features.add(`document.vertical-glue.${node.command}`); break;
    case "penalty": features.add("document.penalty"); break;
    case "vertical-rule": features.add("document.vertical-rule"); break;
    case "document-box": features.add(`document.box.${node.command}`); break;
    case "oracle-command": features.add("oracle.supported-command"); break;
  }
  if ("children" in node) {
    node.children.forEach((child) => {
      nodeFeatures(child, features);
    });
  }
  if (node.kind === "item" && node.label) {
    node.label.forEach((child) => {
      nodeFeatures(child, features);
    });
  }
}

export function caseFromTexFuzzAst(
  ast: readonly TexFuzzNode[],
  options: { readonly seed?: number; readonly profile?: TexFuzzCase["profile"]; readonly choices?: TexFuzzCase["choices"] } = {}
): TexFuzzCase {
  const printed = printTexFuzzAst(ast);
  const features = new Set<TexFuzzFeatureId>();
  ast.forEach((item) => {
    nodeFeatures(item, features);
  });
  return {
    schemaVersion: TEX_FUZZ_SCHEMA_VERSION,
    generatorVersion: TEX_FUZZ_GENERATOR_VERSION,
    seed: options.seed ?? 0,
    profile: options.profile ?? "canary",
    ast,
    source: printed.source,
    sourceMap: printed.sourceMap,
    choices: options.choices ?? [],
    features: [...features].sort(),
    mutations: [],
  };
}

export function generateTexFuzzCase(
  seed: number,
  options: {
    readonly depth?: number;
    readonly size?: number;
    readonly profile?: TexFuzzCase["profile"];
    /** Prior feature counts; when supplied, rarer features receive a deterministic novelty boost. */
    readonly coverageFeedback?: Readonly<Record<string, number>>;
    readonly adaptiveNoveltyBudget?: number;
  } = {}
): TexFuzzCase {
  const random = new TexFuzzRandom(seed);
  const profileId = options.profile ?? "aggressive";
  const profile = TEX_FUZZ_PROFILES[profileId];
  const size = options.size ?? sampleTexFuzzProfileBudget(random, "budget/size", profile.size);
  const depth = options.depth ?? sampleTexFuzzProfileBudget(random, "budget/depth", profile.depth);
  if (!Number.isSafeInteger(size) || size < 1 || size > profile.size.maximum) {
    throw new RangeError(`TeX fuzz size ${size} exceeds profile ${profileId} bounds.`);
  }
  if (!Number.isSafeInteger(depth) || depth < 1 || depth > profile.depth.maximum) {
    throw new RangeError(`TeX fuzz depth ${depth} exceeds profile ${profileId} bounds.`);
  }
  const weights = options.coverageFeedback === undefined
    ? profile.weights
    : adaptTexFuzzWeights(
      profile.weights as Readonly<Record<TexFuzzFeatureId, number>>,
      options.coverageFeedback,
      { noveltyBudget: options.adaptiveNoveltyBudget }
    );
  const ast = Array.from({ length: size }, (_, index) => {
    const context: GenerationContext = { weights, remainingDescendants: MAX_DESCENDANTS_PER_ROOT };
    return profileId === "document"
      ? documentNode(random, `root/${index}`, depth, context)
        : profileId === "vertical-slice" || profileId === "canary"
        ? verticalSliceNode(random, `root/${index}`, depth, context, true)
        : inlineNode(random, `root/${index}`, depth, context);
  });
  return caseFromTexFuzzAst(ast, { seed, profile: profileId, choices: random.choices() });
}

export function differentialCanaryCase(): TexFuzzCase {
  return caseFromTexFuzzAst([
    { kind: "text", value: "Alpha" },
    { kind: "space", nonBreaking: false },
    { kind: "group", children: [{ kind: "oracle-command", command: "TeX" }] },
    { kind: "space", nonBreaking: false },
    { kind: "text", value: "Omega" },
  ]);
}
