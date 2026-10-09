# Canvas Editing Architecture

Draft 2026-10-08. Revised the same day after a Codex architecture review:
see "Revision notes" at the end. This is the implementation architecture
for the keyboard and editing semantics specified in
`design/canvas-keyboard-scenarios.md` (called *the scenarios doc* below:
rules R1–R17, decisions, sections K, T, V, Z and O). It builds on the
session, scope and object-layer model in `design/beamer-canvas-editing.md`.

The scenarios doc says *what* each keystroke means. This doc says how to
structure the code so that those meanings stay predictable and
maintainable as constructs nest. The main risk it addresses is the one the
scenarios doc keeps running into: per-key if/else ladders that each
re-derive "where am I?" and disagree once constructs nest.

## Scope

In scope:
- Canvas-focus editing in Beamer scope sessions: prose, lists, inline and
  display math, style wrappers, macros, alignments (`align*`, `array`,
  `tabular`, matrices) and overlays.
- Typing, deletion, structural keys, navigation, selection, formatting,
  the command chip, paste and undo.

Out of scope:
- **TikZ node text editing.** It shares the input machine and must keep
  working unchanged; the new path is enabled per session kind, and the
  TikZ route keeps its own regression tests throughout the migration.
- **Table structure editing**: inserting or deleting columns, editing the
  column specification, `\multicolumn`, rules, per-column alignment. A
  later pass will build it on the alignment model defined here. Typing in
  cells, moving between cells, adding rows and joining rows are in scope.
- **Engine recovery internals** (scenarios doc T1–T7: run isolation, ghost
  closers, recovery diagnostics). That is a parallel track, but its
  *interface* to this architecture is specified here (§Interfaces) and
  must be agreed before either side builds on it.

## Diagnosis of the current structure

- `packages/core/src/beamer/structural-edit.ts`: pure patch builders, one
  per key (`beamerStructuralEnterPatch`, `…BackspacePatch`, `…TabPatch`,
  …). They are good as pure functions, but each re-derives its context
  from a flat caret domain with ad-hoc queries (`isInsideMath`,
  `beamerListItemAt`, `paragraphRoleAt`) and branches on the answers. Every
  new construct kind would add a branch to every key's ladder.
- `packages/core/src/beamer/caret-stops.ts`: the canvas caret domain is a
  sorted list of unique source offsets plus rows of x positions. It has no
  slot identity, ancestry or boundary side, and no y within a row. Macro
  invocations are collapsed wholesale. Inside math, every source offset is
  a stop (the `\setminus` problem).
- `packages/core/src/text/tex/math/inline-provider.ts`: the math caret map
  spreads each glyph's stops across its whole source span. The math IR
  already attaches scripts to their bases and knows each construct's
  slots, but the provider does not publish the parsed structure, and
  rejects parses that carry errors, so the editor sees only a flattened
  per-offset map.
- `packages/app/src/ui/canvas-panel/useCanvasTextEditSession.ts` (~2,400
  lines): keydown handling is a hand-ordered chain. It runs Escape, then
  the focus-switch shortcut, then structural keys, then Tab, then rendered
  motion, then modifier shortcuts. Each handler repeats its own modifier
  and composition guards, and Escape has none. Typed characters go through
  a separate beforeinput path in `canvas-text-edit-machine.ts`, so "what
  does this keystroke mean" is answered in three places.
- `packages/app/src/ui/canvas-panel/canvas-text-edit-machine.ts`: the
  applier recomputes *one* bounding minimal replacement per edit
  (`computeMinimalReplacementPatch`). That is fine for the buffer, but it
  loses the disjoint patches a position mapping needs. Undo checkpoints
  every ordinary input, and every structural edit, including
  selection-only ones. A stale structural edit is swallowed rather than
  replayed.
- `packages/core/src/text/format-commands.ts`: a separate lexical scanner
  for wrappers. It is a third interpretation of `\textbf{…}`, next to the
  text engine's (`font-command` IR nodes, which already retain command and
  content spans) and the syntax index's.

## Principles

1. **Pure core, thin shell.** All interpretation lives in
   `packages/core` as pure functions: tree, positions, intents,
   operations, transactions. The app translates DOM events into intents,
   applies transactions, and draws. Every keystroke meaning in the
   scenarios doc can be tested without a browser.
2. **The source is the truth.** Any interpretation is a function of the
   source, the interpretation environment (macros in scope, overlay step)
   and the session's ephemeral state. That state is explicit, small and
   enumerated (§Interaction state). Undo restores source and selection,
   never ephemeral state (scenarios doc O7).
3. **Editable structure does not depend on rendering success.** The tree
   comes from a source-level syntax and binding layer. Engines *annotate*
   it with meaning and geometry. A construct the engine fails to lay out
   is still a construct, with its slots, rendered as a literal or a
   placeholder, so it stays editable.
4. **Operations, not handlers.** Every edit is one of a small library of
   shared structural operations (delete a range, find the adjacent item in
   a direction, remove a slot, split and rewrap a path, enter or create a
   script, wrap). Node kinds *declare capabilities* (owns this intent,
   barrier, transparent, splittable). They do not contain free-form
   handler code. Ownership is decided before anything executes.
5. **Geometry is separate from logic.** Horizontal motion, deletion,
   typing and structure need only the tree. Vertical motion, clicks,
   carets, outlines and ghosts need geometry, which an adapter supplies.
6. **Fail safe to an atom, and say why.** Anything that cannot be bound
   becomes an opaque atom whose source stays editable through the source
   lens. A debug diagnostic names the cause, so that silent atomisation of
   valid TeX shows up in tests.
7. **Scenarios are the specification.** The scenarios doc's notation is
   the test format, and the hardest scenarios are written as contract
   tests *before* the abstractions they constrain.

