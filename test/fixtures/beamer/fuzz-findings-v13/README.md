# Shrinking blocks inside items

Both themed controls pass strict live LuaLaTeX checks in
`artifacts/beamer-fuzz/v13-live`, with pinned source-hash checked traces.

A block prepared as an external box inside an item must receive the widened
text width selected by Beamer's shrink option. Using the original page text
width shifts its centered text and changes wrapping. Its leading center
trivlist also inherits the minipage's suppression of the initial topsep.

All original full compositions now pass live checks; their failure history
remains in `design/beamer-failure-ledger.json`.
