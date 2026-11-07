# Natural top skip on overfull frames

This fixed bug came from checking an actual edited document with LuaLaTeX after
its entire warm/cold editing sequence had passed. Switching to 20pt made a later
frame too tall; native body glyphs moved upward by about 3.486pt while the title
stayed correct. Simple short 20pt Roman/sans paragraphs both passed, ruling out
font selection as the cause.

The reduced ten-line `overflow-top-skip.tex` reproduced a 5.69046pt error. Native
vertical packing clamped the natural `.2cm` skip of `[t]` frames to the remaining
free height. Beamer's `beamerbaseframe.sty` defines that skip with stretch and no
shrink, and adds it even on overfull frames. Keeping its natural size fixes the
reduced case and all three independently checked edited context frames.

The strict live comparison now has identical glyphs/fonts/transforms and less
than 0.0001pt maximum glyph-Y error. Its independent trace is part of the passing
frozen collection. A unit regression checks that adding overflowing later lines
does not move the first baseline.
