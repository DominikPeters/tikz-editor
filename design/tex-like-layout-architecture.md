# TeX-Like Text Layout Architecture

## Purpose

TikZ Editor currently renders rich node text through MathJax and uses a
custom Knuth-Plass paragraph breaker to approximate TeX line breaking. The
long-term goal is stronger compiler faithfulness: users should be able to
fine-tune text alignment in the editor and see line breaks that match the
actual LaTeX compiler as closely as possible.

This document sketches an architecture for moving from a MathJax-owned text
layout model toward a TeX-like layout subsystem. The same subsystem should
support TikZ node text first, then basic LaTeX block constructs such as
`itemize`, `enumerate`, `description`, `quote`, and eventually `tabular` and
Beamer frame layout.

## Goals

- Match TeX paragraph breaking decisions for common TikZ node text.
- Keep editor preview metrics and line breaking tied to the same layout model.
- Preserve MathJax as the renderer/layout engine for math islands.
- Build reusable infrastructure for interpreting LaTeX fonts and producing both
  measurements and SVG glyph output from that font data.
- Make block constructs reusable across TikZ node text and future Beamer-like
  WYSIWYG editing.
- Validate progress with oracle comparisons against installed TeX engines.
- Keep implementation incremental; existing MathJax rendering should remain a
  fallback while the TeX-like layer grows.

## Non-Goals

- Reimplement all of LaTeX.
- Replace MathJax for math layout.
- Support arbitrary package behavior in the first iteration.
- Guarantee pixel-identical output for every font/backend combination.
- Build a full TeX macro expansion engine before extracting value from text
  layout improvements.

## Current State

The current pipeline for MathJax-backed node text is roughly:

```text
TikZ source
  -> parser and semantic evaluator
  -> node text request
  -> MathJax TeX input
  -> MathJax wrappers
  -> custom paragraph visitor for breakable mtext
  -> SVG scene text payload
```

The custom paragraph visitor already includes:

- Flattening MathJax text and math wrappers into paragraph runs.
- Knuth-Plass paragraph breaking.
- English hyphenation data aligned to default TeX `hyphen.tex`.
- TeX-like interword glue constants and TikZ ragged skip constants.
- A more complete TeX-like spacefactor model for wrapped text.
- A LuaTeX oracle comparison script with line, hyphenation, glue, and badness
  diagnostics.

The largest remaining mismatch is that MathJax text measurement is internally
consistent with MathJax's own SVG font tables, but not with the compiler's TeX
font metric pipeline. TeX uses `.tfm` widths, ligature/kern programs, font
encodings, and LaTeX font selection. MathJax text uses Unicode-oriented
MathJax font tables.

## Target Architecture

The first exact target is default pdfLaTeX with Computer Modern. The
architecture should not be Computer-Modern-specific: it should interpret a
font profile, resolve the relevant LaTeX font data, and produce shaped metrics
and renderable glyph data through the same interface. Later profiles can add
Latin Modern, New Computer Modern, TeX Gyre families, or Unicode/OpenType
fonts without changing paragraph/list layout code.

The long-term shape is:

```text
LaTeX-ish content inside TikZ node or Beamer frame
  -> source frontend
       macro-aware tokenization
       font state
       paragraph/block structure
  -> TeX-like layout IR
       horizontal items
       vertical items
       math boxes
       rules
       alignments
  -> layout algorithms
       text shaping
       paragraph breaking
       vertical list layout
       list layout
       tabular alignment
  -> SVG renderer
       positioned TeX-shaped text
       MathJax-rendered math islands
       editor hit maps
```

MathJax remains responsible for math islands. Ordinary text, paragraph
breaking, list indentation, vertical spacing, and later tabular alignment move
into a TeX-like subsystem owned by the renderer.

## Core Concepts

### Layout IR

Introduce a layout IR that is independent of MathJax wrappers. This IR should
model the primitives TeX layout algorithms operate on without requiring a full
TeX implementation.

Horizontal items:

- `GlyphBox`: shaped text glyph with font id, glyph id, advance, height, depth,
  and source span.
- `Kern`: fixed horizontal adjustment from font metrics or explicit commands.
- `Glue`: width, stretch, shrink, stretch order, shrink order, and source span.
- `Penalty`: break penalty, flagged status, and optional replacement items.
- `MathBox`: atomic inline math box rendered/measured by MathJax.
- `Rule`: horizontal or vertical rule where needed.
- `HBox`: grouped horizontal box for labels, inline constructs, or measured
  fragments.

