# Beamer fidelity failure accounting

Earlier reports mixed distinct bugs, failing frame observations, and successful
warm/cold comparisons. Native warm/cold agreement does not establish LuaLaTeX
fidelity. The complex campaigns were never clean, and the outstanding failures
should have been disclosed whenever fixes were reported.

## Current acceptance status

| Saved campaign | Baseline passing | Current passing | Still failing | States checked |
| --- | ---: | ---: | ---: | ---: |
| Seed 20261106 | 16/22 | 17/22 | 5 | 40 |
| Seed 20261107 | 27/39 | 30/39 | 9 | 81 |

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
V13 2/2, V14 4/4. All overlay states and unchanged strict contracts were checked;
source-hash-checked traces are pinned as regressions. Passing reductions do not
close the 14 still-failing complex observations.

Two investigation corrections are retained explicitly: the original grouped
columns repro was actually a subtitle; both it and the corrected body case are
preserved. The suspected hidden-label oracle bug was rejected: the oracle was
correct and renderer label geometry was wrong. No oracle exclusions or tolerance
relaxations were used to make these cases pass.

## Remaining work

The five older and nine newer first-frame compositions still fail geometry,
shrink transforms, and/or covered-glyph matching. Reduced cases are needed for
remaining multiline list font/baseline and mixed display/column boundaries.
All failures remain open until their original frames pass every state, followed
by live raster/paint checks. Current independent controls cover many interactions
but do not establish arbitrary TeX support. Unverified support and oracle coverage
gaps are listed separately in the ledger.

## Regression gates

The intermediate full suite had 8,331 passing tests and four failures: three
alignment regressions and one generated-preview mismatch. Those were fixed;
the subsequent broad run passed 1,759 tests with seven skipped. After the final
explicit display-boundary correction, 365 focused tests passed. A final full
suite is still required. Typecheck and production lint results are separate
from renderer fidelity. Source-fingerprinted saved replays reject source changes
during a run; per-state exceptions remain failures and later cases still run.