## Alternatives considered

- **Document model as primary** (ProseMirror, Slate): the tree is the
  editable model, and TeX is serialised from it. Structural edits and
  stable selections become simple. Rejected because it conflicts with R1
  and with source fidelity. Preserving comments, authored braces,
  `\frac1n`, spacing and unknown commands would require a lossless
  concrete layer anyway. At that point, serialisation is a lossy round
  trip that adds risk without removing the concrete layer.
- **Rendered layout as the model**: the editor works on boxes and glyphs.
  Rejected: layout loses everything that is invisible (braces,
  terminators, comments, overlay markers) and fails exactly when the
  source is temporarily invalid.
- **Bidirectional transformations (lenses)** between source and an abstract
  model: elegant for well-behaved edits, but TeX's macro layer makes the
  backward direction ill-defined in general.
- **Chosen: a source-truth, lossless concrete tree with bindings and engine
  annotations.** This is the CST-backed design Codex argued as the
  strongest alternative. The difference from the first draft is that
  argument binding and script attachment become an explicit shared layer
  (§Binding layer) instead of being split between the syntax index and the
  engines.

## Pipeline

```
DOM events (keydown, beforeinput, composition*, paste, pointer)
   │  InputAdapter (app): normalise into Intents carrying origin and repeat
   ▼
Intent ──► Interaction state (composition overlay; chip / pending /
   │        picker / lens / armed-deletion), which may capture first
   ▼
Ownership: scan the caret's ancestry for capabilities; pick the owner
   │        (barriers stop the scan) before executing anything
   ▼
Operation (shared library) executed with the owner's parameters
   │        (may transform the path between caret and owner)
   ▼
Transaction (patches in pre-edit coordinates, mapped selection,
   │        interaction-state delta, undo group, hint)
   ▼
Logical model update, synchronous: buffer patch + tree and position
   │        mapping through the patches, so the next intent sees the
   │        new state at once
   ▼
Layout, asynchronous: engines re-lay out → annotations + geometry
          catch up; the caret is drawn from mapped geometry meanwhile
```

## Components

### Binding layer and EditTree

**Lexical layer: the TeX syntax index** (`text/tex/syntax-index.ts`,
Lezer-based). It is authoritative for tokens, comments, groups,
optional and overlay arguments, environment boundaries and parse errors.
It is *not* authoritative for which arguments a command consumes, or for
script operands. In the grammar, `GenericCommand` is just a control
sequence, and `MathIdentifier` is a multi-letter `WordToken`, so the
grammar's operand of `x^ij` is `ij` where TeX's is `i`.

**Binding layer (new, shared).** It runs over the lexical tokens and binds:
- **command arguments**, from the CommandTable arity and argument kinds,
  including unbraced single-token arguments (`\frac1n`);
- **script attachment**, TeX's single-token rule: `^`/`_` take the next
  token or group, and attach to the preceding base, or to an empty base;
- **environments**, from matched boundaries;
- **macro invocations**, mapping arguments to their appearances in the
  expansion. This is needed for K1's style and slot macros. Today, macro
  arguments are read-only and their output selects the invocation
  (`beamer/render.ts`); that gating changes for macros whose arguments are
  proven to map one-to-one.

The binding layer is the one place where "what belongs to what" is
decided. Both the EditTree and (eventually) the engines' editing facts
agree with it. Where an engine's own parse disagrees, the binding layer
wins for editing, and a debug diagnostic is emitted. The node does not
silently become an atom (principle 6 applies only when binding itself
fails).

**EditTree.** One tree per edit scope, built from the bound syntax, then
annotated:

```ts
type EditNode = {
  id: NodeId;
  kind: EditNodeKind;
  span: Span;                  // full source extent, delimiters included
  slots: readonly EditSlot[];
  delimiters: readonly Span[]; // source owned by the construct itself
  mode: "text" | "math" | "verbatim";
  command?: CommandRef;
  parent: NodeId | null;
  annotations: {               // from the engines; absent when layout failed
    rendered: "normal" | "literal" | "placeholder" | "hidden-on-step";
    role?: string;
  };
};
type EditSlot = {
  id: SlotId;
  role: SlotRole;              // content | numerator | denominator | sup | sub | index | cell | label | …
  presence: "present" | "absent";   // an absent optional slot is a ghost (V3), not an empty one
  contentSpan: Span;           // empty span when present-but-empty
  braced: boolean;             // `\frac1n` vs `\frac{1}{n}`, `x^2` vs `x^{2}`
  children: readonly NodeId[];
};
```

Node kinds (as built in step 3):
- **Flow:** `scope`, `paragraph`, `list`, `item`, `container` (blocks,
  theorems, floats, `center`, `minipage`, …), `display`, `alignment`
  with `row`, `vertical` (`\medskip`, `\vspace`, `\pause`). Alignment
  cells are the slots of a row, as numerator and denominator are the
  slots of a fraction; there is no cell node.
- **Inline:** `style` (font commands, `\textcolor`, `\alert`, style
  macros), `declaration` (`\bfseries`, `\color`, `\centering`, which
  scope to the end of their group), `overlay` (`\only`, `\uncover`,
  `\alt`), `group` (bare braces), `formula`, `text-in-math`, `link`,
  `break` (`\\`, `\newline`). Verbatim content is an `atom`.
- **Math:** `fraction`, `radical`, `scripted` (a base that owns its
  scripts, per scenarios doc O3), `delimited`, `accent`, `overset`,
  `operator`.
- **Leaves:** `char`, `symbol`, `atom`, `space`, `invisible`.

Invariants, checked by property tests:
- Spans nest.
- Every source offset in the scope is covered by exactly one leaf,
  delimiter or slot gap.
- Delimiters are never items.

