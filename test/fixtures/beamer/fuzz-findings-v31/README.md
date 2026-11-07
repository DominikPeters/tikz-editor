# Beamer item font registers and display cleanup

The six controls cover default smaller list fonts, explicit font size/baseline
selection, normalsize/footnotesize changes, a continuing parent list, plain versus
visible-wrapped displays, and a covered pending ancestor marker. All overlay
states pass live LuaLaTeX geometry and paint checks in
`artifacts/beamer-fuzz/v31-live`.

List font declarations must update display registers, while explicit fontsize
keeps the active registers. Environments restore font state; Beamer actionenv
also restores it at each item boundary. A wrapper's closing spacing action can
start a paragraph where a plain next-item transition does not. Pending labels
paint under their consumer's visibility, while retaining original source owners.
