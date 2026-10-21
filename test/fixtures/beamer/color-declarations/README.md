These small original preamble cases exercise Beamer color declaration order,
parent lists, empty fields, star resets, dynamic theme roles, and xcolor
definition/alias order. `colors.oracle.json` stores the color models and
specifications obtained by LuaLaTeX's actual `\usebeamercolor*` and
`\extractcolorspecs` commands. No native renderer values construct the oracle.

Regenerate from the repository root with LuaLaTeX/Beamer available:

```sh
node test/fixtures/beamer/color-declarations/capture-oracles.mjs
```

The script reuses `scripts/lib/tex-oracle.mjs`; its temporary TeX files are
removed after compilation. `\usebeamercolor*` establishes normal-text fallback
before querying each role, so an intentionally empty field is compared with
that effective fallback. The source hash pins the declarations and role list.

Support is limited to authored preamble declarations. Local body/group
assignments, macro-expanded declarations, contextual current-color expressions
and optional target-model conversions are outside this suite.