Vertical items:

- `VBox`: grouped vertical box.
- `VGlue`: vertical skip with stretch/shrink.
- `VPenalty`: vertical page/list break penalty, even if page breaking is not
  used initially.
- `LineBox`: result of paragraph breaking.
- `BlockBox`: paragraph, list item, quote, tabular, or Beamer block result.

This IR gives lists, quotes, and tabular a natural place to live. They should
not be hard-coded as editor UI boxes.

### Font Profiles

Add a font profile abstraction that connects three things that are currently
only loosely related:

- The user's visual MathJax font setting.
- The LaTeX font package/profile used by the compiler.
- The metric source used by the TeX-like layout subsystem.
- The glyph outline source used by the SVG text renderer.

The app should expose this primarily as a document font profile, not as a
purely visual MathJax setting. When the user opens a larger paper source, the
profile can later be inferred from the document preamble. Manual selection
should remain available when inference is incomplete or unsupported.

Example profile fields:

```ts
interface TexFontProfile {
  id: string;
  label: string;
  mathJaxFont: MathJaxFont;
  latexPreamble: string[];
  defaultEncoding: "OT1" | "T1" | "TU";
  defaultFamily: string;
  defaultSeries: string;
  defaultShape: string;
  fallbackMathJaxFont: MathJaxFont;
  metrics: TexMetricProvider;
  glyphs: TexGlyphProvider;
}
```

The current MathJax font list can map approximately to TeX profiles:

- `mathjax-newcm`: New Computer Modern.
- `mathjax-modern`: Latin Modern.
- `mathjax-tex`: Computer Modern-like classic TeX.
- `mathjax-bonum`, `mathjax-pagella`, `mathjax-schola`, `mathjax-termes`: TeX
  Gyre families.
- `mathjax-stix2`, `mathjax-asana`, `mathjax-dejavu`, `mathjax-fira`: likely
  Unicode/OpenType-oriented profiles.

For pdfLaTeX-like fidelity, the source data should be `.fd`, `.tfm`, encoding,
and outline files resolved from TeX Live by generator scripts. The generated
metric and glyph data should be vendored so both the web and desktop apps can
run without a local TeX installation. TeX Live lookup remains useful for
development, regeneration, and oracle diagnostics. For LuaLaTeX/fontspec
profiles, the metric and glyph source may need OpenType data through a
separate provider.

The initial profile should target default pdfLaTeX Computer Modern. It should
start with OT1, because that is the default encoding for classic pdfLaTeX
without `fontenc`. T1 should be designed as an additional encoding table and
fixture set, not as a separate shaping architecture. The expected overhead is
moderate if encoding is a pluggable layer:

- extra encoding maps from input characters/macros to font character codes;
- extra `.fd`/`.tfm` families such as EC/Latin Modern when targeting T1;
- additional oracle fixtures for accents, quotes, hyphenation, and ligatures;
- slightly more font-profile plumbing to select the active encoding.

The shaping engine should not assume OT1-specific character codes internally.

### Metric Providers

Metric providers should expose shaped text, not just raw character widths:

```ts
interface TexMetricProvider {
  resolveFont(state: TexFontState): ResolvedTexFont;
  shapeText(text: string, font: ResolvedTexFont): ShapedTextRun;
}
```

For TFM-backed fonts, `shapeText` needs:

- LaTeX font selection data from `.fd` files.
- Encoding mapping from source characters/macros to font character codes.
- `.tfm` width, height, depth, italic correction, ligature, kern, and fontdimens.
- TeX ligature/kern program execution.

This is both data and logic. The data comes from actual TeX fonts; the logic
applies it the way TeX does.

Metric data should be generated into compact, deterministic tables checked
into the repository. Generator scripts should remain in the repo and resolve
their inputs through TeX Live tools such as `kpsewhich`. The generated data
should be the runtime dependency; local TeX Live should not be required in the
web or desktop application.

### Glyph Providers

Glyph providers should expose renderable outlines and glyph metadata for the
same resolved font used by shaping:

```ts
interface TexGlyphProvider {
  resolveGlyph(font: ResolvedTexFont, glyphId: number): ResolvedTexGlyph;
}
```

For the initial pdfLaTeX/Computer Modern profile, glyph data can be generated
from Type 1 `.pfb` outlines distributed with TeX Live. Later profiles may use
OpenType outlines. The renderer should position glyphs from shaped advances
and kerns rather than relying on browser text shaping.

