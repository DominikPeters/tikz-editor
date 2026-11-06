# Remaining recursive flow failures

These two small reproductions are **known failures**, independently verified
with LuaLaTeX on 2026-11-07. They are intentionally outside the passing frozen
campaign. No tolerances or glyph/layout expectations are relaxed.

- `block-inside-list.tex`: a block inside an item prints block environment syntax
  as ordinary text. LuaLaTeX renders a titled block and places the following item
  after it; native glyph Y positions differ by about 33.2pt.
- `grouped-columns.tex`: columns inside a formatting group print column syntax
  as ordinary text. LuaLaTeX renders two small-font columns. The native output
  has three unmatched lines and misses the two reference column lines.

Both failures cross the boundary between the generic TeX text/list/group
frontend and structural Beamer flow. Rendering columns within a block is fixed,
but that alone does not make arbitrary nesting within text containers work.
The recursive seed 20261107 exercises `list>block` and `group>columns`; these are
hand-reduced examples of those interactions, not claims of global minimality.
All text witnesses and source hashes are checked by the manifest.

```sh
node scripts/compare-beamer-priorities.mjs \
  --manifest test/fixtures/beamer/fuzz-findings-v7/cases.json \
  --out-dir artifacts/beamer-fuzz/replay-findings-v7
```

The expected result is two strict mismatches, with valid independent references.
The initial grouped reduction was rejected because an immediately leading group
was parsed by Beamer as an inline frame title. The retained source gives the
frame an explicit title and compiles successfully.