**Engine annotations** (adapting the engines to publish what they already
know):

| Fact | Today | Adaptation |
| --- | --- | --- |
| Style wrapper identity and content spans | Text IR `font-command`, `group` and `color-command` nodes retain them. They are lost only when the IR is converted to tokens. | Publish the retained structure alongside layout. |
| Math construct and slot structure, script attachment | Math IR has it (scripts attached to bases). The provider drops it, and rejects error-bearing parses. | Publish the parsed structure, with slot delimiter spans and the braced flag, *even when layout fails*. |
| Math caret geometry | Flattened per offset, spread across command spans | Geometry per tree position (x, y, height, depth). Derive the old map from it for existing consumers. |
| Alignment rows and cells | Tabular and math alignment layout | Publish row and cell spans, `&` and `\\` delimiter spans, and the fixed column count. |
| Macro expansion provenance | Arguments are read-only; output selects the invocation | Publish argument → output provenance for K1. |
| Overlay visibility per step | `hiddenSourceSpans`, editable-span gating | None. |

### Interpretation environment

The tree is a function of `(scope source, environment, step)`. The
environment is the macros in effect at the scope: preamble definitions
plus body definitions *before* the frame (K14; current rendering already
resolves bindings from preceding scoped source), together with the
document engine (for R16). The environment has its own revision, and the
cache key includes it. A body `\newcommand` added above a frame therefore
invalidates that frame's tree even though the frame's text is unchanged.
The step decides which subtrees are navigable. A step change during a
session clamps the caret to the nearest visible position (Z4). The
ghosted "show covered content" view (V8) renders hidden subtrees as
non-navigable.

### Positions and selection

```ts
type Position = { slot: SlotId; index: number };
type Affinity = "before" | "after";   // which side of a shared offset
type Selection = {
  rawAnchor: Position; rawFocus: Position;   // what the user did
  effective: { anchor: Position; focus: Position };  // after promotion
};
```

- **Offsets are not unique.** The inside end of an unbraced script
  (`x^2‸` in the sup slot) and the position after the scripted atom share
  one source offset. The same holds for any slot without closing
  delimiter source. Therefore:
  - `position → offset` is a function;
  - `offset → position` needs an affinity, and returns all candidates
    otherwise;
  - transactions express the post-edit selection as **positions mapped
    through the patches**, not as bare offsets (§Transactions).
- **Invisible syntax** is resolved to its content side for *placement*
  (R11), but offsets inside invisibles are not caret positions. The
  property test is "every position round-trips through
  offset-with-affinity", not "every offset round-trips".
- **Offsets in insignificant whitespace** (a slot gap: spaces in math,
  blank lines between blocks) have no positions of their own. They
  resolve to the position the gap belongs to, so `\le‸ 0` and
  `\le ‸0` are one place. Offsets inside a command name, a brace or a
  value have no position at all.
- **Present vs absent slots.** An absent optional slot (no `[n]` on
  `\sqrt`) has no positions until it is created through its ghost. A
  present-but-empty slot has exactly one position.
- **Horizontal motion** is a pure traversal of positions in document
  order. Word motion uses the same traversal with word granularity.
- **Selection promotion** is per kind:
  - *content constructs* (formula, fraction, script, link, …) promote:
    when raw anchor and focus are in different slots and the path between
    them crosses a content construct's boundary, the effective endpoints
    are lifted to whole children of the lowest common slot.
  - *style wrappers* are transparent: a range may cover part of one, and
    range operations split it (F5: selecting `b` plus the first character
    of `\textbf{cd}` and deleting leaves `\textbf{d}`).

  Promotion is recomputed from the raw endpoints on every move, so
  reversing direction undoes it.
- **Soft-wrap ambiguity.** A position at a soft line break has two caret
  placements, end of one row and start of the next. Geometry returns
  both, and the affinity picks one (today's domain already prefers the
  row start).

### CommandTable

```ts
type CommandSchema = {
  name: string;
  category: "style" | "construct" | "symbol" | "atom" | "vertical" | "environment" | "spacing";
  mode: "text" | "math" | "any";
  args: readonly ArgSchema[];      // in source order; drives the binding layer
  wrapTarget?: number;             // which arg receives a wrapped selection (R10)
  pairing?: { closer: string };
  variants?: string;
  creation?: CreationTemplate;
};
type ArgSchema = {
  kind: "mandatory" | "optional" | "overlay";
  role: SlotRole | "value";
  rendered: boolean;
  unbracedSingleToken: boolean;    // TeX-style undelimited argument allowed
  valueDomain?: "color" | "dimension" | "url" | "label-key";
};
```

- **Seeded from** the math symbol definitions, the text engine's
  font-command lists and the beamer overlay commands.
- **User macros** enter through K1 classification, with no special cases
  and no overrides.
- **Consumers:** the binding layer, chip completion, the frequent-styles
  list, the focus-tag variants, wrapping, creation and paste conversion.
- **Creation collects every required value argument**, not just the wrap
  target. `\textcolor` around "risk" needs argument 1 (a colour) although
  the selection goes to argument 2, so the picker opens for the colour.
  Creation without a selection prompts the same way. One transaction is
  committed at the end; cancelling restores the original selection
  exactly (O8).

### Intents

```ts
type IntentOrigin = "keyboard" | "composition" | "paste" | "menu" | "pointer";
type Intent = { origin: IntentOrigin; repeat: boolean } & (
  | { type: "insertText"; text: string }
  | { type: "deleteBackward" | "deleteForward"; unit: "item" | "word" | "line" }
  | { type: "enter"; soft: boolean }
  | { type: "tab"; back: boolean }
  | { type: "move"; dir: "left" | "right" | "up" | "down"; unit: "item" | "word" | "line" | "edge" | "scope"; extend: boolean }
  | { type: "format"; command: string }
  | { type: "paste"; payload: ClipboardPayload }
  | { type: "copy" | "cut" }
  | { type: "escape" } | { type: "unwrap" } | { type: "openLens" }
  | { type: "click"; point: PagePoint; extend: boolean; count: 1 | 2 | 3 }
);
```

