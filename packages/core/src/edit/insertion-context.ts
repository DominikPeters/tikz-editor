import { requireDefined } from "../utils/invariants.js";
import type { PathCommand } from "../ast/types.js";
import { parseOptionListRaw } from "../options/parse.js";
import { parseTikz } from "../parser/index.js";
import { restoreSemanticContext } from "../semantic/context.js";
import { createSemanticEvaluationRun, enterScopeStatement, evaluateSemanticStatementByIndex, getGeometryCheckpoints } from "../semantic/evaluate.js";
import { captureSiteContext, type SiteContext } from "../semantic/site-context.js";
import type { EvaluateOptions } from "../semantic/types.js";
import type { EditGeometrySnapshot } from "./geometry-session.js";
import { resolveStatementOptionState } from "./parent-frame.js";

/** Where a new statement goes: before an evaluated statement, or after the last one. */
export type InsertionGap =
  | { kind: "before"; statementIndex: number }
  | { kind: "end" };

/**
 * The statement to be inserted, as far as its frame depends on it. Options
 * are the raw text between the brackets. A scope's coordinates are only read
 * by paths inside it, so a scope resolves to the frame of a plain path there.
 * Nodes are resolved separately (node placement resets non-translations).
 */
export type InsertionDescription =
  | { kind: "path"; command: PathCommand; options?: string }
  | { kind: "scope"; options?: string };

const INSERTION_SOURCE_REF = { sourceId: "insertion", sourceSpan: { from: 0, to: 0 } } as const;

/**
 * The frame a new statement's coordinates are read in: the evaluator's state
 * at the gap, replayed from the nearest geometry checkpoint, with the
 * statement resolved by the evaluator's own path and scope steps. Nothing
 * here combines transforms itself.
 */
export function prepareInsertion(
  snapshot: EditGeometrySnapshot,
  gap: InsertionGap,
  description: InsertionDescription,
  evaluateOptions: EvaluateOptions = {}
): SiteContext {
  const run = createSemanticEvaluationRun(snapshot.parsed.figure, snapshot.source, evaluateOptions);
  run.captureGeometryCheckpoints = false;
  const target = gap.kind === "end" ? run.expandedFigureBody.length : gap.statementIndex;
  if (target < 0 || target > run.expandedFigureBody.length) throw new Error(`No insertion gap at statement ${target}`);
  const checkpoints = getGeometryCheckpoints(snapshot.semantic);
  const restoreIndex = checkpoints ? Math.max(-1, ...[...checkpoints.keys()].filter(index => index <= target)) : -1;
  if (restoreIndex >= 0) {
    const checkpoint = requireDefined(checkpoints?.get(restoreIndex), "Missing geometry checkpoint");
    restoreSemanticContext(run.context, checkpoint, { editHandleSource: snapshot.semantic.editHandles });
  }
  for (let index = Math.max(0, restoreIndex); index < target; index++) evaluateSemanticStatementByIndex(run, index);

  if (description.kind === "scope") {
    const parsed = parseTikz(String.raw`\begin{tikzpicture}\begin{scope}[${description.options ?? ""}]\end{scope}\end{tikzpicture}`);
    const scope = parsed.figure.body[0];
    if (scope?.kind !== "Scope") throw new Error("Scope options did not parse as a scope");
    enterScopeStatement(scope, run.context);
  }
  const options = description.kind === "path" && description.options ? [parseOptionListRaw(`[${description.options}]`)] : [];
  const resolved = resolveStatementOptionState(run.context, {
    kind: "path",
    command: description.kind === "path" ? description.command : "path",
    options,
    sourceRef: { ...INSERTION_SOURCE_REF, sourceKind: "path-statement" }
  });
  return captureSiteContext(resolved);
}

/** The frame a new path statement at the gap reads coordinates in, with no options of its own. */
export function gapPathContext(snapshot: EditGeometrySnapshot, gap: InsertionGap): SiteContext {
  return prepareInsertion(snapshot, gap, { kind: "path", command: "path" });
}
