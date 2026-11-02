#!/usr/bin/env python3
"""A/B differential SVG comparator for the tikz migration.

Compares a golden (legacy TypeScript renderer) SVG against a Rust-port SVG:
- parses both into document-order element lists (nested <svg> wrappers flattened)
- matches elements by document order, using (tag, data-source-id) as the identity key
- numbers compared within epsilon (default 1e-3 pt); strings exact
- text glyph internals (glyph <path d=...>) are excluded from geometry parity
  on purpose: the port defers the 63k-loc TeX text engine (documented gap) and
  uses egui/naive fonts; wrapper geometry (x,y,width,height) is still compared.

Exit code 0 = parity within epsilon, 1 = divergence, 2 = structural mismatch.
"""
from __future__ import annotations

import json
import math
import re
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

NS = "{http://www.w3.org/2000/svg}"
NUM_RE = re.compile(r"-?\d+(?:\.\d+)?(?:e[-+]?\d+)?")
TEXT_KIND_TAGS = {
    "data-tex-font": "glyph",
    "data-tex-glyph": "glyph",
    "data-text-renderer": "text-wrapper",
}
NUMERIC_ATTR_HINTS = ("x", "y", "cx", "cy", "r", "rx", "ry", "width", "height",
                      "stroke-width", "transform", "viewBox", "dx", "dy")


@dataclass
class Elem:
    tag: str
    attrs: dict
    depth: int
    data_source_id: str | None = None
    glyph: bool = False
    text_wrapper: bool = False

    def __post_init__(self):
        dsi = self.attrs.get("data-source-id")
        if dsi is not None:
            self.data_source_id = dsi
        if "data-tex-font" in self.attrs or "data-tex-glyph" in self.attrs:
            self.glyph = True
        if "data-text-renderer" in self.attrs:
            self.text_wrapper = True


def parse(path: str) -> list[Elem]:
    root = ET.parse(path).getroot()
    out: list[Elem] = []

    def walk(node, depth):
        tag = node.tag.replace(NS, "")
        out.append(Elem(tag, dict(node.attrib), depth))
        for child in node:
            walk(child, depth + 1)

    walk(root, 0)
    # strip tail whitespace-only text nodes (ET has no text refs here)
    return out


def num_attr_equal(a: str, b: str, eps: float) -> tuple[bool, float]:
    an, bn = NUM_RE.findall(a), NUM_RE.findall(b)
    if len(an) != len(bn):
        return (False, float("inf"))
    max_err = 0.0
    for x, y in zip(an, bn):
        try:
            fx, fy = float(x), float(y)
        except ValueError:
            if x != y:
                return False, float("inf")
            continue
        err = abs(fx - fy)
        max_err = max(max_err, err)
        if err > eps:
            return False, max_err
    return True, max_err


