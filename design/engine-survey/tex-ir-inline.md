# Survey: TeX text front end and horizontal layout

Scope: `packages/core/src/text/tex/{ir,layout-inline-items,layout-simple,layout-state,paragraph-*,space-glue,tabular/,shaping/,fonts/,enumerate-template,recovery,syntax-index}.ts`, `vlist/paragraph-{scope,plans}.ts`, `macros/`, `text/knuth-plass/`. Read-only; no source edited. Reference: `tex-src/latex-installed/latex.ltx`, `tex-src/knuth/tex.web`.

Churn caveat: the repo history is 98 commits over 10 days (squashed import). Per-file churn is therefore weak evidence. `ir.ts` is the only file with real history (15 commits). Its subjects are almost all one theme: "Match Beamer list closure after displays", "Keep a list's closing skip apart from an alignment box opened after a vertical-mode color", "Limit the color-change flag to after the last par or environment end". All of them patch `buildSimpleTexParagraphBlocksFromNodes`.

## 1. Map

Data flow: source string -> `getRecoveredTexSyntaxIndex` (real tokenizer plus bracket matching, `syntax-index.ts`) -> `scanSimpleTexIrNodes` (ir.ts:1462, flat node list) -> `resolveSizeNodes` and an alignment pass -> `buildSimpleTexParagraphBlocksFromNodes` (ir.ts:4630-5876, blocks/items/list topology) -> `splitSimpleTexParagraphSegments` (ir.ts:5954) -> `simpleTexInlineNodesToTokens` (ir.ts:6083, font state flattened onto tokens) -> `simpleTexSegmentToLayoutItems` (layout-inline-items.ts:530) -> shaping -> `paragraph-runs.ts` -> `paragraph-break.ts` (DP options) -> `knuth-plass/paragraph/dp.ts` -> vlist (`vlist/*`, the vertical-spacing area, out of scope) -> report/SVG.

| File | Lines | Role |
|---|---|---|
| ir.ts | 6513 | node types, ~25 `scanSimpleTex*` scanners, group/size/alignment/list state, block builder, tokenizer |
| layout-inline-items.ts | 2638 | tokens -> layout items (text/space/math/box/graphics); contains an unrelated includegraphics SVG generator (~450 lines) |
| paragraph-runs.ts / paragraph-break.ts | 933 / 406 | items -> runs; alignment -> DP skip parameters |
| layout-state.ts, vlist/paragraph-scope.ts, vlist/paragraph-plans.ts | 191, 207, 563 | alignment/skip policy propagation across scopes |
| tabular/ | 154 + 274 + 94 | array/tabular parser, layout |
| shaping/, fonts/ | 254, ~900 | OT1 lig/kern, CM metrics |
| knuth-plass/paragraph/dp.ts | 1504 | line-break DP (+ `applyBreaks.ts` 823) |
| macros/ | 864 | string-level macro substitution; the text engine does not use it (only semantic/ and editing/ do) |

## 2. Ranked hotspots

### H1. LaTeX registers are modelled as an alignment enum fanned out through five layers (highest impact)

Where:
- ir.ts:4712-4748 (separate alignment-state pass, `alignmentHistory`)
- ir.ts:3095-3105 and 4526-4543 (`alignmentProfile: "latex-declaration" | "latex-quote"`)
- layout-state.ts:48-191
- vlist/paragraph-scope.ts:1-207 (14 policy fields merged from ancestors)
- vlist/paragraph-plans.ts:535-558
- paragraph-break.ts:215-391 (`texParagraphDpOptions` and three helper functions)

What it does: computes `\leftskip`, `\rightskip`, `\parfillskip`, `\finalhyphendemerits` and `\parindent` per paragraph from `alignment x profile x inheritedAlignment x inheritedProfile x scopePolicy x tikzTextWidthNode`.

