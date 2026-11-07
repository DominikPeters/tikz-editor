# Active font quad at the short-display threshold

Reduced from newer original case 0009. The three controls place a matrix
inside a nested list at widths just below/above the normal-versus-short display
skip threshold. The comparison must use the active list font's quad, including
restored font selections, rather than the enclosing frame's font.

All three pass live LuaLaTeX structural and paint checks in
`artifacts/beamer-fuzz/v34-verified-live`. The original case now passes saved
traces; full live closure remains required. An earlier live attempt failed to
load the renderer while two dist builds overlapped and is not fidelity evidence.