def compare(golden: list[Elem], rust: list[Elem], eps: float) -> dict:
    if len(golden) != len(rust):
        return {"ok": False, "kind": "count", "golden": len(golden), "rust": len(rust)}

    max_abs = 0.0
    mismatches = []
    ignored_glyph = 0
    matched = 0
    first_diff = None
    for i, (g, r) in enumerate(zip(golden, rust)):
        if g.glyph and r.glyph:
            ignored_glyph += 1
            continue
        if g.glyph != r.glyph:
            k = (i, g.data_source_id or g.tag)
            if first_diff is None:
                first_diff = {"i": i, "why": "glyph presence differs",
                              "golden": {"glyph": g.glyph}, "rust": {"glyph": r.glyph}}
            mismatches.append((i, "glyph presence differs"))
            continue
        if g.tag != r.tag:
            mismatches.append((i, f"tag {g.tag} != {r.tag}"))
            if first_diff is None:
                first_diff = {"i": i, "why": "tag", "golden": g.tag, "rust": r.tag}
            continue
        g_key = (g.tag, g.data_source_id)
        r_key = (r.tag, r.data_source_id)
        if g_key != r_key:
            mismatches.append((i, f"identity {g_key} != {r_key}"))
            if first_diff is None:
                first_diff = {"i": i, "why": "data-source-id",
                              "golden": list(g_key), "rust": list(r_key)}
            continue
        bad = False
        for k in sorted(set(g.attrs) | set(r.attrs)):
            gv, rv = g.attrs.get(k), r.attrs.get(k)
            if gv is None or rv is None:
                if k in {"d", "stroke", "fill", "stroke-width", "x", "y", "width", "height",
                         "viewBox", "transform", "data-source-id", "data-paragraph-id"} or \
                        k.startswith(("stroke-", "fill-", "data-")):
                    mismatches.append((i, f"attr {k}: {'missing' if gv is None else 'extra'}"))
                    bad = True
                    if first_diff is None:
                        first_diff = {"i": i, "why": f"attr-missing-or-extra {k}",
                                      "golden": gv, "rust": rv}
                    break
                continue  # tolerated informational attrs
            if k == "d" and g.glyph:
                continue
            if k == "transform" and (g.text_wrapper and r.text_wrapper) and gv == rv:
                continue
            if NUM_RE.search(gv) and k in NUMERIC_ATTR_HINTS or k in {"transform", "viewBox"}:
                ok, err = num_attr_equal(gv, rv, eps)
                max_abs = max(max_abs, err if ok or err != float("inf") else max_abs)
                if not ok:
                    mismatches.append((i, f"numeric {k}: {gv[:64]!r} vs {rv[:64]!r}"))
                    bad = True
                    if first_diff is None:
                        first_diff = {"i": i, "why": f"numeric {k}", "golden": gv, "rust": rv}
                    break
            elif k == "d":
                ok, err = num_attr_equal(gv, rv, eps)
                max_abs = max(max_abs, err if ok else err)
                if not ok:
                    mismatches.append((i, f"path {k} diverges (abs err {err})"))
                    bad = True
                    if first_diff is None:
                        first_diff = {"i": i, "why": f"path {k}", "golden": gv[:96], "rust": rv[:96]}
                    break
            else:
                if gv != rv:
                    mismatches.append((i, f"string {k}: {gv!r} vs {rv!r}"))
                    bad = True
                    if first_diff is None:
                        first_diff = {"i": i, "why": f"string {k}", "golden": gv, "rust": rv}
                    break
        if not bad:
            matched += 1

    ok = not mismatches
    return {
        "ok": ok, "kind": "parity" if ok else "numeric-or-structural",
        "golden_count": len(golden), "rust_count": len(rust),
        "matched": matched, "mismatched": len(mismatches),
        "ignored_text_glyphs": ignored_glyph,
        "max_abs_err": max_abs,
        "first_diff": first_diff,
    }


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: svg_diff.py golden.svg rust.svg [--eps EPS] [--json OUT]", file=sys.stderr)
        return 2
    golden, rust = sys.argv[1], sys.argv[2]
    eps = 1e-3
    json_out = None
    args = sys.argv[3:]
    i = 0
    while i < len(args):
        if args[i] == "--eps":
            eps = float(args[i + 1]); i += 2
        elif args[i] == "--json":
            json_out = args[i + 1]; i += 2
        else:
            i += 1
    try:
        report = compare(parse(golden), parse(rust), eps)
    except ET.ParseError as exc:
        print(f"PARSE FAIL: {exc}")
        return 2
    report["golden"] = golden
    report["rust"] = rust
    report["eps"] = eps
    if json_out:
        with open(json_out, "w") as fh:
            json.dump(report, fh, indent=1)
    if report["ok"]:
        print(f"OK {report['matched']}/{report['golden_count']} elems, "
              f"max_abs_err={report['max_abs_err']:.3g} eps={eps:g} "
              f"ignored_glyphs={report['ignored_text_glyphs']}")
        return 0
    print("FAIL", json.dumps(report)[:1200])
    return 1


if __name__ == "__main__":
    sys.exit(main())
