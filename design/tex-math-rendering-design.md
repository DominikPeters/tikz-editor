# TeX Math Rendering Design

## Purpose

Build a TeX-derived math rendering subsystem that can eventually replace
MathJax inside the TeX-derived text path. The goal is not to render "similar
looking math"; the goal is to make TikZ Editor's preview obey the same layout
decisions as the canonical compiler path so users can tune node text, display
math, and later document-like material without being surprised by the compiled
output.

The canonical oracle for this work is `lualatex`. MathJax source code under
`examples/mathjax-src/` is reference material only: it can inform parser structure,
operator classification, layout decomposition, and edge-case handling, but it
must not become the validation oracle or a production dependency of the new
TeX-derived path.

This document supersedes the earlier "MathJax remains the engine for math
islands" assumption in `design/tex-like-layout-architecture.md` for the
TeX-derived renderer. Legacy MathJax rendering can remain as a compatibility
path while this branch is under development, but unsupported math in the new
path should be explicit rather than silently delegated to MathJax.

## Design Principles

- Use `lualatex` as the source of truth for behavior.
- Keep the architecture font agnostic. The first implementation targets the
  default fonts that `lualatex` uses for a minimal document, but font profile,
  metric, glyph, and math parameter handling must be pluggable.
- Represent math internally as TeX-like math lists and atoms, not as MathML.
- Preserve source spans throughout parsing, layout, rendering, and hit testing.
- Let inline math participate in paragraph breaking as boxes, glue, penalties,
  and discretionary breakpoints rather than as one opaque box.
- Treat display math and alignment environments as first-class block constructs
  in the vertical-list architecture.
- Prefer explicit unsupported placeholders over approximate rendering when a
  construct is not implemented.
- Validate each layer independently before adding broader syntax.

## Scope

### In Scope

- Inline math delimited by `$...$` and `\(...\)`.
- Display math delimited by `\[...\]`, `$$...$$` where TeX-compatible handling
  is required, and LaTeX display environments such as `equation`.
- AMS-style alignment families in a later phase, starting with `align` and
  `aligned`.
- TeX math atom classification and spacing.
- Font-agnostic math metrics, math constants, glyph outlines, italic
  correction, and skew information.
- Fractions, scripts, radicals, accents, large operators, delimiters, and
  basic arrays as incremental milestones.
- Integration with existing TeX paragraph and vertical-list layout.
- Editor caret placement, selection geometry, and hit testing for math content.

### Out of Scope for the First Implementation

- Full TeX macro expansion.
- Arbitrary LaTeX package behavior.
- Complete AMSMath coverage in the first milestone.
- Browser-native text shaping for math glyph placement.
- MathJax as a runtime fallback inside the new TeX-derived path.
- Pixel-perfect equality through PNG rasterization as the primary validation
  mechanism.

## Existing Context

The current TeX-derived text path already provides:

- source-span-preserving simple TeX node parsing;
- paragraph and vertical-list block structure;
- Computer Modern text metrics and SVG glyph rendering;
- TeX-like paragraph breaking validated against TeX;
- editor-facing reports for line boxes, caret positions, and selection spans;
- inline math spans represented as `SimpleTexMathNode`.

The missing layer is math-content interpretation. Today a math span can be
found, measured, and rendered through MathJax, but the math content is not
converted into TeX-like math atoms. This design keeps the outer parser and adds
a math parser/layout subsystem under `SimpleTexMathNode`.

Useful MathJax reference areas:

- `examples/mathjax-src/ts/input/tex/`: TeX parser, token maps, command maps,
  package handlers, and parse utilities.
- `examples/mathjax-src/ts/core/MmlTree/`: MathML-like node tree, TeX class
  logic, and operator dictionary.
- `examples/mathjax-src/ts/output/common/`: layout wrappers, font-data
  abstraction, and line-break visitor.
