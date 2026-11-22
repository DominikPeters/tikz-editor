# Math typesetting survey: `packages/core/src/text/tex/math/`

Read-only survey. No source edited. Line numbers are as of HEAD (35be162).

## 1. Map

| File | Lines | Role |
|---|---|---|
| `parser.ts` | 6,760 | Tokenizer (`tokenizeTexMath`, l.284) plus one `TexMathParser` class (l.348) with about 97 `parseXxx` methods. Produces the `TexMathList` IR. |
| `layout.ts` | 8,073 | The IR to hlist engine, about 220 functions. `layoutAtom` (l.1009) and `layoutNucleus` (l.1357) dispatch on about 33 nucleus kinds (84 `nucleus.kind ===` tests). Also holds the Lua/CM symbol tables (l.7096-7570), script/fraction/limit/radical/delimiter/array code, and the TFM parameter accessors (l.7882-8073). |
| `spacing.ts` | 485 | Bin reclassification and the inter-atom glue table. |
| `inline-provider.ts` | 2,526 | Math box provider for the text engine. Carets. **Display alignments** (align/gather/multline/eqno tags, l.1399-2520). |
| `ir.ts` | 739 | IR types. |
| `font-profile.ts` | 484 | CM font families, `layoutParameters` (strut, jot, baselineskip). |
| `render-svg.ts`, `symbol-definitions.ts`, `index.ts` | 358 / 331 / 112 | |

Data flow: `tokenize` → `parseTexMath` → `TexMathList`. Then `resolveDefaultTexMathFontProfileForList`, which sniffs the formula to decide whether amsmath/amssymb fonts apply. Then `layoutTexMathListContents` (l.546) runs `prepareOrdNoads` → `spaceTexMathList` → a single left-to-right loop that calls `layoutAtom` per atom and accumulates `cursor`. The result is a `TexMathHList` with `x/y` placed items. Displays go to `getDisplayMathAlignment` or `getMathBox` in `inline-provider.ts`, and the text engine wraps them in a `display-math` / `display-alignment` vlist item. The above/below skips are then materialised in `text/tex/vlist/spacing.ts` (l.870-1000, 1225-1290, 1985-2000).

Git churn caveat: this checkout has 98 commits in total, so `git log` for `math/` shows only 2 commits per file. Churn for this area cannot be measured from history. The nearest signal is the display path in the vlist. `vlist/spacing.ts` has 47 commits and `beamer/render.ts` has 39. About 25 of the roughly 36 math/display-related commit subjects in the 2026-11-21/22 window are display-skip fixes, for example "Reset the display-interline flag when a paragraph or box follows a display", "Collapse an outer item's boundary into the display that ended a nested list" and "Keep baseline glue when a display absorbs the next list's boundary skip".

## 2. Overall verdict

The core noad algorithm is **not** a pile of fitted cases. It is a fairly literal port of tex.web, driven by TFM fontdimens:

- Inter-atom spacing is the exact `math_spacing` string from §764 (`spacing.ts:62-70`). Script styles suppress digits 1, 3 and 4.
- Bin reclassification follows §728-729 (`spacing.ts:361`).
- `make_scripts` is correct against §756-759. The `sup1/sup2/sup3` choice checks cramped first. The clearance is `max(shiftUp, sup.depth + xHeight/4)`. The sub-only shift is `h - 4/5 x`. The both-scripts clearance is `4·ξ8`, then the `4/5 x` adjustment (`layout.ts:7791-7865`).
- `make_fraction` (§743-748): `layoutFractionNucleus` (l.3910) matches num1/num2/num3/denom1/denom2 and the 3θ/θ clearances.
- `make_op` limits use bigOpSpacing1-5 and δ/2 (§750-751, `layout.ts:1272-1350`).
- Radical (§737) and `\sqrt[n]` (LaTeX `\r@@t`: 5mu, -10mu, 0.6) are correct.
- Parameters are read from fontdimens (`mathParameterToPt` etc.). There is no scattering of σ/ξ magic numbers in the core path.

The problems are in four places:

1. Structure around that core: five duplicated tabular engines and a re-derivation of TeX's collapse rules on the AST.
2. A hand-port of amsmath macros with their constants inline.
3. The display/equation-number path.
4. Several places where TeX's two-pass structure was patched after the fact.

