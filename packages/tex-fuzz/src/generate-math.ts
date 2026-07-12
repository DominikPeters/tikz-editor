import type {
  TexFuzzChoice,
  TexFuzzCase,
  TexFuzzFeatureId,
  TexFuzzMathAccentCommand,
  TexFuzzMathAlphabetCommand,
  TexFuzzMathNode,
  TexFuzzMutation,
} from "./model.js";
import { TEX_FUZZ_GENERATOR_VERSION, TEX_FUZZ_SCHEMA_VERSION } from "./model.js";
import { mutateTexFuzzCase } from "./mutate.js";
import { printTexFuzzAst, printTexFuzzMathAst } from "./print.js";
import { TexFuzzRandom } from "./random.js";

export interface GeneratedTexMathFuzzCase {
  readonly seed: number;
  readonly source: string;
  readonly features: readonly string[];
  readonly choices: readonly TexFuzzChoice[];
  readonly malformed: boolean;
}

const ATOMS = ["x", "y", "z", "a", "b", "1", "2", "\\alpha", "\\beta", "\\infty", "\\partial", "\\ell"] as const;
const INFIX = ["+", "-", "=", "\\cdot", "\\leq", "\\to"] as const;
const ACCENTS = ["hat", "bar", "tilde", "vec", "dot", "ddot", "widehat", "widetilde"] as const satisfies readonly TexFuzzMathAccentCommand[];
const ALPHABETS = ["mathrm", "mathbf", "mathit", "mathsf", "mathtt", "mathcal", "mathbb", "mathfrak", "boldsymbol"] as const satisfies readonly TexFuzzMathAlphabetCommand[];
const OPERATORS = ["sum", "prod", "int", "lim", "bigcup", "bigcap"] as const;
const DELIMITERS = [["(", ")"], ["[", "]"], ["\\langle", "\\rangle"], ["\\lbrace", "\\rbrace"], ["|", "|"]] as const;