Representative lines:
```
// paragraph-break.ts
const inheritedParfillStretch = inheritedAlignment === undefined ? Infinity : texParfillStretchForAlignment(inheritedAlignment, inheritedAlignmentProfile);
...
if (alignmentProfile === "latex-declaration") { if (alignment === "center" || alignment === "ragged-left") return 0;
  if (alignment === "ragged-right") { if (tikzTextWidthNode) return Infinity; return inheritedParfillStretch; } }
if (scopePolicy.forceParfillStretch) return Infinity;
// layout-state.ts
function texRestoredScopeAlignment(a) { return a === "ragged-left" || a === "center" ? "ragged-right" : a; }
// vlist/paragraph-scope.ts: policy.resetAlignmentSource === "latex-list" -> if (policy.resetAlignment !== "ragged-right") delete policy.resetAlignment ...
```
Real mechanism: latex.ltx:12372-12388 and 13218-13224. `\centering` is `\rightskip\@flushglue \leftskip\@flushglue \finalhyphendemerits=0 \parindent0 \parfillskip0`. `\raggedright` sets `\@rightskip\@flushglue \rightskip\@rightskip \leftskip0 \parindent0` and does not touch `\parfillskip`. `\@trivlist` (12829-12852) resets `\leftskip0 \rightskip\@rightskip \parfillskip\@flushglue`. `\endlist` and `\@parboxrestore` reset them again. The TeX model is five registers, set by declarations, restored by group end, and read once at `\par` (tex.web §1096 `line_break` reads them at that point).

How the code diverges: the five registers do not exist. "Inherited parfillskip under `\raggedright`" is emulated by dragging `inheritedAlignment` down and re-deriving the register. "Quote or list resets stretch to ..." is a `rightskipStretchMode` string enum with three values. Each new LaTeX scope (quote, list, minipage, Beamer column, TikZ text-width node) adds a boolean to the scope policy, and `paragraph-scope.ts` merges them in loop order, so the result depends on ancestor order.

Evidence of stacking: `suppressRaggedLeftCenterLeftskipStretch`, `forceParfillStretch`, `preserveRaggedRight`, `resetAlignmentSource`, `resetInheritedAlignment`, `resetSpaceGlueProfileTo`, `preserveSpaceGlueProfile`, `resetFinalHyphenDemeritsFromAlignment`, `allowForcedBreakIndent`, ... The `tikzTextWidthNode` flag appears at 21 sites in text/tex.

Refactor direction: introduce a `ParagraphRegisters` record `{leftskip, rightskip, parfillskip, parindent, finalhyphendemerits, hsize/leftmargin}` (glue = natural/stretch/shrink with fil orders). Each declaration (`\centering`, `\raggedright`, `\raggedleft`, `\trivlist`, `\endlist`, `\@parboxrestore`, TikZ `align=`) is a pure function `Registers -> Registers`. One group stack, shared with fonts (H3), restores them. `paragraph-break.ts` then reads registers directly and the policy objects and the profile string enum disappear. Size: medium-large (~800 lines removed, ~300 added). Risk is medium: the fuzzer is the safety net, but every special case here encodes some observed TeX output. Migrate scope by scope and keep the old path as an oracle until the fuzzer shows no diff.

### H2. `buildSimpleTexParagraphBlocksFromNodes`: a 1250-line closure that re-implements LaTeX's group/list/`\par` machinery, with regex probes on raw source

Location: ir.ts:4630-5876.

Contents: about 40 `let`/stack variables (`listStack`, `scopeStack`, `environmentStack`, `sizeScopes`, `sizeEnvironments`, `alignmentScopes`, `alignmentEnvironments`, `pendingListLabel`, `pendingListShowLabel`, `pendingListLabels`, `horizontalModeResumedAfterDisplay`, `declarationGroupDepth`, `pendingParagraphVerticalAdjustments`, `consumedTrivlistLabels`, `quotationItemLabelPendingStack`, ...). These are mutated by a big node-kind switch and read by `pushBlock`. `pushBlock` takes 11 positional parameters, four of them booleans (`allowEmptyListItem`, `beforeDisplay`, `closesTrivlist`, `noIndent`).

