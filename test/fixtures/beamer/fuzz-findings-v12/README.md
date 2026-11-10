# Parent labels and nested list entry skips

The cases exercise a scoped smaller fraction
before a parent item that begins with a nested list, with and without columns,
projected labels, and frame shrinking. Their independent traces are saved.

LaTeX's `@trivlist` sees the parent's pending label and sets `@noparitem`.
The child's first `@item` then takes `@donoparitem`, which does not insert the
child's topsep. The parent's item boundary remains. Ordinary itemsep masked this
error; shrinking, which zeros it, exposed the otherwise spurious 2pt skip.