export function generateTexFuzzMathNode(random: TexFuzzRandom, path: string, depth: number): TexFuzzMathNode {
  if (depth <= 0) {
    return { kind: "atom", value: random.pick(`${path}/atom`, ATOMS) };
  }
  switch (random.int(`${path}/kind`, 15)) {
    case 0:
      return { kind: "atom", value: random.pick(`${path}/atom`, ATOMS) };
    case 1:
      return { kind: "group", body: generateTexFuzzMathNode(random, `${path}/group`, depth - 1) };
    case 2: {
      const count = 2 + random.int(`${path}/sequence-count`, 3);
      return {
        kind: "sequence",
        items: Array.from({ length: count }, (_, index) => generateTexFuzzMathNode(random, `${path}/item-${index}`, depth - 1)),
        operators: Array.from({ length: count - 1 }, (_, index) => random.pick(`${path}/operator-${index}`, INFIX)),
      };
    }
    case 3:
      return {
        kind: "fraction",
        command: random.pick(`${path}/fraction-command`, ["frac", "dfrac", "tfrac", "binom"] as const),
        numerator: generateTexFuzzMathNode(random, `${path}/numerator`, depth - 1),
        denominator: generateTexFuzzMathNode(random, `${path}/denominator`, depth - 1),
      };
    case 4:
      return {
        kind: "radical",
        degree: random.boolean(`${path}/has-degree`) ? generateTexFuzzMathNode(random, `${path}/degree`, depth - 1) : undefined,
        body: generateTexFuzzMathNode(random, `${path}/radicand`, depth - 1),
      };
    case 5: {
      const scriptMode = random.int(`${path}/script-mode`, 3);
      return {
        kind: "script",
        base: generateTexFuzzMathNode(random, `${path}/base`, depth - 1),
        subscript: scriptMode !== 1 ? generateTexFuzzMathNode(random, `${path}/subscript`, depth - 1) : undefined,
        superscript: scriptMode !== 0 ? generateTexFuzzMathNode(random, `${path}/superscript`, depth - 1) : undefined,
      };
    }
    case 6:
      return { kind: "accent", command: random.pick(`${path}/accent-command`, ACCENTS), body: generateTexFuzzMathNode(random, `${path}/accent-body`, depth - 1) };
    case 7:
      return { kind: "alphabet", command: random.pick(`${path}/alphabet-command`, ALPHABETS), body: generateTexFuzzMathNode(random, `${path}/alphabet-body`, depth - 1) };
    case 8:
      return {
        kind: "line",
        command: random.pick(`${path}/line-command`, ["overline", "underline", "overbrace", "underbrace"] as const),
        body: generateTexFuzzMathNode(random, `${path}/line-body`, depth - 1),
      };
    case 9: {
      const delimiter = random.pick(`${path}/delimiter`, DELIMITERS);
      return { kind: "left-right", left: delimiter[0], right: delimiter[1], body: generateTexFuzzMathNode(random, `${path}/delimited-body`, depth - 1) };
    }
    case 10:
      return {
        kind: "operator",
        command: random.pick(`${path}/operator-command`, OPERATORS),
        script: random.boolean(`${path}/operator-script`) ? generateTexFuzzMathNode(random, `${path}/operator-limit`, depth - 1) : undefined,
      };
    case 11:
      return { kind: "stackrel", above: generateTexFuzzMathNode(random, `${path}/stack-above`, depth - 1), body: generateTexFuzzMathNode(random, `${path}/stack-body`, depth - 1) };
    case 12:
      return {
        kind: "xarrow",
        command: random.pick(`${path}/arrow-command`, ["xleftarrow", "xrightarrow"] as const),
        below: random.boolean(`${path}/arrow-below`) ? generateTexFuzzMathNode(random, `${path}/arrow-below-body`, depth - 1) : undefined,
        above: generateTexFuzzMathNode(random, `${path}/arrow-above`, depth - 1),
      };
    case 13: {
      const environment = random.pick(`${path}/matrix-environment`, ["matrix", "pmatrix", "bmatrix", "smallmatrix", "cases"] as const);
      const rowCount = 1 + random.int(`${path}/rows`, 3);
      const columnCount = environment === "cases" ? 2 : 1 + random.int(`${path}/columns`, 3);
      return {
        kind: "matrix",
        environment,
        cells: Array.from({ length: rowCount }, (_, row) =>
          Array.from({ length: columnCount }, (_, column) => generateTexFuzzMathNode(random, `${path}/cell-${row}-${column}`, Math.min(1, depth - 1)))
        ),
      };
    }
    default:
      return {
        kind: "text",
        command: random.pick(`${path}/text-command`, ["text", "mathrm", "mathbf"] as const),
        value: random.pick(`${path}/text-value`, ["if", "rank", "office", "A B"] as const),
      };
  }
}

function collectMathFeatures(node: TexFuzzMathNode, features: Set<string>, registered?: Set<TexFuzzFeatureId>): void {
  features.add(`math.${node.kind}`);
  registered?.add(`math.node.${node.kind}`);
  switch (node.kind) {
    case "atom": break;
    case "group": collectMathFeatures(node.body, features, registered); break;
    case "sequence": node.items.forEach((item) => { collectMathFeatures(item, features, registered); }); break;
    case "fraction":
      features.add(`math.fraction.${node.command}`);
      registered?.add(`math.fraction.${node.command}`);
      collectMathFeatures(node.numerator, features, registered);
      collectMathFeatures(node.denominator, features, registered);
      break;
    case "radical":
      if (node.degree) collectMathFeatures(node.degree, features, registered);
      collectMathFeatures(node.body, features, registered);
      break;
    case "script":
      collectMathFeatures(node.base, features, registered);
      if (node.subscript) collectMathFeatures(node.subscript, features, registered);
      if (node.superscript) collectMathFeatures(node.superscript, features, registered);
      break;
    case "accent":
      features.add(`math.accent.${node.command}`);
      registered?.add(`math.accent.${node.command}`);
      collectMathFeatures(node.body, features, registered);
      break;
    case "alphabet":
      features.add(`math.alphabet.${node.command}`);
      registered?.add(`math.alphabet.${node.command}`);
      collectMathFeatures(node.body, features, registered);
      break;
    case "line":
      registered?.add(`math.line.${node.command}`);
      collectMathFeatures(node.body, features, registered);
      break;
    case "left-right": collectMathFeatures(node.body, features, registered); break;
    case "operator":
      registered?.add(`math.operator.${node.command}`);
      if (node.script) collectMathFeatures(node.script, features, registered);
      break;
    case "stackrel":
      collectMathFeatures(node.above, features, registered);
      collectMathFeatures(node.body, features, registered);
      break;
    case "xarrow":
      registered?.add(`math.xarrow.${node.command}`);
      if (node.below) collectMathFeatures(node.below, features, registered);
      collectMathFeatures(node.above, features, registered);
      break;
    case "matrix":
      registered?.add(`math.matrix.${node.environment}`);
      node.cells.flat().forEach((cell) => { collectMathFeatures(cell, features, registered); });
      break;
    case "text": registered?.add(`math.text.${node.command}`); break;
  }
}

