import { splitAllAtTopLevel } from "../domains/coordinates/parse.js";
import type { Span } from "../ast/types.js";
import type { OptionEntry, OptionListAst } from "../options/types.js";
import { evaluatePgfMathExpression, formatPgfMathNumber } from "../semantic/pgfmath/evaluator.js";
import { parseBooleanishNormalized } from "../utils/booleanish.js";
import { expandForeachList } from "./list.js";
import { substituteForeachBindings } from "./substitute.js";
import type { ForeachExpansionDiagnostic, ForeachIterationBinding } from "./types.js";

type EvaluateRule = {
  variable: string;
  target: string;
  expression: string;
  span: Span;
};

type RememberRule = {
  variable: string;
  target: string;
  initial: string;
  span: Span;
};

type CountRule = {
  target: string;
  current: number;
  span: Span;
};

export type ForeachOptionsConfig = {
  variablesFromOptions: string[];
  evaluateRules: EvaluateRule[];
  rememberRules: RememberRule[];
  countRules: CountRule[];
  parseExpressions: boolean;
  expandList: boolean;
  diagnostics: ForeachExpansionDiagnostic[];
};

export type ForeachIteration = {
  index: number;
  bindings: ForeachIterationBinding;
};

export function parseForeachOptions(options: OptionListAst | undefined): ForeachOptionsConfig {
  const config: ForeachOptionsConfig = {
    variablesFromOptions: [],
    evaluateRules: [],
    rememberRules: [],
    countRules: [],
    parseExpressions: false,
    expandList: false,
    diagnostics: []
  };

  if (!options) {
    return config;
  }

  for (const entry of options.entries) {
    if (entry.kind === "flag") {
      if (entry.key === "parse") {
        config.parseExpressions = true;
        continue;
      }
      if (entry.key === "expand list") {
        config.expandList = true;
        continue;
      }

      pushUnsupportedOptionDiagnostic(config, entry, entry.key);
      continue;
    }

    if (entry.kind !== "kv") {
      pushUnsupportedOptionDiagnostic(config, entry, "unknown");
      continue;
    }

    if (entry.key === "var") {
      const parsed = normalizeMacroToken(entry.valueRaw);
      if (parsed) {
        config.variablesFromOptions.push(parsed);
      } else {
        pushUnsupportedOptionDiagnostic(config, entry, "var");
      }
      continue;
    }

    if (entry.key === "evaluate") {
      const parsed = parseEvaluateRule(entry.valueRaw, entry.span);
      if (parsed) {
        config.evaluateRules.push(parsed);
      } else {
        pushUnsupportedOptionDiagnostic(config, entry, "evaluate");
      }
      continue;
    }

    if (entry.key === "remember") {
      const parsed = parseRememberRule(entry.valueRaw, entry.span);
      if (parsed) {
        config.rememberRules.push(parsed);
      } else {
        pushUnsupportedOptionDiagnostic(config, entry, "remember");
      }
      continue;
    }

    if (entry.key === "count") {
      const parsed = parseCountRule(entry.valueRaw, entry.span);
      if (parsed) {
        config.countRules.push(parsed);
      } else {
        pushUnsupportedOptionDiagnostic(config, entry, "count");
      }
      continue;
    }

    if (entry.key === "parse") {
      config.parseExpressions = parseBoolean(entry.valueRaw, true);
      continue;
    }

    if (entry.key === "expand list") {
      config.expandList = parseBoolean(entry.valueRaw, true);
      continue;
    }

    pushUnsupportedOptionDiagnostic(config, entry, entry.key);
  }

  return config;
}

export function resolveForeachVariables(raw: string, config: ForeachOptionsConfig): string[] {
  const explicit = splitAllAtTopLevel(raw, "/")
    .map((entry) => normalizeMacroToken(entry))
    .filter((entry): entry is string => Boolean(entry));

  const merged = [...explicit];
  for (const optionVariable of config.variablesFromOptions) {
    if (!merged.includes(optionVariable)) {
      merged.push(optionVariable);
    }
  }

  return merged;
}

