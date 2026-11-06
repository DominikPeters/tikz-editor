# Aliased declarations across frame flow

`aliased-macro-across-flow.tex` is a fixed follow-up to the source-ordered macro
findings. Calling `\change`, an alias of `\renewcommand`, inside a frame changed
the first paragraph to `ticks` but left the block and following paragraph at
`ms`. The point-context optimization only looked for literal declaration names
in the frame body. It now also accounts for inherited callable declarations.

The independent LuaLaTeX check failed with two missing/mismatched text lines
before the fix and passes the unchanged strict gates afterwards. Its frozen
trace participates in the passing fidelity campaign. The unit regression also
renders frames out of order and checks restoration outside the earlier frame.
