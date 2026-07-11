# TeX Total Rendering and Fallback Removal

## Purpose

The TeX-derived text+math path currently renders a node only when the whole
node is inside the supported subset. Anything else — an unknown command, a
half-typed macro, a non-ASCII character, a bare font declaration — triggers
whole-node fallback to the legacy MathJax path (and, for invalid TeX, to plain
text). This has two costs:

- **Unpredictability.** One keystroke can flip an entire node between two
  engines with different fonts, metrics, and line breaks. While typing
  `This is a \textbf{bold} test`, the intermediate state `This is a \tex` is
  unsupported and the whole node re-renders in a different engine.
- **Hidden coverage gaps.** Silent delegation means unsupported constructs are
  absorbed rather than surfaced, so the supported subset stops being an
  explicit, tracked boundary.

This document specifies the replacement: make the TeX-derived renderer
**total** — every input renders *something* deterministic through the TeX
path — and then remove the MathJax fallback entirely. The mechanism is
literal-source rendering of unsupported runs, with an editing-aware styling
policy layered on top.

This continues the direction set in `design/tex-math-rendering-design.md`
("prefer explicit unsupported placeholders over approximate rendering") and
resolves the open question in `design/tex-like-layout-architecture.md`
("if whole-node fallback becomes rare, the fallback path can later be
narrowed or removed"). It is also a prerequisite investment for
`design/beamer-editor.md`, whose fallback model requires block/inline
granularity inside a frame — whole-node fallback does not scale to frames,
and MathJax is not a meaningful fallback for a frame body at all.

## Goals

- Every node text input produces a deterministic TeX-path rendering; no
  input can flip the node to a different engine.
- Unsupported and incomplete input renders as visible, editable literal
  source text, not as an opaque placeholder box and not as silent omission.
- Typing through an unsupported state is locally stable: each keystroke
  changes only the affected run, never the layout strategy of the node.
- Diagnostics remain first-class: every literal run carries a typed reason
  and source span.
- The editing-vs-display distinction is cosmetic (styling policy), not
  structural (parse/layout policy). Parsing and layout stay pure functions
  of the text.
- After the transition, delete the MathJax measure/render fallback path.

## Non-Goals

- Closing individual coverage gaps (accents/non-ASCII, font size commands,
  color, `\mathbb`, escaped reserved characters). These are tracked
  separately and deliberately sequenced *after* the total-rendering
  mechanism, because the mechanism determines how any remaining gap
  degrades. Non-ASCII is the one gap the mechanism itself cannot absorb
  (see Limits).
- Guessing user intent mid-edit (e.g. "is `\tex` a prefix of `\textbf`?").
  No caret-dependent parsing.
- Semantic math editing or error recovery beyond literal rendering.
- Removing MathJax as an npm dependency in the same change as removing the
  fallback (the Knuth-Plass line-break visitor import is a separate,
  smaller cleanup).

## Current State

Where fallback decisions live today:

- `packages/core/src/text/mathjax-engine.ts` — both `validate()` and
  `measure()` try the TeX path first (`buildSimpleTexTextCacheEntry`), and
  fall back to MathJax `tex2svg` when it returns `null`.
- `isSimpleTexTextEligible` plus `normalizeMathJaxTextInput`
  (`mathjax-engine.ts`) force whole-node fallback for: `mode !== "text"`
  (math-mode matrix cells), monospace font family, bare font declaration
  switches, empty word count, invalid width, layout exceptions, or
  `layout.supported === false`.
- `analyzeSimpleTexParagraph` (`packages/core/src/text/tex/ir.ts`) sets
  `fallbackReason` for any unsupported command, unsupported direct character
  (`& _ ^ ~ # %`), or any codepoint above 0x7E.
- Partial precedent for sub-node degradation already exists:
  - vertical-mode unsupported commands become `placeholder` block items
    when `fallbackPolicy: "placeholder"` (`ir.ts`);
  - display math that the provider cannot build becomes an
    `unsupportedDisplayMathPlaceholder` (`vlist/lower-simple.ts`);
  - unresolved `\includegraphics` renders a placeholder box
    (`layout-inline-items.ts`).
- In math layout, an `unsupported` nucleus currently makes `layoutAtom`
  return `null` and the atom is dropped from the hlist with only a recorded
  error (`math/layout.ts`) — silent omission, which this design forbids.

## Core Mechanism: Literal Runs

### Inline literal items

Add a `literal` inline item kind to the simple-TeX IR. Any scan or lowering
failure produces a literal run instead of poisoning the node:

- unknown control sequence → literal run covering `\foo` (and, when it took
  a balanced group argument that we choose not to interpret, optionally the
  braces as literal glyphs too — see Policy below);
- unsupported direct character (`& _ ^ ~ # %`) → single-character literal
  run;
- malformed construct (unterminated group, half-typed command at end of
  input, dangling `\`) → literal run covering the malformed span;
- inline math span that fails math parse/layout → literal run covering the
  entire `$...$` / `\(...\)` span including delimiters;
- display math that fails → the display placeholder renders the display
  source as a literal typewriter line inside the placeholder box
  (implemented as `literalText` on `TexPlaceholderItem` rather than
  restructuring lowering into a synthetic paragraph; the placeholder keeps
  its vlist hit geometry and gains visible, source-mapped glyphs).

A literal run is **shaped text**, not an opaque box. It is shaped in the
typewriter face (`cmtt10`, already vendored; typewriter has no ligatures and
fixed spacing-factor behavior, so shaping is trivial and visually reads as
"code") at the current font size, and it participates in paragraph breaking
like ordinary words. Because it is shaped text with ordinary caret stops and
source spans, caret placement, selection, and hit testing inside the
unsupported material work through the existing machinery with no special
cases — strictly better than both the MathJax fallback and an opaque
placeholder.

Line breaking inside literal runs: allow breaks only at spaces within the
run and after the run; no hyphenation. A literal run should never change
the break decisions of surrounding supported text beyond its own width.

### Diagnostics

Each literal item carries:

```ts
interface SimpleTexLiteralNode {
  kind: "literal";
  reason:
    | "unsupported-command"
    | "unsupported-character"
    | "malformed-input"
    | "math-parse-error"
    | "math-layout-error"
    | "display-math-unsupported";
  detail?: string;          // e.g. the command name, the diagnostic code
  sourceStart: number;
  sourceEnd: number;
}
```

The paragraph/vlist reports aggregate these into a per-node diagnostics list
(the successor of today's single `fallbackReason`), so the app can show a
badge, tooltip, or problems panel. `validate()` keeps working: it reports
the first literal-run diagnostic instead of an eligibility rejection.

### Math-side changes

The math subsystem needs two adjustments to meet the same standard:

1. **No silent drops.** An `unsupported` nucleus must not vanish from the
   hlist. (Implementation note: math layout already records an error for
   every unsupported nucleus/item, and errors fail the whole hlist, so with
   span-level containment in place the unknown command renders as part of
   the span's literal run — verified for top-level, fraction, script, and
   radical positions. A finer per-atom literal glyph run inside otherwise
   supported formulas remains future work alongside prefix recovery.)
2. **Span-level containment.** Parse errors of severity `error` currently
   make `getMathBox` return `null` (`math/inline-provider.ts`), which today
   escalates to whole-node fallback. Under this design the *outer* layer
   catches the null and renders the whole math span as an inline literal
   run. Inside-math error recovery (rendering the parseable prefix plus a
   literal tail) is explicitly deferred; span-level containment is enough
   for stability, since the damage radius is the formula, not the node.

### Policy: how greedy is a literal run?

Smallest honest span, with these rules:

- An unknown command consumes its name only (`\foo`), not following groups,
  *unless* leaving the group would create a stray-brace literal anyway; in
  that case consume name plus balanced groups as one run. Practical rule:
  try name-only first; if the remainder scans cleanly, keep it; the
  fallback is name+groups. Both are deterministic in the text.
- Adjacent literal items merge into one run for rendering and diagnostics.
- A literal run never crosses a paragraph boundary.

## Editing vs Display: A Styling Policy, Not a Mode

With literal runs, the mid-edit problem largely dissolves: `This is a \tex`
renders exactly those characters, and each keystroke extends the literal run
by one glyph. The parser needs no notion of "currently editing". What
remains is presentation: we should not flag an error at the caret while the
user is mid-word.

Policy:

- Layout emits literal-run groups in the SVG with a stable marker
  (`data-tex-literal` with reason + source span), unstyled beyond the
  typewriter face and a neutral tint.
- The canvas editor owns the styling state. While a text editing session is
  active and the caret (or selection edge) is inside or adjacent to a
  literal run's source span, the run is shown in its neutral "pending"
  presentation. When the caret leaves the run (or the session ends), the
  editor switches the group to "error" presentation (background tint or
  underline decoration, consistent with the MS-Office-style visual
  language).
- The toggle is a class/attribute flip on the rendered group. Layout output
  does not depend on caret position, so layout caches remain keyed by text
  and options only, and the pending→error transition cannot reflow
  anything.
- Optional refinement (not required for v1): a short settle delay so the
  error style does not flash while the caret merely passes through a run.

This is the whole editing/display distinction. No second parse mode, no
last-good-render cache, no caret-dependent grammar.

## Fallback Removal Plan

Ordered so each step is independently shippable; step 1 is the current
priority, and the coverage work in step 3 is deliberately deferred.

### Phase 1: Literal runs in the text path (implemented 2026-07-06)

- Add the `literal` node/item kind through IR → layout items → paragraph
  runs → report → SVG rendering, with source spans and caret stops.
- Route `analyzeSimpleTexParagraph` rejections for unsupported commands and
  unsupported direct characters into literal runs instead of
  `fallbackReason` (non-ASCII stays a fallback trigger for now — see
  Limits).
- Contain failed inline/display math spans as literal runs; stop escalating
  math `error` diagnostics to node fallback.
- Fix silent atom drops in math layout (literal glyph run, `ord`).
- Emit `data-tex-literal` markers; aggregate diagnostics in reports.

Exit criteria:

- Typing `This is a \tex` character-by-character never leaves the TeX path
  and never reflows text before the literal run.
- Caret/selection tests pass inside literal runs (extend hit-map fixtures).
- No input in the text-mode fuzz corpus reaches MathJax except via the
  explicit remaining triggers (non-ASCII, monospace, math-mode cells, bare
  declarations, size/color commands).
- Unsupported math commands are visibly rendered, not dropped.

### Phase 2: Editor styling policy

- Canvas editing session tracks caret-in-literal-run adjacency and toggles
  pending/error presentation on literal groups.
- Node-level diagnostic surfacing (badge or tooltip listing literal-run
  reasons) so gaps are visible instead of silent.

Exit criteria: e2e test types an unsupported macro, observes neutral
styling while caret is inside, error styling after clicking elsewhere.

### Phase 3: Close remaining whole-node triggers (in progress)

Each remaining `isSimpleTexTextEligible` rejection either gets real support
or becomes a literal run:

- escaped reserved characters (`\%`, `\&`, `\_`, `\#`, `\{`, `\}`) — real
  support, trivial;
- bare font declarations (`\bfseries` etc. stripped during normalization) —
  real support (the inline forms already work);
- font size commands, color — real support (needed for Beamer regardless);
- accents and non-ASCII — real support via OT1 accent composition and/or a
  browser-font run for non-encodable characters (see Limits);
- monospace nodes — route to the existing `cmtt`/`lmmono` faces;
- `mode: "math"` matrix cells — route to the TeX math engine (it already
  lays out matrices; the cells simply never reach it).

Implemented 2026-07-11: common accented Latin Unicode and TeX prose accent
commands; monospace nodes and bare font declarations; inline color and text
size declarations; and native math support for `\mathbb`, `\mathfrak`,
`\stackrel`, `\widehat`, and `\widetilde`. Unicode code points absent from the
vendored Latin Modern catalog still fall back explicitly rather than emitting
blank glyphs. A scoped text-size declaration around inline math does not yet
rescale only that math island; leading/global node sizing does.

Also implemented 2026-07-11: escaped reserved characters, TeX quotes/dashes
and ellipses, non-breaking `~` glue, `\textsuperscript`, `\textsubscript`,
prose `\underline`, and `\ensuremath`. The vendored Latin Modern prose catalog
now includes each face's available Latin Extended-A glyphs plus the common
E/e-with-tilde examples; absent per-face glyphs retain the explicit fallback.

The same coverage pass added native `\colorbox` and `\fcolorbox`; genuine
Computer Modern `\boldsymbol` through the `cmmib`, `cmbsy`, and `cmbx` math
versions; RSFS `\mathscr`; vertical, diagonal, and AMS semantic dots;
Mathtools `dcases`; and extensible `\overbrace`/`\underbrace` layouts. Symbols
without a real bold face remain unchanged rather than receiving synthetic
`\pmb` overprinting. Lower-priority `\oldstylenums`, `\mathnormal`, `\pmb`, and
package-specific text-decoration commands remain outside this tranche.

### Phase 4: Delete the fallback

- Remove the MathJax measure/render path from `mathjax-engine.ts`;
  `buildSimpleTexTextCacheEntry` becomes the only entry point. Rename the
  module (`node-text-engine.ts`) — its current name is already misleading.
- Fallback telemetry (added at the start of Phase 3: log every
  `fallbackReason` occurrence in dev builds) must show the remaining rate
  is ~zero on real documents before this lands.
- Separately: replace the `@mathjax/src` LinebreakVisitor import in the
  legacy Knuth-Plass path, then drop the MathJax dependency and worker from
  the bundle.

## Limits

- **Non-ASCII text cannot be absorbed by literal runs**, because `é` cannot
  be OT1-shaped in `cmtt` either. Until accent composition and/or a
  browser-font escape hatch exists (an accepted intermediate mode per the
  layout architecture doc), non-ASCII remains the one whole-node fallback
  trigger. This is the main reason Phase 4 cannot precede Phase 3.
- Literal runs are a *display* of source, so a node dense with unsupported
  macros reads as code. That is intended: it is honest, editable, and
  strictly more informative than a wrong-looking approximation.
- Width changes while typing are inherent to WYSIWYG and are not the
  problem this design solves; the problem is *strategy* changes (engine
  flips, global reflows), which literal runs eliminate.

## Validation

- Unit: IR fixtures for each literal-run reason; shaping fixtures for
  literal runs (no ligatures, space breaking only); math fixtures asserting
  no atom is ever dropped.
- Fuzz: extend the text and math fuzzers with an "always renders" property:
  for arbitrary input, layout succeeds, every source character is covered
  by exactly one of {supported item, literal run, ignored-space rule}, and
  caret stops are monotonic across literal boundaries.
- Editing: hit-map fixtures with caret traversal into/out of literal runs;
  e2e typing test per Phase 2.
- Oracle: unaffected — literal runs are outside the supported subset by
  definition and are excluded from LuaLaTeX comparison, but the oracle
  harness should assert that supported-subset inputs produce zero literal
  runs (guard against accidental support regressions).