- `examples/mathjax-src/ts/output/svg/`: SVG backend and wrapper
  implementations.
- `examples/mathjax-src/testsuite/`: MathJax's own tests, useful as a coverage
  map for syntax and package edge cases.

MathJax should be read as accumulated engineering experience, not as an API
contract.

## Target Pipeline

```text
TikZ/LaTeX-ish source
  -> existing source frontend
       node text boundaries
       paragraph/list/quote/display blocks
       inline math spans
       source ranges
  -> math-content parser
       TeX math tokens
       groups
       commands
       environments
  -> TeX math IR
       math lists
       atoms/noads
       style nodes
       penalties and breakpoints
  -> font profile
       text fonts
       math fonts
       math constants
       glyph outlines
  -> math layout
       hlist/vlist boxes
       scripts
       fractions
       radicals
       delimiters
       alignments
  -> integration layer
       inline paragraph items
       display vlist boxes
       editor reports
  -> SVG renderer
       positioned glyph paths
       rules
       hit maps
```

## Package Structure

Proposed new area:

```text
packages/core/src/text/tex/math/
  ast.ts
  tokens.ts
  parser.ts
  commands.ts
  environments.ts
  ir.ts
  classes.ts
  spacing.ts
  font-profile.ts
  font-metrics.ts
  glyphs.ts
  layout.ts
  layout-inline.ts
  layout-display.ts
  layout-align.ts
  render-svg.ts
  report.ts
  diagnostics.ts
```

Test and validation support:

```text
test/tex-math-parser.spec.ts
test/tex-math-layout.spec.ts
test/tex-math-render.spec.ts
scripts/compare-tex-math.mjs
scripts/fuzz-tex-math.mjs
artifacts/tex-math-oracle-cache/
```

The existing text parser should keep producing `SimpleTexMathNode`. The math
subsystem consumes that node's `content`, `contentStart`, `contentEnd`, and
delimiter metadata.

## Core IR

The IR should be close enough to TeX math lists that TeXbook/math typesetting
rules map naturally onto it.

```ts
type TexMathStyle =
  | "display"
  | "text"
  | "script"
  | "scriptscript";

type TexMathAtomClass =
  | "ord"
  | "op"
  | "bin"
  | "rel"
  | "open"
  | "close"
  | "punct"
  | "inner";

interface TexMathSourceSpan {
  readonly start: number;
  readonly end: number;
}

interface TexMathList {
  readonly kind: "math-list";
  readonly items: readonly TexMathItem[];
  readonly sourceSpan: TexMathSourceSpan;
}

type TexMathItem =
  | TexMathAtom
  | TexMathGlue
  | TexMathKern
  | TexMathPenalty
  | TexMathStyleChange
  | TexMathBoundary;

interface TexMathAtom {
  readonly kind: "atom";
  readonly atomClass: TexMathAtomClass;
  readonly nucleus: TexMathNucleus;
  readonly subscript?: TexMathList;
  readonly superscript?: TexMathList;
  readonly limits?: "display" | "nolimits" | "limits";
  readonly sourceSpan: TexMathSourceSpan;
}

type TexMathNucleus =
  | TexMathGlyphNucleus
  | TexMathListNucleus
  | TexMathFractionNucleus
  | TexMathRadicalNucleus
  | TexMathAccentNucleus
  | TexMathDelimiterNucleus
  | TexMathRuleNucleus
  | TexMathPlaceholderNucleus;
```

This is intentionally not a complete type definition. The required property is
that every later feature can lower to the same list/atom/box model rather than
adding one-off rendering branches.

## Font Profiles

Math layout must not assume Computer Modern, Latin Modern, or any MathJax font
internally. The first profile targets whatever `lualatex` uses in a minimal
document on the supported TeX Live installation. The validation harness must
record the observed font names, font files, and relevant font IDs in the oracle
manifest so future TeX Live changes are visible.