### Math Islands

MathJax remains the engine for math islands:

```text
text run
  -> TeX-shaped GlyphBox/Kern/Glue items
math island
  -> MathJax SVG box
  -> MathBox with width/height/depth/source span
text run
  -> TeX-shaped items
```

Math islands are atomic for paragraph breaking unless we deliberately add
line-breaking support inside math later.

### Source Frontend

The frontend should be modest at first. It does not need to expand all LaTeX
macros, but it should preserve enough structure and state for layout:

- Text mode vs math mode.
- Font switches such as `\rmfamily`, `\sffamily`, `\ttfamily`, `\bfseries`,
  `\itshape`, `\emph`.
- Explicit line breaks.
- Spaces and paragraph boundaries.
- Simple grouping.
- List, quote, and tabular environments as block nodes when supported.

This should be separate from layout. The same block tree can later support
TikZ nodes and Beamer frames.

Unsupported input should initially trigger whole-node fallback to the existing
MathJax-backed path. This keeps the first TeX-like path simple and makes
unsupported cases explicit. If whole-node fallback becomes rare, the fallback
path can later be narrowed or removed.

### Editing and Hit Testing

The canvas editor already supports node text editing through a report-driven
caret and selection API. The current MathJax/Knuth-Plass path exposes
`ParagraphLayoutReport` objects with visual lines, line segments, source
offsets, and optional per-segment `caretStops`. The hit-testing layer then maps
raw source offsets to line-local x positions and uses rendered SVG line boxes
for geometry.

The TeX-like layout subsystem should preserve this shape instead of tying
editing to DOM text nodes. A future renderer-neutral report can replace the
Knuth-Plass-specific name, but it should keep the same essential contract:

- every visual line has a stable line box in SVG with a bounding box and CTM;
- every line segment has a raw source span in the editable TikZ node text;
- every editable segment exposes caret stops in layout coordinates;
- caret stops are indexed by raw source offset, not by shaped glyph index;
- selection rectangles are derived from the same line geometry and stop map
  used for caret placement.

This matters because TeX shaping deliberately breaks the current "one source
character gives one measured prefix" approximation. Ligatures can collapse
multiple source characters into one glyph, kerns alter the advance between
characters, and discretionary hyphens can add visible material that is not a
literal source character. The shaper and paragraph builder therefore need to
emit source-aware stop maps as a first-class result.

For example, a shaped `ffi` ligature may contain one rendered glyph but still
needs valid caret positions for the raw offsets before `f`, between the two
`f`s, between `f` and `i`, and after `i`. Some of those stops may intentionally
share the same x coordinate, or later use an explicit affinity policy if we
want finer hit behavior around ligatures. The important architectural point is
that the mapping comes from the TeX-shaped item trace, not from measuring
substrings with MathJax.

The current editor implementation has two assumptions that should be tightened
when the TeX path is introduced:

- Source alignment should not infer segment source spans by counting displayed
  string lengths. The layout frontend should attach raw source ranges directly
  to tokens, shaped glyphs, glue, penalties, and final line segments.
- Rendered line geometry should not depend on MathJax-specific attributes such
  as `data-mjx-linebox`. The new SVG text renderer can either preserve those
  attributes during migration or introduce a generic line-box marker consumed
  by the shared hit-testing module.

## Block Constructs

### Paragraphs

Paragraphs use the horizontal item builder and Knuth-Plass breaker:

```text
paragraph source
  -> inline token stream
  -> shaped horizontal items
  -> hyphenation and discretionary penalties
  -> Knuth-Plass line breaking
  -> LineBox[]
```

The paragraph breaker should continue using TeX-like badness, demerits,
fitness classes, tolerance, emergency stretch, line penalties, flagged
penalties, and paragraph shape where appropriate.

### Lists

Lists should be modeled as vertical layout with LaTeX-like list parameters:

- `leftmargin`
- `rightmargin`
- `labelwidth`
- `labelsep`
- `itemindent`
- `listparindent`
- `topsep`
- `partopsep`
- `parsep`
- `itemsep`

Each item is a block whose first paragraph has a label box positioned according
to the active list parameters. Nested lists push a new list state. This keeps
`itemize`, `enumerate`, and `description` on the same mechanism.

### Quotes

