import { getGeometryCheckpoints, rememberGeometryCheckpoints } from "@tikz-editor/core/semantic/evaluate";
import { walkStatements } from "@tikz-editor/core/ast/walk";
import type { Span } from "@tikz-editor/core/ast/types";
import type { SourcePatch } from "@tikz-editor/core/edit/types";
import { createIdentitySpanMapper, type IdentityMove } from "@tikz-editor/core/edit/identity-provenance";
import type { SessionSnapshot } from "./compute";
import type { DocumentSession } from "./store/types";
import { deriveSingleSourcePatch } from "./store/source-patch-diff";

export type { IdentityMove } from "@tikz-editor/core/edit/identity-provenance";
type Entry = { id: string; sourceId: string; kind: string; span: Span | null; text: string };
export type EditingIdentityState = {
  source: string;
  rootId: string | null;
  nextId: number;
  entries: Entry[];
  /** null means a command explicitly selected objects in the new source. */
  selection: string[] | null;
  focused: string | null;
};

/** Map only edits whose ownership is known. Ambiguous replacements keep text
 * evidence for later unique matching, but never inherit a positional parser ID. */
export function advanceEditingIdentities(
  state: EditingIdentityState, source: string, patches: readonly SourcePatch[], moves: readonly IdentityMove[] = []
): EditingIdentityState {
  const mapSpan = createIdentitySpanMapper(patches, moves);
  const entries = state.entries.map(entry => {
    if (!entry.span) return entry;
    let span = mapSpan(entry.span);
    if (span && span.to > source.length) span = null;
    return { ...entry, span, text: span ? source.slice(span.from, span.to) : entry.text };
  });
  return { ...state, source, entries };
}

function key(kind: string, span: Span): string { return `${kind}:${span.from}:${span.to}`; }

/** Parser IDs address this revision; these identities address the user's objects. */
export function reconcileEditingIdentities(
  previous: EditingIdentityState | undefined, snapshot: SessionSnapshot, documentId: string, nextAvailableId = 0
): EditingIdentityState {
  const candidates: Array<Omit<Entry, "id"> & { span: Span }> = [];
  const seen = new Set<string>();
  const add = (sourceId: string, kind: string, span: Span) => {
    if (seen.has(sourceId)) return;
    seen.add(sourceId);
    candidates.push({ sourceId, kind, span, text: snapshot.source.slice(span.from, span.to) });
  };
  if (snapshot.parseResult) walkStatements(snapshot.parseResult.figure.body, {
    onStatement: statement => { add(statement.id, statement.kind, statement.span); },
    onNode: node => { add(node.id, node.kind, node.span); }
  });
  for (const element of snapshot.scene?.elements ?? []) {
    const ref = element.identityRef ?? element.sourceRef;
    add(ref.sourceId, element.kind, ref.sourceSpan);
  }
  let baseline = previous?.rootId === snapshot.activeRootId ? previous : undefined;
  if (baseline && baseline.source !== snapshot.source) baseline = advanceEditingIdentities(baseline, snapshot.source, identityPatches(baseline.source, snapshot.source));
  const oldEntries = baseline?.entries ?? [];
  const bySpan = new Map(oldEntries.flatMap(entry => entry.span ? [[key(entry.kind, entry.span), entry] as const] : []));
  const matched = new Set<string>();
  const assigned = new Map<string, Entry>();
  for (const candidate of candidates) {
    const entry = bySpan.get(key(candidate.kind, candidate.span));
    if (entry?.text === candidate.text && !matched.has(entry.id)) {
      matched.add(entry.id); assigned.set(candidate.sourceId, entry);
    }
  }
  // Unique text is useful for manual reordering. Repeated anonymous objects
  // remain unmatched unless patch provenance already identified them above.
  const oldByText = groupByText(oldEntries.filter(entry => !matched.has(entry.id)));
  const newByText = groupByText(candidates.filter(candidate => !assigned.has(candidate.sourceId)));
  for (const [text, next] of newByText) {
    const before = oldByText.get(text);
    if (before?.length === 1 && next.length === 1) assigned.set(next[0].sourceId, before[0]);
  }
  let nextId = Math.max(previous?.nextId ?? 0, nextAvailableId);
  return {
    source: snapshot.source, rootId: snapshot.activeRootId, nextId: nextId + candidates.filter(c => !assigned.has(c.sourceId)).length,
    entries: candidates.map(candidate => ({ ...candidate, id: assigned.get(candidate.sourceId)?.id ?? `${documentId}:${snapshot.activeRootId ?? "root"}:object:${nextId++}` })),
    selection: baseline?.selection ?? null, focused: baseline?.focused ?? null
  };
}
function groupByText<T extends { kind: string; text: string }>(entries: readonly T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const entry of entries) {
    const text = `${entry.kind}\0${entry.text}`;
    const group = groups.get(text) ?? []; group.push(entry); groups.set(text, group);
  }
  return groups;
}

