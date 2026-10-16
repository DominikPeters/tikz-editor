# Beamer breadth gap fixes

The ordinary Beamer gaps from the [LuaLaTeX breadth audit](beamer-breadth-decks-lualatex.md)
now have focused independent reference tests. Specialist package rendering is
reserved for the [support inventory and decision](beamer-package-support-inventory.md).

## Implemented

- Infolines footlines include the short author, institute and date, using the
  template's actual centering and fill glue, including the total-counter box's
  reserved width on single-digit pages of longer decks. Sidebar metadata includes a wrapped
  short author and computes navigation placement from the painted metadata.
- Notes remaining after extracted columns/blocks no longer trigger visible
  unsupported-content cards. A notes-only frame stays empty.
- Default section/subsection contents and numbered-ball contents follow the
  stock vertical packing, indentation and marker geometry. The
  `hideallsubsections` and `hideothersubsections` filters are supported; other
  options produce a specific diagnostic.
- Standalone `\centering` and `\raggedright` affect following extracted pictures
  and paragraphs without adding a spurious text line or center-environment glue.
- Fixed `overlayarea` boxes retain their requested height across alternatives,
  including prose, inline mathematics and lists. Their top minipage and outer
  strut follow `beamerbaseoverlay.sty`; transformed minipages inherit the class's
  list profile. Edit-tree schemas preserve the newly rendered source's caret
  positions. An additional `tikzcd` source-editing schema preserves existing
  literal fallback carets; it does not render commutative diagrams.
- Metropolis/Moloch progress uses independent foreground/background colors with
  deferred color inheritance. The foot position paints its progress bar and
  reserves its 0.4pt height in layout, including when numbering is disabled.
- Dove's monochrome roles and bold alerts, serif font-theme options and
  `professionalfonts` math selection are registered. The Beamer font profile
  selects Latin Modern Roman optical sizes according to `tulmr.fd`; missing
  faces were generated from the installed font sources. Generic text-profile
  selection is unchanged.

## Independent verification

The [wave-three manifest](../test/fixtures/beamer/fidelity-campaign-wave3/cases.json)
contains 18 cases and 20 physical states. All pass the existing independent
LuaLaTeX geometry contract. Three modern progress cases also pass flat-fill RGB
probes. Their 0.4pt bars use a 6400px raster to contain the existing 3×3 probe;
no geometry or color tolerance was relaxed.

The passing live run and visual pairs are at
[`wave3/index.html`](../artifacts/beamer-fidelity-campaign/wave3/index.html).
Only its independent TeX traces were pinned. All 104 cases across the three
campaign waves pass offline, alongside the targeted notes/TOC-option/paint
boundary tests and capability consistency checks. Representative numbered-ball
contents and list-overlay pairs were also visually inspected.

## Remaining boundaries

The full breadth decks deliberately contain additional unsupported material;
the focused successes are not an overall fidelity score. Eleven package
interfaces have source-frame/span inventories and proposed bounded support
contracts. No package-rendering frontend or TeX runtime dependency was added.

Arbitrary contents options/templates, figure-contained picture composition,
generated modern-theme section-hook frames, general continuation geometry,
and the audit's other math/block/title details remain separate gaps. Explicit
metadata is covered here; implicit current-date expansion is not a new promise.

## Whole-deck recheck

A fresh run compared all 150 authored frame/overlay states in the same twelve
unchanged sources. A final correction to the reserved total-counter width then
rechecked all 25 states in the affected logic and ecology decks. Using the
latest result per deck, strict structural matches increased from **2 to 34**;
none of the two prior matches regressed. Diagnostic-free pages increased from
104 to 134. Empty diagnostics do not establish fidelity. Package input still
produces unsupported or literal fallback output in the remaining decks.

The [machine-readable result](beamer-fidelity-campaign-wave3-results.json)
records source/report hashes, per-deck transitions and diagnostics. The
[fresh paired gallery](../artifacts/beamer-breadth-decks/fixes/index.html)
retains all failures; final [logic](../artifacts/beamer-breadth-decks/fixes-final-logic/index.html)
and [ecology](../artifacts/beamer-breadth-decks/fixes-final-ecology/index.html)
rechecks carry the counter-width correction. No failing whole-deck page became
a golden. This recheck
covers the 150 authored states. It does not re-evaluate the separate extra
continuation, and the six generated section pages remain undiscovered.

Final validation: 7,550 repository tests passed (20 skipped, one todo). After
the final footer correction, 995 Beamer/capability tests passed (six skipped),
including all 104 pinned campaign cases. Production lint, full typechecking
and whitespace checks passed.
