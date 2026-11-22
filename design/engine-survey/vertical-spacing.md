# Vertical spacing (lists, environments, blocks, columns, displays)

## Map

| File | Lines | Spacing role |
| --- | --- | --- |
| `text/tex/ir.ts` | 6,513 | Walks the source with a list stack; emits paragraph / glue / penalty / display / box items. List, item and trivlist begin/end are **not** emitted as items; they survive only as `scopePath` / `listContext` / `ancestorListLabels` on each paragraph. |
| `text/tex/vlist/lower-simple.ts` | 783 | Lowers IR items to `TexVListItem`s (paragraph, hbox, vbox, glue, penalty, display). |
| `text/tex/vlist/spacing.ts` | 2,721 | `planSimpleTexParagraphVerticalSkipsInto`: for each emitted paragraph, compares its scopes with the previous paragraph's and decides the skip before it. 84 functions, ~600 lines mentioning skip/topsep/parsep/itemsep. 47 commits. |
| `beamer/render.ts` | 5,540 | Separately stacks Beamer flow items (paragraph, block, columns, tikzpicture, title page) inside blocks, columns and frames, with its own skip, depth and `\lineskip` rules (~280 spacing-related lines). 39 commits. |
| `beamer/frame-flow.ts` | 356 | `positionPreparedFrameFlow`: baseline/lineskip glue between flow items, trivlist skip sharing, trailing list skip regexes. |

## Core diagnosis

1. **Events are thrown away, then reconstructed.** LaTeX's vertical spacing is a sequence of operations on the tail of the vertical list: `\addvspace` (compare and replace `\lastskip`), `\parskip` insertion when a paragraph starts, `\@trivlist` / `\@item` / `\@donoparitem` / `\endtrivlist` adjustments driven by the flags `@inlabel`, `@noparlist`, `@newlist`, `@minipage`, `@endpe`, and the baseline rule (`\baselineskip − \prevdepth − height`, else `\lineskip`). The IR knows the exact order of `\begin{itemize}`, `\item`, `\end{center}`, `\color`, `\par`. But it records them only as scope paths on paragraphs. `spacing.ts` then infers what happened between two paragraphs by diffing those paths, keeping about 20 fields of reconstructed history:
   `previousEmittedListContext`, `previousEmittedTrivlistScopes`, `previousEmittedContentKind`, `previousDisplayListDepth`, `listTopsepByDepth`, `trivlistTopsepByScope`, `listParagraphSkipByDepth`, `noParListDepths`, `leakedItemsepByDepth`, `topsepBeforeLeakByDepth`, `lastListItemsByDepth`, `emittedListItemKeys`, `externalAfterSkip`, `externalPendingParskip`, `hasInterveningPenalty`, …
   Each combination of transitions (exit two lists and enter a trivlist; nested list on a pending label after a block; display ending a nested list before an outer item; …) has become its own branch. The paragraph branch alone has 10 mutually exclusive cases, then a series of post-adjustments.
2. **Two independent vertical-list builders.** The Beamer flow code in `render.ts` / `frame-flow.ts` re-implements `\prevdepth`, baseline/`\lineskip` glue, `\addvspace` sharing and minipage `\unskip` for blocks, columns and frames, separately from `spacing.ts`. The same rule is implemented per context: plain block body vs block flow vs column vs frame; default vs rounded block style.
3. **Source regexes stand in for structure.** Several decisions test raw source slices: `startsWithTrivlist` (`/^\s*(?:\\par…)*\\begin\{center|flushleft|flushright\}/`), `trailingBeamerListSkip` suffix regexes, `followsColorChange` (`/\\color\b/` on the text between blocks), `trailingBeamerTrivlistSkip`. Each fuzz finding adds another alternative (`\{`, `\relax`, `\visible<…>{`, …).

## Evidence from this session's fixes

Every fix was an existing TeX rule missing from one path:

| Fix | TeX rule (source) | Path that lacked it |
| --- | --- | --- |
| 201/0039 parsep after a `@noparlist` nested list | `\endtrivlist` skips `\@endparenv`; the next paragraph still gets `\parskip` (`ltlists.dtx`) | partial list exit in `spacing.ts` |
| 131/0039 nested list on a pending label after a block | `\@donoparitem`: `\lastskip + \@outerparskip − \parskip` | block-collapse branch (item-number coincidence) |
| 131/0039 list closing after a center | `\endtrivlist`: `\lastskip > 0` → add `\parskip − \@outerparskip` | exit-to-outside path |
| 131/0039 `@noparlist` parskip merged into a center's topsep | `\parskip` is not `\addvspace` glue | "adjacent list and alignment share addvspace" rule |
| 163/0040 picture center then `{\begin{center}` | `\addvspace` collapse | regex `startsWithTrivlist` didn't allow `{` |
| 80/0046 `\color` before flushleft holding columns | whatsit makes `\lastskip = 0` | the paragraph path had it, external-flow boxes didn't |
| 144/0043 block ending in a display after columns (default) | box ends in glue → depth 0 | block flow path (plain-body path had it) |
| 144/0043 rounded block | `\endminipage` `\unskip` | block flow path (plain-body path had it) |
| 135/0059 display after a deep block in a column | baseline gap < 0 → `\lineskip` | column path (a previous fix had disabled the clamp) |

Earlier in the branch, the 11 Sonnet-era fixes follow the same pattern.

## Proposed replacement (outline)

- **IR emits vertical-mode events in source order**: `listBegin(kind, depth, registers)`, `item(label)`, `listEnd`, `trivlistBegin/End(kind)` (center, flushleft, flushright, quote, …), `par`, `paragraph(lines)`, `box(height, depth, kind)` for blocks/columns/pictures/minipages, `display(above/below, short?)`, `whatsit` (`\color`, specials), `penalty`, `vskip`, `sizeChange(registers)`, `groupBegin/End`.
- **One `VerticalListBuilder`** follows the LaTeX macros on those events, with explicit TeX state: `lastskip`, `prevdepth`, current `\parskip` and `\@outerparskip`, per-level `\@topsepadd` / `\@topsep`, `@inlabel`, `@noparlist`, `@newlist`, `@minipage`, `@endpe`, plus register values from the active size (`size1x.clo`, beamer's list redefinitions and `shrink` cramping). Each method cites the macro it follows.
- **Beamer containers** (block bodies, columns, frame body) are nested builders with `@minipage` / `\unskip`-at-end semantics; their results are boxes (height, depth) handed to the parent builder. This removes the per-container skip code in `render.ts`.
- **Migration**: run the builder side by side with `spacing.ts`, diff the skip per boundary on all spacing tests, fidelity fixtures and fuzz cases, then switch contexts one at a time and delete the replaced special cases.
