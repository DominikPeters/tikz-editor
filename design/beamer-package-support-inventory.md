# Package support inventory from the Beamer breadth decks

This is a decision inventory, not a commitment to implement every package.
The requested Beamer fixes are separate. Package interfaces below remain
unchanged while we choose a support boundary. The accompanying
[`JSON inventory`](beamer-package-support-inventory.json) records every source
frame and span. Counts are authored frames, not overlay pages, and overlap.

| Interface | Frames / decks | Actual interfaces exercised | Current result | Bounded native implementation |
| --- | --- | --- | --- | --- |
| `pgfplots` | 3 / 3 | Cartesian `axis`, explicit coordinates, `ybar`, markers/lines, a constant/domain plot, major grids, ticks/labels, legends, error bars | Charts disappear; TikZ parser reports syntax/unsupported statements | A typed Cartesian plot model, axis layout and native paths; explicitly exclude arbitrary PGF keys, statistics, 3D, external data and package macros initially. Large effort, highest cross-deck chart payoff. |
| `listings` | 4 / 3 | Fragile `lstlisting`, Python language option, indentation, punctuation and blank lines | Unsupported flow cards | A verbatim block with exact whitespace, monospaced metrics, explicit sizing and basic listing options. Syntax colors can follow. Medium effort; useful beyond Beamer. |
| `alltt` | 1 / 1 | Fixed-width preformatted diagnostic report | Unsupported flow card | Preformatted text with TeX escapes retained, distinct from verbatim/listings. Small-to-medium effort; reuse whitespace-preserving block layout. |
| `siunitx` | 1 / 1 | `\SI`, decimal/scientific numbers, `\milli`, `\metre`, `\pascal`, `\second`, `\per`, `\squared` | Literal macros and reflow | Parse numbers and a typed unit-expression tree, then typeset with spacing and roman units. Small-to-medium for these forms; full localization, uncertainty, `S` columns and package options are separate decisions. |
| `braket` | 6 / 1 | `\ket{...}` and unbraced single-token `\ket0`, `\ket\psi` | Literal command fragments inside otherwise rendered mathematics | Source-preserving math expansion to correctly sized delimiters. Small for `\bra`, `\ket`, `\braket`; automatic sizing and set-builder variants require explicit tests. |
| `mhchem` | 2 / 1 | `\ce` species, subscripts, charges and reaction arrows | Literal formulas, including in TikZ labels | Chemical-expression parser producing math/text runs. Medium; reaction conditions, isotopes, stoichiometry and package syntax extend the grammar considerably. |
| `chemfig` | 1 / 1 | `\chemfig{CH_3-CH_2-Br}` | Literal molecule source | Even this simple case needs a bond/atom graph frontend and chemical label layout. Medium for linear molecules, large for the full package (branches, rings, stereochemistry, schemes and hooks). Avoid calling a linear subset “chemfig support.” |
| `bussproofs` | 2 / 1 | `prooftree`, `\AxiomC`, `\UnaryInfC`, `\BinaryInfC`, `\RightLabel` | Unsupported flow cards | A proof-tree model with rule widths, premise spacing and math labels. Medium and reasonably self-contained; package-wide formatting switches are additional scope. |
| `quantikz` | 2 / 1 | Matrix cells, `\lstick`, `\gate`, `\meter`, `\ctrl`, `\targ`, `\qw` | Unsupported flow cards | Circuit grid with wires, gates, controls and math labels. Medium-to-large; reusable geometry differs from general TikZ matrices. Multiwire gates, slices, bundles and arbitrary TikZ styling need a later boundary. |
| `tikz-cd` | 3 / 1 | Matrix cells, `\arrow[d...]`, quoted labels, row/column separation, dashed unique arrows | Literal environment/arrow source | Commutative-diagram grid and semantic edges, reusing native TikZ routing/labels where possible. Medium-to-large; arbitrary matrix styles, crossings and package macros remain outside a first subset. |
| `subcaption` | 1 / 1 | Two `subfigure` minipages, local images, per-panel captions, outer caption, `\hfill`, trim/clip | Unsupported subfigure cards despite resolved assets | Figure-composition frontend with counters and label/font rules. Medium; asset loading and ordinary graphicx are already separate existing capabilities. |

## Decision options

1. **Staged native support (recommended).** Start with `braket`, the observed
   `siunitx` forms, whitespace-preserving listings/`alltt`, and subfigures.
   These reuse existing math, text and image layout. Then choose a second
   tranche: bounded Cartesian PGFPlots for broad chart use, or proof trees and
   diagram grids for mathematical teaching. Each needs its own syntax contract,
   unsupported-interface diagnostics and independent TeX fixtures.
2. **Native coverage of every observed interface.** Implement explicitly named
   subsets for all eleven rows. This exercises every breadth deck, but plot,
   chemistry and matrix/circuit frontends form several substantial projects.
   The fixture vocabulary must not become an implicit claim of full package
   compatibility.
3. **TeX-backed package islands.** Compile opaque unsupported regions using an
   actual TeX engine and embed their painted result. This can cover much more
   package syntax, but requires a decision about engine availability, browser
   execution/service architecture, latency, asset resolution, caching,
   isolation and editing opaque content. It is not currently a portable
   drop-in substitute for the native pipeline.

My proposed first tranche is option 1. I would keep unsupported complex
package input visible with package-specific diagnostics, rather than send it
to the ordinary TikZ statement parser. No new package support or TeX-runtime
dependency is introduced by this inventory.

## Acceptance criteria after a decision

- Name supported commands, options and composition contexts explicitly.
- Keep source provenance through any lowering into math, text or scene graphs.
- Diagnose unsupported options and macros at the package boundary; avoid
  silently dropping a chart or disguising valid package input as malformed TikZ.
- Compare independent LuaLaTeX references for layout, paint, overlays and source
  mapping. Include adversarial valid examples beyond these twelve decks.
- Record capability changes and boundaries together in the capability matrix.

The installed TeX Live 2025 package sources and the original fixture preambles
are the semantic references for this inventory. It describes observed syntax;
it does not infer compatibility from merely recognizing a package name.

## Accepted first stage

The user accepted the recommended first tranche. Its implemented boundary and
independent checks are recorded in [First Beamer package tranche](beamer-package-frontends.md).
The table above preserves the pre-implementation audit; the remaining package
rows still require a support decision.