## 3. Ranked hotspots

### H1. Five copies of "array" layout (layout and parser), plus a sixth engine elsewhere
- **Layout:** `layoutAlignedNucleus` (l.2008-2120), `layoutMatrixBody` (l.3455-3545), `layoutSmallMatrixBody` (l.3335-3455), `layoutCasesBody` (l.2785-2895), `layoutArrayNucleus` (l.2899-3025), and `layoutSubstack` / `layoutSubarray` (l.2321-2500). Each repeats the same skeleton: `columnCount = Math.max(...)`, `columnWidths = Array.from(...)`, cursor loop with `roundTexPt`, `baselineOffsets`, `height = naturalHeight/2 + axis`, `baselineY` accumulation, and a `mathChildHListLayoutItem` row. Line 3463 in `layoutMatrixBody` and line 2037 in `layoutAlignedNucleus` are the same code with different cell-offset helpers.
- **Parser:** `parseAlignedBodyContent` (l.2809, about 620 lines), `parseMatrixBody` (3430), `parseArrayBody` (3523), `parseCasesBody` (3641), `parseSmallMatrixBody` (3744), `parseSubarrayBody` (3837) and `parseCasesMacro` (1504) each re-scan for `&` and `\\` (`separator?.kind === "character" && separator.text === "&"` at parser l.1562, 2894, 3472, 3573, 3682, 3786).
- **Baseline rule duplicated four times** (TeX §679 `append_to_vlist`: baselineskip, lineskip, lineskiplimit):
  - `alignedRowBaselineDistance` (l.2231-2262), sp-quantised with the comment "a decimal baseline such as 13.6pt does not take the `\lineskip` branch because of a floating-point residue";
  - `substackRowBaselineOffsets` (l.2731), same rule, different parameters;
  - `smallMatrixRowBaselineOffsets` (l.3589), constants `TEX_SMALLMATRIX_BASELINE_SKIP_PT=6`, `LINE_SKIP=1.5`, no sp quantisation;
  - `texInterlineGlueSize` in the vlist (`vlist/spacing.ts`).
  - `matrixRowBaselineOffsets` (l.3654) and `arrayRowBaselineOffsets` (l.3025) apply no baselineskip at all. They rely on the strut making rows tall enough.
  The sp-quantisation fix exists in only one of them, so the rounding bug class will reappear in the others.
- **`../tabular/layout.ts`** is a separate, smaller (522-line) tabular engine for text-mode tabular. The `\halign` model (widths, spans, strut, rules) is therefore implemented at least twice across modules.
- **TeX mechanism:** `\halign` / `\valign` (§768ff), `append_to_vlist` §679, `\vcenter` §736. LaTeX's `array.sty` is a preamble-driven `\halign` with `\@arstrut`. amsmath's `matrix` is `\array` with `\arraycolsep=\thickmuskip`.
- **Direction:** one `layoutHalign(rows, colSpec, vskipPolicy)` primitive, with matrix/cases/aligned/substack/smallmatrix as thin parameter sets (col sep, row skip function, strut, alignment per column) plus one shared `vcenter`. Do the same on the parser side with one `parseAlignedRows(cellTerminators, rowTerminators)`. Size: roughly 1,800 lines in layout.ts and 1,400 in parser.ts collapse to about 600 / 500. Risk: high, because every shape is golden-tested, but it is mechanical. Do the baseline rule first (low risk, high value).

