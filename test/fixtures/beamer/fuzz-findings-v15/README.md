# Multiline nested-list boundaries

All four cases pass strict live LuaLaTeX structural and paint checks in
`artifacts/beamer-fuzz/v15-live`. Source-hash-checked traces are pinned.

Plain and overlay-controlled items distinguish a child list in the same item
from one in the next parent item. Looking only at the next paragraph's depth
incorrectly applied that next item's smaller baseline to the preceding multiline
paragraph. Deferred ancestor labels must also contribute to the first line's
height and depth. The default Beamer enumeration templates use hierarchical
numeric labels (for example 2.1), unlike the article class's alphabetic labels;
the controls check those labels and their actual box metrics.
