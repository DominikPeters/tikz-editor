/** Semantic edit recipes keep their meaning when earlier edits/source are reduced. */
import { createHash } from "node:crypto";
import { scanBeamerDocument } from "../../packages/core/src/beamer/index.js";
import { createBeamerSyntaxContext } from "../../packages/core/src/beamer/syntax.js";
import { matchTexSyntaxEnvironments } from "../../packages/core/src/text/tex/syntax-index.js";
import { fragment } from "../fragment-helpers.js";
import { coldCompute, runOps, singleEdit, type FuzzFailure, type FuzzOp, type FuzzRunResult, type WarmModuleFactory } from "./compute-fuzz.js";

export { EDIT_FIELDS, generateBeamerEditSequence, withEditProbes } from "../../scripts/lib/beamer-edit-sequences.mjs";
export type { EditField, BeamerEditAction, BeamerEditSequence } from "../../scripts/lib/beamer-edit-sequences.mjs";
import { setBeamerEditField as setField, type EditField, type BeamerEditSequence } from "../../scripts/lib/beamer-edit-sequences.mjs";
export const sourceHash = (source: string): string => createHash("sha256").update(source).digest("hex");

export function materializeBeamerEdits(sequence: BeamerEditSequence): { ops: FuzzOp[]; effectiveEdits: Partial<Record<EditField, number>>; finalSource: string; opActions: number[] } {
  let source = sequence.source, layer = false;
  const history: string[] = [], ops: FuzzOp[] = [], opActions: number[] = [], effectiveEdits: Partial<Record<EditField, number>> = {};
  const emit = (op: FuzzOp, action: number) => { ops.push(op); opActions.push(action); };
  for (const [index, action] of sequence.actions.entries()) {
    switch (action.kind) {
      case "set": {
        const after = setField(source, action.field, action.value, sequence.probeVersion ?? 1);
        if (after === source) break;
        const edit = singleEdit(source, after);
        if (action.mode === "race") emit({ kind: "race", doc: 0, edit, newerFirst: index % 2 === 0 }, index);
        else emit({ kind: "edit", doc: 0, edit, origin: action.mode === "typing" ? "source-editor" : "edit-command", changedSourceIds: null,
          drag: false, render: action.render, note: `beamer:${action.field}`,
          ...(layer && action.mode === "command" ? { layer: { patches: [{ oldSpan: { from: edit.from, to: edit.to },
            newSpan: { from: edit.from, to: edit.from + edit.insert.length }, replacement: fragment(edit.insert) }], changedSourceIds: null } } : {}),
        }, index);
        history.push(source); if (history.length > 12) history.shift(); source = after;
        effectiveEdits[action.field] = (effectiveEdits[action.field] ?? 0) + 1;
        break;
      }
      case "navigate": layer = false; emit({ kind: "navigate", doc: 0, root: action.picture ? `frame:${action.frame}:tikzpicture:0` : `frame:${action.frame}`, step: action.step }, index); break;
      case "layer": layer = action.enabled; emit({ kind: "layer", doc: 0, root: action.enabled ? "frame:1:overlay:0" : null }, index); break;
      case "render": emit({ kind: "render", doc: 0 }, index); break;
      case "neighbors": emit({ kind: "neighbors", doc: 0, abortAfterYields: null }, index); break;
      case "abort": emit({ kind: "aborted-render", doc: 0, afterYields: action.afterYields }, index); break;
      case "mask": {
        const from = source.indexOf("EditNode");
        emit({ kind: "mask", doc: 0, span: action.enabled && from >= 0 ? { from, to: from + 8 } : null }, index); break;
      }
      case "undo": {
        const previous = history.at(-1);
        if (previous === undefined || previous === source) break;
        history.push(source); if (history.length > 12) history.shift(); source = previous;
        emit({ kind: "history", doc: 0, back: 1 }, index); break;
      }
    }
  }
  return { ops, effectiveEdits, finalSource: source, opActions };
}

export async function runBeamerEditSequence(sequence: BeamerEditSequence, factory?: WarmModuleFactory): Promise<FuzzRunResult> {
  return runOps([{ label: sequence.family, source: sequence.source }], materializeBeamerEdits(sequence).ops, factory);
}

/** Values and offsets vary during shrinking; the exact differing output path must persist. */
export function beamerFailureKey(failure: FuzzFailure): string {
  if (failure.what === "threw") return `exception:${failure.differences[0]?.split("\n")[0]}`;
  const difference = failure.differences[0] ?? "";
  return `mismatch:${failure.what}:${difference.slice(0, difference.indexOf(": ") < 0 ? undefined : difference.indexOf(": "))}`;
}

