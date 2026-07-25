# @tikz-editor/lezer-tex

Reusable Lezer syntax parser for TeX.

The package intentionally contains syntax structure rather than TeX rendering
semantics. It exposes document, text-fragment, and math-fragment entry points so
the same concrete syntax tree can support the editor and core IR lowering.

The optional `beamer` dialect specializes Beamer commands and environment names
without creating a second TeX grammar.
