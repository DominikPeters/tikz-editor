# Ending a child list after display math

The nested display-only description and the plain description control pass live
LuaLaTeX comparison in `artifacts/beamer-fuzz/v29-list-identity-verified`. Ending
the description already cleans up the paragraph resumed after its display; a
following child list must not ship an extra empty line. List identities retain
ancestors omitted from geometric scope paths, so a continuing parent is distinct
from a list that has ended.

A longer variant exposed a separate top-aligned frame glue-compression bug. It
remains saved under `artifacts/beamer-fuzz/nested-description-display/cases/`.
