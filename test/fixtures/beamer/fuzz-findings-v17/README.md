# Deferred labels consumed inside structural minipages

A list/trivlist inside a block's minipage can consume the surrounding pending
item label through LaTeX's global @inlabel/@labels state. A plain minipage
paragraph does not. Leaving that label pending manufactured a label-only
paragraph after the block, adding 15pt to its column in the reduction. Merely
removing the paragraph fixed text positions but failed the strict marker check:
the actual label is painted inside the centered block body.

The generic frontend captures the consumed labels; bounded context preparation
transfers them to the first executing native list/trivlist, retaining their
fonts, box metrics, and original item ownership. A minipage's terminal unskip
also removes the structural smallskip. Controls compare bottom/top columns,
direct/nested preceding items, plain-body negative controls, and overlay states.