Regexes over raw text, inside the model builder (all in ir.ts):
- 4889: `/\\par\b|\n\s*\n/u.test(gap)` (`hasExplicitParagraphBoundaryBetween`)
- 4994: `/\\color\b/u.test(textSliceAtSourceOffsets(prevEnd, rawStart).split(/\\par(?![A-Za-z@])|\\end\s*\{[^}]*\}/u).at(-1) ?? "")` -> `followsColorChange`
- 5816: `/\\color\b[\s\S]*\\begin\s*\{(?:center|flushleft|flushright)\}/u.test(textSliceAtSourceOffsets(...).split(/\\end\s*\{[^}]*\}|\\item(?![A-Za-z@])/u).at(-1) ?? "")`
- 4752: `resolveListGlue` parses `plus`/`minus` with a regex
- 5022 and 5066: `textSliceAtSourceOffsets` is used to rebuild a literal node's text

Note 4889 misses `\par` hidden in a group or macro, and a `%`-commented `\par`, and a `\par` inside a nested box. 4994 matches `\color` inside a comment, inside a nested `\textcolor{..}` body, or inside a group that closed. The nodes already exist (`paragraph-break`, `color-command`, `style-declaration`). The regexes exist because the node list is flat and lost the information.

Real mechanism: `\color` in vertical mode appends a whatsit/special (`\pdfcolorstack`/`\special`) to the vertical list. A whatsit is non-discardable and is not glue, so a later `\addvspace` sees `\lastskip` = 0 (ltspace.dtx, `\addvspace` and `\@xaddvskip`; tex.web §1100 for what "vertical mode" appends). So the relevant fact is "a non-glue node sits between the two skips", a vertical-list property. The IR should emit an explicit vertical node (`whatsit`) in `items`, and `spacing.ts` should look at the previous item. Today the IR guesses via text, and the guess feeds `followsColorChange` into the spacing heuristics. This is where this area feeds the known vertical-spacing problem. Related carried flags: `preDisplayFontSizePt`, `hasTrivlistLabel`, `closesTrivlist`, `startsAfterExplicitPar`, `listContext.fontSizePt/registerFontSizePt/labelFontSizePt/displaySkipCommand`.

Churn evidence: the ir.ts commit subjects listed above.

Refactor direction: split into (a) an event-stream interpreter producing a vertical list of `{paragraph | glue | penalty | whatsit | box}` items with TeX-style group enter/leave, and (b) list/trivlist structure derived from environments. A single `Scope` object (H3) replaces `sizeScopes`, `alignmentScopes`, `activeList.fontState`. Replace all text-slice regexes by node-kind checks. Size: large (2-3 weeks), risk high. A staged path: first make the flat node list carry `whatsit` nodes for `\color`/`\par`-in-group and delete the three regexes. That is small (about 100 lines) and removes the most fragile heuristics.

### H3. Four independent group-scope trackers for the same TeX group semantics

1. `resolveSizeNodes` (ir.ts:4660-4709): `sizeState` carrying size, baseline, color, `fontDeclarations`, display-skip registers. It uses a pre-pass, `sizeHistory`, and `sizeAt(offset)` as a linear backwards scan (O(blocks x history)); it is called 5 times per block.
2. The alignment pass (4712-4748): the same push/pop skeleton again, with `alignmentHistory` and `alignmentAt`.
3. `simpleTexInlineNodesToTokens` (6083-6393): recursion on `group`/`font-command`/`color-command`; `style-declaration` with `restoreFontDeclarations`/`restoreColor`/`sizeScope` is a third replay of the scope pop (6270-6285).
4. `activeList.fontState` and `inheritedFontState` (5003-5011) for lists; vlist scopes are a fifth.

Representative smell: a plain `{ ... }` group containing block-level material is encoded as two fake `style-declaration` nodes with `sizeScope: { boundary: "begin", name: "" }` (ir.ts:1895-1898). So "style-declaration" doubles as group delimiter, size command, color command, tabular-register assignment, and list-register assignment. Code later tests `node.sizeScope?.name === ""` to mean "this is a brace group" (4723).