export function withEditingHandleIdentities(snapshot: SessionSnapshot, state: EditingIdentityState): SessionSnapshot {
  const bySource = new Map(state.entries.map(entry => [entry.sourceId, entry.id]));
  const counts = new Map<string, number>();
  const editHandles = snapshot.editHandles.map(handle => {
    const owner = bySource.get(handle.sourceRef.sourceId);
    if (!owner) return handle;
    // Repeated template instances retain their own runtime handle slot. An
    // ambiguous structural source change cancels a gesture at the session guard.
    const role = `${owner}:${handle.kind}`;
    const index = counts.get(role) ?? 0; counts.set(role, index + 1);
    return { ...handle, editingId: `${role}:${index}` };
  });
  const semanticResult = snapshot.semanticResult ? { ...snapshot.semanticResult, editHandles } : null;
  const checkpoints = snapshot.semanticResult ? getGeometryCheckpoints(snapshot.semanticResult) : undefined;
  if (semanticResult && checkpoints) rememberGeometryCheckpoints(semanticResult, checkpoints);
  return { ...snapshot, editHandles, semanticResult };
}

/** Called once for document transitions; source changes only map spans. Parsing
 * and reconciliation run when the existing compute pipeline supplies a snapshot. */
export function updateDocumentIdentities(before: DocumentSession, after: DocumentSession): DocumentSession {
  if (before.source === after.source) {
    if (before.selectedElementIds === after.selectedElementIds || !after.editingIdentities) return after;
    const bySource = new Map(after.editingIdentities.entries.map(entry => [entry.sourceId, entry.id]));
    const identities = { ...after.editingIdentities, selection: after.snapshot.source === after.source ? null
      : [...after.selectedElementIds].flatMap(id => bySource.get(id) ?? []) };
    return { ...after, editingIdentities: identities,
      editingIdentityRoots: { ...after.editingIdentityRoots, [identities.rootId ?? ""]: identities } };
  }
  let identities = after.editingIdentities;
  if (identities && identities === before.editingIdentities) {
    const bySource = new Map(identities.entries.map(entry => [entry.sourceId, entry.id]));
    identities = { ...identities,
      selection: before.selectedElementIds === after.selectedElementIds
        ? identities.selection ?? [...before.selectedElementIds].flatMap(id => bySource.get(id) ?? []) : null,
      focused: before.focusedScopeId ? bySource.get(before.focusedScopeId) ?? null : null };
    const patches = after.lastEditPatchBaseRevision === before.sourceRevision && after.lastEditPatches
      ? after.lastEditPatches : identityPatches(before.source, after.source);
    identities = advanceEditingIdentities(identities, after.source, patches, after.pendingIdentityMoves);
  }
  const roots = { ...after.editingIdentityRoots };
  for (const [key, state] of Object.entries(roots)) {
    if (state.source !== after.source) roots[key] = advanceEditingIdentities(state, after.source,
      after.lastEditPatchBaseRevision === before.sourceRevision && after.lastEditPatches ? after.lastEditPatches : identityPatches(state.source, after.source), after.pendingIdentityMoves);
  }
  if (identities) roots[identities.rootId ?? ""] = identities;
  const history = [...after.history];
  const entry = history[after.historyIndex];
  if (entry?.sourceAfter === after.source && after.history !== before.history) {
    history[after.historyIndex] = { ...entry,
      identitiesBefore: entry.identitiesBefore ?? before.editingIdentities,
      identitiesAfter: identities, identityRootsBefore: entry.identityRootsBefore ?? before.editingIdentityRoots, identityRootsAfter: roots };
  }
  const editingTargetsStale = after.lastEditPatchBaseRevision !== before.sourceRevision && before.editingIdentities ? true : after.editingTargetsStale;
  return { ...after, editingTargetsStale, editingIdentityRoots: roots, editingIdentities: identities, pendingIdentityMoves: undefined, history: after.history === before.history ? after.history : history };
}

function identityPatches(before: string, after: string): SourcePatch[] {
  return deriveSingleSourcePatch(before, after) ?? [{ oldSpan: { from: 0, to: before.length }, newSpan: { from: 0, to: after.length }, replacement: after }];
}
