These checked-in LuaLaTeX traces pin command-form columns and a frame whose
first body material is a display under a size declaration. They retain the
existing exact glyph, rule, font and transform contract.

Regenerate after `npm run compare:beamer-followups` with:

```
node test/fixtures/beamer/fixed-flow-fidelity/capture-oracles.mjs
```