The observed default LuaLaTeX split is not "Computer Modern everywhere":
ordinary text uses Latin Modern OpenType fonts through TU encoding, while
classic LaTeX math still uses Computer Modern math families such as `cmr`,
`cmmi`, `cmsy`, and `cmex` unless `unicode-math` changes the setup. The text
side should therefore be profile-driven first, via `TexTextFontProfile`, and
the math profile should extend the same document-font concept rather than
creating a separate font-selection mechanism.

```ts
interface TexMathFontProfile {
  readonly id: string;
  readonly label: string;
  readonly engine: "lualatex";
  readonly preamble: readonly string[];
  readonly textProvider: TexMetricProvider;
  readonly mathProvider: TexMathMetricProvider;
  readonly glyphProvider: TexGlyphProvider;
  readonly parameters: TexMathParameters;
}
```

The provider boundary should support both classic TeX metric data and
OpenType math data:

- TFM/VF/Type1-based fonts need widths, heights, depths, italic corrections,
  ligature/kern data, extensible recipes, and fontdimens.
- OpenType math fonts need glyph advances, glyph boxes, italic correction,
  top accent positions, variants, assembly recipes, and MATH table constants.

The first implementation may only implement the subset needed by default
LuaLaTeX, but the interfaces should not encode that subset as a permanent
limitation.

## Math Parser

The parser should be separate from the outer text parser. It receives the
contents of a math span and a source offset.

Responsibilities:

- tokenize control sequences, characters, groups, alignment tabs, scripts,
  spaces, comments, and environment delimiters;
- preserve source spans for all tokens and AST nodes;
- normalize simple commands into IR constructs;
- distinguish parse errors from unsupported but syntactically valid commands;
- avoid full document macro expansion in the initial version.

Initial syntax target:

- identifiers and numbers;
- ordinary symbols;
- binary and relation operators;
- grouping with `{...}`;
- superscript and subscript;
- `\frac`;
- `\sqrt`;
- `\left...\right` as unsupported or placeholder in the first parser pass,
  then as delimiter atoms later;
- simple spacing commands: `\,`, `\:`, `\;`, `\!`, `\quad`, `\qquad`;
- text-style switches only where they are needed for layout style changes.

Validation targets:

- 100% source-span accuracy for parsed nodes in deterministic unit fixtures.
- 100% round-trip token coverage: every input character belongs to exactly one
  token, diagnostic, or explicitly ignored TeX space/comment rule.
- Parser diagnostics classify inputs as `ok`, `parse-error`, or `unsupported`
  without throwing for fuzzed inputs.
- Unit fixture matrix covers at least 200 hand-written cases before broad
  layout work begins.
- Fuzz parser with 10,000 generated math strings and require no crashes, no
  infinite loops, and bounded diagnostics.

Verification approach:

- `test/tex-math-parser.spec.ts` checks AST shapes, spans, and diagnostics.
- `scripts/fuzz-tex-math.mjs --parser-only` generates valid and invalid math
  snippets and asserts parser totality.
- A development-only comparison may inspect MathJax source behavior for
  ambiguous constructs, but pass/fail decisions use TeX oracle behavior or
  explicit design choices.

## Atom Classes and Spacing

TeX math spacing depends on adjacent atom classes and current style. This layer
should be implemented independently of glyph layout.

Responsibilities:

- classify symbols and command outputs into `ord`, `op`, `bin`, `rel`, `open`,
  `close`, `punct`, and `inner`;
- implement TeX's binary-operator reclassification rules;
- apply math spacing table for adjacent atoms;
- produce explicit glue/kern items in math layout units;
- expose line-break penalties around binary and relation operators.

MathJax's TeX class and operator dictionary logic is useful reference material
here. It should be translated into our own compact tables and tests, with
citations in code comments only where they clarify a non-obvious rule.

Validation targets:

- 100% agreement with TeX for class-sensitive spacing fixtures such as
  `a+b`, `a-b`, `-a`, `a=-b`, `(a+b)`, `a,b`, `a\mathbin{+}b`,
  `a\mathrel{=}b`, and consecutive binary operators.
- Measured horizontal advances for spacing-only formulas agree with the
  LuaLaTeX oracle within 0.01 pt for each glyph origin and total width.
- Breakpoint extraction matches TeX-observed line breaks for a focused inline
  math paragraph matrix.

Verification approach:

- Unit tests assert class transitions and inserted math glue.
- Oracle tests render formulas in a fixed-width box and compare glyph traces.
- Fuzz tests generate short operator-heavy formulas and compare line-break
  choices across widths.

## Layout Algorithms

Math layout converts math lists into TeX-style boxes. All dimensions should be
in TeX points at the API boundary, with internal precision high enough to avoid
rounding-driven line-break changes.

### Inline Math

Initial inline layout should support:

- glyph nuclei;
- atom spacing;
- italic correction;
- superscript and subscript placement;
- simple fractions;
- simple radicals;
- explicit math spacing commands;
- breakpoints after binary and relation operators where TeX allows them.

Validation targets:

- Formula metrics: width, height, and depth agree with LuaLaTeX within
  0.01 pt for simple formulas and within 0.03 pt for formulas containing
  stacked constructs during early implementation.
- Glyph traces: same glyph sequence and same font IDs as the oracle for
  supported default-font formulas.
- Glyph positions: max `x` delta <= 0.01 pt and max baseline `y` delta
  <= 0.01 pt for simple atom/script fixtures; temporarily <= 0.03 pt for
  fractions/radicals until the exact constants are verified.
- Paragraph integration: line text, math breakpoints, and line count match the
  oracle for supported inline-math paragraphs.

Verification approach:

- `scripts/compare-tex-math.mjs --inline` creates a minimal TikZ or LaTeX box,
  compiles with `lualatex`, extracts glyph traces, and compares against our
  SVG trace.
- The manifest records input source, width, preamble, engine version, font
  files, glyph sequence, glyph coordinates, and extracted box dimensions.
- Cached oracle artifacts live under `artifacts/tex-math-oracle-cache/`.

### Display Math

Display math is vertical-list content, not an oversized inline box. It needs
display style, display skips, centering/indent behavior, equation numbering
policy when supported, and surrounding paragraph interaction.

Initial display target:

- `\[...\]`;
- `equation*` or an explicit no-number equation mode;
- no equation numbering in the first pass unless the outer document model is
  ready to own counters.

Validation targets:

- Display box width, height, depth, and baseline agree with LuaLaTeX within
  0.03 pt for supported formulas.
- Vertical placement relative to preceding and following paragraphs matches
  TeX within 0.05 pt for display skip fixtures.
- Display style changes are observable: scripts, large operators, and
  fractions match display-style oracle metrics.
- Unsupported numbering or tags produce explicit diagnostics and placeholders.

Verification approach:

- Oracle fixtures compile full paragraph-display-paragraph examples.
- SVG trace comparison checks glyph positions in document coordinates, not
  per-line-normalized coordinates.
- Vertical-list reports include display item metrics and source spans.

### Alignment Math

Alignment environments should lower to an alignment/list model analogous to
TeX's `\halign`, not to manually positioned independent formulas.

Initial alignment target:

- `aligned` inside display math;
- later `align*` as a display block;
- `&` alignment tabs;
- `\\` row breaks;
- simple inter-column spacing.

Validation targets:

- Column anchor positions agree with LuaLaTeX within 0.03 pt for supported
  aligned fixtures.
- Row baselines and inter-row spacing agree within 0.03 pt.
- Glyph traces compare in absolute display coordinates.
- Parser rejects or placeholders unsupported tags, numbering, `\intertext`,
  and complex AMS constructs until implemented.

Verification approach:

- Focused fixtures for one alignment point, multiple alignment points, long
  left/right sides, scripts, fractions, and row breaks.