Real mechanism: TeX has one save stack. A `{` or `\begingroup` pushes, a `}` pops and restores all eqtb entries changed inside (tex.web §1068 `handle_right_brace`, §282 `unsave`). Nothing is replayed per concern.

Direction: one `Scope` value type (immutable record containing font (NFSS axes + size + baselineskip), color, registers from H1, list registers) and a `ScopeStack` with `enter(kind)`/`leave()`. The interpreter in H2 owns it once; tokens carry a scope snapshot. Delete `sizeHistory`, `alignmentHistory`, `restore*` fields. Size: medium; risk medium. Prerequisite for H1/H2.

### H4. Scanners: ~25 eager, independent, string-position scanners; groups re-scanned by slicing

Location: ir.ts:1462-1944 and 2203-4560. At every `\` position, `scanSimpleTexIrNodes` first calls about 17 scanners unconditionally (ir.ts:1654-1672): `scanSimpleTexParagraphCommand, ...ItemCommand, ...VerticalGlueCommand, ...VerticalRuleCommand, ...PenaltyCommand, ...BoxCommand, ...BoxEnvironment, ...ColorBoxCommand, ...MBoxCommand, ...RuleCommand, ...IncludeGraphicsCommand, ...RaiseBoxCommand, ...DimensionBoxCommand, ...FontCommand, ...FontDeclaration, ...StyleDeclaration, ...ColorCommand, ...AlertCommand, ...AccentCommand`. Then a chain of `if (x) { nodes.push(x.node); unsupportedCommand ||= x.unsupportedCommand; index = x.end; continue; }` blocks follows (~120 lines of one shape). The control-word name is re-lexed by each scanner (`scanSimpleTexControlWord` per candidate name: `for (const name of SIMPLE_TEX_FONT_COMMAND_NAMES)` at 3944 is a linear try-all).

Duplicated scanning logic:
- Group extent via `findSimpleTexGroupExtent` (syntax index) plus `scanTexRecovery(text)` (`recovery.ts`, a second independent bracket/environment matcher with its own `Frame` stack) plus `scanSimpleTexGroup`.
- Dimension/glue parsing: `texLengthPattern` regex (ir.ts:972), `vskipGluePattern`, `lineLeadingOptionPattern`, `parseTexSemanticLength`, `parseSimpleTexRelativeLength` (em/ex only), `parseSimpleTexGraphicsDimension`, `resolveListGlue`, `parseTexDimensionExpression` (`dimensions.ts`), plus tabular `dimension()` and `fractionPt`. The numeric literal regex `[+-]?(?:\d+(?:\.\d*)?|\.\d+)` appears 8 times in ir.ts.
- `baselineskip`-by-size tables exist three times: ir.ts:4649-4655 (`defaultBaselines`), tabular/layout.ts:37 (`baselineForSize`, which also contains 10.95pt), text-box-transform.ts:39. These should come from the class size file (`size10.clo` via `\@setfontsize`), which the options already partly carry (`namedFontSizes`).

Re-scan cost: every group, font command, box etc. calls `scanSimpleTexIrNodes(text.slice(contentStart, contentEnd), ...)`, which builds a fresh syntax index and recovery scan for the slice (1465-1475). A tabular body is validated by re-running the scanner on every cell and preamble piece (1570-1590), then `layoutTexTabularBox` re-parses each cell again (tabular/layout.ts:68-76). The index built for the whole text is thrown away. Complexity is O(n x depth) at best, with large constants.

Direction: a dispatch table `Map<controlWord, handler>` consulted once per control sequence; handlers consume a cursor over the existing token/syntax index (no slicing, no re-lex); one `parseGlue/parseDimen` module (TeX §448 `scan_dimen`/§462 `scan_glue` semantics); read baselines from the size table. Size: medium (net removal of ~1500 lines in ir.ts), risk low-medium because behaviour is local. Quickest win with the least risk.

### H5. Two ~330-line near-identical functions in the inline layer, already drifted

Locations: layout-inline-items.ts:530-883 `simpleTexSegmentToLayoutItems` and 1915-2256 `simpleTexInlineTokensToLayoutItems` (`diff` shows only parameter-passing differences plus drift). Drift found: the first applies `token.fontState.color` to the math box (`box: token.fontState.color ? {...box, color, rootBox: {...}} : box`), and the second does not (`box,`). The first has the "Total rendering: a math span the math subsystem cannot handle is contained as a literal run" comment and handling; the second does not. The second is used by tabular cells, mbox/raisebox/dimension-box contents, math `\text`, and transform boxes; the first by paragraph segments. So `\textcolor{red}{$x$}` in a table cell or `\mbox` behaves differently from the paragraph path. The same applies to `spaceFactor` (about 14 hand-maintained `spaceFactor = 1000` resets in each copy).

TeX mechanism: one main loop (tex.web §1034-1040) where every non-character item sets `space_factor:=1000` (§1041 for glue/box appends; §1202 and `\hbox` boxes in `box_end`).

Direction: make the first a thin wrapper over the second (`trimEdges: true`); give each token kind one handler that returns `{items, spaceFactorAfter}`. Size: small (~350 lines deleted), risk low. Do this first.

### H6. Ligatures and quote/dash conventions live in the IR, ahead of the font, and interact wrongly with space factor and kerning

Locations: ir.ts:2272-2312 (`scanSimpleTexProseConvention`: `---`, `--`, ``` `` ```, `''`, `` ` ``, `'` become Unicode U+2014/2013/201C/201D/2018/2019 text nodes), layout-inline-items.ts:2257-2303 (`insertTextBoundaryKerns`), layout-inline-items.ts:2606-2638 (`updateSpaceFactorForText`, `defaultTexSfcode`).

