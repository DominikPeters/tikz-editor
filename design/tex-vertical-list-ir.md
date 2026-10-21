# TeX Vertical List IR

## Purpose

Introduce a small TeX-like vertical list model for the text subsystem. The
immediate goal is not to implement TeX's full page builder, nor to start Beamer
frame support. The goal is to stop encoding vertical behavior as special cases
inside paragraph/list/quote layout, and instead give paragraphs, lists, quotes,
manual skips, boxes, and placeholders one common layout representation.

This document refines the vertical-item part of
`design/tex-like-layout-architecture.md`. It is intentionally scoped to layout
fundamentals that are useful before any Beamer-specific work: box metrics,
vertical glue, nested boxes, source spans, and fallback placeholders.

## Goals

- Preserve current TikZ node text behavior while moving paragraph/list/quote
  stacking into a reusable vertical list layer.
- Represent TeX-like vertical primitives explicitly: boxes, glue, penalties,
  rules, and nested vboxes.
- Make source spans, measured dimensions, editor hit maps, and fallback
  granularity first-class data.
- Keep the model general enough that a future document/frame renderer can lower
  into it without changing the fundamentals.
- Leave horizontal paragraph layout free to evolve: inline math, color boxes,
  tabular cells, and font profiles should plug in through measured box
  contracts rather than forcing vertical-list rewrites.
- Keep the first implementation narrow and oracle-validated against current
  paragraph/list/quote behavior.

## Non-Goals

- Implement TeX's page-breaking algorithm.
- Model every LaTeX package environment.
- Replace MathJax for math layout.
- Make Beamer frame rendering, Beamer blocks, or theme chrome land in the first
  vlist refactor.
- Model `tcolorbox` or other package-specific decorated boxes.
- Change current line breaking, glyph placement, list indentation, or quote
  spacing as part of introducing the IR.

## Why Now

The current TeX text path already has vertical concerns:

- multiple paragraphs from `\par` and blank lines;
- `\\` and `\\[<skip>]`;
- `\noindent`;
- list labels, list margins, `\item` boundaries, and nested list spacing;
- quote margins and vertical skips;
- paragraph reports consumed by editor caret/selection code.

Those concerns currently live close to paragraph layout. That was a pragmatic
way to validate TeX-shaped paragraphs, but it makes the text subsystem harder
to extend cleanly. Starting the vlist model now lets the existing text path
become the first producer and consumer, with future document-level renderers
able to reuse the same primitives later.

## Core Model

### Metrics

Every laid-out box uses TeX-style dimensions:

```ts
interface TexBoxMetrics {
  readonly width: number;
  readonly height: number; // above baseline
  readonly depth: number;  // below baseline
}
```

For vertical stacking, a box also needs a baseline policy:

```ts
type TexVBoxBaseline =
  | { kind: "first-line" }
  | { kind: "center" }
  | { kind: "explicit"; y: number }
  | { kind: "none" };
```

TikZ node text mostly cares about full bounding boxes and line hit maps. The
baseline policy is still worth modeling now because it affects nested boxes and
future display-style constructs.

### Source Spans

Every item that came from source should preserve a source span:

```ts
interface TexSourceSpan {
  readonly start: number;
  readonly end: number;
}

```

Overlay visibility is deliberately out of scope for the first vlist model. If a
future document renderer needs it, visibility should be added as metadata on
layout items rather than as renderer-only state.

### Items

The minimal vertical-list IR:

```ts
type TexVListItem =
  | TexParagraphItem
  | TexHBoxItem
  | TexVBoxItem
  | TexGlueItem
  | TexPenaltyItem
  | TexRuleItem
  | TexPlaceholderItem;

interface TexParagraphItem {
  readonly kind: "paragraph";
  readonly sourceSpan: TexSourceSpan;
  readonly paragraph: TexParagraphLayoutInput;
  readonly options: TexParagraphBlockOptions;
}

interface TexHBoxItem {
  readonly kind: "hbox";
  readonly sourceSpan?: TexSourceSpan;
  readonly box: TexHorizontalLayout;
}

interface TexVBoxItem {
  readonly kind: "vbox";
  readonly sourceSpan?: TexSourceSpan;
  readonly width?: TexDimenExpr;
  readonly items: readonly TexVListItem[];
  readonly alignment?: "top" | "center" | "bottom";
}

interface TexGlueItem {
  readonly kind: "glue";
  readonly sourceSpan?: TexSourceSpan;
  readonly size: number;
  readonly stretch?: number;
  readonly shrink?: number;
  readonly stretchOrder?: "normal" | "fil" | "fill" | "filll";
  readonly shrinkOrder?: "normal" | "fil" | "fill" | "filll";
}

interface TexPenaltyItem {
  readonly kind: "penalty";
  readonly sourceSpan?: TexSourceSpan;
  readonly penalty: number;
}

interface TexRuleItem {
  readonly kind: "rule";
  readonly sourceSpan?: TexSourceSpan;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

interface TexPlaceholderItem {
  readonly kind: "placeholder";
  readonly sourceSpan: TexSourceSpan;
  readonly reason: string;
  readonly estimated: TexBoxMetrics;
}
```