### H2. §1186 "collapse `{x}` to the inner noad" re-derived at layout time on the AST, repeatedly
TeX's `math_group` handling (§1186) turns `{ord}` with no scripts into the inner noad at **parse** time, so accents, `clean_box`, `make_ord` and `make_op` see a char. Here the IR keeps `kind:"list"` wrappers, and each consumer re-checks:
- `layoutSingleAtomGroupNucleus` (l.1515), called from `layoutNucleus` (l.1357);
- `accentBaseSkew` (l.7014), `accentBaseSingleGlyphMetrics` (l.7057), `trailingSkewKern` (l.5215), `hasNestedAccentBase`/`innermostNestedAccentBase` (l.5191-5210), `isSingleCharacterCleanBoxList` (l.7703), and the `bm` special case inside `shouldUseOperatorLimits` (l.1232).
- Representative: `if (item.nucleus.kind === "list" && item.nucleus.leadingKern === undefined && !item.nucleus.operator) return accentBaseSkew(item.nucleus.list, ...)` appears at l.7035 and again, almost verbatim, at l.7076. `item.nucleus.kind === "alphabet" && item.nucleus.alphabet !== "boldsymbol"` is repeated alongside it.
- The skew-kern lookup `glyph.font.data.ligKerns.find(rule => rule[0]==="kern" && rule[1]===glyph.code && rule[2]===mathFontSkewChar(...))` is copy-pasted in `trailingSkewKern` (l.5238-5248) and `accentBaseSkew` (l.7046-7054).
- The flag `isCharacterNucleus` (62 uses in layout.ts) plus `scriptAttachment {shiftBasis, advance, superscriptOffset}` is a hand-carried substitute for "is the nucleus a char node" (§755, §742). Accents with scripts need this for real (§742 swaps scripts into the inner box), but it is carried through every layout result by hand.
- **Direction:** a normalization pass (it can live in the existing `normalizeTexMathAtomClasses`) that applies §1186 once, so downstream code sees `glyph` directly. Then delete about 6 predicates. Size: small to medium (300 lines out). Risk: medium, because source spans and caret mapping rely on the wrapper kinds. Keep a `groupSpan` on the unwrapped atom.

### H3. `clean_box` / `rebox` / running-rule behaviour emulated by AST predicates and post-hoc patches
TeX §720-721 (`clean_box`) strips a trailing italic-correction kern after a single char node in the *output* list. §715 `rebox` re-adds a kern to restore char width when widening. §755 adds `script_space` to the script box width, and a running-width rule then widens to the box.
- Here: `omitSingleCharacterCleanBoxItalicCorrection` (l.7659), `reboxSingleCharacterItalicCorrection` (l.7676), `isSingleCharacterCleanBoxList` (l.7703, AST-level), and, most tellingly, `expandSingleLineRuleCleanBox` (l.7618): after adding `TEX_SCRIPT_SPACE_PT` it walks items and widens any `overline-rule`/`underline-rule` to the new width. That is a hand-written substitute for the running-width rule that TeX gets for free from `vpack`.
- Fractions call `reboxSingleCharacterItalicCorrection` at l.3978-3987 (§744 `rebox` to common width).
- **Direction:** give `TexMathRuleLayoutItem` a `width: "running"` mode resolved when the enclosing box is finalised. Implement `cleanBox(hlist)` as an operation on the output hlist (check list is `[glyph, kern(italic-correction)]`). Size: small. Risk: low-medium. It removes three AST predicates.

### H4. amsmath/LaTeX macros hand-transcribed with inline constants
Constants fitted by reading amsmath, not derived through a box DSL: `TEX_AMSMATH_ALIGNMENT_PAIR_GAP_PT=10` (l.1976), `TEX_LATEX_EQNARRAY_COLUMN_GAP_PT`, `TEX_MATRIX_ARRAY_COL_SEP_PT=5` (l.1978; it is `\arraycolsep`=5pt only at 10pt text, not `\thickmuskip`-derived), `TEX_CASES_ARRAY_STRETCH=1.2`, `TEX_SMALLMATRIX_*` (6/1.5), `TEX_AMSMATH_MULTIDOT_LIMIT_CORRECTION_PT=0.014` (l.451, used at l.5449 as `0 - base.height - 0.6*textEx + dotHeight - 0.014`), `TEX_AMSOPN_VARLIM_ARROW_DEPTH_EX_CORRECTION=0.4253` (l.452, used at l.4930), `3.5*thickness`/`5.5*thickness` (l.4884-4900, `\varliminf`), `1.2*xHeight` (l.4919), `0.2777*quad` (l.3371, "amsmath inserts \thickspace… independent of math style"), `leadingThinSpace = font.atPt/6` for `\dddot` (l.5445). The two correction constants (`0.014`, `0.4253`) are not amsmath numbers. They look like residues from fitting against LuaLaTeX output.
- `\dddot`, `\varliminf`, `\sideset`, `\substack`, `\cases`, `\smallmatrix`, `\xrightarrow`, `\overbrace` are each a bespoke layout function (layout.ts l.2506-2730, 4667-5005, 5409-5490, 5667-5776) rather than the amsmath macro expanded to TeX box primitives.
- **TeX mechanism:** amsmath.sty / amsopn.sty definitions (`\dddot` via `\mathpalette\@dddot`, `\varliminf` via `\mathop{\operator@font lim}` plus `\underline`, etc.). Sources are in `/usr/share/texlive/texmf-dist/tex/latex/amsmath/`.
- **Direction:** keep bespoke code only where TeX primitives can't express it. For the rest, build a tiny box-construction layer (`hbox`, `vbox`, `raise`, `kern`, `mathchoice`, `mathpalette`) and transcribe each macro 1:1 so constants trace to source lines. This also fixes the "formula font size != 10pt" class, since `\arraycolsep` and `\jot` are fixed dimensions, not scaled. Size: large (about 1,500 lines), incremental per macro. Risk: medium. Fuzzer coverage is the safety net.

