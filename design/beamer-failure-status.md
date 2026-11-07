# Beamer fidelity failure accounting

Earlier reports mixed distinct bugs, failing frame observations, and successful
warm/cold comparisons. Native warm/cold agreement does not establish LuaLaTeX
fidelity. The complex campaigns were never clean, and the outstanding failures
should have been disclosed whenever fixes were reported.

## Current acceptance status

| Saved campaign | Baseline passing | Current passing | Still failing | States checked |
| --- | ---: | ---: | ---: | ---: |
| Seed 20261106 | 16/22 | 18/22 | 4 | 40 |
| Seed 20261107 | 27/39 | 35/39 | 4 | 81 |

These are frame observations, not counts of distinct bugs. One frame can contain
several bugs, and one bug can affect several frames. Current numbers come from
strict saved independent TeX traces, not live paint reruns of the full campaigns.
Every original failure and its latest status/report is in
`beamer-failure-ledger.json`. Initial failing sources and reduction controls are
retained under `test/fixtures/beamer/fuzz-open-compositions/`.

## Corrections verified by independent reductions

- Recursive columns and structural blocks inside lists, groups, and subtitles;
  preservation of surrounding font, color, alignment, width, and overlay scope.
- Ambient TikZ font selection and em-based node padding, plus PGF cubic picture
  bounds that include control points.
- List font depth excluding descriptions, inline math sizes, pending parent/child
  labels, captured label fonts, projected marker paint, and label alignment.
- Nested-column reference baselines, inherited ragged-right declarations, and
  covered geometry retained for strict hidden-glyph checks.
- Paragraph/list/block boundary glue, cramped nested-list entry, list closing
  skips after scoped formatting, leading block/minipage center spacing, and
  inline structural width in shrinking frames.
- Overlay item action closing order after display math: next-item and end-list
  boundaries differ. Following prose also needs the resumed empty line's list
  scope, without an invented leading word space.

Live controls: V7 3/3, V9 6/6, V10 24/24, V11 25/25, V12 12/12,
V13 2/2, V14 4/4, V15 4/4, V16 2/2, V17 8/8, V18 2/2, V19 1/1,
V20 8/8, V21 2/2, V22 6/6, V23 2/2, V24 1/1, V25 1/1,
V26 2/2, V27 8/8, V28 10/10. All overlay states and unchanged strict contracts were checked;
source-hash-checked traces are pinned as regressions. Passing reductions do not
close the eight still-failing complex observations.

Two investigation corrections are retained explicitly: the original grouped
columns repro was actually a subtitle; both it and the corrected body case are
preserved. The suspected hidden-label oracle bug was rejected: the oracle was
correct and renderer label geometry was wrong. No oracle exclusions or tolerance
relaxations were used to make these cases pass.

Additional verified corrections include multiline baseline ownership across new
parent items, default hierarchical enumeration labels, ancestor labels in first
line metrics, explicit paragraph breaks before interior displays, and labels
consumed inside structural minipages. The label-transfer investigation rejected
a second partial fix: discarding the deferred label fixed spacing but failed the
strict marker check. The final correction transfers that label to its actual
consumer, preserving geometry and original item ownership.

Nested numbered-ball templates now use their smaller sphere and different
baseline settings. LaTeX's @noparlist also suppresses the closing skip of child
lists begun in a pending parent label. Those changes close original newer case
0000 in all five states, confirmed by live PDF/paint checks and pinned in V19.

## Remaining work

The four older (0000, 0001, 0003, 0004) and four newer (0002, 0003, 0008, 0009) first-frame compositions still fail geometry,
shrink transforms, and/or covered-glyph matching. Reduced cases are needed for
remaining multiline list font/baseline and mixed display/column boundaries.
All failures remain open until their original frames pass every state, followed
by live raster/paint checks. Current independent controls cover many interactions
but do not establish arbitrary TeX support. Unverified support and oracle coverage
gaps are listed separately in the ledger.

## Regression gates

The intermediate full suite had 8,331 passing tests and four failures: three
alignment regressions and one generated-preview mismatch. Those were fixed;
the subsequent broad run passed 1,759 tests with seven skipped. A later broad
run had 1,822 passing tests and two bibliography failures, which were fixed and
retested. The latest focused run passed 602 tests. Typecheck passed before V28's
final declaration adjustment; production lint passed before V28. A final full
suite is still required. These gates are separate from renderer fidelity. Source-fingerprinted saved replays reject source changes
during a run; per-state exceptions remain failures and later cases still run.

## Latest independent findings

V20–V28 correct display-only column baselines, active table-strut registers,
class-based list dimensions, captured parent labels and fonts, list item changes
across child lists, nested Rose/Orchid color context, whole-container covering,
structural body extents, and alignment-environment empty paragraphs/display skips.
The last correction also preserves pending description labels inside columns.

Original newer frames 0000, 0001, 0004, 0005, and 0007 have complete live closures
pinned in V19, V24, V21, V25, and V21 respectively; earlier V9/V10 controls cover
0006, 0010, and 0011. Older 0002 now passes saved traces and awaits live closure.
Newer 0008 still has an independently reproduced ~5.3pt offset at a nested
description-display to parent-item transition, despite the centered-column fix.
V24's earlier failed live runs and V28's initial three failed controls are retained;
only their final all-state live runs establish the stated control passes.