The first implementation can omit fields that are not yet consumed, but the
types should leave room for them. In particular, `TexGlueItem` should already
have stretch orders because TeX vertical glue distinguishes finite stretch from
`fil`/`fill`/`filll`, and that is fundamental rather than package-specific.

### Horizontal Contract

The vertical layer should not know whether a paragraph contains bold text,
inline math, a color box, or a future inline TikZ box. It only needs a measured
horizontal layout result:

```ts
interface TexHorizontalLayout {
  readonly metrics: TexBoxMetrics;
  readonly lines?: readonly TexLineBox[];
  readonly renderItems: readonly TexRenderItem[];
  readonly hitMap?: TexHitMap;
}
```

The current TeX-shaped paragraph path can produce this contract from text runs
and line boxes. Later, inline math and inline boxes become horizontal items
inside the paragraph breaker without changing the vlist abstraction.

## Layout Result

Laying out a vlist produces positioned boxes and glue:

```ts
interface TexVListLayout {
  readonly metrics: TexBoxMetrics;
  readonly baseline: TexVBoxBaseline;
  readonly items: readonly PositionedTexVListItem[];
  readonly reports: readonly TexLayoutReport[];
  readonly errors: readonly string[];
}

interface PositionedTexVListItem {
  readonly item: TexVListItem;
  readonly x: number;
  readonly y: number;
  readonly metrics: TexBoxMetrics;
}
```

For current TikZ node text, `reports` should include the existing
`ParagraphLayoutReport` data used by SVG rendering and editor hit testing. The
goal is not to replace those reports immediately; the vlist layout should
become the owner that assembles them.

## Lowering Rules

### Current Text Path

Existing simple TeX blocks lower as:

- paragraph segment -> `TexParagraphItem`;
- paragraph boundary -> no item by itself; it affects paragraph item sequence
  and inserted glue according to the existing vertical model;
- `\\[<skip>]` -> paragraph line break inside the paragraph item, plus line
  leading in the paragraph report;
- list item -> paragraph item with a label hbox and margins, or eventually a
  `TexVBoxItem` representing the list item body;
- quote environment -> nested vbox with left/right margins and entry/exit
  glue;
- unsupported block -> `TexPlaceholderItem` or whole-node fallback, depending
  on caller policy.

The first refactor should lower current blocks into a vlist and then produce
the same combined paragraph report as today. That gives us a behavior-preserving
migration path.

## Layout Options

The vlist API should start with only the layout constraints needed by the text
subsystem:

```ts
interface TexVListLayoutOptions {
  readonly width: number;
  readonly height?: number;
  readonly verticalAlign?: "top" | "center" | "bottom";
}
```

`height` and `verticalAlign` are not required for the first TikZ node-text
refactor, but including them in the options shape keeps root-box alignment from
becoming an ad hoc later addition.

## Fallback Granularity

Fallback placeholders are part of the IR because the text subsystem needs
graceful degradation without demoting larger structures unnecessarily:

- inline fallback inside a paragraph;
- block fallback inside otherwise supported text content.

Frame- or document-level fallback remains a future caller policy. The vlist
layer should only own placeholders that occupy space inside supported content.

## Editor Hit Testing

The existing text editor relies on paragraph reports with line boxes, segment
source spans, and caret stops. The vlist model must preserve that contract.

The first implementation should:

- keep producing `ParagraphLayoutReport` for text paragraphs;
- associate positioned vlist items with source spans;
- expose a tree of positioned boxes for future block-level hit testing;
- avoid hiding source spans inside renderer-only SVG output.

