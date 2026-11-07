# Structural Beamer boxes inside native text containers

All three sources pass strict live LuaLaTeX structural and paint comparisons
(`artifacts/beamer-fuzz/v7-recursive-final`, 2026-11-07) and are included in the
frozen fidelity campaign. No tolerances or expectations were relaxed.

- `block-inside-list.tex`: a block inside an item retains its title/body flow
  instead of printing environment syntax.
- `grouped-columns.tex`: columns inside a body formatting group retain scoped
  small text and their structural layout. A preceding `\relax` prevents Beamer
  from interpreting the group as a subtitle.
- `columns-in-subtitle.tex`: the original “grouped columns” reduction, preserved
  because it exposed a separate unsupported metadata flow. The group following
  the frame title is a subtitle, not body text. The earlier description of this
  source as body nesting was incorrect.

Passing these reductions does not establish that arbitrary compositions work.
Outstanding generated frames are tracked in `design/beamer-failure-ledger.json`.

```sh
node scripts/compare-beamer-priorities.mjs \
  --manifest test/fixtures/beamer/fuzz-findings-v7/cases.json \
  --out-dir artifacts/beamer-fuzz/replay-findings-v7
```