Verified by running `layoutSimpleTexParagraph` (widths of line 1, cmr10, justified last line):
1. `A{}V` and `A\relax V` both give 13.89pt, the same as `AV`. TeX gives 15.0 (A=7.5, V=7.5): a group or `\relax` ends the main-loop run, so the lig/kern program sees a non-char (tex.web §1034-1040, `main_loop_wrapup`, boundary char) and inserts no kern. Cause: `insertTextBoundaryKerns` adds a kern between any two adjacent text items of the same font regardless of what was between them in the source. The shaper already has the right model per text run (shape.ts `applyLigKernProgram`); the patch-up at item boundaries is the wrong layer.
2. `\texttt{a--b}` gives 15.75pt (3 glyphs); `\texttt{a-{}-b}` gives 21pt. cmtt has no `--`/`` `` `` ligature, so TeX gives 21pt for both. The IR decides the ligature before the font is known. The same mis-model applies to `'`/`''`.
3. Space factor: `a.'' b` equals `a.''\ b` (both 20.00pt). In LaTeX `\sfcode`\'=0` (latex.ltx:657), so `'` leaves the factor at 3000 and the space after `.''` must be larger by the extra-space amount. Cause: `''` was already rewritten to U+201D, so `defaultTexSfcode` (which special-cases `)`, `]`, `'`, `"`) never sees the ASCII quote. Conversely `"` is hard-coded to 0, but latex.ltx sets sfcode 0 only for `)`, `'`, `]`; `a." b` is 20.13 vs `a."\ b` 19.02, so the engine keeps 3000 where TeX resets to 1000.
4. The sfcode table is a hard-coded function; `\frenchspacing` (latex.ltx:561) and `\nonfrenchspacing` change that table in TeX. `\@` and `\frenchspacing` are not modelled (`a.\@ b` renders at 27.17pt, i.e. literal fallback).

Direction: leave `--`, `''`, `` ` `` as raw characters in text nodes; let the font's lig/kern program (already in `shaping/`) produce the glyph; run the shaper over a maximal run of source characters with boundary chars; model `sfcode` as a table in the scope state (H3), indexed by source char, mutated by `\frenchspacing`. Size: small-medium, risk medium (shaper must accept source-span mapping for multi-char ligatures, which it already does via `components`).

### H7. `\\` is two different TeX macros modelled through three flags and a post-hoc second DP run

