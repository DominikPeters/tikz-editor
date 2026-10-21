# Stale-representation editing bugs: findings and fix plan

Status: investigation complete 2026-07-07; CM sync fix landed same day; retargeting guard awaiting go/no-go.

## Background

The store's `source`/`sourceRevision` advance synchronously on every dispatch, while the
`snapshot` (parse result, scene, edit handles) is recomputed asynchronously (single-flight,
debounced 120–220ms for typing) and lands via `SNAPSHOT_READY`. Everything the UI derives from
the snapshot — canvas hit-testing, selection, inspector descriptors — can therefore lag the live
source. Two distinct bug classes fall out of this; both were confirmed with executable repros.

## Class 1 — CodeMirror sync offset corruption (FIXED 2026-07-07)

`ExternalSourceSyncManager` (`packages/app/src/ui/source-panel/SourcePanel.tsx`) applies
store-produced span patches to the CM buffer, deferred to a rAF (80ms throttle during canvas
drags/text edits). Pre-fix, the "trusted patch" fast path was authorized by revision bookkeeping
alone, and when the buffer revision was unknown — true after every keystroke and at mount — the
manager *assumed* the buffer sat at the patch base. A keystroke landing in the coalescing window
got patches applied at shifted offsets: `\draw (0,0) -- (1,1);` + move became
`\draw(2,2)) -- (1,1);`. The manager then recorded `lastKnownSource = nextSource` (asserted, not
measured), so it never self-repaired; the corruption reached the store on the next CODE_EDITED,
which also cleared the WYSIWYG undo history.

Additionally confirmed: the EditorView is created once (`SourcePanel.tsx`, mount effect with `[]`
deps) and survives document switches unkeyed (`DockLayout.tsx` renders `<MemoSourcePanel />`),
while revision numbers are per-document counters — so cross-document revision collisions could
authorize applying one document's patches into another document's text.

Fix (landed): revision numbers are demoted to short-circuit hints. Patch mode (single-step and
chain) is only taken when replaying the patches on the tracked buffer content byte-reproduces
`nextSource` (`patchesMatchSourceTransition` / sequential chain application); anything else falls
back to a full-document replace. Cost: one string apply + compare per flush (≤60/s, ~12.5/s
during drags), well under 0.1ms at 80k chars. Tests: `test/web/source-sync-stale-buffer.spec.ts`
(verified patch, verified chain, keystroke divergence → replace, chain divergence → replace,
cross-document collision → replace).

## Class 2 — stale-id retargeting (OPEN; this doc's decision)

### Root cause

Scene/source ids are positional: `path:${statementIndex}` (`packages/core/src/ast/ids.ts`).
Handle-based actions are protected in core (handle `sourceFingerprint` + `sourceText` content
checks → clean "stale handle" error). ElementId-based actions have no equivalent: the reducer's
`APPLY_EDIT_ACTION` re-parses the live source and resolves `path:N` positionally, while the UI
computed that id from the stale snapshot scene. Whenever a statement was inserted/removed above
the target between snapshot and dispatch, the edit silently lands on the wrong element.

CODE_EDITED preserves `selectedElementIds` by id, so the everyday trigger is: select on canvas →
type a statement above it in the code editor → use the inspector within the recompute window.
Pure-WYSIWYG triggers exist too (duplicate/delete renumber immediately; canvas hit-testing stays
stale until SNAPSHOT_READY).

### Repros

`test/edit-stale-scene-retargeting.spec.ts`, four `it.fails` tests (desired behavior encoded;
currently failing; they self-flag when the guard lands):
1. inspector `setProperty` fills the rectangle instead of the selected circle;
2. duplicate-then-delete deletes the fresh duplicate instead of the clicked circle;
3. `updateNodeText` renames node A instead of selected node B;
4. `resizeElement` stretches the wrong rectangle (reducer-level face of the resize-drag
   staleness-guard exemption, `useCanvasDragController.ts:495`).

All silent: no warning, source stays parseable, figure diverges from user intent.

### Options

**A. expectedSourceRef verification (reject on mismatch).**
Extend elementId-carrying actions with optional `expectedSourceRef: { sourceSpan, sourceText }`,
populated by the UI from the snapshot scene (`element.sourceRef`). Core verifies, after resolving
`path:N` in the live source, that the resolved statement's text equals `expectedSourceText`
(span equality is too strict — unrelated edits shift spans harmlessly; text-at-resolved-span is
the right check, mirroring the handle guard). Mismatch → `unsupported: "stale target"` → existing
warning surface (`lastEditWarningMessage`).
- Touch points: `EditAction` types + a verification helper in core (one choke point:
  `applyEditAction` target resolution); UI dispatch sites attach the ref (inspector mutations,
  editor-commands context, canvas panel, objects panel, context menu). Dispatch sites can adopt
  incrementally — actions without the ref behave as today.
- UX cost: in the staleness window the action is refused with a warning instead of misfiring.
  Window is typically 120–220ms after typing plus compute time; rare in practice.

**B. A + forward remapping (reject → retarget).**
On mismatch, translate the expected span forward through the patch log to locate the statement's
new position, then re-resolve the id. The store already records `lastEditPatches` per WYSIWYG
edit and full `forward` patches in every `HistoryEntry`; a short revision→patches ring buffer
covers WYSIWYG-induced renumbering completely. CODE_EDITED (free typing) produces no patches
today — CM transactions carry precise changes that could be forwarded later; until then,
remapping degrades to A's rejection for typing-induced drift.
- UX: seamless in the common duplicate/delete/reorder windows.
- Cost: patch-log plumbing in the store + span-translation helper (core has the machinery:
  `applySourcePatches` span arithmetic).

**C. Stable statement identity (long-term).**
Content-independent statement uids maintained across edits (parser assigns, patches translate).
Solves the class permanently, also fixes selection-after-undo and enables robust multiplayer/
assistant edits. Big refactor: scene, selection, history, inspector, objects panel all key on
positional ids today. Related to `identityRef?: IdentitySourceRef` already present on scene
elements — partial infrastructure exists.

### Recommendation

A now (small, one choke point in core + mechanical UI adoption; flips the four `it.fails` tests
green); B as a fast-follow reusing A's mismatch signal; C folded into the addon-architecture
Phase 0 / scene-model work rather than standalone.

### Testing plan

- Flip the four repros to regular tests once A lands; add remap-specific cases with B.
- Store-level fuzzer (next phase of the fuzzing plan): drive `editorReducer` with real
  `computeSnapshot` results delivered late/coalesced/mid-gesture at random; interleave edit
  actions computed from the stale snapshot, gesture frame sequences, CODE_EDITED, UNDO/REDO.
  Invariants: source parses; undo round-trips byte-exact; selection resolves; snapshot converges
  at quiescence; with A, every stale dispatch either applies to the *intended* statement text or
  is rejected — never a third outcome. Add a simulated CM buffer with randomized flush timing to
  cover Class-1-style divergence (the existing sync tests cover the deterministic cases).

### Open questions

1. Should A's mismatch warning be user-visible (status bar warning, as drafted) or silently
   dropped for preview-mode writes (`recordInHistory: false`) to avoid warning spam during
   scrubs?
2. Adopt `expectedSourceRef` in `pasteStatements.anchorElementId` and matrix/tree structural ops
   in the first pass, or start with the high-frequency actions (setProperty, delete, move,
   resize, rotate, updateNodeText, duplicate)?
3. For B: ring buffer depth (how many revisions of patches to retain) — proposal: cover the
   worst-case snapshot lag, i.e. ~2× the compute debounce, ≈ last 10 revisions.
