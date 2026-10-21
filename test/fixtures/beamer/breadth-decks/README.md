# Original Beamer breadth decks

Twelve original decks, with 111 authored source frames and 157 compiled PDF
pages. Each has its own subject, theme, audience and presentation method. These
are substantial examples for discovery and future fidelity work, rather than
minimal reproductions or copied lecture slides. They deliberately include valid
package interfaces that the native renderer cannot yet reproduce.

| Deck | Style and format | Presentation approach | Selected content and interfaces |
| --- | --- | --- | --- |
| [NVIDIA FY2025](01-nvidia-performance.tex) | Madrid/seahorse, 11pt, 16:9 | Executive briefing: headline, evidence, sensitivity, actions | KPI columns, financial table, PGFPlots bars, footnote, bibliography |
| [Logic](02-logic-proof-clinic.tex) | CambridgeUS/dove, serif, 12pt, 4:3 | Proof clinic: try, construct, inspect a mistake, transfer | Nested lists, contents, `bussproofs`, numbered theorem/proof, custom macro |
| [Machine learning](03-ml-selective-prediction.tex) | Metropolis, Fira, 10pt, 16:9 | Experiment-led reading group | Risk–coverage curves, equations, subgroup reveal with `overprint`, footnote |
| [Algorithms](04-algorithms-dijkstra.tex) | Warsaw, 11pt, 4:3 | Trace an algorithm, then justify its invariant | Weighted TikZ graph, overlay table, fragile Python listing, counterexample |
| [Fluid dynamics](05-fluid-channel.tex) | Berkeley sidebar/dolphin, 11pt, 16:9 | Observation → assumptions → derivation → falsification | Channel schematic, boundary conditions, integrals, `siunitx`, units |
| [General relativity](06-relativity-clocks.tex) | Moloch with navy headers, 11pt, 16:9 | Operational thought experiment before geometric notation | Clock diagram, decorated path, tensor indices, subtitles, plain closing frame |
| [Quantum information](07-quantum-predict-observe.tex) | Boadilla/orchid, 12pt, 4:3 | Predict–observe–explain with an intervention | `quantikz`, `braket`, matrices, stable `overlayarea`, Bell circuit |
| [Category theory](08-category-products.tex) | Pittsburgh, violet, 10pt, 4:3 | Example → universal interface → uniqueness → transfer | Fragile `tikz-cd` diagrams, definitions, proof, hom-set naturality square |
| [Organic chemistry](09-organic-electrons.tex) | Darmstadt/rose, red accents, 11pt, 16:9 | Mechanism workshop: inspect, draw, compare, defend | `chemfig`, `mhchem`, curved arrows, qualitative energy landscapes |
| [Distributed systems](10-distributed-timeout.tex) | Singapore/whale, 10pt, 16:9 | Incident review: reconstruct observations before assigning guarantees | Sequence diagram, quorum inequality, retry listing, action table |
| [Ecology](11-ecology-restoration.tex) | AnnArbor/spruce, 11pt, 16:9 | Research seminar: estimand, design, uncertainty, next study | Local raster asset, cropped image, subfigures, error bars, difference in differences |
| [Numerical analysis](12-numerical-debugging.tex) | Rochester/beaver, 14pt, 16:10 | Debugging lab: reproduce, diagnose, repair, validate | Fragile listings, `alltt`, operators, internal button/link, explicit continuation |

The decks also cross section/subsection navigation, titlepages before and after
content, command-form `maketitle`, automatic modern-theme section pages,
progress bars, speaker notes, pauses, absolute and incremental overlays,
columns, descriptions, captions, references, appendices and class sizes.
`manifest.json` records the per-deck coverage and is directly readable by the
existing corpus runner.

## Data and source provenance

All prose, examples, diagrams, code sketches and presentation sequences are
original fixtures under the repository's MIT license. Links identify background
reading; no source slides, photographs or logos have been copied.

