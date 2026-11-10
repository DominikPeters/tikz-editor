# Scoped alignment, labels, and first column boxes

Reduced from newer case 0003. The standalone and centered/top-column variants
combine item actions, scoped scriptsize/small declarations, nested columns, TikZ,
and a following flushright table.

The label belongs to the nearest enclosing item even inside a trivlist. Alignment
environments and item-action groups restore their own declarations. A column's
initial interline glue uses its first physical box's height and active baseline,
which can differ from the first later prose report.

At this checkpoint the original complex source still had a separate final
pending-label height failure.