This generalizes from "one TikZ node has paragraph reports" to "a positioned
box tree has paragraph reports plus box geometry".

## Module Placement

Recommended package structure:

```text
packages/core/src/text/tex/
  ir.ts                    # existing simple TeX frontend, eventually renamed
  paragraph.ts             # paragraph shaping/breaking/reporting
  vlist/
    types.ts               # TexVListItem, TexBoxMetrics, source spans
    lower-simple.ts        # current simple text blocks -> vlist
    document.ts            # simple TeX document preparation and layout IR
    paragraph-plans.ts     # vlist paragraph extraction and scoped plans
    paragraph-items.ts     # paragraph plans -> horizontal breaker items
    paragraph-breaker.ts   # paragraph-plan breaking orchestration
    layout.ts              # vlist layout algorithm
    report.ts              # vlist -> ParagraphLayoutReport assembly
```

Do not put document- or presentation-specific concepts in `text/tex/vlist`.
Future callers should lower their own IR into this package.

## Implementation Phases

### V0: Types and No-Behavior-Change Lowering

- Add `text/tex/vlist/types.ts`.
- Add a lowering pass from existing simple paragraph blocks to vlist items.
- Keep current paragraph layout as the execution backend.
- Add tests proving current paragraph/list/quote reports are byte-equivalent
  before and after lowering.

Exit: no output changes; current TeX text tests and visual fuzz smoke pass.

### V1: VList-Owned Vertical Stacking

- Move paragraph/list/quote vertical skip calculation into vlist layout.
- Represent current quote/list entry/exit spacing as named glue items.
- Produce the same `ParagraphLayoutReport` as today from positioned vlist
  output.

Exit: current paragraph/list/quote oracle and visual fuzz tests pass.

### V2: Explicit Vertical Glue

- Add frontend support for fundamental vertical commands:
  `\vspace`, `\vskip`, `\smallskip`, `\medskip`, `\bigskip`, `\vfill`.
- Lower them to `TexGlueItem`.
- In TikZ node text, support only the subset whose behavior is well-defined in
  current text nodes; otherwise produce placeholders/fallbacks.

Exit: oracle fixtures cover fixed vertical skips and stretch glue behavior.

### V3: Nested Boxes

- Add nested vboxes/hboxes for quote/list bodies where useful.
- Keep style/render data separate from layout metrics.

Exit: quote and list bodies can be represented as nested boxes where that
reduces special-case layout code.

### V4: Future Document Consumers

- A future document/frame/layout module lowers its own IR into vlist items.
- The vlist package remains unaware of document-specific constructs.
- Any future visibility/overlay metadata is added as generic item metadata,
  not hard-coded presentation logic.

Exit: the text subsystem has stable enough primitives for another subsystem to
consume without forking layout fundamentals.

## Acceptance Criteria for the First Milestone

- Existing TeX text behavior is unchanged for current paragraph, list, quote,
  alignment, `\par`, `\noindent`, and `\\[<skip>]` fixtures.
- `npm run lint:prod` and focused TeX text tests pass.
- At least one visual fuzz smoke run has no flagged cases.
- The new vlist types do not import document- or presentation-specific modules.
- `ParagraphLayoutReport` remains available for current editor caret and
  selection code.
- Source spans survive lowering and positioned layout.

## Recommended Decisions

- **Description labels:** model labels as `hbox` attachments to paragraph or
  list-item boxes first. Do not introduce separate label/body vbox regions
  until description lists need multi-paragraph bodies or independent label
  alignment.
- **`\prevdepth`:** do not model full TeX `\prevdepth` initially. Store enough
  line height/depth on positioned boxes that `\prevdepth` can be added later,
  but keep V0/V1 behavior matched to today's explicit skip model.
- **`\vfill` stretch order:** represent exact stretch orders (`fil`, `fill`,
  `filll`) from the start. The type cost is tiny, and collapsing them would
  create avoidable migration work.
- **File naming:** keep ownership in `vlist/` once behavior is stable. The
  earlier top-level `layout-*` transition modules should not remain as empty
  compatibility façades once internal imports have moved to vlist-owned APIs.
- **Display math metrics:** treat display math as a future measured box
  provider. When added, it should expose width/height/depth from the same
  rendered artifact used for hit testing, not a separate estimate.

These defaults are enough to begin V0. No additional design decision is needed
before adding the types and no-behavior-change lowering pass.