- **NVIDIA:** historical FY2025 GAAP results come from the company's
  [26 February 2025 earnings release](https://nvidianews.nvidia.com/news/nvidia-announces-financial-results-for-fourth-quarter-and-fiscal-2025).
  Amounts are labeled USD billions, converted from reported millions. The
  concentration calculation and sensitivity identity are explicitly distinguished
  from reported facts. The deck is an educational case, not an NVIDIA presentation.
- **Logic:** [Pfenning's natural-deduction notes](https://www.cs.cmu.edu/~fp/courses/15317-f17/lectures/02-natded.pdf)
  provide background. The constructions and exercises here are original.
- **ML:** [Calibrated Selective Classification](https://arxiv.org/abs/2208.12084)
  is further reading. Every plotted point and comparison table is invented;
  no paper's experimental results are reproduced.
- **Algorithms:** [MIT 6.006, Lecture 16](https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-fall-2011/resources/mit6_006f11_lec16/)
  is background. The graph, trace and implementation sketch are original.
- **Fluids:** [Tong's Fluid Mechanics](https://davidtong.org/teaching/fluid-mechanics/)
  is background. Channel dimensions and numerical inputs are teaching examples;
  the solution is derived from the stated idealized assumptions.
- **Relativity:** [Tong, Geodesics in Spacetime](https://www.damtp.cam.ac.uk/user/tong/gr/grhtml/S1.html)
  is background. The deck states its signature, weak-field approximation and
  stationary-clock assumptions; its sketch is not observational data.
- **Quantum:** [IBM Quantum Learning](https://quantum.cloud.ibm.com/learning/en/courses/basics-of-quantum-information/single-systems/introduction)
  is further reading. Probabilities are ideal Born-rule predictions, not hardware counts.
- **Categories:** [MIT's adjunction lecture](https://math.mit.edu/~larsh/teaching/S2005/l12/)
  is a next reading after this original product construction.
- **Chemistry:** [MIT Organic Chemistry I, lectures 13–15](https://ocw.mit.edu/courses/5-12-organic-chemistry-i-spring-2003/pages/calendar/)
  provide background. Energy curves are qualitative, not measured values.
- **Systems:** [Ongaro and Ousterhout's Raft paper](https://raft.github.io/raft.pdf)
  provides background. The incident, times and retry sketch are invented; the
  sketch is not a consensus protocol implementation.
- **Ecology:** all observations, intervals and maps are synthetic, with no real
  site or research team represented. The map's color index and illustrative
  contrast table are separate teaching constructions, not a fitted dataset.
- **Numerics:** [Goldberg's floating-point article](https://docs.oracle.com/cd/E19957-01/806-3568/ncg_goldberg.html)
  provides background. Code examples state their binary64 assumptions and use an
  explicit left-to-right loop rather than depending on a language's `sum` implementation.

`assets/river-transects.svg` and its PNG are local, original assets. Recreate them
with `node scripts/generate-beamer-breadth-assets.mjs` (requires `rsvg-convert`).
The generator uses fixed analytic values; no random seed, network or private
file is needed. The PNG is checked in so compiling the decks needs no asset build.

## Build and inspect

From the repository root:

```sh
npm run check:beamer-breadth
npm run render:beamer-breadth
npx vitest run test/beamer-breadth-fixtures.spec.ts
```

The independent check compiles each complete document twice with LuaLaTeX,
checks physical page counts and first/last content witnesses, and makes every
page available as a PNG. It writes PDFs, logs, source/asset hashes and an HTML
gallery to `artifacts/beamer-breadth-decks/tex/`. It requires LuaLaTeX and Poppler's
`pdfinfo`, `pdftotext` and `pdftoppm`. Validation used TeX Live 2025 with the
packages listed in each preamble, including the two modern themes and their fonts.

One known TeX warning is retained: stock Metropolis's full-paper-height title
minipage produces a 13.79993pt overfull vertical box in this 10pt title frame.
The titlepage was visually inspected and is not clipped. The check reports box
warnings explicitly; it does not hide them or mistake them for compile failures.

For just one deck, use a separate output directory:

```sh
npm run check:beamer-breadth -- --deck quantum --out-dir artifacts/beamer-breadth-quantum
npm run render:beamer-breadth -- --deck category --out-dir artifacts/beamer-breadth-category
```

The native census writes its own SVG gallery and diagnostics to
`artifacts/beamer-breadth-decks/native/`. The smoke tests render every discovered
frame, overlay and continuation without requiring unsupported packages to become
faithful. Native completion and empty diagnostic lists are not fidelity scores.

There are three distinct page denominators:

- TeX executes **157 pages**, including six automatically generated section
  frames from Metropolis/Moloch and the numerical deck's continuation page.
- The native census discovers **111 authored source frames** and renders **150
  frame/overlay states**. Its existing sampling API emits one continuation at a time.
- The smoke tests use `renderFramePages` and cover **151 native pages**, including
  the second continuation. The six generated section frames are an explicit
  scanner boundary, not silently counted as compared pages.

The initial inventory is recorded in
[`design/beamer-breadth-decks-baseline.json`](../../../../design/beamer-breadth-decks-baseline.json).
It preserves package/color-theme diagnostics, literal markers and discovery
boundaries. No failing native output is accepted as a fidelity golden.
To begin paired investigation using the existing comparison harness:

```sh
npm run render:beamer-breadth -- --mode compare --frames 3 --steps first,last \
  --timeout-seconds 300 --out-dir artifacts/beamer-breadth-decks/compare
```

Expect strict mismatches for unsupported interfaces. Reduce those to focused
campaign cases and valid TeX oracles before changing production behavior.

The completed [LuaLaTeX gap audit](../../../../design/beamer-breadth-decks-lualatex.md)
covers all 150 discovered frame/overlay states and the extra continuation page.
It records ordinary Beamer gaps separately from unsupported package interfaces
and comparison-trace limitations. Its final paired artifacts are under
`artifacts/beamer-breadth-decks/lualatex-audit/`, with the continuation under
`lualatex-continuation/`. The audit fixed early font-outline loading and
isolated `maketitle`/contents probes; preliminary `compare/` and interrupted
`compare-all/` artifacts predate those repairs.
