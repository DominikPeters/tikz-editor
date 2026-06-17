# MathJax TeX Corpus Slices

This note records stable slices of the MathJax TeX testsuite that are useful while implementing the TeX-derived math renderer. The slice definitions live in `scripts/mathjax-tex-corpus-slices.json`; this document records why the slices exist and the current extracted counts.

The corpus is extracted from `examples/mathjax-src/testsuite/tests/input/tex` with:

```sh
npm run extract:mathjax-tex-corpus
```

Coverage for a stable slice is checked with:

```sh
npm run check:mathjax-tex-corpus -- --slice core-baseline
```

## Full Corpus

Current extraction from 45 MathJax TeX test files:

| Count | Meaning |
| ---: | --- |
| 2,937 | total extracted TeX snippets |
| 2,676 | render snippets |
| 261 | expected-error snippets |
| 997 | clean LuaLaTeX-oracle fixture candidates |
| 1,546 | package or feature coverage inventory |
| 328 | parser diagnostic cases |
| 66 | explicit unsupported or non-LaTeX-ish cases |

## Slices

| Slice | Files | Total | LuaLaTeX candidates | Inventory | Diagnostics | Explicit unsupported | Use |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `core-baseline` | 3 | 1,279 | 889 | 268 | 122 | 0 | Broad first-pass development corpus: Base, AMS, Mathtools. |
| `latex-oracle-candidates` | 45 | 997 | 997 | 0 | 0 | 0 | All current clean oracle candidates. |
| `extra-oracle-candidates` | 8 | 108 | 108 | 0 | 0 | 0 | Oracle-like snippets outside Base/Ams/Mathtools. |
| `display-environments` | 7 | 209 | 67 | 121 | 21 | 0 | Display environments, tagging, cases, proof/table extensions. |
| `font-symbol-text` | 9 | 295 | 24 | 256 | 15 | 0 | Font alphabets, text-in-math, Unicode, symbol tables. |
| `macro-diagnostics` | 8 | 244 | 15 | 99 | 129 | 1 | Macro expansion and diagnostic policy. |
| `extension-inventory` | 7 | 821 | 0 | 798 | 23 | 0 | Package-extension discovery, not a first exact-LaTeX target. |
| `html-color-action` | 7 | 87 | 0 | 4 | 18 | 65 | HTML/color/action behavior; mostly explicit unsupported scope. |

## Development Use

`core-baseline` should be the main development target until ordinary scripts, fractions, radicals, operators, delimiters, accents, arrays, and core display math are handled with high support.

`latex-oracle-candidates` is the next exactness gate: cases in this slice should eventually be rendered and compared against LuaLaTeX fixtures rather than MathJax snapshots.

`extra-oracle-candidates` is a low-noise way to expand fixture diversity once `core-baseline` is mostly supported.

The other slices are mainly roadmaps. They should not be treated as immediate exactness failures, because many entries depend on package-level commands, MathJax-only HTML/action constructs, or diagnostic-policy behavior.

## Current Coverage Snapshot

These counts come from `npm run check:mathjax-tex-corpus -- --slice <slice>` after adding display-environment-aware corpus validation for supported `equation`, `align`, `gather`, and `multline` wrappers.

| Slice | Entries | Supported | Supported % | Explicit unsupported | Parser error | Not applicable |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `core-baseline` | 1,279 | 492 | 38.5% | 707 | 80 | 0 |
| `latex-oracle-candidates` | 997 | 510 | 51.2% | 483 | 0 | 4 |
| `extra-oracle-candidates` | 108 | 60 | 55.6% | 44 | 0 | 4 |
| `display-environments` | 209 | 74 | 35.4% | 116 | 17 | 2 |
| `font-symbol-text` | 295 | 7 | 2.4% | 274 | 14 | 0 |
| `macro-diagnostics` | 244 | 9 | 3.7% | 166 | 62 | 7 |
| `extension-inventory` | 821 | 59 | 7.2% | 742 | 20 | 0 |
| `html-color-action` | 87 | 1 | 1.1% | 64 | 17 | 5 |

The dominant current failure classes are:

- Unsupported AMS/package control-sequence atoms and macros beyond the first vendored AMS font/operator slices, such as `\mathbbm`, `\boldsymbol`, and package commands like `\bra`.
- Display environment structure, such as `align`, `CD`, `numcases`, tags, labels, and multi-row alignment syntax.
- Macro expansion and scoping, such as `\def`, `\let`, `\newcommand`, `\begingroup`, and `\endgroup`.
- Diagnostic-policy gaps where MathJax expects an error but the current parser only reports unsupported-command warnings.

After adding renderable Computer Modern symbol/operator mappings, TeX-like single-token arguments for `\frac`, `\binom`, and `\sqrt`, standalone delimiter commands, `\colon`, control-space, long-arrow macro composites, first-class parser/layout support for `align`/`gather`/`multline` display environments, explicit amsmath-style diagnostics for invalid nested `align`/`gather` structures, TeX infix generalized fractions (`\over`, `\choose`, `\atop`, `\brack`, `\brace`, `\overwithdelims`, `\atopwithdelims`), absolute-dimension `\above`/`\abovewithdelims`, non-rendering alignment row metadata (`\label`, `\notag`, `\nonumber`), the first AMSa/AMSb glyph-family slice (`\digamma`, `\dotplus`, `\ulcorner`, `\urcorner`, `\lesssim`, `\gtrsim`, `\thickapprox`, `\Bbbk`, and related symbols), AMS multi-integral operators (`\iint`, `\iiint`, `\iiiint`, `\idotsint`), AMS multi-dot accents (`\dddot`, `\ddddot`), AMS extensible arrows (`\xleftarrow`, `\xrightarrow`), AMS prefix generalized fractions (`\genfrac`), AMS scriptstyle `subarray`, basic `\DeclareMathOperator`, TeX-like `xalignat` parser diagnostics, TeX-like `\genfrac` delimiter diagnostics, display-environment-aware corpus validation, and LaTeX-style single vertical rules in `array` preambles, `core-baseline` support rose from 232/1,279 to 492/1,279. Remaining high-frequency failures in that slice are now dominated by broader array/alignment environments (`eqnarray`, `flalign`, `xalignat`, starred matrix variants, and richer `array` preambles), broader AMS/package macro coverage, and package-specific diagnostics rather than plain Computer Modern symbol declarations. Two remaining MathJax diagnostic expectations intentionally disagree with the installed AMSMath source: explicit `\cfrac[c]` still centers, and integer `\genfrac` style argument `4` maps to `\scriptscriptstyle` through `\@mathstyle`, rather than producing errors.