- **Origin** matters. A `[` committed by composition, or arriving by
  paste, never opens a pending command's optional argument (O4). Menu
  intents never arm deletion.
- **`repeat`** is carried, so that "key repeat never confirms" (R9) is
  enforceable.

### Interaction state

The session's only non-source state is a small record. **Composition is an
overlay**, not a mode: it can be active on top of any state, and suspends
interpretation until it commits.

```ts
type InteractionState = {
  composing: boolean;                       // overlay (R17)
  mode:
    | { type: "normal" }
    | { type: "chip"; buffer: string; selectionHeld?: Selection }
    | { type: "pendingCommand"; node: NodeId }          // O4: next keystroke only
    | { type: "picker"; command: string; values: Partial<Record<number, string>>; restore: Selection }
    | { type: "lens"; span: Span };
  armedDeletion?: { selection: Selection }; // R9: selected by ⌫, awaiting a fresh press
  createdBraces: readonly Span[];           // R6 provenance; cleared on commit and on undo/redo
  goalX?: number;                           // sticky vertical motion
};
```

Transitions are listed in a table in the code, next to the scenario tests
that exercise them. Every transition that is not listed is a no-op,
covered by a test. Examples:
- `armedDeletion` is set by a Backspace that selects a construct, cleared
  by any other intent, and only a non-repeat Backspace consumes it.
- `pendingCommand` ends on any intent other than a keyboard-origin `[` or
  `{`.

### Ownership, operations, and why this avoids the spaghetti

**Step 1: decide the owner (no side effects).** Each node kind declares,
per intent type, one capability:

| Capability | Meaning |
| --- | --- |
| `owns(op, params)` | This node handles the intent with the given shared operation. |
| `barrier(hint?)` | Stop: nothing at or above this node may handle the intent. |
| `transparent` | Skip this node, but the chosen operation must carry it along (e.g. split it). |
| `pass` | Skip this node. |

