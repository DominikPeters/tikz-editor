import type { Span } from "../ast/types.js";
import type { BeamerControlSequence, BeamerSyntaxContext } from "./syntax.js";

/**
 * User environments that are a known environment under another name:
 * `\newenvironment{wideitemize}{\itemize\addtolength{\itemsep}{10pt}}{\enditemize}`
 * is an itemize. Classified by what the definition does, like K1's macro
 * classes, with no per-name configuration: the begin part must open
 * exactly one list and the end part close it, with nothing else visible
 * around them (spacing and label settings only, which the alias does not
 * reproduce). Anything else stays an environment the editor and the
 * preview do not know.
 */
export type BeamerEnvironmentAliasModel = {
  readonly kind: "environment-alias";
  /** The user environment. */
  readonly name: string;
  /** The environment it stands for. */
  readonly target: AliasTarget;
  readonly span: Span;
};

const TARGETS = ["itemize", "enumerate", "description"] as const;
type AliasTarget = (typeof TARGETS)[number];

/** Settings a definition may make around the list: lengths, label commands, and `\relax`/`\par`. */
const SETTING = new RegExp([
  String.raw`\\(?:setlength|addtolength)\s*\{?\\[A-Za-z@]+\}?\s*\{[^{}]*\}`,
  String.raw`\\(?:renewcommand|def)\s*\{?\\[A-Za-z@]+\}?\s*\{(?:[^{}]|\{[^{}]*\})*\}`,
  String.raw`\\(?:relax|par)(?![A-Za-z@])`,
  String.raw`%[^\n]*`,
].join("|"), "gu");

/** The list a definition's begin and end parts open and close, or null. */
export function environmentAliasTarget(begin: string, end: string): AliasTarget | null {
  const strip = (part: string) => part.replace(SETTING, "").replace(/\s+/gu, "");
  const opened = /^\\(?:begin\{([a-z]+)\}|([a-z]+))$/u.exec(strip(begin));
  const target = opened?.[1] ?? opened?.[2];
  if (!target || !(TARGETS as readonly string[]).includes(target)) {
    return null;
  }
  const closed = strip(end);
  return closed === `\\end{${target}}` || closed === `\\end${target}` ? target as AliasTarget : null;
}

/**
 * `\newenvironment` (and `\renewenvironment`) definitions without
 * parameters that are aliases. Their parts are read as plain brace groups:
 * a list opened in one and closed in the other is not a syntax tree's
 * environment.
 */
export function scanBeamerEnvironmentAliases(
  context: BeamerSyntaxContext,
  controls: readonly BeamerControlSequence[],
  limit: number,
  excludedSpans: readonly Span[]
): BeamerEnvironmentAliasModel[] {
  const { source } = context;
  const aliases: BeamerEnvironmentAliasModel[] = [];
  for (const command of controls) {
    if ((command.name !== "newenvironment" && command.name !== "renewenvironment") ||
      excludedSpans.some((span) => command.from >= span.from && command.from < span.to)) {
      continue;
    }
    const name = groupAfter(source, command.to, limit);
    // With parameters (`[1]`), the arguments go somewhere the alias would not show.
    const begin = name && /^[A-Za-z]+$/u.test(name.value) ? groupAfter(source, name.to, limit) : null;
    const end = begin ? groupAfter(source, begin.to, limit) : null;
    const target = begin && end ? environmentAliasTarget(begin.value, end.value) : null;
    if (name && target) {
      aliases.push({ kind: "environment-alias", name: name.value, target, span: { from: command.from, to: end!.to } });
    }
  }
  return aliases;
}

/** The brace group after `from` (past spaces and comments): its content and end. */
function groupAfter(source: string, from: number, limit: number): { value: string; to: number } | null {
  let at = from;
  while (at < limit && (/\s/u.test(source[at]) || source[at] === "%")) {
    const line = source[at] === "%" ? source.indexOf("\n", at) : at;
    at = line < 0 ? limit : line + 1;
  }
  if (source[at] !== "{") {
    return null;
  }
  let depth = 0;
  for (let index = at; index < limit; index += 1) {
    const char = source[index];
    if (char === "\\") {
      index += 1;
    } else if (char === "%") {
      const line = source.indexOf("\n", index);
      index = line === -1 ? limit : line;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return { value: source.slice(at + 1, index).trim(), to: index + 1 };
      }
    }
  }
  return null;
}

/** The aliases in effect: name to target. */
export function beamerEnvironmentAliasMap(aliases: readonly BeamerEnvironmentAliasModel[]): ReadonlyMap<string, AliasTarget> {
  return new Map(aliases.map((alias) => [alias.name, alias.target]));
}