### H5. Display math: equation tags and alignment tags are four different implementations
`inline-provider.ts`: `addDisplayMathTag` (l.273, plain equation), `addDisplayAlignmentTag` (l.2049), `addGatherDisplayTag` (l.2113), `addMultlineDisplayTag` (l.2160). Each decides "tag collides, shift down" separately, using constants `TEX_DISPLAY_ALIGNMENT_COLLIDING_TAG_SHIFT_PT=12`, `STANDARD_ROW_DEPTH_PT=3.600037`, `SHIFTED_TAG_STRUT_HEIGHT_PT=8.4`, `SHIFTED_TAG_LINE_SKIP_PT=1` (l.77-87). Two tolerances look fitted: `OVERFULL_BODY_TOLERANCE_PT = 1` and `TAGGED_ROW_OVERFULL_TOLERANCE_PT = 10` (l.84-85). `applyAmsmathCenteredRightTagClearance` (l.2310-2370) is a 60-line loop re-solving amsmath's `\halign` glue (eqnshift/alignsep) by hand.
- **TeX mechanism:** for non-amsmath `equation` it is `\eqno` in §1199-1206 (§1202-1205: `e` = eqno width, `q = e + math_quad`; if `w+q > z` then shrink or move eqno; `d = half(z-w)`; if `e>0 and d<2e` then `d = half(z-w-e)`). amsmath `align` is its own `\halign` with `\@@display@init`, `\place@tag` and the `\tag@in@display` vtop logic (see `amsmath.sty` ~l.1204ff). None of the tag functions implement §1202-1205 as written. `addDisplayMathTag` centres independently of the tag (`mathX = (width - hlist.width)/2`) and widens the box to `hlist.width + tag.width + 10`. That is an amsmath-shaped approximation, used for equations whose font profile has no amsmath. **Verify** against `equation` without amsmath.
- **Direction:** one `placeTag(rowBox, tag, displayWidth, mode)` encoding §1202-1205 and amsmath `\place@tag` as two policies. Size: medium (about 400 lines in, 200 out). Risk: medium.

