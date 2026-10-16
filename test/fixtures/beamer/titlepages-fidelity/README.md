# Titlepage conformance

Each `.tex` document has a source-hashed `.oracle.json` containing normalized
LuaLaTeX page traces. `test/beamer-titlepage-fidelity.spec.ts` compares native
text, font metrics, line breaks and TeX rules to these traces within 0.001pt.

Regenerate with TeX Live's Beamer, Metropolis and Moloch packages installed:

```sh
node scripts/regenerate-beamer-titlepage-oracles.mjs
```

Pass fixture stems to regenerate selected documents, for example:

```sh
node scripts/regenerate-beamer-titlepage-oracles.mjs moloch metropolis
```

Metropolis fixtures explicitly restore Latin Modern Sans after loading the
theme, so the comparison isolates template geometry and the renderer's current
font substitution. They do not assert support for native Fira fonts. PGF path
paint (including separators and rounded shadows) is not represented as TeX
rules in these traces; verify it with the renderer comparison raster output.
