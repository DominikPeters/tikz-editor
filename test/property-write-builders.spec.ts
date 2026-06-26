import { describe, expect, it } from "vitest";

import { parseOptionListRaw } from "../packages/core/src/options/parse.js";
import { SHADOW_INHERIT_FILL } from "../packages/core/src/semantic/types.js";
import {
  DEFAULT_TRANSFORM_INSPECTOR_VALUES,
  buildArrowTipSetPropertyMutation,
  buildFillModeSetPropertyMutations,
  buildFillPatternOptionSetPropertyMutation,
  buildFillShadingSetPropertyMutations,
  buildLineCapSetPropertyMutation,
  buildNodeFontSetPropertyMutation,
  buildNodeInnerSepSetPropertyMutation,
  buildNodeMinimumDimensionSetPropertyMutations,
  buildRoundedCornersSetPropertyMutation,
  buildShadowMutationContextForPreset,
  buildShadowSetPropertyMutations,
  buildTransformSetPropertyMutations,
  resolveTransformInspectorMutationContextFromOptionEntries,
  transformRotateInspectorLabel,
  transformPropertyCandidateKeys,
  uniqueStrings
} from "../packages/core/src/edit/property-write-builders.js";

describe("property write builders", () => {
  it("serializes arrow presets through shorthand and explicit arrow forms", () => {
    expect(buildArrowTipSetPropertyMutation({ startRaw: "", endRaw: ">", clearKeys: [] }, "end", "none")).toMatchObject({
      key: "-",
      value: "true"
    });
    expect(buildArrowTipSetPropertyMutation({ startRaw: "", endRaw: "", clearKeys: [] }, "end", "arrow")).toMatchObject({
      key: "->",
      value: "true"
    });
    expect(buildArrowTipSetPropertyMutation({ startRaw: "", endRaw: "", clearKeys: [] }, "start", "arrow")).toMatchObject({
      key: "<-",
      value: "true"
    });
    expect(buildArrowTipSetPropertyMutation({ startRaw: "<", endRaw: "", clearKeys: [] }, "end", "arrow")).toMatchObject({
      key: "<->",
      value: "true"
    });
    expect(buildArrowTipSetPropertyMutation({ startRaw: "Hooks[left]", endRaw: "Stealth", clearKeys: ["arrows"] }, "start", "latex")).toMatchObject({
      key: "arrows",
      value: "Latex-Stealth",
      clearKeys: expect.arrayContaining(["arrows"])
    });
  });

  it("normalizes fill mode, shading, and pattern option mutations", () => {
    expect(buildFillModeSetPropertyMutations("solid", {
      fillColor: "  ",
      patternColor: "orange",
      shading: "custom",
      pattern: "custom"
    })).toEqual([
      expect.objectContaining({ key: "fill", value: "black" })
    ]);

    expect(buildFillModeSetPropertyMutations("gradient", {
      fillColor: "red",
      patternColor: "",
      shading: "radial",
      pattern: "Lines"
    })).toEqual([
      expect.objectContaining({ key: "shade", value: "true" }),
      expect.objectContaining({ key: "shading", value: "radial" })
    ]);

    expect(buildFillModeSetPropertyMutations("pattern", {
      fillColor: null,
      patternColor: " teal ",
      shading: "axis",
      pattern: "custom"
    })).toEqual([
      expect.objectContaining({ key: "pattern", value: "dots" }),
      expect.objectContaining({ key: "pattern color", value: "teal" })
    ]);

    expect(buildFillShadingSetPropertyMutations("axis")[1]?.clearKeys).toContain("inner color");
    expect(buildFillShadingSetPropertyMutations("radial")[1]?.clearKeys).toContain("left color");
    expect(buildFillShadingSetPropertyMutations("ball")[1]?.clearKeys).toContain("inner color");

    const basePatternValues = {
      angle: 30,
      distance: 4,
      xshift: 0,
      yshift: 0,
      lineWidth: 0.4,
      radius: 1.2,
      points: 5
    };
    expect(buildFillPatternOptionSetPropertyMutation({ family: "Lines", values: basePatternValues }, "line width", Number.NaN).value)
      .toContain("line width=0.4pt");
    expect(buildFillPatternOptionSetPropertyMutation({ family: "Stars", values: basePatternValues }, "points", 1.2).value)
      .toContain("points=2");
    expect(buildFillPatternOptionSetPropertyMutation({ family: "Dots", values: basePatternValues }, "radius", -5).value)
      .toContain("radius=0pt");
  });

  it("builds node dimension and font mutations with fallbacks", () => {
    expect(buildLineCapSetPropertyMutation("square")).toMatchObject({ key: "line cap", value: "projecting" });
    expect(buildRoundedCornersSetPropertyMutation(false, 0, false)).toMatchObject({
      key: "rounded corners",
      value: ""
    });
    expect(buildRoundedCornersSetPropertyMutation(false)).toMatchObject({
      key: "sharp corners",
      value: "true"
    });
    expect(buildRoundedCornersSetPropertyMutation(true, Number.NaN)).toMatchObject({
      key: "rounded corners",
      value: "true"
    });

    expect(buildNodeInnerSepSetPropertyMutation(-1).value).toBe(".3333em");
    expect(buildNodeMinimumDimensionSetPropertyMutations({ minimumWidth: 12, minimumHeight: 8 }, "minimum width", Number.NaN)).toEqual([]);
    expect(buildNodeMinimumDimensionSetPropertyMutations({ minimumWidth: Number.NaN, minimumHeight: 8 }, "minimum width", 10)).toEqual([
      expect.objectContaining({ key: "minimum width", value: "10pt" }),
      expect.objectContaining({ key: "minimum height", value: "8pt" })
    ]);

    expect(buildNodeFontSetPropertyMutation(
      { key: "node font", clearKeys: ["font", "node font"], fallbackCustomSizePt: 11 },
      { family: "sans", weight: "bold", style: "italic", sizePreset: "custom", customSizePt: Number.NaN }
    )).toMatchObject({
      key: "node font",
      value: "\\fontsize{11pt}{13.2pt}\\selectfont\\sffamily\\bfseries\\itshape"
    });
    expect(buildNodeFontSetPropertyMutation(
      { key: "font", clearKeys: [], fallbackCustomSizePt: 10 },
      { family: "serif", weight: "normal", style: "normal", sizePreset: "normalsize", customSizePt: null }
    ).value).toBe("");
  });

  it("parses transform options and builds companion mutations", () => {
    const parsed = parseOptionListRaw("scale={bad}, xscale=2, yscale=bad, shift={(1cm,bad)}, xshift=4pt, rotate={90}");
    const context = resolveTransformInspectorMutationContextFromOptionEntries(parsed.entries);
    expect(context.values).toMatchObject({
      xshift: 4,
      xscale: 2,
      yscale: 1,
      rotate: 90
    });
    expect(context.presence).toMatchObject({
      scale: true,
      shift: true,
      xshift: true,
      yscale: true,
      rotate: true
    });

    const rotateAround = resolveTransformInspectorMutationContextFromOptionEntries(
      parseOptionListRaw("rotate around={32:(3.09,0.79)}").entries
    );
    expect(rotateAround.values.rotate).toBe(32);
    expect(rotateAround.values.rotateAround).toEqual({
      pivotRaw: "(3.09,0.79)",
      pivotLabel: "(3.09, 0.79)"
    });
    expect(transformRotateInspectorLabel(rotateAround)).toBe("Rotate around (3.09, 0.79)");
    expect(buildTransformSetPropertyMutations(rotateAround, "rotate", 10)).toEqual([
      {
        key: "rotate around",
        value: "{10:(3.09,0.79)}",
        clearKeys: ["rotate", "/tikz/rotate", "rotate around", "/tikz/rotate around"]
      }
    ]);

    expect(buildTransformSetPropertyMutations(DEFAULT_TRANSFORM_INSPECTOR_VALUES, "rotate", Number.NaN)).toEqual([]);
    expect(buildTransformSetPropertyMutations({
      values: { xshift: 1, yshift: 2, xscale: 1, yscale: 1, rotate: 0 },
      presence: { shift: true, scale: false, xshift: false, yshift: false, xscale: false, yscale: false, rotate: false }
    }, "xshift", 3)).toEqual([
      expect.objectContaining({ key: "xshift", value: "3pt" }),
      expect.objectContaining({ key: "yshift", value: "2pt" })
    ]);
    expect(buildTransformSetPropertyMutations({
      values: { xshift: 0, yshift: 0, xscale: 1, yscale: 1, rotate: 0 },
      presence: { shift: false, scale: false, xshift: false, yshift: true, xscale: false, yscale: false, rotate: false }
    }, "xshift", 2)).toEqual([
      expect.objectContaining({ key: "xshift", value: "2pt" }),
      expect.objectContaining({ key: "yshift", value: "" })
    ]);
    expect(buildTransformSetPropertyMutations({
      xshift: Number.NaN,
      yshift: 0,
      xscale: Number.POSITIVE_INFINITY,
      yscale: 2,
      rotate: Number.NaN
    }, "yscale", 0)).toEqual([
      expect.objectContaining({ key: "yscale", value: "0" })
    ]);
    expect(transformPropertyCandidateKeys("rotate")).toEqual(["rotate", "/tikz/rotate", "rotate around", "/tikz/rotate around"]);
  });

  it("serializes shadow contexts and unique key lists", () => {
    expect(buildShadowMutationContextForPreset("none")).toMatchObject({
      preset: "none",
      color: null
    });
    expect(buildShadowSetPropertyMutations(buildShadowMutationContextForPreset("none"))).toEqual([
      expect.objectContaining({ value: "" })
    ]);

    const context = buildShadowMutationContextForPreset("drop-shadow");
    const mutations = buildShadowSetPropertyMutations({
      ...context,
      xshiftPt: context.xshiftPt + 1,
      yshiftPt: context.yshiftPt + 2,
      scale: context.scale + 0.5,
      opacity: context.opacity - 0.25,
      color: SHADOW_INHERIT_FILL
    });
    expect(mutations[0]?.value).toContain("shadow xshift=");
    expect(mutations[0]?.value).toContain("shadow yshift=");
    expect(mutations[0]?.value).toContain("shadow scale=");
    expect(mutations[0]?.value).toContain("opacity=");
    expect(mutations[0]?.value).not.toContain("fill=__tikz-shadow-inherit-fill__");

    expect(uniqueStrings([" draw ", "", "draw", "fill"])).toEqual(["draw", "fill"]);
  });
});