TeX: `\\` is `\@normalcr` (`\unskip\nobreak\hfil\break`, latex.ltx:7444-7464) in justified text, and `\@centercr` (`\unskip \par \addvspace{-\parskip}`, 12365-12369) after `\centering`/`\raggedright`/`\raggedleft`, which `\let\\\@centercr` (12373, 12378, 12383). The second ends the paragraph.

Code: `splitSimpleTexParagraphSegments` (ir.ts:5954-6065) splits into paragraph segments when `alignment !== "justified"` (a proxy for "`\\` was redefined"), and `noIndentAfterForcedBreak` (6070) adds a `tikzTextWidthNode` exception. For justified text the break stays inside the paragraph, and the DP carries `forcedBreakUsesParfill`, `forcedBreakTerminalDemerits`, `forcedBreakIndentWidth` (paragraph-break.ts:236-312, dp.ts:605-1040). When `forcedBreakIndentWidth > 0` the DP runs a second time and `mergeForcedBreakIndentedSuffixLines` (paragraph-break.ts:166-205) splices prefix lines from one solution onto suffix lines from the other. That splice is exactly what a real paragraph split would have given.

Direction: carry `\\` binding as part of the register scope (H1): `Scope.newline: "normalcr" | "centercr"`. The IR then makes the paragraph-split decision from that, and the DP needs only `\hfil\break` (a forced break with infinite-stretch glue before it) so the three DP flags and the second pass go away. Size: small once H1/H3 exist.

### H8. Tabular: alignment and cell content inferred by regex over the preamble source

tabular/layout.ts:
- `const alignment = /\\raggedright\b/u.test(column.before ?? "") ? "ragged-right" : /\\centering\b/u.test(...) ? "center" : /\\raggedleft\b/u.test(...) ? "ragged-left" : ...` (paragraphCell)
- `preamblePieces` (lines ~41-49) strips `\arraybackslash|raggedright|raggedleft|centering|noindent` by regex, so the declarations vanish from the IR and the layout re-derives them from text.
- `mappedPreamble` uses `/\\[A-Za-z@]+$/u.test(part.text)` to decide whether to insert a generated `{}`.
- ir.ts:1572 `part.text.replace(/\\arraybackslash\b/gu, "")`.
- `p{}` cells call the full `layoutSimpleTexParagraph` recursively and then re-assemble hlists from the report (line ~95-115). `\tabcolsep`=6, `\arrayrulewidth`=.4, `\doublerulesep`=2 are in-line defaults.

Real mechanism: array.sty `\@mkpream`/`>{...}` inserts tokens before the cell, executed in the cell group (so `\centering` is just a declaration in that group, and `\arraybackslash` re-installs `\\` as `\tabularnewline`; array.sty). The p-cell is a `\parbox` with `\@arrayparboxrestore`. Row height is `\arraystretch`-scaled `\strutbox` (`\@arstrut`, latex.ltx array part; tex.web §1146ff `\halign`/`align_peek` for what the primitive does).

Direction: parse `>{}`/`<{}` insertions as ordinary IR nodes through the normal declaration path (H1/H3) rather than text; the cell body becomes a normal paragraph scope in the same interpreter. Size: medium. Risk: medium (tables are probably well fuzzed).

### H9. Line-breaker parameter policy is hard-wired

