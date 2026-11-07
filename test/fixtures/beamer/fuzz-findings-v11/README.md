# Column references and label ownership

All 25 controls (30 states) pass strict live LuaLaTeX structural and paint
checks in `artifacts/beamer-fuzz/v11-label-verified`. No oracle expectations
or tolerances were changed; their source-hash checked traces are pinned.

- All 16 combinations of nested top, first-baseline, center, and bottom columns
  check the initial empty line, reference baseline, and natural extent.
- Three covered-column cases distinguish visible, uncover, and removed content.
- Four scoped first-list-line cases check the size active when that paragraph
  ends, including class sizes 11pt and 12pt.
- Two resumed-text counterexamples keep an item label inside its visibility
  wrapper after the columns. They verify its original item font and its
  horizontal movement with the centered paragraph.

The label oracle was initially suspected of counting a hidden glyph as visible.
Inspection of the PDF, a red-ink control, and a detailed LuaTeX literal trace
rejected that hypothesis: it already recorded the hidden layout correctly.
The mismatch was in native label geometry, which prevented exact covered-glyph
matching. The fix changes the native layout and retains the original oracle.

The open campaign observations remain in `design/beamer-failure-ledger.json`.
