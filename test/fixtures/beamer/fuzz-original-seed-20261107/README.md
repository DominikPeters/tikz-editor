# Complete original campaign: seed 20261107

All 39 original frames and 81 overlay states pass strict live LuaLaTeX structural
and paint checks in `artifacts/beamer-fuzz/original-20261107-final-live`. Every
source is byte-identical to its original saved input (SHA-256 checked).

Each selected frame has a unique source/oracle filename to retain multi-frame
macro definitions and redefinitions without overwriting references. These full
compositions complement the reduced regressions, with unchanged contracts.
