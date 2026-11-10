These 14 sources add 16 independently compiled states for the remaining
font, heading, node-size, rounded-background and default-arrow coverage gaps.
The original seed-43 sources remain in `../ci-fuzz-seed43/` with their original
source hashes; these controlled examples supplement them.

Run the live structural and paint checks after building the core:

```sh
node scripts/compare-beamer-priorities.mjs \
  --manifest test/fixtures/beamer/ci-fidelity-followup-20261110/cases.json \
  --out-dir artifacts/beamer-fidelity-followup
```

The `.oracle.json` files contain independent LuaLaTeX shipout traces, pinned
only from a complete passing live run with matching source and manifest hashes.
`test/beamer-fidelity-campaign.spec.ts` checks those traces without TeX.
Live paint checks remain necessary: the offline glyph/rule traces alone do not
verify rounded backgrounds or arrow ink.

The unique-colour masks require zero disagreements outside the shared 1px
edge bands, with RGB tolerance 2. Both raster inputs use 2x sampling and box
downsampling. Changing antialiased target-colour-to-white coverage also marks
an edge; constant missing paint and unrelated colours do not. These oracle
changes and deliberate missing/shifted/corner/hole controls are recorded in
`design/ci-fidelity-followup-20261110.json` separately from renderer fixes.
The pixel gate permits differences within its edge band; PGF dimension and
path tests separately protect the exact default-arrow construction.

Coverage is bounded to these class sizes, stock themes and templates.
It does not establish arbitrary font-parent execution or shadow pixel equality.