The resolver scans the caret's whole ancestry, from the caret up to the
scope, and *collects* capabilities. Only then does it decide, with one
rule for all intents: **if any node on the chain declares `barrier` for
this intent, the result is a stop (with that barrier's hint); otherwise
the innermost `owns` wins.** `transparent` nodes between the caret and the
owner are handed to the operation, which must carry them along.

Checked against O1 (Enter):
- `$a‸+b$` in a paragraph: there is no barrier, and the inline formula
  is the innermost owner, so it splits or exits (Z1).
- `$\text{one $a‸+b$ two}$`: the inner formula owns, but `text-in-math`
  is a barrier for Enter, so the result is a stop with a hint.
- `$\frac{a‸}{b}$`: the fraction slot is a barrier, so the result is a
  stop.
- `\item one \textbf{two‸ three}`: `style` is transparent and the item
  owns, so `splitPath` closes and reopens `\textbf` around the split.

The decision is a pure function over the collected list, tested on its
own. It lives in one place, not in N handlers.

**Step 2: execute a shared operation.** Operations are a small library:

| Operation | Used by |
| --- | --- |
| `deleteRange(range)` | selection deletes, cut, typing over a selection; splits style wrappers, promotes content constructs |
| `adjacentItem(dir)` | Backspace/Delete targeting. Direction-aware: backward looks through style wrappers and into scripts (O3, "delete the 2"); forward from before a scripted base targets the whole `scripted` node. |
| `removeSlot`, `stepOut`, `moveToSlotEdge` | O2 rows |
| `splitPath(from caret up to owner)` | Enter in an item through `\textbf{…}`: every `transparent` node on the path is closed before the split and reopened after (Z1) |
| `enterOrCreateScript(kind)` | `^`/`_`: enter an existing script (K4), else create one with editor-owned braces |
| `wrap(command, values, selection)` | R10, O8, the formatting commands |
| `insertText(text, slot)` | after input rules, with R5 terminator hygiene |
| `convertPaste(payload, destinationMode)` | O6 table |
| `joinRows`, `newRow`, `nextCell` | alignments (D2–D4) |

**Operations own their preconditions.** `joinRows` checks the column count
and returns a refusal with a hint if the merged row would not fit (D3),
so the owner never needs an if/else. The O2 Backspace precedence becomes
the Backspace capability declarations of `construct`, `slot` and
`scripted`, plus `adjacentItem`'s direction rules. What used to be the
scenarios doc's precedence tables are data plus two pure functions.

**Input rules delegate to operations.** The character table (R2, R3, R4,
R6, R16, K3, K9) maps `(mode, char)` to an *operation request*, not to a
patch. `^` in math is `enterOrCreateScript("sup")`. It is the operation,
not the rule, that knows whether a superscript exists, so K4 lives in
exactly one place.

### Transactions

```ts
type Transaction = {
  baseRevision: number;                       // logical-model revision it was computed against
  patches: readonly { span: Span; insert: string }[];  // pre-edit coordinates, sorted, non-overlapping
  selectionAfter: { anchor: MappedPosition; focus: MappedPosition };  // positions + affinity, resolved after mapping
  interactionDelta?: Partial<InteractionState>;
  undo: { group: "typing-run" | "chip" | "transformation" | "own-step"; mergeKey?: string };
  hint?: HintId;
  balance: "required" | "exempt";             // exempt only for Paste as TeX and edits inside already-invalid source
};
```

**Revision protocol.** The logical model (buffer, bound tree and
positions) advances *synchronously* with each transaction. Positions and
node ids are mapped through the disjoint patches. So the next intent is
resolved against the new state even if layout has not caught up. Layout
annotations and geometry are revision-tagged. Until they catch up:
- carets and outlines are drawn from the previous geometry, mapped through
  the patches;
- anything needing new geometry (vertical motion, clicks) waits for it,
  or uses the mapped estimate.

Until the binding layer exists (step 3), the only structure source is
the rendered layout, so the step-2 protocol is the "waits for it" half:
an intent that reads the layout (canvas motion, Enter, Tab, ⌫/⌦ on the
canvas, list toolbar commands) is queued until the caret domain was built
from the current buffer, and every later intent queues behind it. If the
layout has not caught up after 200 ms (a render failed), the queue runs
against the layout as it is, with the structural staleness guard, and
later intents stop waiting until the layout is current again. The caret
domain records the source its layout was rendered from, which is its
revision tag.

No intent is dropped because layout lags. This replaces today's "swallow
stale structural edits".

**The applier** keeps the disjoint patches, so they can be used as the
identity map. The buffer may still apply a minimal-diff replacement
internally.

**Undo grouping is explicit and new** (today's machine checkpoints every
input and every structural edit):
- consecutive `typing-run` transactions in one slot merge. The run ends
  at a pause of more than one second, at any selection change that is not
  part of the run (arrows, clicks), at any other transaction, and at
  undo/redo. Typing and deleting are separate runs. Other editors differ
  (TeXmacs merges adjacent inserts with no time or word limit, VS Code
  breaks before a space, LibreOffice at letter/non-letter changes,
  CodeMirror after 500 ms); the pause rule was chosen so that ⌘Z never
  removes a whole sentence typed in one go;
- an IME composition, from its first update to its commit, is one step;
- a chip from `\` to commit is one group;
- `transformation` groups (smart quotes, list autoformat) are a separate
  step after their literal keystroke (R12);
- selection-only transactions never create undo steps.

Ending a session folds its steps into one store-level entry, which
carries the scope id. Undo after the session has ended reopens a session
on that scope at the restored selection (Z6).

### Geometry index

This is the DOM-free part of what `caret-stops.ts` and the hit maps
provide today, keyed by positions and revision-tagged:
- **Caret placements per position:** one, or two at soft wraps; page
  coordinates with paint transforms applied.
- **Rows** for vertical motion, with sticky `goalX`, plus structural
  vertical moves (N4) decided by the tree.
- **Hit testing:** a point gives the position and its affinity (the ink
  box rule at formula edges, N5).
- **Node bounds** for outlines (focus and parent), ghost slots, the
  breadcrumb highlight and step badges.

### Interfaces to neighbouring systems

- **Recovery and the source lens (agreed before the parallel track
  starts).**
  - The engine reports `recovery` diagnostics: virtual closers with their
    source position, literal-fallback spans, and swallowed spans.
  - The tree marks affected nodes `rendered: "literal"` but keeps their
    binding (principle 3).
  - The lens edits a *span*. While it is open, the canvas shows the lens
    span's live render and keeps everything else on the last good
    annotations (T1, T7). Positions outside the span are mapped through
    the lens's patches.
  - Escape from an invalid lens span keeps the text and shows T6's
    quick-fix pill. It never reverts silently.
- **Clipboard.** Copy and cut write `text/plain` (the rendered text) and a
  custom type, `{ source, mode, shape: "fragment" | "whole", macros }`.
  `shape` distinguishes a formula fragment from a whole formula (O6);
  `macros` lists the user macros used, so pasting into another document
  can warn (Z3). Paste reads the custom type first.
- **Object layer.** The resolver can return shell effects alongside
  transactions: `selectObject(objectId)` (the Esc ladder),
  `drillIn(objectId)`, and `promoteToObjects(ids)` (tier-3 selections that
  cross containers). Object ids are mapped from tree node ids by span.
- **Stable ids.** Node ids are mapped through patches. On split, the left
  part keeps the id and the right part gets a new one. On merge, the
  surviving left id stays. A duplicate gets a new id. Structural-path ids
  are only a fallback, and are never reused across sibling insertions.

### Affordance renderers (app)

These are thin React layers over tree plus geometry: the caret with its
style additions (V11), focus and parent outlines with the tag (R8, V4),
the breadcrumb (V11), the command chip with ghost completion (V2), ghost
slots (V3), hints (V7) and the picker (O8). They contain no editing logic;
menu actions dispatch intents.

## Testing

- **Contract tests first.** These are adversarial scenarios that pin down
  the abstractions before they are built:
  - F5: partial style-wrapper ranges;
  - R8 boundaries at unbraced scripts (`x^2`);
  - nested Enter ownership, O1: `$\text{one $a‸+b$ two}$`;
  - directional O3: `$ax^2‸$` Backspace vs `$a‸x^2$` forward Delete;
  - K4: a second `^`;
  - O8: picker cancellation with selection restore;
  - O4: `[` from composition;
  - burst typing faster than layout;
  - undo grouping.
- **Scenario DSL.**

  ```ts
  scenario("M7 replace setminus", {
    source: String.raw`$A\setminus B‸$`,
    keys: "← ⌫ \\cup␣",
    expect: String.raw`$A\cup‸ B$`,
  });
  ```

  The harness renders with the real engines in Node. It can also run
  layout lazily, applying intents faster than layout, to exercise the
  revision protocol.
- **Two tiers.** Logic scenarios assert source and selection; geometry
  scenarios assert positions against layout.
- **Property tests over the corpus:**
  - positions round-trip through offset-with-affinity;
  - tree invariants hold;
  - random intent sequences keep the source balanced (except
    `balance: "exempt"` transactions);
  - typing any prefix of a construct never changes the topology outside
    the focus;
  - binding-layer vs engine disagreements are reported, not silent.
- **Performance, measured honestly.** The current Beamer canvas latency
  gate (`apps/web/profiling/profile-beamer-canvas-text-latency.spec.ts`)
  is paced edits in one warmed KKT column. Chromium medians are already
  around 48–52 ms, and thresholds sit just above the noise band (55/85 ms
  median, 100 ms p95), so a new per-keystroke cost has essentially no
  headroom. The binding and tree work must therefore be incremental:
  - reuse unchanged paragraphs' subtrees by span mapping;
  - re-bind only the edited paragraph;
  - note that the syntax index currently re-enumerates the whole tree even
    when it parses incrementally, so it needs incremental enumeration
    too.

  Measure input-to-paint latency, burst typing, and mixed math/table
  scopes, not just tree-build time.

## Code layout

```
packages/core/src/editing/
  binding/     binding layer over the syntax index; macro classification
  tree/        EditTree types, builder, annotation merge, invariants
  position/    positions, affinity, traversal, selection promotion
  commands/    CommandTable schema and built-in entries
  input/       intents, input rules, interaction state and transitions
  ownership/   capability declarations per kind, owner decision per intent
  operations/  the shared operation library
  transaction/ transaction type, mapping, undo grouping, validation
  geometry/    GeometryIndex (DOM-free), revision-tagged
  testing/     scenario DSL, contract tests, harness
```

What happens to the existing files:
- `caret-stops.ts` is replaced by `position/` plus `geometry/`.
- `structural-edit.ts` patch builders become implementations inside
  `operations/` (item split, nest and unnest, list toggle). Object-layer
  patches stay.
- `format-commands.ts` wrap, unwrap and split become `wrap` and
  `deleteRange` internals. Its lexical scanner is retired in favour of the
  binding layer.
- `useCanvasTextEditSession.ts` loses its key ladders. Events go to the
  InputAdapter, transactions go to the applier.
- `canvas-text-edit-machine.ts` keeps the session lifecycle and the
  buffer. It gains the revision protocol, disjoint-patch mapping and
  explicit undo groups.

## Migration plan

Reordered after the review, to avoid intermediate states where navigation
uses positions but deletion still uses raw source ranges.

1. **Contract tests and harness.** The scenario DSL, the contract tests
   above (initially failing or marked pending), and characterisation
   tests that pin down today's list keys, motion, select-then-delete and
   the TikZ node route.
2. **Contracts in code, no UX change.**
   - The InputAdapter with origin, repeat and the composition overlay.
   - The transaction type with disjoint patches and the revision protocol.
   - Explicit undo groups.
   - The existing structural keys are re-expressed as transactions.

   *Exit:* characterisation tests are green, burst-typing tests pass, and
   the key ladders are gone.

   *Status:* done. Intents, the adapter, the resolver and the scheduler
   live in `editing/input/`, transactions and undo history in
   `editing/transaction/`. The hook has one keydown handler per surface,
   and the edit machine applies transactions. The scenario driver runs
   the app's machine headlessly, with rendering after every key or only
   when an intent waits for it; both must agree. Today's per-intent
   precedence (structural keys before atom selection before plain
   deletion) still lives in `editing/input/resolve.ts`, until ownership
   replaces it in step 4.
3. **Binding layer and tree in shadow mode.** Built on every revision and
   checked against invariants and against today's behaviour in tests, but
   not yet driving the UI. Includes the engine annotations for math slots
   and style wrappers. Latency is measured against the gate.

   *Status:* done, except the engine annotations, which moved to step 4
   (caret drawing and vertical motion are their first consumers, and
   nothing in shadow mode reads them). The CommandTable is in
   `editing/commands/`, and math commands are classified by the math
   parser's own command families. The tree, its builder and invariants
   are in `editing/tree/`, and positions in `editing/position/`. The
   session hook builds the tree for a scope session on every revision
   (`edit-tree-shadow.ts`), and dev builds check its invariants. Tests
   over every scope of the Beamer fixtures check:
   - the invariants;
   - agreement with the math parser (fractions, radicals, scripts) and
     the text IR (font commands);
   - that every caret stop today's renderer publishes is a tree position,
     or lies inside one construct's own source (`\la‸mbda`), which the
     tree treats as a unit by design.

   Building takes 1–2 ms per frame. The latency gate on the KKT frame
   measured a median of 51.1 ms and p95 of 56.5 ms with the tree on,
   within the earlier baseline.
4. **First vertical slice: navigation, selection *and* deletion
   together.** It covers prose, one style wrapper, inline math (fraction,
   script, symbol), one editable style macro (K1), and one alignment
   (`align*`). Includes the engine annotations (moved from step 3).
   Outlines and the breadcrumb are drawn from the tree.
   *Exit:* the `\setminus` and `\frac` scenarios and the F5/O2/O3/K4
   contract tests pass.

   *Status:* done, with the per-position caret geometry left open (see
   below). On the canvas of a scope session, ←/→, ⌫/⌦, typing over a
   selection and `^`/`_` work on the tree:
   - `position/view.ts`: caret stops (positions of caret slots, minus
     those that look the same as the stop before: after invisible items,
     a script's base start, bare group edges);
   - `position/selection.ts`: promotion from raw ends;
   - `operations/`: ⌫/⌦ by the O2 precedence, range deletion keeping
     wrappers, K4, R6;
   - `ownership/kinds.ts`: one role per kind (invisible, unit,
     transparent, scripted, construct, flow), the data the operations
     read. The full owns/barrier resolution arrives with Enter and the
     input rules in step 5.

   Paragraph and item edges still go to the structural keys. Transactions
   carry the raw selection ends as positions, and the edit machine keeps
   them while buffer and selection are unchanged, so the inside and
   outside of `x^2‸` stay apart.

   Engine facts used so far:
   - nodes the layout hides on the current step (overlay content,
     paragraphs after `\pause`): a hideable node with no rendered caret
     stop in it is invisible for motion and deletion
     (`position/rendered.ts`). Spaces TeX drops at a paragraph's edges
     are invisible too (`text\n\pause` ends with "text");
   - K1: style macros are classified from their definition
     (`commands/macro-classes.ts`), and the renderer keeps their argument
     editable instead of atomic.

   Outlines are the union of the hit maps' selection rects for the focus
   and parent spans, narrowed to the caret positions at both ends on a
   single line (math selection rects cover whole rows). The breadcrumb is
   in the status bar, and each crumb selects its construct.

   Caret geometry per position (math): the tree says which rendered item
   a caret hugs (`position/context.ts`, `caretEdge`): the end of the last
   item at a slot's end, else the start of the next. The hit map picks the
   math caret entry on that side, and glyph entries publish a font-level
   caret extent (0.75 em up, 0.25 em down) next to their ink-based
   geometry. So the inside of `x^\star‸)` is a short caret at the star,
   and the outside a full-size one before the parenthesis. After a
   construct at a slot's end (`$x^\star$‸`), the caret is after it as a
   whole: at its rightmost entry, sized like its first item. Outlines use
   the same edges. On slide text, the hit map's default projection is
   then only a fallback where the layout has no matching entry; it stays
   for callers without a tree (TikZ node text).

   Open: sub-paragraph `\pause` hiding, and `\alt`, where one argument
   is hidden, are not detected yet.
   Latency gate: median 52.9 ms, p95 60.2 ms.
5. **Input rules and the chip.** Escaping, auto-pairing, completion from
   the CommandTable, scripts, the pending command.

   *Status:* done, together with Enter/Tab ownership and the structural
   keys, which moved here from step 4. Nothing in typing, ⌫/⌦, ⏎ or ⇥ reads
   the layout any more; only vertical motion, row edges and hidden-step
   detection do.
   - **Input rules** (`operations/insert.ts`), by the caret slot's mode:
     - escaping `%`, `#` and `&` (also in math, where a raw `%` comments
       out the rest of the line), plus `_` and `^` in prose;
     - `$` and `{` with their closers, and `}`, `$` and `]` stepping over
       them;
     - R5 terminators;
     - `[` protected after `\item` and `\\`.
   - **Placeholder braces.** An empty `$…$` cannot be written as `$$`
     (display math), so `$` writes `${}$`, and `^` writes `x^{}`. These
     editor-created braces are interaction state, valid until the next
     intent:
     - the first character typed replaces them;
     - in a script it then leaves (`x^2‸`);
     - leaving them empty removes the script or formula;
     - ⌫ in them removes the construct.

     Deleting a formula's last item leaves the same placeholder.
   - **The interaction state** (`input/interaction.ts`) travels on
     transactions. The machine keeps it while buffer and selection are
     unchanged, so a click, undo or bar edit drops it. Besides the
     placeholder, it holds:
     - the `{` that `}` just moved before (consumed by the next `{`);
     - the open chip;
     - the pending command (O4).
   - **The chip** (`input/chip.ts`, `operations/command.ts`): `\` opens
     it, and the name stays out of the source until it commits.
     - Letters extend the name, ⌫ shortens it, Esc cancels it, and ↑/↓
       pick a completion.
     - ␣ commits the name as typed (`\foo` stays unknown). ⇥ and ⏎ accept
       the highlighted completion.
     - The commit key decides what is written: a word space in text
       (`\LaTeX{} `), the arguments as `{}` with the caret in the first,
       or the optional argument for `[`.
     - Another character commits the name as typed and is then typed
       itself, in the same step (`\alpha^`, `\frac1`).
     - A first non-letter commits a control symbol at once: `\%`, `\{`
       paired with `\}`, `\\` pending for `[`.
     - A held selection goes into the first rendered argument.
     - Completion comes from the CommandTable's vocabulary: the document's
       macros, the text commands, the parser's math symbols and a checked
       list of math constructs. Names this buffer uses rank first.
     - Each commit is one undo step.
   - **Ownership** (`ownership/keys.ts`): every node declares owns,
     barrier, transparent or pass for ⏎, ⇧⏎ and ⇥. One rule decides:
     walking outward from the caret, the first node that decides wins.
     A barrier stops the key; an owner handles it, and the transparent
     nodes inside it (style wrappers, inline formulas) are closed before
     the break and reopened after it (Z1). (This refines the "any
     barrier on the chain" rule above: an environment is then a barrier
     only to an owner outside it, so `\scalebox{\begin{minipage}…}` is
     not split from its paragraph while its own items still split.) A wrapper with nothing on one side of the caret is
     not split: the break goes beside it.
   - **Structural keys** (`operations/structure.ts`, `lists.ts`): item
     split and exit, paragraph break, new row and leaving an alignment
     (D2, D3), leaving a display, next slot and next cell (with `&` added
     unless the column count is fixed), nesting items, joins at block
     edges, and the list toolbar. All of these read the tree. The old
     layout-based key code is gone, except the object-layer delete and
     duplicate.

   Not done yet:
   - `$` in an empty formula does not yet make a display (D1).
   - The `\begin` environment chip (K15).
   - Rendered previews in the completion list.
   - Mouse picking in the chip.
   - Leaving a placeholder by clicking (only arrows remove it).

   Latency gate: typing median 51.1 ms, p95 56.1 ms. ⏎ and ⇥ no longer
   wait for layout (median about 40 ms each). (Re-measured after the
   TeX-validity work below: 52–55 ms in Chromium, run-to-run noise is
   about ±3 ms; Firefox unchanged.)

   **Source TeX accepts.** A keystroke fuzzer checks the contracts after
   every key (`test/editing/keystroke-fuzz.spec.ts`), and an opt-in
   LuaLaTeX oracle compiles its end states in their frames
   (`keystroke-tex-oracle.spec.ts`). What the oracle found became rules:
   - Wrong-mode commands: a math command typed in prose starts a formula
     (`$\frac{‸}{}$`); a text command in math goes into `\text{…}`.
   - Beamer reads `<` as an overlay specification after `\item`,
     `\begin{…}` (and a block's title), `\\` and a text command's closing
     brace, and `[`/`<` at a frame body's start: `{}` (or `\relax` at the
     body's start) protects them, typed or left by a deletion.
   - `\\`, ⇧⏎ and `\newline` need ink on their line (`\only` content does
     not count), never in LR boxes or inline math; a `\\` an edit leaves
     dead is removed.
   - The chip refuses what no commit writes whole: `\verb`, `\begin`,
     `\end`, `\item` outside a list, table rules outside a table.
   - Commands as bare scripts only when TeX reads them as one token
     (`\mu^\top`, not `x^\ldots`); a closer right after a command gives it
     its braces; a typed overlay specification is the command's
     (`\only<2->{x}`).
   - Beamer nests three lists; `cases` has two columns (`*{2}{lr}` counts
     four); `\multicolumn` opens its cell; joins across a `%` comment keep
     text out of it.
   - Page and frame breaks, `\onslide` and the transitions read a `<`
     after them too; in `overprint`, `\onslide` cannot be wrapped; inside
     `\bm`, beamer's overlay-aware commands make LuaLaTeX loop, so the
     chip refuses them there.
   The oracle skips what TeX cannot judge yet: unknown commands, value
   arguments left empty or edited in place (O8), commands waiting for an
   argument (K2).
6. **Breadth.** All node kinds, wrapping and pickers (R10, O8), paste and
   copy (O6), the frequent-styles list and variants, the remaining
   alignments and tables (D2–D4, K13), overlays (Z4).

   A survey of real decks (about 6,600 frames) reorders this:
   - User-defined environments occur in a third of the frames and are
     opaque atoms today; macros that open and close environments
     (`\BI…\EI`) in a tenth. Classifying `\newenvironment` bodies as K1
     does for macros would open them to editing.
   - The chip writes value arguments empty (`\url{}`, `\textcolor{}{…}`),
     which TeX rejects until filled: O8's pickers are the fix.
   - Overlays need a design from first principles (typing next to
     content hidden on the current step, specifications as values).
   - `\frame{…}` and `\slide{…}{…}`-style frames are not recognized.

   **Paste and copy (O6), done.** A canvas copy carries balanced source
   (wrappers and lists it cuts through are closed and reopened) with its
   mode, under its own clipboard type, and the rendered text as
   `text/plain`; the bar keeps the input's own clipboard. Paste converts
   by destination: a formula fragment pasted into prose gets `$…$`, a
   whole formula pasted into math loses its delimiters, prose pasted into
   math gets `\text{…}`. Copied source that cannot stand where it goes
   (paragraphs or lists where no paragraph goes, items outside a list,
   rows and table rules, `\verb`, line breaks without a line) falls back
   to its plain text. Outside text is literal: every special escaped in
   prose; in math, characters keep their meaning, and a `^`/`_` stays a
   script only with a base and an argument. The fuzzers paste canvas
   copies and a set of outside texts. "Paste as TeX" (C2's pill) and Z3's
   missing-macro hint are still to come.

Parallel: engine recovery (T1–T7) against the interface above. It must
land before the source lens is promoted as the main escape hatch.

## Risks and open questions

- **Latency.** There is no headroom in the current gate. If incremental
  binding is not enough, the tree may need to be maintained incrementally
  by the transactions themselves (mapping plus local re-bind), with
  layout used only for annotations. The revision protocol already points
  that way.
- **Binding-layer correctness.** It reimplements TeX's argument and script
  rules for the commands it knows. Engine disagreements are reported. The
  CommandTable must be right for argument kinds, especially
  `unbracedSingleToken`.
- **Ownership rules per intent** are the heart of predictability. They
  must stay small, declarative and tested on their own. If a new
  scenario needs an exception, change the rule table, not an operation.
- **The hidden textarea and IME.** The candidate window must be positioned
  at the canvas caret while the canvas shows the text.
- **The bar.** If the docked bar stays, it remains a literal surface with
  no input rules, and it shares the buffer and the revision protocol.

## Revision notes

Codex reviewed the first draft (same day). Accepted:
- unique offsets do not exist: positions carry affinity, and transactions
  map positions;
- selection promotion depends on the kind: style wrappers allow partial
  ranges;
- walk-and-handle relocated the branching: it is now an ownership decision
  over declared capabilities, plus shared operations with their own
  preconditions;
- the binding layer: the grammar does not bind arguments, and its math
  identifiers are multi-letter;
- corrected engine facts: the text IR already keeps font-command identity;
  the math IR keeps script attachment, but the provider drops it;
- picker semantics: all required values are collected, and cancellation
  restores the selection;
- intent origin and `repeat`; composition as an overlay; armed deletion;
- the revision protocol for typing faster than layout; explicit undo
  groups;
- the interpretation environment (body macro definitions, step);
- interfaces for recovery and the lens, the clipboard, the object layer,
  and stable ids;
- the corrected latency baseline (no headroom);
- the migration reordered: contracts first, the tree in shadow mode, then
  navigation, selection and deletion together.

Kept: source as truth, patch transactions, the pure core with separate
geometry. Codex argued for keeping these too, and rejected a
document-model-primary design for the same R1 fidelity reasons.
