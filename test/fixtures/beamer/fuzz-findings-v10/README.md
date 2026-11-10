# Expanded list and picture regressions

The controls cover blocks at the beginning of items and after prose, itemize,
enumerate and description lists, rounded and default block templates, scoped
small text and description margins, projected marker placement, and picture
blocks containing transformed cubic paths. Eight nested list-head cases check
that a parent label shares its first child's line without emitting an empty
paragraph. The composed scoped-list/picture frame checks every overlay and
shrinking geometry.

The Bézier controls deliberately test PGF picture bounds, which include control
points and can exceed the curve's ink bounds. This keeps the correct image
layout separate from tight rendered-path bounds.