- Fuzz generated aligned equations with bounded grammar and compare column
  anchors, line count, row count, and glyph positions.

## SVG Rendering

The SVG renderer should consume laid-out boxes and glyph placements. It should
not ask the browser to shape or position math text.

Responsibilities:

- emit glyph paths from the same font profile used for metrics;
- emit rules for fraction bars, radicals, and delimiters;
- preserve source-span metadata on render groups where practical;
- expose a glyph trace for validation;
- expose hit-test geometry for editor interaction.

Validation targets:

- For supported formulas, SVG glyph trace equals the layout trace before the
  SVG string is serialized.
- Rendered glyph path IDs resolve to the same font/glyph IDs reported by the
  layout layer.
- Visual smoke tests render nonblank SVGs for all supported construct classes.
- Coordinate trace comparison is the primary visual validator; PNG diffs are
  secondary diagnostics only.

Verification approach:

- Unit tests on generated SVG structure and trace metadata.
- Browser smoke tests for nonblank rendering and stable viewBox dimensions.
- Optional raster diagnostics at high resolution for human inspection.

## Editor Interaction

Math must remain editable inside the canvas. The editor does not need semantic
math editing in the first pass, but caret placement and selection should not
collapse to whole-node behavior for supported formulas.

Initial target:

- caret before/after the whole formula;
- caret positions inside simple linear math content;
- source-span selection geometry for glyph-backed atoms;
- whole-construct selection geometry for fractions/radicals until finer
  hit maps are implemented.

Validation targets:

- Pure function tests map source offsets to x/y positions and back for simple
  inline formulas.
- Hit testing inside text surrounding math remains unchanged.
- Multi-line paragraphs with inline math preserve caret and selection behavior
  across line breaks.
- Unsupported math placeholders remain selectable as a source span.

Verification approach:

- Extend existing hit-map tests with math-specific fixtures.
- Add fuzz tests that generate text/math/text paragraphs and assert monotonic
  source-to-x mappings within each rendered line.
- Add regression tests for formulas that break across lines around binary and
  relation operators.

## Oracle and Comparison Infrastructure

The oracle harness should be designed before broad implementation so each
feature lands with a way to prove it is faithful.

### Oracle Generation

Each oracle case should produce:

- `case.tex`;
- `case.pdf`;
- extracted SVG or trace data;
- raw log file;
- manifest JSON with engine version, command line, preamble, fonts, source,
  dimensions, glyphs, coordinates, diagnostics, and cache key.

`lualatex` is the only pass/fail oracle. `dvisvgm`, `pdftocairo`, or other
tools may be used to extract traces, but their extraction noise must be
measured separately from our layout error.

### Comparison Levels

Use layered comparison so failures identify the responsible subsystem:

1. Parser comparison: diagnostics, source spans, AST/IR shape.
2. Metric comparison: formula width, height, depth, axis, and baseline.
3. Glyph sequence comparison: font ID and glyph ID/name.
4. Coordinate comparison: absolute glyph positions.
5. Paragraph comparison: line breaks and break reasons.
6. SVG structure comparison: path IDs, transforms, rules, and viewBox.
7. Raster diagnostics: optional side-by-side images for human inspection.

### Required Matrices

The first serious validation matrix should include:

- styles: inline text style, display style, script style through scripts;
- widths: 80, 100, 120, 150, 200, 240, 320 pt for paragraph cases;
- formulas: atoms, operators, scripts, nested scripts, fractions, radicals,
  delimiters, spacing commands;
- paragraphs: text before/after math, multiple math spans, breakable math,
  multi-paragraph nodes, forced line breaks;
- display: paragraph-display-paragraph, display after list item, display in
  quote/list contexts when those contexts support it;
- alignment: one-column, two-column, multi-row, scripts/fractions in cells.

### Acceptance Levels

Use explicit gates:

