# Active table baseline registers

These controls pass strict live LuaLaTeX checks in `artifacts/beamer-fuzz/v22-live`.
Table row struts retain the active implicit list baseline or an explicit
fontsize/baseline selection. The initial paragraph baseline enters inline font
state; later declarations still take effect at their actual source position.
