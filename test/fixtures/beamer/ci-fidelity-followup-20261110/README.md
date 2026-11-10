# Font, heading, node-size and paint regressions

These documents cover nested font declarations, heading inheritance, named
sizes inside TikZ nodes, rounded backgrounds and default arrow geometry.

```sh
node scripts/compare-beamer-priorities.mjs \
  --manifest test/fixtures/beamer/ci-fidelity-followup-20261110/cases.json \
  --out-dir artifacts/beamer-fidelity-followup
```

The `.oracle.json` files contain LuaLaTeX glyph/rule reference data for the
ordinary regression tests. Live paint comparisons additionally check rounded
backgrounds and arrow ink. Their colour masks use RGB tolerance 2 and allow a
shared 1px antialiasing edge band; raster inputs use 2x sampling with box
reduction. The paint tests also reject missing fills, shifts, wrong corners and
holes. Exact default-arrow dimensions and paths have separate tests.
