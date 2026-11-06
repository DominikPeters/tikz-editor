# Beamer flow and overlay interaction regressions

These are original minimal documents from the mandatory families in
`scripts/lib/beamer-fuzz-cases.mjs`, seed 20261105. They cross paragraph
alignment, center environments, columns, blocks, compilation dates, and
absolute/relative/nested TikZ overlays. Animated pictures between paragraphs
exercise layout on hidden as well as visible steps.

Run the full live LuaLaTeX comparison, including colored path footprints:

```sh
npm run compare:beamer-campaign-wave5
```

`paintColors` requires an independent oracle paint witness on every visible
step and compares the entire colored footprint, including its position. Hidden
steps must have no oracle paint. The structural-only mode deliberately cannot
pass these paint contracts. Glyph and rule tolerances remain unchanged.

Only after a complete passing live run, pin the independent LuaLaTeX traces:

```sh
node scripts/update-beamer-campaign-oracles.mjs artifacts/beamer-fidelity-campaign/wave5 test/fixtures/beamer/fidelity-campaign-wave5/cases.json
```

The regular test suite checks these source hashes and offline glyph/rule traces,
plus the generator's per-step paint-presence and diagnostic invariants. Full
path paint is gated by the live comparison and scheduled Beamer fuzz job.
