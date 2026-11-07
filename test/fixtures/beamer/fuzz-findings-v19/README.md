# Original composed nested-flow acceptance case

The complete first frame from seed 20261107 case 0000 passes every one of its
five states in `artifacts/beamer-fuzz/closed-nested-flow-live`, including live
raster/paint checks. This preserves the original multi-frame source, macro
scopes/redefinitions, nested lists and columns, display equations, shrinking,
transformed TikZ paths and nodes, blocks, and covered/removed overlays.

It is an acceptance case in addition to reductions. All 61 original frames now pass live checks;
their failure history remains tracked separately in the failure ledger.
