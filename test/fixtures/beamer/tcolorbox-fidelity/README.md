`boxes.tex` covers the ordinary unbroken tcolorbox standard skin: titled
itemize, an untitled box between paragraphs, explicit padding/rules/corner
radius, title/body fonts and colors, and boxes in Beamer columns.

`boxes.oracle.json` retains LuaLaTeX glyph/rule geometry for each selected
source frame. The existing Beamer probe preserves the original preamble,
compiles the isolated frame, and records shipout with the shared Lua tracer.
No native renderer measurements are used to construct these references.

Regenerate from the repository root with the existing core scanner built:

```sh
node test/fixtures/beamer/tcolorbox-fidelity/capture-oracles.mjs
```

The script uses `scripts/probe-beamer-frame.mjs` and the existing trace
normalizer. TeX/PDF/log artifacts are written under the ignored directory
`artifacts/beamer-tcolorbox-fidelity`. LuaLaTeX with Beamer and tcolorbox, plus
the probe's existing `pdfinfo` dependency, must be available. Optional first
argument changes the artifact directory.

The glyph gate does not infer PGF fill paths from TeX rule nodes. Separate
background geometry checks and raster inspection cover the frame, interior
and title colors and rounded corners. Advanced skins, global `\tcbset`
styles, lower parts, custom code and nested package boxes remain explicitly
diagnosed rather than being painted as stock boxes.
