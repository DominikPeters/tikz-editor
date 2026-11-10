# Column block regressions found by the Beamer soak

The 2026-11-05 soak ran 256 cases from four seeds, with 157 distinct sources and
504 independently compiled LuaLaTeX overlay pages. Its column/block cases
exposed a missing baseline skip before a leading block. Column minipages begin
with `\leavevmode`; the block's `\par` ends that initial empty line. Normal
interline glue must precede the title box unless `T` cleared it with
`\nointerlineskip`.

Cross-checking `t`, `b` and `T` found a second bug: bottom-aligned minipages need
the final box's depth. Aligning geometric bottoms loses descenders and changes
the frame's vertical packing. The fixtures cover all four column alignments,
rounded blocks, mixed text/picture bodies, and preceding prose.

Reproduce the live glyph, rule and paint comparison:

```sh
node scripts/compare-beamer-priorities.mjs --manifest test/fixtures/beamer/fidelity-campaign-wave6/cases.json --out-dir artifacts/beamer-fidelity-campaign/wave6
```

Refresh the independent LuaLaTeX traces with:

```sh
node scripts/update-beamer-campaign-oracles.mjs artifacts/beamer-fidelity-campaign/wave6 test/fixtures/beamer/fidelity-campaign-wave6/cases.json
```

The soak also exposed raster-only small-node warnings. PDF path coordinates and
glyph geometry matched; Poppler's hinted glyphs and librsvg's outlines differed
at pixel edges. Paint checks now allow only shared one-pixel boundary bands and
require zero differences elsewhere. Tests reject interior holes, missing shapes
and larger translations. Raw raster differences remain in live reports.

The top-aligned cases additionally catch the empty initial line of a leading
block in a lowercase `t` minipage: it gives the vtop zero height. `T` has a
separate negative skip and `\nointerlineskip` rule. Fixture names use words
(`top`, `bottom`, `capital-t`) so `t` and `T` cannot alias on case-insensitive
file systems. The harness rejects case-only ID and filename collisions.

`column-block-alignment` is now a mandatory fuzzer family, varying `t`, `b` and
`T` alongside the existing default-centered column cases.
