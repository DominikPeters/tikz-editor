# Alignment-environment display boundaries

Reduced from seed 20261107 case 0008, a pending description item containing
columns with a leading `center` display. The renderer dropped its label and
omitted the initial empty paragraph; normal versus short display skips and the
column's negative head skip also differed from LaTeX.

The ten controls cover pending/no labels, prose/no prose, font declarations,
`center`, `flushleft`, `flushright`, and a single centered character before math.
All ten pass independent live LuaLaTeX geometry and paint comparisons in
`artifacts/beamer-fuzz/v28-declaration-spacing`. Their source-hash-checked TeX
traces are pinned here. The original complex frame still fails at another list
boundary; passing these reductions does not close it.