export function beamerSourceCandidates(source: string): string[] {
  const context = createBeamerSyntaxContext(source);
  const candidates: string[] = [];
  for (const environment of matchTexSyntaxEnvironments(context.syntax).values()) {
    if (!["frame", "tikzpicture", "columns", "column", "center", "flushleft", "flushright", "block", "alertblock", "exampleblock", "itemize", "enumerate"].includes(environment.name)) continue;
    candidates.push(source.slice(0, environment.span.from) + source.slice(environment.span.to));
    if (environment.name === "frame") candidates.push(source.slice(0, environment.contentSpan.from) + source.slice(environment.contentSpan.to));
    if (environment.name !== "frame") candidates.push(source.slice(0, environment.span.from) + source.slice(environment.contentSpan.from, environment.contentSpan.to) + source.slice(environment.span.to));
  }
  const preambleEnd = source.indexOf("\\begin{document}");
  if (preambleEnd >= 0) for (const match of source.slice(0, preambleEnd).matchAll(/^\\(?:title|date|definecolor|newcommand|usetheme|setbeamertemplate|year|month|day)[^\n]*\n/gmu)) {
    if (/\\(?:year|month|day)\b/u.test(match[0])) continue;
    candidates.push(source.slice(0, match.index) + source.slice(match.index + match[0].length));
  }
  for (const match of source.matchAll(/^%[^\n]*\n/gmu)) candidates.push(source.slice(0, match.index) + source.slice(match.index + match[0].length));
  return [...new Set(candidates)].filter(candidate => candidate.length < source.length && scanBeamerDocument(candidate).frames.length > 0 && scanBeamerDocument(candidate).diagnostics.length === 0)
    .sort((left, right) => left.length - right.length);
}

export type BeamerReduction = { sequence: BeamerEditSequence; failure: FuzzFailure; key: string; attempts: number; accepted: number; budgetExhausted: boolean };
export async function reduceBeamerEditSequence(sequence: BeamerEditSequence, options: {
  budget?: number; factory?: WarmModuleFactory;
  run?: (sequence: BeamerEditSequence) => Promise<FuzzRunResult>;
  acceptSource?: (failure: FuzzFailure) => Promise<boolean>;
  onProgress?: (result: BeamerReduction) => void;
} = {}): Promise<BeamerReduction> {
  const budget = options.budget ?? 48;
  const run = options.run ?? ((candidate: BeamerEditSequence) => runBeamerEditSequence(candidate, options.factory));
  const original = await run(sequence);
  if (!original.failure || original.failure.what === "threw") throw new Error("Reduction requires a reproducible differential mismatch, not an exception.");
  const key = beamerFailureKey(original.failure);
  let current = sequence, failure = original.failure, attempts = 0, accepted = 0;
  const snapshot = (): BeamerReduction => ({ sequence: current, failure, key, attempts, accepted, budgetExhausted: attempts >= budget });
  const acceptSource = options.acceptSource ?? (async (mismatch: FuzzFailure) => {
    const cold = await coldCompute(mismatch.request);
    const paint = cold.snapshot.deck?.activeFrame?.svg ?? cold.snapshot.svg?.svg;
    return cold.diagnostics.length === 0 && paint !== undefined && !paint.includes("data-tex-literal=");
  });
  const tryCandidate = async (candidate: BeamerEditSequence, sourceChanged = false): Promise<boolean> => {
    if (attempts >= budget) return false;
    attempts++;
    const result = await run(candidate);
    if (!result.failure || beamerFailureKey(result.failure) !== key || (sourceChanged && !await acceptSource(result.failure))) return false;
    current = candidate; failure = result.failure; accepted++;
    options.onProgress?.(snapshot()); return true;
  };
  // Truncate only at the semantic action owning the first failing concrete op.
  const actionIndex = materializeBeamerEdits(current).opActions[failure.opIndex];
  if (actionIndex !== undefined && actionIndex + 1 < current.actions.length) await tryCandidate({ ...current, actions: current.actions.slice(0, actionIndex + 1) });
  for (let chunk = Math.max(1, Math.floor(current.actions.length / 2)); chunk >= 1 && attempts < budget; chunk = Math.floor(chunk / 2)) {
    for (let start = 0; start < current.actions.length && attempts < budget;) {
      const actions = [...current.actions.slice(0, start), ...current.actions.slice(start + chunk)];
      if (!await tryCandidate({ ...current, actions })) start += chunk;
    }
  }
  let changed = true;
  while (changed && attempts < budget) {
    changed = false;
    for (const source of beamerSourceCandidates(current.source)) {
      if (await tryCandidate({ ...current, source }, true)) { changed = true; break; }
      if (attempts >= budget) break;
    }
  }
  // Reproduction is checked again after all accepted reductions.
  const verified = await run(current);
  if (!verified.failure || beamerFailureKey(verified.failure) !== key) throw new Error("Reduced sequence did not reproduce its recorded mismatch.");
  failure = verified.failure;
  return snapshot();
}
