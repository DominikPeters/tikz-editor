# Graphicx text transform fidelity

`npm run compare:beamer-transforms` renders the original fixtures in
`test/fixtures/beamer/transforms/cases.json` and compares them with LuaLaTeX.
The gallery includes the native SVG, its raster preview and the PDF raster.
It gates painted glyph origins, underlying font names/sizes, affine font axes,
rule bounds and flat block fills. Its pass badge does not mean a pixel-identical
whole-page image.

The matrix covers quarter, half and arbitrary rotations; default, centered,
edge and explicit pivots; uniform and anisotropic scaling; negative factors and
reflection; width, height and starred total-height resizing; nested transforms;
and wrapped minipages with centered, top and bottom baselines. Ordinary text,
inline math and rules use the shared hlist renderer. Paragraph boxes use the
shared vlist paragraph renderer before applying the kernel's parbox baseline.

The implementation follows the installed primary definitions in
`graphics.sty` (`Grot@box`, `Gscale@box`, `Gscale@div`) and `graphicx.sty`
(`Grot@box@kv`, the rotation origin keys). Default `rotatebox` rotates around
the left baseline. Supplying an option list starts with the box center as the
pivot. Positive TeX angles become negative SVG rotation angles because SVG
uses a downward y axis. A rotated box keeps graphicx's chosen vertical reference
point while normalizing its horizontal extent. Negative scaling swaps vertical
height/depth as required and translates horizontal reflection back into its
occupied box. Resize factors reproduce graphicx's integer division rather than
using the unrounded floating-point target ratio.

Lua tracing follows `pdf_save`, `pdf_setmatrix` and `pdf_restore` whatsits,
composing their affine matrices at the TeX box baseline. Native tracing composes
all SVG ancestors. Glyph traces keep their original font size separately from
the painted axes, allowing nonuniform scaling, rotation and reflection to be
checked without conflating them with font selection. Rule traces compare the
transformed corner bounds. Rotated and reflected glyphs are grouped along
their painted baseline direction, preserving authored word order.

Transform nodes keep their exact command/content spans and map glyph carets
through the same affine matrices. Nested image resources remain discoverable.
Explicit-height minipages/parboxes and unsupported transform arguments/content
are retained visibly as source material. Arbitrary TeX dimension expressions
and package-specific box engines remain outside this initial partial capability.
