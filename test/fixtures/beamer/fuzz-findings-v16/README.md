# Explicit paragraph before display and columns

Both cases pass strict live LuaLaTeX structural and paint checks in
`artifacts/beamer-fuzz/v16-live`. Source-hash-checked traces are pinned.

After prose ends with an explicit paragraph break, a display begins a new empty
paragraph even inside an existing vertical list. The renderer previously only
modeled this when a display was the first item. The resumed display baseline
must also subtract the preceding line's depth. Tables in centered columns and
following prose expose accumulated boundary errors; the no-display case is a
negative control.