- `experimental`: parser totality, no crashes, diagnostics are stable.
- `structural`: line counts, glyph sequences, source spans, and box tree agree.
- `metric`: dimensions and coordinates are within stated tolerances.
- `visual`: rendered SVG is nonblank and human-readable; raster diagnostics do
  not show unexplained differences.
- `editor-ready`: hit testing and selection tests pass.
- `default-on`: feature passes fuzz matrix at 100% for supported constructs and
  has no silent fallback.

A construct is "implemented" only at `default-on`. Before that, it must be
gated by capability flags or explicit unsupported placeholders.

### Current Quality Gap Inventory

The quality pass on the current implementation shows that the existing
supported grammar is mostly healthy under the available gates:

- parser unit/layout/render suites pass for the current math subsystem;
- parser fuzz is total over 10,000 generated inputs with random source offsets;
- isolated math fuzz passes against LuaLaTeX for the current formula grammar;
- inline text/math paragraph glyph fuzz passes for the current mixed formula
  grammar at 80, 120, and 160 pt widths;
- inline text/math paragraph glyph fuzz also has absolute-coordinate mixed and
  script-heavy large modes that compare math glyphs after applying TeX vlist
  line placement;
- display construct and large display fuzz matrices compare glyphs in
  absolute vbox coordinates and pass at the current 0.03 pt tolerance;
- aligned math fuzz passes for the currently supported alignment grammar.
- mixed vertical-list display fixtures (`quote` and `itemize`) have a glyph
  oracle mode and pass at the current 0.03 pt tolerance for the focused
  paragraph-display-paragraph fixtures.
- mixed vertical-list display fuzz now covers quote, itemize, enumerate,
  description, nested quote/itemize, and two-item list contexts, includes
  aligned display formulas, and passes at the current 0.03 pt tolerance for
  the generated display formulas.

The main gaps are therefore not isolated command coverage. The next robustness
work should focus on:

- running larger versions of the same fuzz matrices and making them cheap
  enough for regular use;
- expanding absolute-coordinate glyph trace coverage beyond the current inline,
  display, and mixed vertical-list gates into broader document-level matrices;
- expanding editor hit-test fuzz beyond simple inline formulas into scripts,
  fractions, radicals, alignment rows, and line breaks around math;
- documenting each known intentional mismatch between MathJax diagnostic tests
  and LuaLaTeX behavior before using MathJax corpus failures as work items;
- expanding the mixed vertical-list fuzz grammar to include aligned displays
  and larger generated corpora once the regular run time is cheap enough.

## Phased Implementation

### Phase 0: Remove MathJax From the New Path

Goal:

- Inline math in the TeX-derived path becomes an explicit unsupported math
  placeholder unless handled by the new math subsystem.
- Legacy MathJax rendering remains outside this path if needed.

Validation:

- Existing paragraph text tests still pass for non-math input.
- Math input reports a typed unsupported reason with source span.
- No new TeX-derived path code calls MathJax measurement/rendering APIs.
- Capability/fallback tests verify unsupported math is visible in diagnostics.

### Phase 1: Math Parser and IR Skeleton

Goal:

- Parse simple inline math into `TexMathList`.
- Support identifiers, numbers, basic operators, groups, scripts, `\frac`,
  and spacing commands as IR.

Validation:

- Unit fixtures cover at least 200 parser cases.
- Parser fuzz runs 10,000 cases without crash.
- Source-span coverage is exact.
- Unsupported commands are placeholders, not thrown exceptions.

### Phase 2: Font Profile and Metric Extraction

Goal:

- Add math font profile interfaces.
- Vendor the default LuaLaTeX font metric/glyph data needed for the initial
  formula set.
- Record oracle font identity in manifests.

Validation:

- Generated metric tables are deterministic.
- For each vendored font, checksum/source metadata is present.
- Raw glyph widths and boxes match extracted font data within table precision.
- A small oracle script confirms the default LuaLaTeX profile used by tests.

