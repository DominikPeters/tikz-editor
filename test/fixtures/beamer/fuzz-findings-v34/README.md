# Active font quad at the short-display threshold

Reduced from newer original case 0009. The three controls place a matrix
inside a nested list at widths just below/above the normal-versus-short display
skip threshold. The comparison must use the active list font's quad, including
restored font selections, rather than the enclosing frame's font.

An earlier live attempt failed to
load the renderer while two dist builds overlapped and is not fidelity evidence.
