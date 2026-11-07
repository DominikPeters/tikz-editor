# Scoped alignment, labels, and first column boxes

Reduced from newer case 0003. The standalone and centered/top-column variants
combine item actions, scoped scriptsize/small declarations, nested columns, TikZ,
and a following flushright table. All three cases and twelve states pass live
LuaLaTeX geometry and paint checks in `artifacts/beamer-fuzz/v33-live`.

The label belongs to the nearest enclosing item even inside a trivlist. Alignment
environments and item-action groups restore their own declarations. A column's
initial interline glue uses its first physical box's height and active baseline,
which can differ from the first later prose report.

The original complex source still has a separate final pending-label height
failure; these reductions do not close it.
