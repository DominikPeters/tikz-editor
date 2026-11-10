# Alignment-environment display boundaries

Reduced from seed 20261107 case 0008, a pending description item containing
columns with a leading `center` display. The renderer dropped its label and
omitted the initial empty paragraph; normal versus short display skips and the
column's negative head skip also differed from LaTeX.

The ten controls cover pending/no labels, prose/no prose, font declarations,
`center`, `flushleft`, `flushright`, and a single centered character before math.
At this checkpoint the original complex frame still failed at another list
boundary.
