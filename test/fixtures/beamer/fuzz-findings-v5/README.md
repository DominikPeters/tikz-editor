# Further findings from recursive grammar fuzzing

All three cases pass the unchanged strict LuaLaTeX gates and have independent
frozen traces. They extend the original four fixes rather than weakening their
comparison contracts.

- `long-infolines-title`: Madrid's `insertshorttitle` is an hbox. A long title
  remains on one line and can extend beyond its colorbox; the native renderer
  previously wrapped and hyphenated it. Stock infolines author/title boxes now
  retain that unbreakable layout.
- `macro-across-flow`: a frame-local declaration must remain visible after a
  structural boundary such as a block. Text layout previously restarted with
  the frame's initial bindings. Point-context snapshots preserve the executing
  source scope across separate layout leaves.
- `macro-declaration-alias`: an alias of `renewcommand` used between frames
  changes the following frame's macro context. A scan for literal declaration
  names missed the assignment; the bounded macro stream now executes such
  aliases while respecting closed frame/group scopes.

The long-title source also exposed an oracle witness problem: LuaLaTeX's `fl`
ligature in “overflow” is a single presentation glyph. Witness checks now
compare its spelling with `fl`. Raw glyph, font, transform and geometry traces
remain unchanged and retain their strict comparisons.

```sh
node scripts/compare-beamer-priorities.mjs \
  --manifest test/fixtures/beamer/fuzz-findings-v5/cases.json \
  --out-dir artifacts/beamer-fuzz/replay-findings-v5
```
