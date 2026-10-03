These checked-in LuaLaTeX traces pin command/default columns, 14pt class sizes,
stock block/list flow and a leading display under a size declaration. They retain the
existing exact glyph, rule, font and transform contract.

Regenerate after `npm run compare:beamer-followups` with:

```
node test/fixtures/beamer/fixed-flow-fidelity/capture-oracles.mjs
```
