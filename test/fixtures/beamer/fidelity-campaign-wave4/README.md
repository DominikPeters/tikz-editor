# Bounded package frontend conformance

Eleven reductions and stress cases cover the first package tranche. Run the
LuaLaTeX comparison and refresh its reference traces with:

```
node scripts/compare-beamer-priorities.mjs --manifest test/fixtures/beamer/fidelity-campaign-wave4/cases.json --out-dir artifacts/beamer-fidelity-campaign/wave4
node scripts/update-beamer-campaign-oracles.mjs artifacts/beamer-fidelity-campaign/wave4 test/fixtures/beamer/fidelity-campaign-wave4/cases.json
```

`test/beamer-fidelity-campaign.spec.ts` consumes the traces without a TeX install.
The subfigure cases reuse the original synthetic river-map asset from the
breadth decks. They cover image trim/clip, caption wrapping and composition;
no remote assets are needed.

See [the implementation boundary](../../../../design/beamer-package-frontends.md).
