import { describe, expect, it } from "vitest";

import { parseOptionListRaw, splitTopLevel } from "../packages/core/src/options/parse.js";

describe("options parser", () => {
  it("splits top-level commas while preserving nested structures", () => {
    const raw = "a={1,2}, b=(3,4), c=[x=1,y=2], d";
    const parts = splitTopLevel(raw, ",").map((part) => part.trim());

    expect(parts).toEqual(["a={1,2}", "b=(3,4)", "c=[x=1,y=2]", "d"]);
  });

  it("parses kv and flag options with spans", () => {
    const parsed = parseOptionListRaw("[thick, red, line width=2pt, fill=blue]", 10);

    expect(parsed.entries.some((entry) => entry.kind === "flag" && entry.key === "thick")).toBe(true);
    expect(parsed.entries.some((entry) => entry.kind === "flag" && entry.key === "red")).toBe(true);
    expect(parsed.entries.some((entry) => entry.kind === "kv" && entry.key === "line width")).toBe(true);
    expect(parsed.entries.some((entry) => entry.kind === "kv" && entry.key === "fill")).toBe(true);
    expect(parsed.entries.every((entry) => entry.span.from >= 10)).toBe(true);

    const lineWidth = parsed.entries.find((entry) => entry.kind === "kv" && entry.key === "line width");
    expect(lineWidth?.kind).toBe("kv");
    if (lineWidth?.kind === "kv") {
      expect(lineWidth.keySpan).toBeDefined();
      expect(lineWidth.keySpan!.to).toBeLessThan(lineWidth.valueSpan?.from ?? Number.POSITIVE_INFINITY);
      expect(lineWidth.valueSpan).not.toBeNull();
    }
  });

  it("parses symbolic marker flags like |-|", () => {
    const parsed = parseOptionListRaw("[|-|, dashed]");

    expect(parsed.entries.some((entry) => entry.kind === "flag" && entry.key === "|-|")).toBe(true);
    expect(parsed.entries.some((entry) => entry.kind === "flag" && entry.key === "dashed")).toBe(true);
  });

  it("classifies arrow shorthand specifications as flags", () => {
    const parsed = parseOptionListRaw("[-, ->, Stealth-Stealth, -{Latex[open]}, |<->|]");

    expect(parsed.entries.some((entry) => entry.kind === "flag" && entry.key === "-")).toBe(true);
    expect(parsed.entries.some((entry) => entry.kind === "flag" && entry.key === "->")).toBe(true);
    expect(parsed.entries.some((entry) => entry.kind === "flag" && entry.raw.trim() === "Stealth-Stealth")).toBe(true);
    expect(parsed.entries.some((entry) => entry.kind === "flag" && entry.raw.trim() === "-{Latex[open]}")).toBe(true);
    expect(parsed.entries.some((entry) => entry.kind === "flag" && entry.raw.trim() === "|<->|")).toBe(true);
  });

  it("classifies extended arrows.meta names as arrow flags", () => {
    const parsed = parseOptionListRaw("[Kite-Square, -{Rays[n=8]}, Bracket-Parenthesis]");

    expect(parsed.entries.some((entry) => entry.kind === "flag" && entry.raw.trim() === "Kite-Square")).toBe(true);
    expect(parsed.entries.some((entry) => entry.kind === "flag" && entry.raw.trim() === "-{Rays[n=8]}")).toBe(true);
    expect(parsed.entries.some((entry) => entry.kind === "flag" && entry.raw.trim() === "Bracket-Parenthesis")).toBe(true);
  });

  it("classifies xcolor-style mix expressions as flags", () => {
    const parsed = parseOptionListRaw("[green!50!white, red!20, #00ff00]");

    expect(parsed.entries.some((entry) => entry.kind === "flag" && entry.key === "green!50!white")).toBe(true);
    expect(parsed.entries.some((entry) => entry.kind === "flag" && entry.key === "red!20")).toBe(true);
    expect(parsed.entries.some((entry) => entry.kind === "flag" && entry.key === "#00ff00")).toBe(true);
  });

  it("keeps unknown tokens", () => {
    const parsed = parseOptionListRaw("[foo={a,b}, ???]");

    expect(parsed.entries.some((entry) => entry.kind === "unknown")).toBe(true);
  });

  it("ignores line comments in option lists", () => {
    const parsed = parseOptionListRaw(`[fill=yellow!80!black, % comment
every path/.style={draw}]`);

    expect(parsed.entries.some((entry) => entry.kind === "kv" && entry.key === "fill")).toBe(true);
    expect(parsed.entries.some((entry) => entry.kind === "kv" && entry.key === "every path/.style")).toBe(true);
  });

  it("parses positioning-library and legacy relative placement keys", () => {
    const parsed = parseOptionListRaw("[above=of a, above left=1cm and 2cm of b, left of=c, on grid, node distance=5mm and 7mm]");

    expect(parsed.entries.some((entry) => entry.kind === "kv" && entry.key === "above" && entry.valueRaw === "of a")).toBe(true);
    expect(parsed.entries.some((entry) => entry.kind === "kv" && entry.key === "above left" && entry.valueRaw === "1cm and 2cm of b")).toBe(true);
    expect(parsed.entries.some((entry) => entry.kind === "kv" && entry.key === "left of" && entry.valueRaw === "c")).toBe(true);
    expect(parsed.entries.some((entry) => entry.kind === "flag" && entry.key === "on grid")).toBe(true);
    expect(parsed.entries.some((entry) => entry.kind === "kv" && entry.key === "node distance")).toBe(true);
  });
});
