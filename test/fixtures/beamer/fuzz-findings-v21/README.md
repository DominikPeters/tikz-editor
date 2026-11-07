# Composed display-column acceptance cases

Both original first frames (seed 20261107 cases 0004 and 0007) pass every state
in `artifacts/beamer-fuzz/v21-live`, with live raster/paint checks. The complete
multi-frame sources are retained. They cover scoped fonts/alignment, display
math, nested/covered columns, tables, TikZ, macros and shrinking. These acceptance
cases supplement V20's smaller column-display controls.
