import { beamerNamedFontSizes, beamerTrivlistSpacing } from "./theme/font-sizes.js";
import type { ResolvedBeamerTheme } from "./theme/types.js";
import type { Diagnostic } from "../diagnostics/types.js";
import { concatMappedText, createGeneratedMappedText, projectInputRange, sliceMappedText, type MappedText } from "../text/source-map.js";
import { createBeamerSyntaxContext } from "./syntax.js";
import { matchTexSyntaxEnvironments } from "../text/tex/syntax-index.js";

/** Comma-separated package keys, with brace-owned styles kept intact. */
export function packageOptions(raw: string): Map<string, string> {
  const result = new Map<string, string>(); let depth = 0, start = 0;
  for (let i = 0; i <= raw.length; i++) {
    if (raw[i] === "{") depth++; else if (raw[i] === "}") depth--;
    if (i === raw.length || (raw[i] === "," && depth === 0)) {
      const part = raw.slice(start, i).trim(), equal = part.indexOf("=");
      if (part) result.set(equal < 0 ? part : part.slice(0, equal).trim(), equal < 0 ? "true" : part.slice(equal + 1).trim().replace(/^\{(.*)\}$/su, "$1"));
      start = i + 1;
    }
  }
  return result;
}
const pythonKeywords = new Set("False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield".split(" "));
const allowed = new Set(["basicstyle", "keywordstyle", "commentstyle", "stringstyle", "language", "columns", "keepspaces", "tabsize", "showstringspaces"]);

/** Lower exact source characters into unbreakable TT lines. alltt retains
 * TeX control sequences and groups; listings treats them as literal code. */
