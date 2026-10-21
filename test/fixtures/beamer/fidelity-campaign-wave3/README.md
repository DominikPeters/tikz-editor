# Breadth-deck Beamer reductions

Focused independent LuaLaTeX regressions for the ordinary Beamer gaps found in
`../breadth-decks/`. These examples intentionally omit the specialist package
interfaces catalogued in `design/beamer-package-support-inventory.md`.

The cases exercise Infolines author/institute/date metadata, wrapping sidebar
authors, private notes after columns, standalone centering before a picture,
fixed overlay areas containing alternative prose/list/math material, default
and numbered-ball contents (including subsection filters), modern head/title/
foot progress geometry and paint, Dove alerts, serif optical text sizes and
serif/professional math font behavior.

Run the live geometry and paint contract:

```
node scripts/compare-beamer-priorities.mjs --manifest test/fixtures/beamer/fidelity-campaign-wave3/cases.json --out-dir artifacts/beamer-fidelity-campaign/wave3
```

The 0.4pt progress bars use a 6400px raster so the existing 3×3 flat-color probe
fits inside the bar. RGB tolerance remains 2; glyph tolerances remain 0.02pt
horizontally and 0.01pt vertically, with 0.01pt rule-edge tolerance. Geometry
passes are not whole-image pixel-equality claims.

Pin only after a complete passing live run:

```
node scripts/update-beamer-campaign-oracles.mjs artifacts/beamer-fidelity-campaign/wave3 test/fixtures/beamer/fidelity-campaign-wave3/cases.json
```

The checked-in oracle snapshots contain independently compiled TeX glyph/rule
traces. The offline campaign test verifies source hashes and compares native
output to those traces; paint probes run in the live suite. Unsupported TOC
options produce diagnostics. Arbitrary contents templates, package frontends,
generated section-hook frames and general frame continuation fidelity remain
separate work.
