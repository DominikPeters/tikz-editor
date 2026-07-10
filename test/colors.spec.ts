import { describe, expect, it } from "vitest";

import { normalizeColor, resolveDefineColorModel } from "../packages/core/src/semantic/style/colors.js";
import { COLOR_HEX, NAMED_COLORS } from "../packages/core/src/semantic/style/constants.js";
import { hexToRgb, rgbToHex } from "../packages/core/src/utils/color-convert.js";

describe("color normalization", () => {
  it("rounds fractional RGB components into valid two-digit hex channels", () => {
    expect(rgbToHex({ r: 12.5, g: 128.4, b: 254.6 })).toBe("#0d80ff");
    expect(hexToRgb("#0d80ff")).toEqual({ r: 13, g: 128, b: 255 });
  });

  it("supports chained xcolor mixes left-to-right", () => {
    expect(normalizeColor("black!10!white!92!red")).toBe("#e8d3d3");
  });

  it("defaults omitted mix targets to white at each step", () => {
    expect(normalizeColor("black!10!white!92")).toBe("#e8e8e8");
  });

  it("parses chained mixes with whitespace and case differences", () => {
    expect(normalizeColor(" BLACK ! 10 ! WHITE ! 92 ! RED ")).toBe("#e8d3d3");
  });

  it("falls back to the raw value for unsupported mix colors", () => {
    expect(normalizeColor("black!10!chartreuse!92!red")).toBe("black!10!chartreuse!92!red");
  });

  it("matches xcolor always-available named-color set exactly", () => {
    const expected = [
      "black",
      "darkgray",
      "gray",
      "lightgray",
      "white",
      "red",
      "green",
      "blue",
      "cyan",
      "magenta",
      "yellow",
      "lime",
      "olive",
      "orange",
      "pink",
      "teal",
      "violet",
      "purple",
      "brown"
    ];

    expect(Array.from(NAMED_COLORS).sort()).toEqual([...expected].sort());
    expect(Object.keys(COLOR_HEX).sort()).toEqual([...expected].sort());
  });

  it("uses xcolor always-available named-color RGB definitions", () => {
    expect(COLOR_HEX.black).toBe("#000000");
    expect(COLOR_HEX.darkgray).toBe("#404040");
    expect(COLOR_HEX.gray).toBe("#808080");
    expect(COLOR_HEX.lightgray).toBe("#bfbfbf");
    expect(COLOR_HEX.white).toBe("#ffffff");
    expect(COLOR_HEX.red).toBe("#ff0000");
    expect(COLOR_HEX.green).toBe("#00ff00");
    expect(COLOR_HEX.blue).toBe("#0000ff");
    expect(COLOR_HEX.cyan).toBe("#00ffff");
    expect(COLOR_HEX.magenta).toBe("#ff00ff");
    expect(COLOR_HEX.yellow).toBe("#ffff00");
    expect(COLOR_HEX.lime).toBe("#bfff00");
    expect(COLOR_HEX.olive).toBe("#808000");
    expect(COLOR_HEX.orange).toBe("#ff8000");
    expect(COLOR_HEX.pink).toBe("#ffbfbf");
    expect(COLOR_HEX.teal).toBe("#008080");
    expect(COLOR_HEX.violet).toBe("#800080");
    expect(COLOR_HEX.purple).toBe("#bf0040");
    expect(COLOR_HEX.brown).toBe("#bf8040");
  });

  it("resolves definecolor core xcolor models to normalized hex", () => {
    expect(resolveDefineColorModel("HTML", "1A2B3C")).toBe("#1a2b3c");
    expect(resolveDefineColorModel("rgb", "0.1,0.2,0.3")).toBe("#1a334d");
    expect(resolveDefineColorModel("RGB", "26,43,60")).toBe("#1a2b3c");
    expect(resolveDefineColorModel("gray", "0.5")).toBe("#808080");
    expect(resolveDefineColorModel("Gray", "8")).toBe("#888888");
    expect(resolveDefineColorModel("cmy", "0.1,0.2,0.3")).toBe("#e6ccb3");
    expect(resolveDefineColorModel("cmyk", "0,0.5,0.5,0")).toBe("#ff8080");
    expect(resolveDefineColorModel("hsb", "0,1,1")).toBe("#ff0000");
    expect(resolveDefineColorModel("HSB", "80,240,240")).toBe("#00ff00");
  });

  it("returns null for unsupported or malformed definecolor model specs", () => {
    expect(resolveDefineColorModel("wave", "500")).toBeNull();
    expect(resolveDefineColorModel("HTML", "XYZ123")).toBeNull();
    expect(resolveDefineColorModel("rgb", "0.1,0.2")).toBeNull();
    expect(resolveDefineColorModel("cmyk", "0,0,0")).toBeNull();
  });
});
