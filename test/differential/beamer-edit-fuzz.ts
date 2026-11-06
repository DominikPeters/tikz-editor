/** Semantic edit recipes keep their meaning when earlier edits/source are reduced. */
import { createHash } from "node:crypto";
import { scanBeamerDocument } from "../../packages/core/src/beamer/index.js";
import { createBeamerSyntaxContext } from "../../packages/core/src/beamer/syntax.js";
import { matchTexSyntaxEnvironments } from "../../packages/core/src/text/tex/syntax-index.js";
import { fragment } from "../fragment-helpers.js";
import { coldCompute, makeRng, runOps, singleEdit, type FuzzFailure, type FuzzOp, type FuzzRunResult, type WarmModuleFactory } from "./compute-fuzz.js";

export const EDIT_FIELDS = ["text", "class-font", "aspect", "theme", "alignment", "date", "width", "rotation", "overlay", "color", "comment", "title", "scope", "bounds-width"] as const;
export type EditField = typeof EDIT_FIELDS[number];
export type BeamerEditAction =
  | { kind: "set"; field: EditField; value: string; mode: "typing" | "command" | "race"; render: boolean }
  | { kind: "navigate"; frame: number; step: number; picture?: boolean }
  | { kind: "layer"; enabled: boolean }
  | { kind: "mask"; enabled: boolean }
  | { kind: "undo" }
  | { kind: "render" }
  | { kind: "neighbors" }
  | { kind: "abort"; afterYields: number };
export type BeamerEditSequence = { formatVersion: 1; probeVersion?: 1 | 2; seed: number; family: string; source: string; actions: BeamerEditAction[] };
export const sourceHash = (source: string): string => createHash("sha256").update(source).digest("hex");

export function withEditProbes(source: string): string {
  // Freeze the date even for imported reproducers, including long runs crossing midnight.
  const preamble = String.raw`\newcommand{\editprobetext}{EditAlpha}
\definecolor{editpaint}{RGB}{255,0,255}
% edit-comment: initial
% edit-date
\year=2026\month=11\day=6
`;
  const probe = String.raw`\begin{frame}{EditTitleA}
\begin{tikzpicture}[remember picture,overlay,rotate=0]
% edit-layer-probe
\fill[editpaint] (-1,0) rectangle (1,0.6);
\node<2-> at (0,0) {EditNode};
\end{tikzpicture}
\end{frame}
\begin{frame}EditNeighbor
\begin{tikzpicture}
% edit-bounds
\fill[editpaint] (-1,0) rectangle (1,0.6);
\fill[editpaint,rotate=-25] (0,0) ellipse[x radius=.325cm,y radius=.35cm];
\end{tikzpicture}
\end{frame}
`;
  const themed = /\\usetheme\{/u.test(source) ? source : source.replace("\\usepackage{tikz}", "\\usepackage{tikz}\n\\usetheme{default}");
  return themed.replace("\\begin{document}", preamble + "\\begin{document}")
    .replace("\\begin{frame}", "\\begin{frame}\\raggedright \\editprobetext\\par ")
    .replace("\\end{document}", probe + "\\end{document}");
}

function setField(source: string, field: EditField, value: string, probeVersion = source.includes("% edit-bounds") ? 2 : 1): string {
  const replace = (pattern: RegExp, project: (match: RegExpExecArray) => string): string => {
    const match = pattern.exec(source);
    return match ? source.slice(0, match.index) + project(match) + source.slice(match.index + match[0].length) : source;
  };
  switch (field) {
    case "text": return replace(/\\newcommand\{\\editprobetext\}\{[^}]*\}/u, () => `\\newcommand{\\editprobetext}{${value}}`);
    case "class-font": return replace(/(\\documentclass\[)\d+pt/u, m => `${m[1]}${value}pt`);
    case "aspect": return replace(/aspectratio=\d+/u, () => `aspectratio=${value}`);
    case "theme": return replace(/\\usetheme\{[^}]*\}/u, () => `\\usetheme{${value}}`);
    case "alignment": return replace(/\\(?:centering|raggedright|raggedleft)(?= \\editprobetext)/u, () => `\\${value}`);
    case "date": return replace(/(?<=% edit-date\n)\\year=\d+\\month=\d+\\day=\d+/u, () => `\\year=${value}\\month=11\\day=6`);
    case "width": {
      if (probeVersion !== 2 && /\\fill\[editpaint\] \(0,0\) rectangle/u.test(source)) {
        return replace(/(\\fill\[editpaint\] \(0,0\) rectangle \()[\d.]+(,0\.6\);)/u, m => `${m[1]}${value}${m[2]}`);
      }
      // Version-1 recipes had only one probe. New recipes retain its identity
      // after source reduction even when a different picture remains.
      const pattern = probeVersion === 2
        ? /(% edit-(?:layer-probe|overlay)\n)\\fill\[editpaint\] \(-[\d.]+,0\) rectangle \([\d.]+,0\.6\);/u
        : /()\\fill\[editpaint\] \(-[\d.]+,0\) rectangle \([\d.]+,0\.6\);/u;
      return replace(pattern, m => `${m[1]}\\fill[editpaint] (-${value},0) rectangle (${value},0.6);`);
    }
    case "bounds-width": return replace(/(% edit-bounds\n)\\fill\[editpaint\] \(-[\d.]+,0\) rectangle \([\d.]+,0\.6\);/u,
      m => `${m[1]}\\fill[editpaint] (-${value},0) rectangle (${value},0.6);`);
    case "rotation": return replace(/(remember picture,overlay,rotate=)-?[\d.]+/u, m => `${m[1]}${value}`);
    case "overlay": return replace(/\\node<[^>]+>(?= at \(0,0\) \{EditNode\})/u, () => `\\node<${value}>`);
    case "color": return replace(/\\definecolor\{editpaint\}\{RGB\}\{[^}]*\}/u, () => `\\definecolor{editpaint}{RGB}{${value}}`);
    case "comment": return replace(/% edit-comment:[^\n]*/u, () => `% edit-comment: ${value}`);
    case "title": return replace(/\\begin\{frame\}\{EditTitle[^}]*\}/u, () => `\\begin{frame}{EditTitle${value}}`);
    case "scope": return replace(/(?<= )(?:\{\\(?:centering|raggedright|raggedleft) )?\\editprobetext(?:\\par\})?/u,
      () => value === "plain" ? "\\editprobetext" : `{\\${value} \\editprobetext\\par}`);
  }
}

