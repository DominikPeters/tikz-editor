# First Beamer package tranche

The first stage of the [package inventory](beamer-package-support-inventory.md)
adds native, source-backed frontends for the agreed small interfaces. It does
not add a TeX runtime or claim complete compatibility with these packages.

## Supported boundary

- Math: fixed `\bra`, `\ket`, `\braket`, including single unbraced tokens,
  and scalable `\Bra`/`\Ket`. These use math atoms and retain argument spans;
  delimiters own the original command. `\Braket`, `\set`, `\Set` and automatic
  middle delimiters remain outside this tranche.
- Beamer body quantities: `\SI`, `\si`, `\num` with default decimal or
  `e`-notation input and named products/reciprocals. Supported unit controls are
  metre/meter, pascal, second, gram/kilogram, ampere, kelvin, mole, hertz,
  newton, joule, watt and volt; prefixes are milli/kilo/centi/nano; powers are
  squared/cubed. `\per` affects the next unit, as in the package defaults.
  Units use upright text and generated glyphs own their source factors.
  Configuration, explicit options, uncertainty, grouping, locale, micro and
  `S` columns remain unsupported. The initial decimal subset allows up to four
  integer and fractional digits. Leading-dot, explicit-plus, negative-zero and
  grouped forms receive a package diagnostic and remain visible.
- `lstlisting`: fullflexible typewriter columns, named font sizes, spaces,
  indentation, tabs, blank lines and literal TeX punctuation. Python has basic
  keyword, comment and single-line string styles (strings with spaces require
  `showstringspaces=false`). Recognized styling is bounded to simple font declarations and named colors. Unsupported languages, options,
  styles and multiline Python strings retain visible fallback and a listing
  diagnostic. Line numbers, listing frames, wrapping and escape modes remain outside this
  subset. `alltt` shares preformatted line layout while retaining TeX controls
  and groups. The edit tree keeps listing code literal and alltt controls
  structural.
- `subcaption`: a row of bottom-aligned panels with explicit widths, one
  numbered caption per panel, local images, `\hfill`, and an outer figure
  caption. Existing graphicx asset resolution and trim/clip are reused. Panel
  labels reset per figure; short captions center and long captions wrap ragged
  right. Other alignments, starred panel captions and custom caption settings
  are explicitly outside this subset.

The implementation follows the installed TeX Live 2025 `braket.sty`,
`siunitx.sty`, `listings.sty`, `alltt.sty`, `subcaption.sty`, `caption3.sty`
and the Beamer caption adapter. Package defaults, rather than the breadth
fixture vocabulary alone, determine spacing and atom classes.

## Verification

The [wave-four fixtures](../test/fixtures/beamer/fidelity-campaign-wave4/cases.json)
include reductions of the observed forms and independent stress cases: serif
12pt nested notation, TeX-looking listing code, punctuation, surrounding prose,
unequal image widths, wrapped captions, clipped images, and alltt within
columns and blocks. The former alltt recognition cases are promoted to native
fidelity fixtures; verbatim now exercises their unsupported-source-card
contracts. The existing strict LuaLaTeX contracts check page counts, line content, glyph positions, font faces,
font sizes, transforms and rectangle edges. Their tolerances are unchanged.

Source ownership, literal typing, balanced alltt controls and unsupported-option
tests accompany the comparisons. Unsupported listings still use bounded source
cards and retain their surrounding supported paragraphs.
Explicit size and color selections are retained by Roman and Fira font profiles.
Cropped images are traced by their painted SVG viewport, instead of comparing
the intrinsic raster dimensions to a cropped TeX image box. That harness fix
has a separate regression test.

The full breadth decks retain failures from other package interfaces and other
layout details. A diagnostic-free page remains a coverage observation, not a
fidelity score. PGFPlots, chemistry, proof trees, circuits and commutative
diagrams await a separate support decision. Dirac macros inside an unsupported
Quantikz circuit remain part of that circuit’s source card; supporting the math
macro does not imply rendering its parent package.

All **11 new cases** pass live LuaLaTeX comparison and are pinned independently.
The largest glyph deltas are 0.007445pt horizontally and 0.001401pt vertically;
the largest rectangle-edge delta is 0.007003pt. All **115 campaign cases**
(118 physical states) pass offline. The selected **13 package-bearing breadth
frames** pass coverage checks across all their native pages, with deferred
Quantikz cards preserved. The serif caption and cropped-image pairs were also
visually inspected.

The [machine-readable acceptance record](beamer-fidelity-campaign-wave4-results.json)
records hashes and validation. The [live paired gallery](../artifacts/beamer-fidelity-campaign/wave4/index.html)
retains the independent reference PDFs and native output. A partial concurrent
whole-deck run hit timeouts and was stopped; it contributes no fidelity score.

Final validation: 7,472 repository tests, 115 pinned campaign cases and 13
breadth-coverage cases passed (7,600 total; 20 skipped, one todo). Full
typechecking, production lint and whitespace checks passed. The repository
suite used two workers to avoid the contention of the initial concurrent run.