### Phase 3: Inline Math Layout

Goal:

- Layout atom lists with TeX class spacing, italic correction, scripts, simple
  fractions, and simple radicals.
- Render glyph SVG from profile data.

Validation:

- Unit tests for spacing/class transitions.
- Oracle formula metrics within tolerances.
- Glyph sequence and coordinate traces match supported fixtures.
- SVG smoke tests are nonblank.

### Phase 4: Paragraph Integration

Goal:

- Inline math contributes paragraph items, breakpoints, penalties, and hit maps.
- Breakable math around binary/relation operators matches TeX for supported
  cases.

Validation:

- Fuzz matrix over text plus inline math at standard widths reaches 100%
  agreement for supported grammar.
- Line breaks are compared against LuaLaTeX, including breaks inside math.
- Caret and selection tests pass for single-line and multi-line paragraphs.

### Phase 5: Display Math Blocks

Goal:

- Add display math as vertical-list block content.
- Support display style, display skips, and no-number equation-style layout.

Validation:

- Paragraph-display-paragraph oracle fixtures match vertical spacing and glyph
  coordinates.
- Display formulas use display style metrics.
- Editor reports include display block source spans and geometry.

### Phase 6: Alignment Math

Goal:

- Add `aligned` and then `align*` through a reusable alignment model.

Validation:

- Column anchors, row baselines, and glyph coordinates match oracle fixtures.
- Fuzz generated aligned formulas with bounded syntax.
- Unsupported AMS features remain explicit placeholders.

### Phase 7: Broaden Coverage

Goal:

- Add accents, stretchy delimiters, large operators with limits, arrays,
  matrix-like constructs, text-in-math commands, and selected AMS commands.

Validation:

- Each construct gets a focused unit suite, oracle fixtures, fuzz grammar, and
  editor-hit-map coverage where applicable.
- A larger nightly-style matrix tracks default-on coverage and regression risk.

## Risk Register

- LuaLaTeX default fonts may vary with TeX Live version. Mitigation: record
  engine and font identity in oracle manifests.
- Extracted SVG traces may introduce coordinate noise. Mitigation: compare raw
  layout metrics and glyph traces first; use raster images only diagnostically.
- TeX macro expansion can dominate edge cases. Mitigation: start with a bounded
  supported grammar and explicit placeholders.
- OpenType MATH table handling is broader than current text TFM handling.
  Mitigation: keep provider interfaces general and implement only the default
  profile subset first.
- Alignment environments can become a separate layout system. Mitigation:
  design them as vertical/horizontal box lists with alignment anchors.
- Editor hit testing may lag visual rendering. Mitigation: make report output a
  required acceptance gate, not a later polish step.

## Definition of Done

For a feature to be considered fully implemented:

- it is represented in the parser and math IR with source spans;
- it lays out through font-profile metrics, not hard-coded visual estimates;
- it renders through vendored glyph/rule data, not MathJax;
- it has deterministic unit tests;
- it has LuaLaTeX oracle fixtures;
- it participates correctly in paragraph or vertical-list layout;
- it has editor hit-test/selection behavior or an explicit reason why that is
  not meaningful;
- unsupported subcases produce typed diagnostics or placeholders;
- fuzz coverage includes the construct before it is enabled by default.

## Immediate Next Step

Start with Phase 0 and Phase 1 together:

1. Remove MathJax measurement/rendering from the TeX-derived inline math path.
2. Add `packages/core/src/text/tex/math/ir.ts`.
3. Add `packages/core/src/text/tex/math/parser.ts`.
4. Parse a narrow inline grammar into `TexMathList`.
5. Add parser unit tests and parser-only fuzzing before adding layout.

This creates a clean foundation: source parsing remains ours, MathJax stops
pulling the design sideways, and every later rendering feature has a TeX-like
IR target plus a validation contract.