- `texParagraphTolerance()` (paragraph-break.ts:395) takes no arguments and returns 9999; `texParagraphEmergencyStretch` returns 3em. The comment justifies this by the TikZ minipage, which is true for `\parbox`/minipage/TikZ text-width nodes (`\@arrayparboxrestore` -> `\sloppy`), but the fallback applies to every paragraph that reaches pass 2 unless a caller passes `tolerance`, including ordinary body paragraphs where LaTeX's `\tolerance=200`, `\emergencystretch=0` apply. TeX's pass structure itself (tex.web §863: pretolerance pass without hyphens, second pass with, emergency pass with `\emergencystretch`) is modelled correctly in `breakTexParagraphRuns` (pass1, pass2 with tolerance variants, "last resort overfull"), but the numbers should be registers in the scope (H1), not constants.
- `LATEX_RAGGED_FINAL_HYPHEN_DEMERITS`, `texFinalHyphenDemeritsForAlignment`: `\finalhyphendemerits=0` set by `\centering`/`\raggedright`/`\raggedleft` (latex.ltx:12374-12384). It is re-derived from alignment in two places (paragraph-break.ts:237-245, layout-state.ts:181-191) with slightly different conditions (`alignmentProfile === "latex-declaration" && alignment !== "center"` vs `latexRagged || inheritedLatexRagged`).
- dp.ts is a DP keyed by break cursor with fitness class, not TeX's active list keyed by (position, fitness, line-class); that is fine without `\hangafter`/`\looseness`, but note both are absent, so `\parshape`/hanging lists/`\looseness` cannot be added without reworking.
- The Knuth-Plass `knuth-plass/paragraph` code has only one commit of history, so there is no churn signal. No model problem found beyond the above.

## 3. Cross-cutting observations

1. There is a real tokenizer/bracket matcher (`syntax-index.ts`, `parser/tex-lexical.ts`) but the IR builder does not consume tokens. It re-slices strings per construct and rebuilds a syntax index per slice. The missing abstraction is a token stream with a cursor plus a group/save stack. Everything in H2, H3, H4 and H8 grows from that.
2. TeX registers (`\leftskip`, `\rightskip`, `\parfillskip`, `\parindent`, `\finalhyphendemerits`, `\tolerance`, `\emergencystretch`, `\baselineskip`, `\sfcode` table, `\\` meaning) are never first-class values. Each has been reduced to an enum or boolean and re-derived at the point of use, from a different subset of context in each place. A `Scope` record with save/restore would replace roughly the top 5 hotspots.
3. Fixed TeX constants are repeated: baselineskip-by-size (3 tables), length units/regex (8+ copies), `\leftmargin` em tables in ir.ts (`articleListLeftMarginEmByDepth`, `latexArticleQuotationFirstLineIndentEm`). These should be loaded from `size1x.clo`/`article.cls` values once.
4. Option-bag growth: `SimpleTexParagraphIrOptions` (ir.ts:1005-1027) carries `boxesClearingPendingItemLabels`, `syntheticParagraphBreaks`, `minipageListDepthResets`, `listBodyFontSizes/BaselineSkips/DisplaySkipCommands`, `groupListItemBodies` (Beamer), `enumerateMiniTemplates`, `bibliographyMargins`, `descriptionLabelWidths`. These are positional or source-offset-keyed overrides injected by callers because the IR cannot see the surrounding document state. Another sign that the interpreter lacks scope ownership. About 86 `x !== undefined ? { x } : {}` spreads in ir.ts and 62 in layout-inline-items.ts show the cost of the optional-field-heavy types.
5. Layering: layout-inline-items.ts contains ~450 lines of includegraphics SVG generation (1223-1644) and mbox/frame construction; `ir.ts` contains includegraphics option parsing (3370-3680) and URL scanning. These are separable, low-risk extractions.
6. Output stability: `paragraph-report.ts` (1313) and `source-map-report.ts` (819) were not surveyed; they bound how aggressively internal types can change.
7. Pointers to the already-known vertical-spacing problem from this area: the per-block flags `followsColorChange`, `beforeDisplay`/`preDisplayFontSizePt`, `closesTrivlist`, `hasTrivlistLabel`, `startsAfterExplicitPar`, and list `displaySkipCommand` are computed here by source-text probes and state patching (H2), then consumed by `vlist/spacing.ts`. Emitting honest vertical items (glue, penalty, whatsit, `\par` boundaries) from the IR would remove the need for most of them.

## Suggested order
(1) H5 merge the two item builders (small, fixes a live drift). (2) H4 dispatch table plus one length/glue parser plus size tables (low risk). (3) H6 stop rewriting ligatures in the IR and feed `sfcode` from scope. (4) H3 unify scopes. (5) H1/H7/H9 registers. (6) H2/H8 rebuild the block builder and tabular on the interpreter.
