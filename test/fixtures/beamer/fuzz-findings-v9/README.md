# Recursive flow, font context, and overlay geometry

- Nested columns preserve their own geometry and source scopes.
- TikZ inherits Beamer's font family and class-specific sizes; em padding uses
  the ambient font instead of the node's selected text size.
- A rounded block starting with display math uses the short above-display skip.
- Overlay items ending in display math retain the paragraph committed by
  Beamer's closing action environment.
- The composed shrinking frame checks all four overlays, retained covered
  columns, native top skip, visible glyph axes, and paint sentinels.

These passing cases do not close the other failing generated compositions.
