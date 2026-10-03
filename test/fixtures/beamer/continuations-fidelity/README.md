These are full-document LuaLaTeX shipout traces from Beamer 3.72 / TeX Live
2025, normalized to physical page coordinates with the existing Beamer
oracle instrumentation and comparison helpers. They check forced and
automatic breaks, top/center/bottom/plain geometry, paragraph lines and list glue,
display math, atomic blocks, the stock continuation title variants, final
footnote placement, and frame counters across a complete deck. Each snapshot
records the source SHA-256 and TeX environment. Continuation indexes are
one-based; frame indexes are zero-based. Continuations are distinct from
overlay steps.

With the existing TeX Live tools installed, run from the repository root:

```sh
node scripts/regenerate-beamer-continuation-oracles.mjs --check
node scripts/regenerate-beamer-continuation-oracles.mjs
npx vitest run test/beamer-continuations.spec.ts
npm run compare:beamer-continuations
```

`--check` recompiles without replacing snapshots; omit it to regenerate and
review the JSON diff. `--cases forced,counters` selects fixtures and
`--out-dir <directory>` changes the ignored compilation artifact directory.
The helper compiles complete authored documents twice, so the counter case
retains its preceding continuations and the `.nav` total. Its explicit page
correspondence is checked before regeneration.

The comparison command generates a raster gallery with strict glyph/rule gates
for all 36 physical pages. Its frame manifest includes every authored frame
in the counter and unnumbered-frame decks.