export function texFuzzMathFeatureIds(node: TexFuzzMathNode): readonly TexFuzzFeatureId[] {
  const registered = new Set<TexFuzzFeatureId>();
  collectMathFeatures(node, new Set(), registered);
  return [...registered].sort();
}

function damageMathMutation(random: TexFuzzRandom, source: string, offset = 0): TexFuzzMutation {
  switch (random.int("malformed/damage", 5)) {
    case 0: return { kind: "delete", start: offset + random.int("malformed/truncate", source.length + 1), end: offset + source.length };
    case 1: return { kind: "insert", offset: offset + source.length, text: "}" };
    case 2: return { kind: "insert", offset, text: "{" };
    case 3: return { kind: "insert", offset: offset + source.length, text: "^" };
    default: {
      const begin = source.indexOf("\\begin");
      return begin >= 0
        ? { kind: "replace", start: offset + begin, end: offset + begin + "\\begin".length, text: "\\begun" }
        : { kind: "insert", offset: offset + source.length, text: "\\begin{matrix}" };
    }
  }
}

/** Generate one recursive formula inside the normal versioned/replayable shared case envelope. */
export function generateTexMathFuzzTexCase(
  seed: number,
  options: { readonly depth?: number; readonly malformed?: boolean } = {}
): TexFuzzCase {
  const random = new TexFuzzRandom(seed);
  const body = generateTexFuzzMathNode(random, "math", options.depth ?? 4);
  const ast = [{ kind: "math", body, delimiter: "dollar" } as const];
  const printed = printTexFuzzAst(ast);
  const validCase: TexFuzzCase = {
    schemaVersion: TEX_FUZZ_SCHEMA_VERSION,
    generatorVersion: TEX_FUZZ_GENERATOR_VERSION,
    seed,
    profile: options.malformed === true ? "malformed" : "aggressive",
    ast,
    source: printed.source,
    sourceMap: printed.sourceMap,
    choices: random.choices(),
    features: (["math.inline", ...texFuzzMathFeatureIds(body)] satisfies TexFuzzFeatureId[]).sort(),
    mutations: [],
  };
  if (options.malformed !== true) return validCase;
  const formula = printTexFuzzMathAst(body).source;
  const damaged = mutateTexFuzzCase(validCase, damageMathMutation(random, formula, 1));
  return { ...damaged, choices: random.choices() };
}

export function generateTexMathFuzzCase(
  seed: number,
  options: { readonly depth?: number; readonly malformed?: boolean } = {}
): GeneratedTexMathFuzzCase {
  const sharedCase = generateTexMathFuzzTexCase(seed, options);
  const rootNode = sharedCase.ast[0];
  if (rootNode?.kind !== "math" || !rootNode.body) {
    throw new Error("Shared math fuzz case did not contain a recursive inline math root.");
  }
  const features = new Set<string>();
  collectMathFeatures(rootNode.body, features);
  const malformed = options.malformed ?? false;
  return {
    seed,
    source: sharedCase.source.slice(1, -1),
    features: [...features].sort(),
    choices: sharedCase.choices,
    malformed,
  };
}
