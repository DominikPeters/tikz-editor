# Tabular and booktabs fidelity

Run `npm run compare:beamer-tables` to compile the original fixtures in
`test/fixtures/beamer/tables/` and compare them against the shared native
text renderer. The command writes an ignored gallery to
`artifacts/beamer-table-conformance/index.html`. `--cases ID,ID` selects
cases and `--structural-only` skips raster previews. The same strict runner
also accepts `--manifest path/to/cases.json`.

The gate requires complete page correspondence, every witnessed oracle
word, exact glyph codes and font sizes, no unmatched text or rules, glyph
positions within 0.02pt horizontally and 0.01pt vertically, and rule edges
within 0.01pt. Raster previews support manual review. Flat block fills have
an additional color probe; the gate does not assert whole-image pixel
identity.

The matrix covers unequal left/center/right columns; text fonts and math;
outer and intercolumn padding; `@{}` and `!{}` inserts; repeated preambles;
wide multicolumn headings and omitted internal vertical rules; `hline`,
`cline`, double rules and the array package's distinct rule widths;
booktabs top/mid/bottom/partial rules, trims, adjacent partial rules, custom
widths, `specialrule` and `addlinespace`; fixed-width p/m/b paragraphs,
font/alignment/suffix declarations, math column declarations, extra row
height, row gaps, array stretch, preamble settings and local overrides;
nested tables; rule-aware top/bottom anchoring; assignment-time em/ex
lengths across later font changes; and inline, block and column containment.

The layout follows the installed primary definitions in `latex.ltx`,
`array.sty`, and `booktabs.sty`. Tables remain atomic source-backed inline
boxes. Their cells use the same text shaping, math boxes and paragraph
breaking as other editor text, retaining cell glyph sources and caret
positions on each actual row. Booktabs lengths retain their package-load
font dimensions under later size changes. Dimension assignments also retain
the font used when the assignment executes. Unsupported column macros such
as tabularx `X` and siunitx `S` remain visible source literals; implementing
those packages requires separate layout semantics. Multicolumn boundary
inserts and vertical cell material such as displays, lists and LR parboxes
also retain the entire table as a visible source literal rather than lose
their content. Preamble inserts and column declarations retain their own
source spans and do not map carets onto unrelated cell text.
