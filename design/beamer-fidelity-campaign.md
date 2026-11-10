# Beamer rendering regression tests

Small TeX documents under `test/fixtures/beamer/` exercise headings, themes,
font sizes, lists, columns, blocks, math, images and overlays. The corresponding
`.oracle.json` files contain expected glyph and rule geometry from LuaLaTeX.
These are test data, rather than records of individual debugging sessions.

`test/beamer-fidelity-campaign.spec.ts` compares the renderer against those
references without requiring a TeX installation. Other Beamer tests cover
editing, source mapping and package-specific behaviour.

## Running comparisons

Build before using the command-line comparison tools:

```sh
npm run build:tex-fuzz
node scripts/compare-beamer-priorities.mjs \
  --manifest test/fixtures/beamer/fidelity-campaign/cases.json \
  --out-dir artifacts/beamer-comparison
```

The manifest selects documents, source frames and overlay/page counts. Cases
can also require text witnesses, image counts, sampled colours or colour
footprints. `--cases` selects particular case IDs.

The comparison checks glyph positions, font identity, transforms and rule
geometry. Raster checks cover paint that those structural measurements cannot
capture, such as backgrounds, clipping and images. Native warm/cold agreement
checks cache consistency; comparison with TeX checks rendering fidelity.

To refresh saved TeX reference data from a comparison run:

```sh
node scripts/update-beamer-campaign-oracles.mjs \
  artifacts/beamer-comparison \
  test/fixtures/beamer/fidelity-campaign/cases.json
```

Inspect the changed reference data and run the affected tests. Generated
reports, PDFs and comparison images belong under the ignored `artifacts/`
directory.

## Package coverage

The [breadth decks](../test/fixtures/beamer/breadth-decks/README.md) provide
larger examples. [Package frontend boundaries](beamer-package-frontends.md)
describe the supported interfaces. Unrecognised package content should remain
visible with diagnostics rather than silently disappear.