### H6. Display skip selection (§1145-1146) implemented in two places and simplified
- In `vlist/spacing.ts:957-964` the "short vs normal" decision is inlined for leading displays: `displayLeftEdge <= 2 * (item.fontSizePt ?? font.atPt) * font.data.fontdimen.quad`. A second site, `displayMathSkipVariant` (l.1985-1997), uses `previousParagraphMeasurement.lastLinePreDisplaySize`. Line 953 forces `normal` for any `display-alignment` or `fullDisplayWidth` item. Line 961 forces `normal` when the enclosing trivlist is centered or ragged-left.
- TeX's real test (§1146): `d + s <= pre_display_size` where `s` = `display_indent`, `d` = the §1145 shift **after** the eqno adjustment, `pre_display_size` = last-line width + 2em (or `-max_dimen` for an empty paragraph; §1146 uses `abovedisplayshortskip` when the test is true). The code uses `displayLeftEdge = (targetWidth - materialWidth)/2` with `materialWidth` being the equation excluding its tag, ignoring `\displayindent`/`\mathindent`/fleqn and the eqno shift. The "centered/flush paragraph forces `normal`" rules (l.961, report.ts:283) are a workaround for `pre_display_size = max_dimen`, which TeX gets from the infinite glue on the line.
- This path is where the churn lives: `vlist/spacing.ts` has about 126 mentions of eight state flags (`previousDisplaySkipVariant`, `displayInterlineAlreadyInserted`, `plainParagraphInterlinePending`, `previousDepthSuppressed`, `paragraphBoundaryInterlineAlreadyInserted`, `hasInterveningPenalty`, `previousDisplayBelowSkip`, `previousDisplayMaterialMetrics`) in one pass. Each of the 25 display-skip commits in 2 days added or reset a flag. `beamer/render.ts:2270-2340` additionally patches the displays' terminal glue from outside: `suppressCenteredTikzTopGlueAfterNormalDisplay` re-subtracts `\topsep` and the canceled `\belowdisplayskip` from `naturalHeight` after the fact, a hand emulation of `\addvspace` (max of adjacent vertical skips).
- **TeX mechanism:** §1145-1149 (display placement), §1203 (`\predisplaypenalty`, `\abovedisplay(short)skip` with `g1`/`g2`), LaTeX `\@endparenv`/`\addvspace`/`\@trivlist` for the boundaries.
- **Direction (shared with whoever surveys vlist):** make the display a real vlist fragment `[penalty, glue(g1), box, glue(g2), penalty]`, compute `pre_display_size` as the width/indent of the last line box (from the paragraph measurement, with `-max_dimen` for empty), and let a real `\addvspace` (not flags) collapse adjacent glue. Size: large. Risk: high. Highest payoff.

### H7. Spacing pass patched for `\left`/`\right`/`\middle` instead of making delimiters atoms (§762)
`layoutLeftRightBody` (l.5931-5975) lays out the body in an isolated sub-list and then special-cases one pair: "The right delimiter is a Close noad. Punctuation before it still gets TeX's thin inter-atom glue", appending glue after the fact only if `last.atomClass === "punct"`. In TeX (§762, `make_left_right`) `\left` and `\right` are Open and Close noads in the same list, so the full spacing table applies on both sides (Punct to Close = thin, Op/Bin/Rel adjacency, etc.). `\middle` is dropped from the spacing pass completely: `spacing.ts:100-130` pushes `middle-delimiter` with `previousAtom = null`, so no glue is computed on either side and a following Bin is reclassified to Ord. In real TeX/e-TeX `\middle` is a Close-class noad (the following atom gets Close-to-X spacing, e.g. Close followed by Op gets a thin space), though LuaTeX's fence handling should be **verified** in luatex.pdf before changing it. Only the "punct before `\right`" case was found and patched.
- `layoutLeftRightNucleus` also lays out `\left...\right` with `layoutMathDelimiter` on "LuaTeX tries both delimiter chains" (l.6064), which differs deliberately from TeX's §706 `var_delimiter` search order (small chain then large). That is a legitimate LuaTeX difference, and the code is right to carry it, but it is not shared with `selectRadicalDelimiter` (l.6022), which has its own variant of the same two-chain search.
- **Direction:** model delimiters as atoms (Open/Close/Inner-middle) in the spacing pass, and size them in a second step once max_h/max_d are known (as §762 does), instead of recursing into a separate list. Size: small. Risk: low. Add a regression for `\left( a, \right)` and `\middle|`.

### H8. Font profile chosen by sniffing the formula
`resolveDefaultTexMathFontProfileForList` (l.791) picks `luaLatexAmsMathFontProfile`, `amsMathWithoutAmsFonts` or the default by walking the IR (`texMathListNeedsAmsFonts`, a generic JSON walk with `value.kind === ...` string checks and re-parsing nested `math` strings, l.797; `texMathNucleusNeedsAmsMath`, a typed walk over about 15 kinds, l.835). Many behaviours depend on `fontProfile.id === luaLatexAmsMathFontProfile.id` (l.5178, 5294) or `amsWideAccents`. This means the *preamble* (what packages the document loads) is inferred from *content*, which can be wrong when the preamble loads amsmath and the formula doesn't use an ams symbol, and is a third IR traversal that must be updated for every new nucleus kind.
- **Direction:** take package state from the document preamble (the Beamer/LaTeX side already tracks `\usepackage`), and feed it as a profile. Delete both sniffing walks. Size: small. Risk: medium (default expectations in tests).