`quote` and `quotation` are vertical blocks that mainly alter margins,
paragraph indentation, and vertical skips. They should reuse paragraph layout
with adjusted block state rather than becoming custom render boxes.

### Tabular

Tabular support should be deferred until the layout IR and text shaping are
stable. It will need:

- Cell parsing.
- Column specs.
- Natural width measurement.
- Column width resolution.
- Row baselines and struts.
- Rules.
- Horizontal and vertical alignment.

The layout IR should already contain enough concepts for `tabular`: boxes,
glue, rules, and alignment rows/cells.

### Beamer

Future Beamer editing should reuse the same primitives:

- Frame as a vertical layout root.
- Text blocks and lists as block boxes.
- Columns as constrained block containers.
- Beamer blocks as decorated vertical boxes.
- Math islands through MathJax.
- Overlay support as source-state and visibility layers, not as a separate
  layout model.

## Rendering Strategy

The first TeX-like implementation can keep MathJax SVG rendering for math and
use a new SVG text renderer for shaped text. For the initial Computer Modern
profile, the target renderer should eventually use generated glyph outlines
from the actual TeX font, not MathJax's Computer-Modern-like paths.

For visual fidelity, text glyph rendering should eventually use outlines from
the same font family as the metric source:

- Type 1 `.pfb` or OpenType outlines for TeX fonts.
- Glyph subsetting/cache for SVG output.
- Explicit glyph positioning for kerns and ligatures.

Until that exists, there are two useful intermediate modes:

- Use TeX-derived metrics for line breaking while keeping MathJax text drawing.
- Render shaped Unicode runs with explicit `x` positions where the browser font
  is a close visual match.

The preferred end state is metric-and-display coherence: the same font profile
drives shaping, line breaking, and SVG glyph placement.

## Validation

The oracle harness should become a core development tool:

- Compare line text.
- Compare hyphenation points.
- Compare line count.
- Compare line natural widths.
- Compare glue stretch/shrink and badness.
- Report first divergent line with source spans and shaped item traces.

The oracle should support:

- pdfLaTeX-like profiles for TFM-backed fonts.
- LuaLaTeX profiles for Unicode/OpenType fonts when needed.
- Fixed seed fuzz cases.
- Curated regression snippets for tricky spacing, ligatures, kerns, nested
  environments, and math islands.

Agreement metrics should prefer semantic layout faithfulness over pixel
comparison. Pixel comparison remains useful for final SVG/compiler visual
checks, but paragraph debugging should use line-level and item-level metrics.

## Implementation Phases

### Phase 1: Design Boundary and Diagnostics

- Keep the current MathJax paragraph path working.
- Introduce names and types for a layout IR without migrating all code.
- Add richer report fields where needed: source spans, item traces, font state,
  shaped width source.
- Extend oracle reports to include enough data to diagnose font metric,
  hyphenation, glue, and penalty mismatches.

Exit criteria:

- Existing paragraph tests still pass.
- Oracle reports identify whether a mismatch is due to width, hyphenation,
  glue, or breakpoint scoring.

### Phase 2: TFM Metrics Reader

- Add a TFM parser or integrate a small dependency if one is acceptable.
- Resolve `.tfm` files through `kpsewhich` in local/dev oracle mode.
- Extract character dimensions, ligature/kern programs, and fontdimens.
- Add unit tests for known fonts such as `cmr10` and `ec-lmr10`.
- Add a generator that writes vendored metric tables for the initial Computer
  Modern profile.

Exit criteria:

- Can read common TeX Live TFM files.
- Can reproduce selected TeX character widths and kern pairs.
- Generated metric data can be loaded without TeX Live at runtime.

### Phase 3: TeX Text Shaping

- Implement a TFM-backed `TexMetricProvider`.
- Add OT1 encoding mapping for the initial pdfLaTeX/Computer Modern target.
- Keep the encoding layer pluggable so T1 can be added with a data-table and
  fixture expansion rather than a different shaper.
- Apply TeX ligature/kern programs to plain text runs.
- Produce `GlyphBox` and `Kern` items with raw source spans.
- Produce source-offset caret stop maps for shaped text runs, including
  ligatures, kern pairs, punctuation ligatures, and zero-width/collapsed stops
  where needed.
- Compare shaped words against LuaTeX node lists for cases like `fi`, `ff`,
  `fl`, `To`, punctuation, and quotes.

Exit criteria:

- Word natural widths match TeX for a focused corpus.
- Ligatures and kerns explain previously observed paragraph divergences.
- Focused hit-map fixtures can place carets and draw selections through shaped
  words such as `office`, `fluff`, and kerned pairs such as `AV` or `To`.

### Phase 4: Paragraph Engine Migration

- Feed TeX-shaped horizontal items into the existing Knuth-Plass breaker.
- Keep MathJax math islands as atomic boxes.
- Preserve current editor hit testing and caret mapping by emitting a
  renderer-neutral layout report with line geometry hooks, raw source spans,
  and caret stop maps.
- Add profile selection plumbing from app settings to layout.
- Use whole-node fallback to the existing MathJax path for unsupported input.

Exit criteria:

- Paragraph agreement improves on the fuzz/oracle suite.
- Existing MathJax paragraph rendering remains available as fallback.
- Existing canvas text editing APIs continue to work for TeX-shaped paragraphs,
  including multi-line selections, hyphenated line breaks, transformed nodes,
  and math-island boundaries.

### Phase 5: SVG Text Glyph Rendering

- Add a shaped text SVG renderer.
- Add generator support for Computer Modern Type 1 glyph outlines.
- Render shaped glyph sequences with explicit positioning from TeX metrics.
- Keep positioned text or MathJax-compatible glyph output only as temporary
  intermediate options if outline extraction is not ready yet.
- Add glyph cache/subsetting if output size becomes a problem.

Exit criteria:

- Preview rendering uses the same shaped item sequence as line breaking.
- Ligatures and kerns are visible in the SVG output where TeX would use them.
- The initial profile can produce both measurements and SVG glyphs from
  vendored TeX-derived data.

### Phase 6: Lists and Quotes

- Add block frontend support for `itemize`, `enumerate`, `description`,
  `quote`, and `quotation`.
- Implement LaTeX-like list parameter stacks.
- Layout items as vertical lists containing paragraph blocks.
- Add oracle comparisons for nested lists and mixed text/math list items.

Exit criteria:

- Basic nested lists and quotes render with compiler-like indentation and line
  breaks.
- The implementation reuses paragraph/block primitives rather than custom
  one-off layout.

### Phase 7: Tabular and Beamer Foundations

- Add alignment/table IR.
- Implement a limited `tabular` subset.
- Define Beamer frame/block/columns layout roots around the same block model.
- Add overlay metadata as a separate visibility layer.

Exit criteria:

- Simple tables and Beamer-like frame layouts reuse the same text, math, and
  block layout infrastructure.

## Risks and Tradeoffs

- Exact LaTeX compatibility can expand without bound. The implementation needs
  explicit supported profiles and environments.
- Font selection is hard. Start with one default compiler profile and grow
  deliberately.
- MathJax and TeX font families are not identical. A profile must state whether
  it is visual-only, metric-faithful, or metric-and-display coherent.
- Editor hit testing can regress if shaped ligatures collapse multiple source
  characters into one glyph. Source span mapping must be part of shaping from
  the beginning.
- Browser and SVG font rendering can introduce visual differences even when
  line breaks match. The line-breaking oracle should stay separate from visual
  pixel comparison.

## Open Questions

- Where should generated font data live, and what size budget is acceptable for
  web delivery?
- Which exact Computer Modern font set should be included in the first profile:
  only roman/italic/bold/typewriter/sans at 10pt scale, or the broader LaTeX
  size substitutions as well?
- How should document font profile inference work when the user opens a full
  paper source with a preamble?
- When should T1 support be added after the OT1 path is working?
- How much macro expansion should happen before the layout frontend delegates
  unsupported input back to MathJax?

## Near-Term Recommendation

Start with a narrow, measurable path:

1. Add a TFM reader and a default pdfLaTeX/Computer Modern OT1 metric profile.
2. Implement TFM-backed shaping for plain text words.
3. Generate and vendor runtime metric data from TeX Live.
4. Compare shaped word widths and ligature/kern behavior against LuaTeX.
5. Feed those shaped widths into the existing paragraph breaker with whole-node
   fallback for unsupported input.
6. Add generated Computer Modern glyph outlines and a shaped SVG text renderer.
7. Add T1 as a second encoding/profile once OT1 shaping and rendering are
   stable.

This sequence improves line-break faithfulness without forcing an immediate
replacement of MathJax rendering. It also creates the primitives needed for
lists, quotes, tabular, and future Beamer frame layout.
