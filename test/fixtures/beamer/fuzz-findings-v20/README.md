# Display-only column minipages

All eight alignment/size controls pass strict live LuaLaTeX checks in
`artifacts/beamer-fuzz/v20-live`.

A column begins in horizontal mode. Its leading display therefore uses an empty
line at zero height, without the frame-leading extra baseline; this is also the
reference of a top-aligned column. At endminipage, unskip removes the final
below-display glue. Intermediate paragraph/display glue remains in place before
following flow items. All four T/t/c/b alignments are checked in normal and
scriptsize text, with a prose neighbor and following root paragraph.
