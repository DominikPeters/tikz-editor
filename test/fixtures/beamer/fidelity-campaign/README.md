# Beamer fidelity campaign: interaction probes

These are original, minimal documents for the next fidelity campaign. They
exercise combinations beyond the earlier corpus reductions: wrapped headings
across structurally different themes, class size with nested lists or math
blocks, requested fonts, and local declarations.

Run all cases with:

```sh
npm run compare:beamer-campaign
```

Select a mechanism with the existing runner's case filter:

```sh
npm run compare:beamer-campaign -- --cases berkeley-wrapped-heading,warsaw-wrapped-heading,rochester-wrapped-heading
```

The command uses the existing exact comparison gates, reference content
witnesses and page-count checks. It generates native SVGs, TeX PDFs, traces,
paired rasters, differences and a gallery. Failures exit nonzero and remain
unresolved targets. There are no native-output goldens, expected failures or
tolerance exceptions.

Dates are explicitly empty to keep dynamic `\today` content out of the theme
geometry comparisons. `metropolis-lm-wrapped-heading` explicitly restores
Latin Modern Sans after loading Metropolis to isolate layout from font selection. `metropolis-requested-font` retains the requested font and
measures native Fira support separately. Two additional holdouts cover the four
Fira Sans faces, ligatures, kerning and a full titlepage.

A structural pass only covers measured glyphs, fonts, transforms and TeX rules.
Inspect paint and content in the raster gallery before closing a target. Scoped
color changes can pass geometry while still painting the wrong color. An
unsupported-code recognition pass is a separate contract from visual fidelity.

The campaign and current baseline are described in
[`design/beamer-fidelity-campaign.md`](../../../../design/beamer-fidelity-campaign.md).

The first wave now has 20 regression cases. Their `.oracle.json` files contain
independent TeX traces, never accepted native output. After a complete passing
live run, use `node scripts/update-beamer-campaign-oracles.mjs RUN_DIRECTORY` to
refresh them; the script rejects stale source/manifest hashes or failed cases.
`test/beamer-fidelity-campaign.spec.ts` applies the same structural contract
offline. Paint fidelity still requires the live raster probes and visual review.
Fira's license is retained beside the generated font data.
