# Fidelity findings from editing sequences

Regression cases for inline picture flow and title-page spacing. Their
reference traces were compiled independently with LuaLaTeX.

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
The title-page example sets a fixed date so its output is stable across runs.
To continue reducing the inline example:

```sh
npm run reduce:beamer-fidelity -- \
  --input test/fixtures/beamer/fuzz-findings-v3/inline-picture-after-text-reduced.tex \
  --anchor EditNeighbor --out-dir artifacts/beamer-fuzz/reduce-inline --budget 64
```

For the title-page example use `--anchor '\titlepage' --witness Probe`.
