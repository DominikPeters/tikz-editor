# Complete original campaign: seed 20261106

All 22 original frames and 40 overlay states pass strict live LuaLaTeX structural
and paint checks in `artifacts/beamer-fuzz/original-20261106-post-gates-live`. Every
source is byte-identical to its original saved campaign input (SHA-256 checked).

Each selected frame has its own source/oracle filename so multi-frame documents
retain preceding macro definitions and redefinitions without overwriting another
frame's reference. These full compositions complement the reduced regressions.
No original failure source or tolerance was removed.
