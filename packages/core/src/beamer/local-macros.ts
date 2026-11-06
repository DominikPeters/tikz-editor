import { requireArrayValue } from "../utils/collections.js";
import type { MacroBinding } from "../macros/types.js";
import { collectMacroAlias, collectMacroCommandDefinition, collectMacroDefinition } from "../macros/bindings.js";
import { expandFirstMacroBindingMapped, expandMacroBindingsMapped, parseMacroInvocationArgs } from "../macros/expand.js";
import { collectContextDefinitions } from "../transform/cst-to-ast.js";
import { readTexBalancedDelimited, readTexControlSequence, readTexEnvironmentDelimiter, skipTexComment, skipTexVerbatim, skipTexWhitespaceAndComments } from "../parser/tex-lexical.js";
import { concatMappedText, sliceMappedText, type MappedText } from "../text/source-map.js";

const declarations = new Set(["\\newcommand", "\\renewcommand", "\\providecommand", "\\def", "\\let"]);
const declarationPattern = /\\(?:newcommand|renewcommand|providecommand|def|let)\b/u;

/** Execute declarations before expanding subsequent uses. Definition names and
 * bodies are tokens, not ordinary prose to eagerly substitute. */
export function expandBeamerLocalMacros(input: MappedText, initial: ReadonlyMap<string, MacroBinding>, force = false): { mapped: MappedText; bindings: ReadonlyMap<string, MacroBinding> } {
  const canDeclare = declarationPattern.test(input.text) || [...initial.values()].some(binding => declarationPattern.test(binding.kind === "text" ? binding.value : binding.body));
  if (!force && !canDeclare) return { mapped: expandMacroBindingsMapped(input, initial), bindings: initial };
  const scopes = [new Map(initial)];
  const active = () => requireArrayValue(scopes, scopes.length - 1);
  let pending = input;
  const parts: MappedText[] = [];
  // End offsets of replacements currently being scanned. Sibling calls do not
  // consume one another's depth budget, while recursive expansion stays bounded.
  let expansionEnds: number[] = [];
  const take = (length: number, paint = true) => {
    if (paint) parts.push(sliceMappedText(pending, 0, length));
    pending = sliceMappedText(pending, length, pending.text.length);
    expansionEnds = expansionEnds.map(end => end - length).filter(end => end > 0);
  };
  while (pending.text.length) {
    const text = pending.text, char = text[0];
    if (char === "%") { take(skipTexComment(text, 0)); continue; }
    if (char === "{" || char === "}") {
      if (char === "{") scopes.push(new Map(active()));
      else if (scopes.length > 1) scopes.pop();
      take(1); continue;
    }
    if (char !== "\\") {
      const next = text.search(/[\\{}%]/u); take(next < 0 ? text.length : next); continue;
    }
    const control = readTexControlSequence(text, 0);
    if (!control) { take(1); continue; }
    const verbatim = skipTexVerbatim(text, control, true);
    if (verbatim !== null) { take(verbatim); continue; }
    const environment = readTexEnvironmentDelimiter(text, 0, true);
    if (environment) {
      if (environment.kind === "begin") scopes.push(new Map(active()));
      else if (scopes.length > 1) scopes.pop();
      take(environment.to); continue;
    }
    if (["\\begingroup", "\\bgroup", "\\endgroup", "\\egroup"].includes(control.raw)) {
      if (control.raw === "\\begingroup" || control.raw === "\\bgroup") scopes.push(new Map(active()));
      else if (scopes.length > 1) scopes.pop();
      take(control.to); continue;
    }
    const end = declarations.has(control.raw) ? declarationEnd(text, control.raw, control.to) : null;
    if (end !== null) {
      const parsed = collectContextDefinitions(text.slice(0, end));
      const startOrigin = pending.sourceMap.boundaryOrigins[0];
      const endOrigin = pending.sourceMap.boundaryOrigins[end];
      const from = startOrigin?.kind === "offset" ? startOrigin.offset : startOrigin?.kind === "range" ? startOrigin.from : 0;
      const to = endOrigin?.kind === "offset" ? endOrigin.offset : endOrigin?.kind === "range" ? endOrigin.to : from;
      let register = false;
      for (const statement of parsed) {
        if (statement.kind !== "MacroDefinition" && statement.kind !== "MacroCommandDefinition" && statement.kind !== "MacroAlias") continue;
        // The text frontend owns this numeric register and its local scopes.
        if (statement.nameRaw.trim() === "\\arraystretch") { register = true; continue; }
        const positioned = { ...statement, id: `${statement.kind}:${from}:${to}`, span: { from, to } };
        if (positioned.kind === "MacroDefinition") collectMacroDefinition(positioned, active());
        else if (positioned.kind === "MacroCommandDefinition") collectMacroCommandDefinition(positioned, active());
        else collectMacroAlias(positioned, active());
      }
      take(end, register); continue;
    }
    const binding = active().get(control.raw);
    if (binding && expansionEnds.length < 100) {
      const next = expandFirstMacroBindingMapped(pending, new Map([[control.raw, binding]]));
      if (next.text !== pending.text) {
        // The shared expander retains argument/definition provenance and token
        // boundaries. Read its replacement before visiting the remaining tail.
        let consumed = control.to;
        if (binding.kind === "callable") {
          const args = parseInvocationEnd(text, control.to, binding.parameterCount, binding.optionalFirstArgDefault);
          if (args !== null) consumed = args;
        }
        const delta = next.text.length - pending.text.length;
        expansionEnds = expansionEnds.map(endOffset => endOffset + delta);
        expansionEnds.push(consumed + delta);
        pending = next; continue;
      }
    }
    take(control.to);
  }
  return { mapped: concatMappedText(parts), bindings: active() };
}

function parseInvocationEnd(text: string, from: number, count: number, optional: string | undefined): number | null {
  return parseMacroInvocationArgs(text, from, count, optional)?.nextIndex ?? null;
}

function declarationEnd(text: string, command: string, start: number): number | null {
  let cursor = skipTexWhitespaceAndComments(text, start);
  if (text[cursor] === "*") cursor = skipTexWhitespaceAndComments(text, cursor + 1);
  if (text[cursor] === "{") {
    const name = readTexBalancedDelimited(text, cursor, "{", "}");
    if (!name) return null;
    cursor = name.to;
  } else {
    const name = readTexControlSequence(text, cursor);
    if (!name) return null;
    cursor = name.to;
  }
  cursor = skipTexWhitespaceAndComments(text, cursor);
  if (command === "\\let") {
    if (text[cursor] === "=") cursor = skipTexWhitespaceAndComments(text, cursor + 1);
    return readTexControlSequence(text, cursor)?.to ?? Math.min(cursor + 1, text.length);
  }
  if (command !== "\\def") {
    for (let option = 0; option < 2 && text[cursor] === "["; option++) {
      const group = readTexBalancedDelimited(text, cursor, "[", "]");
      if (!group) return null;
      cursor = skipTexWhitespaceAndComments(text, group.to);
    }
  }
  return readTexBalancedDelimited(text, cursor, "{", "}")?.to ?? null;
}
