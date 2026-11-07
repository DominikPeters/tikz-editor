# Display-only overlay items

All four cases and six states pass strict live LuaLaTeX structural and paint
checks in `artifacts/beamer-fuzz/v14-live`. Pinned traces retain source hashes.

Consecutive display-only items expose action-environment closing order. Beamer
ends the paragraph before closing the previous action at the next item, whereas
at end-list the action closes first and creates a resumed empty paragraph.
Treating every closure alike accumulated a full empty line per item. A synthetic
vspace workaround also merged following prose, retaining an unwanted word space.
The renderer now commits the actual paragraph boundary at list end. The empty
line retains list scope so the following prose receives the closing list skip.
Plain itemize/enumerate cases are negative controls.
