Three original Beamer cases cover an explicit minimum shrink with wider paragraph wrapping, unscaled title/subtitle, inline fraction and rotated text/rule; automatic shrink of an overflowing list; and the cramped but unscaled `squeeze` option.

`test/beamer-frame-shrink.spec.ts` compares all glyph origins, underlying fonts, composed paint axes and rules against the pinned LuaLaTeX trace, with a .001pt limit. It also checks authored caret offsets and selection rectangles after the body transform. `test/beamer-frame-oracle.spec.ts` exercises the actual PGF and graphicx PDF matrices, including hidden overlay layout origins.

To refresh the primary trace, first run `scripts/compare-beamer-frame.mjs` on `shrink.tex` for frames 1, 2, 3, with page 1, output directory `artifacts/beamer-shrink-fidelity` and names `shrink-1-state-1`, `shrink-2-state-1`, `shrink-3-state-1`. Then run:

```
node test/fixtures/beamer/frame-shrink-fidelity/capture-oracles.mjs
```

The capture checks source hashes, engine, page count and oracle contract version. Beamer 3.72 computes both the minimum scale and its reciprocal with integer dimension arithmetic; `shrink=20` therefore paints at .80011 rather than exactly .8.
