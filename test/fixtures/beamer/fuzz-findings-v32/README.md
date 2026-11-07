# Display-to-table item spacing in a block

Reduced from newer original case 0002. A first-level enumerate inside a block
selects the globally nested small body font. That size command replaces the
first-level list registers, including 3pt parsep in an 11pt class. The paragraph
following a display in a new item must retain that skip.

The matrix/table, block, bottom-aligned columns, and pending outer label all pass
strict live checks in `artifacts/beamer-fuzz/v32-live`.