export function buildForeachIterations(params: {
  variablesRaw: string;
  listRaw: string;
  options: OptionListAst | undefined;
  baseBindings: ForeachIterationBinding;
  loopSpan: Span;
}): {
  iterations: ForeachIteration[];
  diagnostics: ForeachExpansionDiagnostic[];
} {
  const optionsConfig = parseForeachOptions(params.options);
  const diagnostics = [...optionsConfig.diagnostics];

  const substitutedVariablesRaw = substituteForeachBindings(params.variablesRaw, params.baseBindings);
  const substitutedListRaw = substituteForeachBindings(params.listRaw, params.baseBindings);
  const variables = resolveForeachVariables(substitutedVariablesRaw, optionsConfig);
  if (variables.length === 0) {
    diagnostics.push({
      severity: "warning",
      code: "invalid-foreach-header",
      message: "Foreach loop does not declare variables.",
      span: params.loopSpan
    });
    return { iterations: [], diagnostics };
  }

  const listEntries = expandForeachList(substitutedListRaw, { parseExpressions: optionsConfig.parseExpressions });
  if (listEntries.length === 0) {
    diagnostics.push({
      severity: "warning",
      code: "invalid-foreach-list",
      message: "Foreach loop list could not be expanded.",
      span: params.loopSpan
    });
    return { iterations: [], diagnostics };
  }

  const rememberState = new Map<string, string>();
  for (const rule of optionsConfig.rememberRules) {
    rememberState.set(rule.target, rule.initial);
  }

  const iterations: ForeachIteration[] = [];
  for (const [index, listEntry] of listEntries.entries()) {
    const normalizedEntry = normalizeListEntryForSplit(listEntry);
    const splitValues = splitAllAtTopLevel(normalizedEntry, "/").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
    const fallbackValue = splitValues.at(-1) ?? "";

    const bindingScope: Partial<ForeachIterationBinding> = { ...params.baseBindings };
    for (const [variableIndex, variable] of variables.entries()) {
      const assigned = splitValues[variableIndex] ?? fallbackValue;
      bindingScope[variable] = assigned;
    }

    for (const countRule of optionsConfig.countRules) {
      bindingScope[countRule.target] = String(countRule.current);
      countRule.current += 1;
    }

    for (const rememberRule of optionsConfig.rememberRules) {
      bindingScope[rememberRule.target] = rememberState.get(rememberRule.target) ?? rememberRule.initial;
    }

    for (const evaluateRule of optionsConfig.evaluateRules) {
      const substitutedExpression = substituteForeachBindings(evaluateRule.expression, bindingScope);
      const evaluated = evaluatePgfMathExpression(substitutedExpression);
      if (evaluated.ok === false) {
        diagnostics.push({
          severity: "warning",
          code: `foreach-evaluate-failed:${evaluated.code}`,
          message: `Could not evaluate foreach expression: ${substitutedExpression} (${evaluated.message})`,
          span: evaluateRule.span
        });
        bindingScope[evaluateRule.target] = substitutedExpression;
        continue;
      }

      bindingScope[evaluateRule.target] = formatPgfMathNumber(evaluated.quantity.value);
      if (evaluateRule.target === evaluateRule.variable) {
        bindingScope[evaluateRule.variable] = formatPgfMathNumber(evaluated.quantity.value);
      }
    }

    for (const rememberRule of optionsConfig.rememberRules) {
      const rememberValue = bindingScope[rememberRule.variable];
      if (rememberValue != null) {
        rememberState.set(rememberRule.target, rememberValue);
      }
    }

    const localBindings: ForeachIterationBinding = {};
    for (const variable of variables) {
      localBindings[variable] = bindingScope[variable] ?? "";
    }
    for (const rule of optionsConfig.countRules) {
      localBindings[rule.target] = bindingScope[rule.target] ?? "";
    }
    for (const rule of optionsConfig.evaluateRules) {
      localBindings[rule.target] = bindingScope[rule.target] ?? "";
    }
    for (const rule of optionsConfig.rememberRules) {
      localBindings[rule.target] = bindingScope[rule.target] ?? "";
    }

    iterations.push({
      index,
      bindings: localBindings
    });
  }

  return { iterations, diagnostics };
}

function parseEvaluateRule(raw: string, span: Span): EvaluateRule | null {
  const normalized = raw.trim();
  const match = normalized.match(/^(\\[A-Za-z@]+)(?:\s+as\s+(\\[A-Za-z@]+))?(?:\s+using\s+([\s\S]+))?$/i);
  if (!match) {
    return null;
  }
  const variable = match.at(1);
  if (!variable) {
    return null;
  }
  const target = match.at(2) ?? variable;
  const expression = (match.at(3) ?? variable).trim();
  if (expression.length === 0) {
    return null;
  }
  return { variable, target, expression, span };
}

function parseRememberRule(raw: string, span: Span): RememberRule | null {
  const normalized = raw.trim();
  const match = normalized.match(/^(\\[A-Za-z@]+)(?:\s+as\s+(\\[A-Za-z@]+))?(?:\s*\(initially\s+([\s\S]+)\))?$/i);
  if (!match) {
    return null;
  }

  const variable = match.at(1);
  if (!variable) {
    return null;
  }
  const target = match.at(2) ?? variable;
  const initial = (match.at(3) ?? "0").trim();
  return { variable, target, initial, span };
}

function parseCountRule(raw: string, span: Span): CountRule | null {
  const normalized = raw.trim();
  const match = normalized.match(/^(\\[A-Za-z@]+)(?:\s+from\s+(.+))?$/i);
  if (!match) {
    return null;
  }

  const target = match.at(1);
  if (!target) {
    return null;
  }
  const fromRaw = match.at(2)?.trim() ?? "1";
  const parsed = Number(fromRaw);
  const current = Number.isFinite(parsed) ? parsed : 1;
  return { target, current, span };
}

function normalizeMacroToken(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^\\[A-Za-z@]+$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function pushUnsupportedOptionDiagnostic(config: ForeachOptionsConfig, entry: OptionEntry, key: string): void {
  config.diagnostics.push({
    severity: "warning",
    code: `foreach-unsupported-option:${key}`,
    message: `Unsupported foreach option: ${key}`,
    span: entry.span
  });
}

function parseBoolean(raw: string, fallback: boolean): boolean {
  return parseBooleanishNormalized(raw, { allowOnOff: true }) ?? fallback;
}

function normalizeListEntryForSplit(raw: string): string {
  let current = raw.trim();
  for (;;) {
    const stripped = stripOuterBraces(current);
    if (stripped === current) {
      return current;
    }
    current = stripped;
  }
}

function stripOuterBraces(raw: string): string {
  if (!raw.startsWith("{") || !raw.endsWith("}")) {
    return raw;
  }

  let depth = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0 && index !== raw.length - 1) {
        return raw;
      }
    }
  }

  return raw.slice(1, -1).trim();
}