## 4. Parser notes
- It is a real tokenizer plus a class parser with grouping (`parseGroupedAtom`, `parseScripts` l.5048, `stopAtGroupClose`), not regex slicing. Only 19 string-slicing calls in 6,700 lines.
- Weak point 1: it has **no macro expansion**. `\newcommand`/`\def` inside math are not interpreted here (comment at `layout.ts:663`: "Macro-generated noads can share one source span, so match by order"; atoms are matched back to source by index). There is a `declaredMathOperators` map only for `\DeclareMathOperator`. Anything that expands to math structure depends on an expander running earlier.
- Weak point 2: `parseItem` (l.498-780) is a long ladder of `if (commandName(token.text) === "…")` and `xxxCommandName(...)` lookups (about 60 of them, one function per command family, l.5710-6640). New commands need three coordinated edits: name table, parse method, IR kind, then a new `layoutXxx`, a case in `normalizeNucleus` (spacing.ts:239-355), a case in `texMathNucleusNeedsAmsMath`, and a caret-map case in `inline-provider.ts`.
- `parseAlignedBodyContent` (about 620 lines) and the six body parsers are covered in H1.

## 5. Cross-cutting observations
1. **No generic IR traversal.** Four hand-written per-kind recursions must be kept in sync: layout dispatch (84 `nucleus.kind ===` tests), `normalizeNucleus` (spacing.ts:227-360), `texMathNucleusNeedsAmsMath`, and caret-map builders (`inline-provider.ts:657-1100`). A single `mapNucleusLists(nucleus, fn)` / `childLists(nucleus)` helper would remove the drift risk and about 400 lines.
2. **Sp-rounding is done by convention, not by type.** `roundTexPt(...)` wraps almost every arithmetic result (hundreds of calls); only `alignedRowBaselineDistance` does explicit sp comparison. TeX compares and adds scaled integers. Move to an integer-sp `Dimen` for layout so the 13.6pt-style "floating-point residue" class of bug cannot occur.
3. **TeX's two-pass structure is flattened.** TeX computes max_h/max_d, does §762 sizing and spacing in the second pass. Here a single loop lays out each atom with `cursor` and then patches the cases that needed look-ahead or look-behind (H7, H3). Every missed look-behind case becomes a new special case.
4. **Constants calibrated to 10pt.** `font-profile.ts:248-258` hardcodes strut 8.399963 / 3.600037, baselineskip 12, jot 3, and `displayFontProfile` (inline-provider.ts:218) recomputes strut/baselineskip from the current baselineskip with the literal 45875/19661 (0.7/0.3 of 65536). `TEX_LATEX_STRUT_HEIGHT_PT * (baseAtPt/10)` in `layoutFractionNucleus` (l.3943) scales linearly, whereas LaTeX's `\strutbox` is 0.7 `\baselineskip`, which is not linear in font size (10pt→12pt, 11pt→13.6pt). That one is a latent size bug, and the same rule is implemented in two ways.
5. **Sizeable "LuaLaTeX" naming but TFM semantics.** The engine is `lualatex`, but all math parameters come from TFM fontdimens (CM). That matches the default oracle. Real OpenType math (`unicode-math`, `\Umath*`) isn't supported. The few LuaTeX deviations (delimiter two-chain search, l.6064) are encoded inline with one comment. Collect them in one place, with luatex.pdf page citations.
6. **Test/fuzz coverage is the real specification.** Given how the module is organised, correctness of each construct is protected by golden/differential tests, not by the structure. Refactors in H1-H3 should land one function at a time with the differential fuzzer running, starting with the baseline rule.

## 6. Suggested order
1. H7 (spacing for `\left`/`\right`/`\middle`): small, local, user-visible.
2. H3 (running rules, `clean_box` on output): small, removes three predicates.
3. H1 baseline rule only, then the shared `halign` primitive.
4. H2 (§1186 normalization), after H3.
5. H8 (preamble-driven profile).
6. H5 and H6 together with the vlist survey: shared design for displays.
7. H4 incrementally, macro by macro.
