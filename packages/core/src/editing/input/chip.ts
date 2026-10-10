import type { CommandCategory, CommandTable } from "../commands/table.js";
import type { EditMode } from "../tree/types.js";

/**
 * Completion for the command chip (R4, V2): the known commands starting
 * with the typed name, best first.
 */
export type ChipCandidate = {
  readonly name: string;
  readonly category: CommandCategory;
  /** Defined by the document (preamble or body), not built in. */
  readonly user: boolean;
};

export const CHIP_CANDIDATE_LIMIT = 8;

/**
 * `\left` and `\right` are offered with their delimiter (`\left(`), as
 * they are only ever written: the commonest first.
 */
const DELIMITER_VARIANTS: Readonly<Record<string, readonly string[]>> = {
  left: ["left(", "left[", "left\\{", "left|"],
  right: ["right)", "right]", "right\\}", "right|"],
};

/**
 * Ranking: an exact match first, then commands this buffer already uses
 * (most used first: the author's own `\ee` beats `\emph`), then commonly
 * used ones, then shorter names. `closer`: a pending `\right` (`\right)`,
 * M14), offered first wherever it matches.
 */
export function chipCandidates(table: CommandTable, mode: EditMode, prefix: string, text: string, closer?: string | null): ChipCandidate[] {
  if (prefix === "") {
    return [];
  }
  const resolved = mode === "verbatim" ? "text" : mode;
  const usage = usageCounts(text);
  const popular = resolved === "math" ? POPULAR_MATH : POPULAR_TEXT;
  // A variant counts as its command: `left(` as `left`.
  const base = (name: string) => /^(left|right)[^A-Za-z]/u.exec(name)?.[1] ?? name;
  const rank = (name: string) => {
    const index = popular.indexOf(base(name));
    return index < 0 ? popular.length : index;
  };
  const variant = (name: string) => {
    const variants = DELIMITER_VARIANTS[base(name)];
    return variants ? variants.indexOf(name) : 0;
  };
  const pending = closer?.startsWith("\\right") ? closer.slice(1) : null;
  const names = table.names(resolved).flatMap((name) => resolved === "math" ? DELIMITER_VARIANTS[name] ?? [name] : [name]);
  if (pending && !names.includes(pending)) {
    names.push(pending);
  }
  return names
    .filter((name) => name.startsWith(prefix))
    .sort((left, right) =>
      Number(right === pending) - Number(left === pending) ||
      Number(right === prefix) - Number(left === prefix) ||
      (usage.get(base(right)) ?? 0) - (usage.get(base(left)) ?? 0) ||
      rank(left) - rank(right) ||
      variant(left) - variant(right) ||
      left.length - right.length ||
      left.localeCompare(right))
    .slice(0, CHIP_CANDIDATE_LIMIT)
    .map((name) => {
      const schema = table.command(base(name), resolved)!;
      return { name, category: schema.category, user: schema.userMacro === true };
    });
}

/**
 * The name a commit writes: as typed (R1: `\foo␣` is `\foo`, shown as
 * unknown), or, when the commit accepts (⇥, ⏎), the highlighted completion
 * if there is one.
 */
export function chipCommitName(
  table: CommandTable,
  mode: EditMode,
  name: string,
  selected: number,
  text: string,
  accept: boolean,
  closer?: string | null
): string {
  if (!accept) {
    return name;
  }
  const candidates = chipCandidates(table, mode, name, text, closer);
  return candidates[Math.min(selected, candidates.length - 1)]?.name ?? name;
}

let counted: { text: string; counts: Map<string, number> } | null = null;

function usageCounts(text: string): Map<string, number> {
  if (counted?.text !== text) {
    const counts = new Map<string, number>();
    for (const match of text.matchAll(/\\([A-Za-z@]+)/gu)) {
      counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
    }
    counted = { text, counts };
  }
  return counted.counts;
}

const POPULAR_MATH = [
  "frac", "sum", "in", "le", "ge", "alpha", "beta", "lambda", "mu", "sigma", "pi", "theta", "delta", "epsilon",
  "gamma", "infty", "cdot", "times", "neq", "sqrt", "int", "mathbb", "mathcal", "text", "left", "right", "ldots",
  "cdots", "subseteq", "subset", "cup", "cap", "setminus", "forall", "exists", "to", "rightarrow", "Rightarrow",
  "mapsto", "partial", "nabla", "hat", "bar", "overline", "mathbf", "mathrm", "lim", "max", "min", "log", "exp",
  "prod", "top", "quad", "approx", "equiv", "leq", "geq", "emptyset", "phi", "varphi", "omega",
];

const POPULAR_TEXT = [
  "textbf", "emph", "textit", "alert", "texttt", "underline", "textcolor", "cite", "ref", "label", "footnote",
  "url", "href", "ldots", "LaTeX", "quad", "hspace", "vspace", "medskip", "bigskip", "pause", "only", "uncover",
  "small", "footnotesize", "tiny", "large", "centering", "includegraphics",
];
