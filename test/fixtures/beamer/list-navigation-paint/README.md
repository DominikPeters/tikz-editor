These original stock Beamer cases exercise numbered and bulleted label colors
independently from body text, nesting across list kinds, and the empty/default
navigation symbols template. The committed LuaLaTeX oracle records the active
xcolor foreground at actual stock label-template execution, plus Beamer's
`\ifbeamertemplateempty` result. The custom-label case also logs the actual
generated counter after two custom items. The hooks only log paint and counters;
they add no material. Custom labels bypass the stock templates, so that case
compares the generated label separately from the authored custom-label colors.

Regenerate from the repository root with:

```sh
node test/fixtures/beamer/list-navigation-paint/capture-oracles.mjs
```

The script uses the shared TeX oracle runner and requires LuaLaTeX with Beamer.
The snapshot records the TeX/class versions and hashes `cases.json` so source
changes cannot silently reuse the old oracle. No native renderer values are
used to produce the reference. The normal test suite reads this snapshot and
checks native label glyph paint and navigation primitives without requiring TeX.
