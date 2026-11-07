# Grandchild enumeration before a block item

Both cases pass strict live LuaLaTeX checks in `artifacts/beamer-fuzz/v18-live`.

Nested numbered balls use the smaller 1.4-scaled sphere, -.55ex picture edge,
and unraised projected number, rather than the first-level 1.75/-.65ex/.5pt
settings. Normal and cramped cases also distinguish item separation from the
closing skip of a list begun while a parent label was pending: LaTeX's
@noparlist suppresses that closing skip. The normal itemsep hides the error;
zero cramped itemsep exposes the erroneous 2pt.
