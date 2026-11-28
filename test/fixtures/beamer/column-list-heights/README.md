# Column height of a short list

A column is a `minipage` whose natural height is the sum of its boxes and
glue. For a one-item itemize that is `\topsep`, the baseline skip after the
column's empty `\leavevmode` line, and the item line's height and depth
(16.72pt for "Left text" in Madrid 11pt).

The renderer measured a column list by the height of the shared text
frontend's enclosing vlist. That vlist's cursor advances at least 0.85em past
its first line (the TikZ-node strut), so a single item without descenders made
the column 1.588pt too tall. Every alignment then moved: `b` columns put the
item 1.588pt high, `t` columns 0.635pt (through the frame's vertical
centring), `c` columns 0.794pt beside a taller picture and 1.111pt beside a
shorter one. Three items, or one item with a descender, exceed the floor and
were already exact; they are kept as controls.

The decks vary theme, aspect ratio, column alignment, `\column` against the
`column` environment, picture height and order. A `P` node at the picture's
origin witnesses the picture's position.

Reproduce and refresh the LuaLaTeX traces:

```sh
node scripts/compare-beamer-priorities.mjs --manifest test/fixtures/beamer/column-list-heights/cases.json --out-dir artifacts/beamer-fidelity-campaign/column-list-heights --structural-only
node scripts/update-beamer-campaign-oracles.mjs artifacts/beamer-fidelity-campaign/column-list-heights test/fixtures/beamer/column-list-heights/cases.json
```