const VALUES: Record<EditField, readonly string[]> = {
  text: ["EditAlpha", "EditAlpha stretches across several ordinary words", "EditBeta", "EditGamma"],
  "class-font": ["8", "9", "10", "11", "12", "14", "17", "20"], aspect: ["43", "169"],
  theme: ["default", "Madrid", "Boadilla"], alignment: ["centering", "raggedright", "raggedleft"], date: ["2000", "2024", "2026", "2031"],
  "bounds-width": ["0.01", "0.2", "1", "3"], width: ["0.01", "0.2", "0.6", "1", "2.4", "4.5"], rotation: ["0", "15", "-25", "45"],
  overlay: ["1-", "2-", "2", "2-3", "3-"], color: ["255,0,255", "18,137,67", "0,128,255"],
  comment: ["short", "long offset with astral 🖉 and accented é", "🖉🖉", ""], title: ["A", "B", "LongerTitle"], scope: ["plain", "centering", "raggedleft"],
};

export function generateBeamerEditSequence(source: string, family: string, seed: number, steps: number): BeamerEditSequence {
  const random = makeRng(seed), pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)]!;
  const actions: BeamerEditAction[] = [{ kind: "navigate", frame: 0, step: 1 }, { kind: "neighbors" },
    { kind: "navigate", frame: 1, step: 2 }, { kind: "layer", enabled: true },
    { kind: "set", field: "width", value: "0.2", mode: "typing", render: true },
    { kind: "set", field: "width", value: "1", mode: "typing", render: true },
    { kind: "navigate", frame: 0, step: 1 }];
  let current = source;
  for (let index = 0; index < steps; index++) {
    const field = index < EDIT_FIELDS.length ? EDIT_FIELDS[index]! : pick(EDIT_FIELDS);
    const choices = VALUES[field].filter(value => setField(current, field, value) !== current);
    if (!choices.length) continue;
    const value = pick(choices);
    const probe = ["width", "rotation", "overlay", "title"].includes(field);
    actions.push({ kind: "navigate", frame: field === "bounds-width" ? 2 : probe ? 1 : 0, step: 1 + Math.floor(random() * 4), ...(field === "bounds-width" ? { picture: true } : {}) });
    if (probe) actions.push({ kind: "layer", enabled: true });
    const mode = index % 7 === 3 ? pick(["typing", "command"] as const) : pick(["typing", "typing", "command", "race"] as const);
    actions.push({ kind: "set", field, value, mode, render: index % 7 !== 3 });
    current = setField(current, field, value);
    if (index % 7 === 3) {
      const comment = `coalesced-${index}-🖉`;
      actions.push({ kind: "set", field: "comment", value: comment, mode: "typing", render: false }, { kind: "render" });
      current = setField(current, "comment", comment);
    }
    if (index % 5 === 0) actions.push({ kind: "neighbors" });
    if (index % 9 === 4) actions.push({ kind: "abort", afterYields: pick([1, 3, 8]) });
    if (index % 11 === 5) actions.push({ kind: "mask", enabled: true }, { kind: "mask", enabled: false });
    // The next mutation derives from the restored source during materialization.
    // Generate undo as a round trip so its modeled source remains current.
    if (index % 8 === 6) actions.push({ kind: "undo" }, { kind: "undo" });
  }
  actions.push({ kind: "navigate", frame: 1, step: 2 }, { kind: "navigate", frame: 0, step: 1 }, { kind: "render" });
  return { formatVersion: 1, probeVersion: source.includes("% edit-bounds") ? 2 : 1, seed, family, source, actions };
}

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