export function projectBeamerPreformatted(mapped: MappedText, source: string, diagnostics: Diagnostic[], theme?: ResolvedBeamerTheme, surroundingFont?: { sizePt: number; lineHeightPt: number }): MappedText {
  if (!/\\begin\s*\{(?:lstlisting|alltt)\}/u.test(mapped.text)) return mapped;
  const { syntax } = createBeamerSyntaxContext(mapped.text);
  const document = createBeamerSyntaxContext(source).syntax;
  const scopes = [...document.groups, ...matchTexSyntaxEnvironments(document).values()];
  const pieces: MappedText[] = []; let cursor = 0;
  for (const env of matchTexSyntaxEnvironments(syntax).values()) {
    if (!["lstlisting", "alltt"].includes(env.name) || env.span.from < cursor) continue;
    const hit = projectInputRange(mapped.sourceMap, env.span.from, env.span.to);
    const owner = hit.kind === "source-range" ? { from: hit.from, to: hit.to } : { from: 0, to: 0 };
    const generated = (text: string, from?: number, to?: number) => {
      const hit = from !== undefined && to !== undefined ? projectInputRange(mapped.sourceMap, from, to) : null;
      return createGeneratedMappedText(text, "Beamer preformatted text", hit?.kind === "source-range" ? { from: hit.from, to: hit.to } : owner);
    };
    const configuredPackage = env.name === "lstlisting" && document.controls.some(command => {
      if (command.name !== "usepackage" && command.name !== "RequirePackage") return false;
      const option = document.argumentAfter(command.span.to, "optional", source.length);
      const names = option && document.argumentAfter(option.span.to, "required", source.length);
      return names != null && source.slice(names.contentSpan.from, names.contentSpan.to).split(",").some(name => name.trim() === "listings");
    });
    const options = new Map<string, string>();
    // The shared syntax index deliberately masks a listing's body, including
    // its optional header. Read that balanced header before consuming code.
    let local: { span: { to: number }; contentSpan: { from: number; to: number } } | null = null;
    if (env.name === "lstlisting") {
      let at = env.begin.span.to; while (/\s/u.test(mapped.text[at] ?? "") && at < env.end.span.from) at++;
      if (mapped.text[at] === "[") {
        let depth = 1, braces = 0, end = at + 1;
        for (; end < env.end.span.from; end++) {
          const char = mapped.text[end];
          if (char === "\\") { end++; continue; }
          if (char === "{") braces++; else if (char === "}") braces--;
          else if (!braces && char === "[") depth++; else if (!braces && char === "]" && --depth === 0) break;
        }
        if (!depth) local = { span: { to: end + 1 }, contentSpan: { from: at + 1, to: end } };
      }
    }
    if (env.name === "lstlisting") {
      for (const command of document.controlsIn({ from: 0, to: owner.from })) {
        if (command.name !== "lstset" || scopes.some(scope => scope.contentSpan.from <= command.span.from && command.span.to <= scope.contentSpan.to && !(scope.contentSpan.from <= owner.from && owner.from < scope.contentSpan.to))) continue;
        const arg = document.argumentAfter(command.span.to, "required", source.length);
        if (arg) for (const [key, value] of packageOptions(source.slice(arg.contentSpan.from, arg.contentSpan.to))) options.set(key, value);
      }
      if (local) for (const [key, value] of packageOptions(mapped.text.slice(local.contentSpan.from, local.contentSpan.to))) options.set(key, value);
      const unsupported = [...options].filter(([key, value]) => !allowed.has(key) || (key === "columns" && value !== "fullflexible") || (key === "language" && value !== "Python") || (key === "showstringspaces" && value !== "false") || (key === "keepspaces" && value !== "true") || (["keywordstyle", "commentstyle", "stringstyle"].includes(key) && !/^(?:\s|\\(?:bfseries|mdseries|itshape|upshape)|\\color\{[A-Za-z]+(?:![0-9]+(?:![A-Za-z]+)?)?\})*$/u.test(value)));
      if (configuredPackage || unsupported.length || options.get("columns") !== "fullflexible") {
        diagnostics.push({ severity: "warning", code: "beamer-listings-unsupported-options", message: "Listings currently supports fullflexible columns, preserved spaces/tabs, basic font styles and Python token styles. Unsupported listing options remain literal.", span: owner });
        continue;
      }
    }
    let start = local?.span.to ?? env.begin.span.to, end = env.end.span.from;
    const opening = /^[ \t]*(?:\r\n|\n|\r)/u.exec(mapped.text.slice(start, end)); if (opening) start += opening[0].length;
    const closing = /(?:\r\n|\n|\r)[ \t]*$/u.exec(mapped.text.slice(start, end)); if (closing) end = start + closing.index;
    let basic = env.name === "alltt" ? "\\ttfamily" : options.get("basicstyle") ?? "";
    const tabsize = Number(options.get("tabsize") ?? 8);
    if ((env.name === "lstlisting" && (!/\\ttfamily\b/u.test(basic) || /[^\x20-\x7e\t\r\n]/u.test(mapped.text.slice(start, end)) || (options.get("language") === "Python" && (/"{3}|'{3}/u.test(mapped.text.slice(start, end)) || (options.get("showstringspaces") !== "false" && /"[^"\n]* [^"\n]*"|'[^'\n]* [^'\n]*'/u.test(mapped.text.slice(start, end))))))) || !Number.isInteger(tabsize) || tabsize < 1 || tabsize > 32 || !/^(?:\s|\\(?:ttfamily|small|footnotesize|scriptsize|tiny|normalsize|bfseries|mdseries|itshape|upshape))*$/u.test(basic)) {
      diagnostics.push({ severity: "warning", code: "beamer-listings-unsupported-options", message: "Unsupported listing font style or tab size.", span: owner }); continue;
    }
    for (const [name, size, skip] of beamerNamedFontSizes(theme)) {
      basic = basic.replace(new RegExp(`\\\\${name}(?![A-Za-z])`, "gu"), `\\fontsize{${size}pt}{${skip}pt}\\selectfont`);
    }
    // A following named-size declaration selects its own baseline register.
    // The paragraph frontend otherwise retains the surrounding class register.
    const following = /^\s*\\([A-Za-z]+)/u.exec(mapped.text.slice(env.span.to));
    const followingSkip = beamerNamedFontSizes(theme).find(([name]) => name === following?.[1])?.[2]
      ?? theme?.fonts["normal-text"].lineHeightPt ?? 13.6;
    const lines: MappedText[] = [];
    for (let offset = start; offset <= end;) {
      const next = mapped.text.indexOf("\n", offset), lineEnd = next < 0 || next > end ? end : next;
      const raw = mapped.text.slice(offset, lineEnd).replace(/\r$/u, "");
      const rendered: MappedText[] = []; let column = 0;
      const tokens = env.name === "lstlisting" && options.get("language") === "Python"
        ? [...raw.matchAll(/#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b[A-Za-z_]\w*\b|./gu)]
        : [...raw.matchAll(/./gu)];
      for (const token of tokens) {
        const text = token[0], at = offset + token.index;
        const style = env.name !== "lstlisting" || options.get("language") !== "Python" ? undefined : text.startsWith("#") ? options.get("commentstyle") ?? "\\itshape" : /^["']/u.test(text) ? options.get("stringstyle") : pythonKeywords.has(text) ? options.get("keywordstyle") ?? "\\bfseries" : undefined;
        if (style) rendered.push(generated(`{${style} `));
        for (let i = 0; i < text.length; i++) {
          const char = text.charAt(i);
          if (char === " " || char === "\t") {
            const count = char === "\t" ? tabsize - column % tabsize : 1;
            // A typewriter space has the same width as its zero glyph.
            rendered.push(generated("\\hphantom{0}".repeat(count), at + i, at + i + 1)); column += count;
          } else {
            if (env.name === "alltt" && !"#$%&_~^".includes(char)) rendered.push(sliceMappedText(mapped, at + i, at + i + 1));
            else if ("#$%&_{}".includes(char)) rendered.push(generated(`\\${char}`, at + i, at + i + 1));
            else if (env.name === "lstlisting" && char === "'") rendered.push(generated("\\textquotesingle{}", at + i, at + i + 1));
            else if (env.name === "lstlisting" && char === "`") rendered.push(generated("\\textasciigrave{}", at + i, at + i + 1));
            else if (env.name === "lstlisting" && char === "-") rendered.push(generated("\\mbox{-}", at + i, at + i + 1));
            else if (char === "\\") rendered.push(generated("\\textbackslash{}", at + i, at + i + 1));
            else if (char === "^" || char === "~") rendered.push(generated(char === "^" ? "\\textasciicircum{}" : "\\textasciitilde{}", at + i, at + i + 1));
            else rendered.push(sliceMappedText(mapped, at + i, at + i + 1));
            column++;
          }
        }
        if (style) rendered.push(generated("}"));
      }
      lines.push(generated(`\\mbox{${basic} ${env.name === "lstlisting" ? "\\strut{}" : ""}`), ...(rendered.length ? rendered : [generated("\\hphantom{X}")]), generated("}"));
      if (lineEnd === end) break;
      lines.push(generated("\\\\\n")); offset = lineEnd + 1;
    }
    pieces.push(sliceMappedText(mapped, cursor, env.span.from),
      generated(env.name === "lstlisting"
        ? `\\par\\vskip${6 - beamerTrivlistSpacing(theme).naturalPt}pt\\begin{flushleft}${basic} `
        : `\\begin{flushleft}${basic} `),
      ...lines, generated(env.name === "lstlisting"
        ? `\\end{flushleft}\\vskip${6 - beamerTrivlistSpacing(theme).naturalPt + (theme?.fonts["normal-text"].lineHeightPt ?? 13.6) - followingSkip}pt\\normalfont\\fontsize{${surroundingFont?.sizePt ?? theme?.fonts["normal-text"].sizePt ?? 10.95}pt}{${surroundingFont?.lineHeightPt ?? theme?.fonts["normal-text"].lineHeightPt ?? 13.6}pt}\\selectfont `
        : "\\end{flushleft}"));
    cursor = env.span.to;
  }
  return cursor ? concatMappedText([...pieces, sliceMappedText(mapped, cursor, mapped.text.length)]) : mapped;
}
