# Recursive-grammar fidelity findings

These are small, independently compiled reproductions found while expanding the
Beamer grammar. They are **fixed as of 2026-11-07 under the original strict gates**,
and now participate in the passing frozen-oracle collection.

- `local-macro-redefinition.tex`: the native renderer expands the target of a
  frame-local `\renewcommand` as ordinary text. The declaration leaks into the
  slide and `Local: 7\unit` retains the old `ms` meaning instead of `ticks`.
  LuaLaTeX applies `ticks` locally and restores `ms` after the group.
- `columns-inside-block.tex`: ordinary columns inside a block are not composed
  as columns. Environment syntax leaks into the block's rendered text. This is
  an interaction failure between two individually supported flow constructs.

These are hand-reduced reproductions, not claims of global minimality. Both
compile with LuaLaTeX, preserve visible text witnesses and fail the original
strict glyph/layout contract. Source hashes are recorded in `cases.json`.

```sh
node scripts/compare-beamer-priorities.mjs \
  --manifest test/fixtures/beamer/fuzz-findings-v4/cases.json \
  --out-dir artifacts/beamer-fuzz/replay-findings-v4
```

Both reduced sources now pass. Complex
cases can have several simultaneous failures; a failing frame is not counted
as a distinct bug. The broader generated galleries retain those untriaged
cases alongside these two isolated findings.

Macro redefinitions also exposed an oracle bug, fixed separately: isolating a
later frame previously omitted preceding body declarations. The oracle now
executes the original prefix in TeX with prior shipouts discarded, then enables
tracing for the selected frame. A live test compares selected glyph data with
an actual full-deck trace, including aliases, local restoration, overlay pages,
and page numbering. This does not use native macro evaluation to manufacture
the reference's macro state.
