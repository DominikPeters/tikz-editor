/**
 * TeX-group state of pgfmath: functions from `declare function` and
 * `/pgf/trig format`. PGF keeps both in macros (`\pgfmath@function@<name>`,
 * `\pgfmath@trig@format@choice`) that TeX groups scope; here they live in the
 * frame's macro bindings under reserved names, so scopes, paths and
 * incremental snapshots carry them the same way.
 */
import type { MacroBinding } from "../../macros/index.js";
import { DEFAULT_MACRO_EXPANSION_MAX_DEPTH, expandMacroBindings } from "../../macros/index.js";
import type { OptionListAst } from "../../options/types.js";
import { builtinArity, type PgfMathDeclaredFunction } from "./compile.js";
import { parsePgfMathFunctionDeclarations } from "./declarations.js";
import type { PgfMathScope, PgfMathTrigFormat } from "./runtime.js";

const FUNCTIONS_BINDING = "\\pgfmath@declared@functions";
const TRIG_FORMAT_BINDING = "\\pgfmath@trig@format@choice";

const DECLARE_FUNCTION_KEYS = new Set(["declare function", "/pgf/declare function", "/tikz/declare function"]);
const TRIG_FORMAT_KEYS = new Set(["trig format", "/pgf/trig format", "/tikz/trig format"]);

export function isPgfMathDeclareFunctionKey(key: string): boolean {
  return DECLARE_FUNCTION_KEYS.has(key);
}

/** A frame's macro bindings (a `PersistentMap`). */
type Bindings = Map<string, MacroBinding>;

export type PgfMathScopeDiagnostic = { code: string; message: string };

/**
 * Apply `declare function=...` and `trig format=...` from option lists to a
 * frame's bindings, in order. Returns diagnostics for malformed values.
 */
export function applyPgfMathScopeOptions(
  bindings: Bindings,
  optionLists: readonly OptionListAst[]
): { applied: boolean; diagnostics: PgfMathScopeDiagnostic[] } {
  const diagnostics: PgfMathScopeDiagnostic[] = [];
  let applied = false;
  for (const list of optionLists) {
    for (const entry of list.entries) {
      if (entry.kind !== "kv") continue;
      if (DECLARE_FUNCTION_KEYS.has(entry.key)) {
        applied = true;
        const declared = parsePgfMathFunctionDeclarations(entry.valueRaw);
        if (declared == null) {
          diagnostics.push({
            code: "invalid-declare-function",
            message: `Could not read the function definitions in 'declare function=${entry.valueRaw}'.`
          });
          continue;
        }
        for (const name of declarePgfMathFunctions(bindings, declared)) {
          diagnostics.push({
            code: "pgfmath-function-exists",
            message: `The function '${name}' already exists; PGF reports an error and redefines it.`
          });
        }
      } else if (TRIG_FORMAT_KEYS.has(entry.key)) {
        applied = true;
        const value = entry.valueRaw.trim().replace(/^\{\s*|\s*\}$/gu, "");
        if (value === "deg" || value === "rad") {
          setBinding(bindings, TRIG_FORMAT_BINDING, value);
        } else {
          diagnostics.push({ code: "invalid-trig-format", message: `'trig format' expects deg or rad, not '${value}'.` });
        }
      }
    }
  }
  return { applied, diagnostics };
}

/** Returns the names that already existed (\pgfmathdeclarefunction complains about those). */
function declarePgfMathFunctions(bindings: Bindings, declared: readonly PgfMathDeclaredFunction[]): string[] {
  const functions = new Map(readPgfMathScope(bindings).functions ?? []);
  const existing: string[] = [];
  for (const definition of declared) {
    if (functions.has(definition.name) || builtinArity(definition.name) != null) {
      existing.push(definition.name);
    }
    // TeX expands other macros in the body when the function is used; the
    // bindings visible at the declaration are the closest stand-in.
    const body = expandBodyMacros(definition, bindings);
    functions.set(definition.name, { ...definition, body });
  }
  setBinding(bindings, FUNCTIONS_BINDING, JSON.stringify([...functions.values()]));
  return existing;
}

function expandBodyMacros(definition: PgfMathDeclaredFunction, bindings: Bindings): string {
  if (!definition.body.includes("\\")) {
    return definition.body;
  }
  let visible: ReadonlyMap<string, MacroBinding> = bindings;
  if (definition.params.some((param) => bindings.has(param))) {
    // Parameters shadow outer macros of the same name.
    const copy = new Map(bindings);
    for (const param of definition.params) copy.delete(param);
    visible = copy;
  }
  return expandMacroBindings(definition.body, visible, { maxDepth: DEFAULT_MACRO_EXPANSION_MAX_DEPTH });
}

function setBinding(bindings: Bindings, name: string, value: string): void {
  bindings.set(name, { kind: "text", value, provenance: [] });
}

const SCOPE_CACHE = new Map<string, PgfMathScope>();

/** The pgfmath scope visible through a frame's bindings. */
export function readPgfMathScope(bindings: Pick<ReadonlyMap<string, MacroBinding>, "get">): PgfMathScope {
  const functionsBinding = bindings.get(FUNCTIONS_BINDING);
  const trigBinding = bindings.get(TRIG_FORMAT_BINDING);
  const functionsText = functionsBinding?.kind === "text" ? functionsBinding.value : "";
  const trigFormat: PgfMathTrigFormat = trigBinding?.kind === "text" && trigBinding.value === "rad" ? "rad" : "deg";
  if (functionsText === "" && trigFormat === "deg") {
    return EMPTY_SCOPE;
  }
  const key = `${trigFormat}|${functionsText}`;
  let scope = SCOPE_CACHE.get(key);
  if (!scope) {
    const definitions = functionsText === "" ? [] : parseStoredFunctions(functionsText);
    // One Map per distinct scope keeps compiled programs shareable.
    scope = {
      trigFormat,
      ...(definitions.length > 0 ? { functions: new Map(definitions.map((definition) => [definition.name, definition])) } : {})
    };
    if (SCOPE_CACHE.size > 256) SCOPE_CACHE.clear();
    SCOPE_CACHE.set(key, scope);
  }
  return scope;
}

const EMPTY_SCOPE: PgfMathScope = { trigFormat: "deg" };

function parseStoredFunctions(text: string): PgfMathDeclaredFunction[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    return [];
  }
  const definitions: PgfMathDeclaredFunction[] = [];
  for (const item of parsed as unknown[]) {
    if (typeof item !== "object" || item === null || !("name" in item) || !("params" in item) || !("body" in item)) continue;
    const { name, params, body } = item;
    if (typeof name === "string" && typeof body === "string" && Array.isArray(params)) {
      definitions.push({ name, body, params: params.filter((param): param is string => typeof param === "string") });
    }
  }
  return definitions;
}
