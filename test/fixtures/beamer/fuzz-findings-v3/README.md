# Fidelity findings from editing sequences

These findings are **fixed as of 2026-11-07** under the original strict
comparison gates. Their independent TeX traces now participate in the passing
frozen-oracle campaign. Each source was compiled
independently with LuaLaTeX; the minimized sources were verified again after
reduction. SHA-256 hashes and reduction budgets are recorded in `cases.json`.

- `inline-picture-after-text`: a top-level ordinary picture sharing a paragraph
  with preceding text is extracted into separate vertical flow. The generated
  cases displace text by roughly 14–21pt and move substantial drawing paint.
  The reduced reproduction keeps one frame and the ordinary picture.
- `titlepage-after-prose`: a title page after a centered paragraph has incorrect
  vertical spacing. Its reduced reproduction uses the 9pt class and has a
  glyph y discrepancy near 0.97pt. This remains after the surrounding generated
  program is removed.

The source reducer reduced the first example from 1,100 to 424 bytes
(32 trials, budget exhausted) and the second from 877 to 214 bytes
(33 trials, not exhausted). These are bounded reductions, not claims of global
minimality. Both retain the original structural failure field and independent
TeX witness. No comparison tolerance was changed.

Replay all four sources:

```sh
node scripts/compare-beamer-priorities.mjs \
  --manifest test/fixtures/beamer/fuzz-findings-v3/cases.json \
  --out-dir artifacts/beamer-fuzz/findings-v3
```

All four sources now pass. The picture fix retains shared paragraph ownership;
the title-page fix carries the preceding depth through the opening empty box.
The reduced title-page source now pins the compilation calendar so replay does
not change at midnight. Its original reduction hash remains in `cases.json`;
the original 214-byte reduction size below predates that calendar pin.
To continue reducing the inline example:

```sh
npm run reduce:beamer-fidelity -- \
  --input test/fixtures/beamer/fuzz-findings-v3/inline-picture-after-text-reduced.tex \
  --anchor EditNeighbor --out-dir artifacts/beamer-fuzz/reduce-inline --budget 64
```

For the title-page example use `--anchor '\titlepage' --witness Probe`.
