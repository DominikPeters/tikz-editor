import { afterEach, describe, expect, it } from "vitest";

import { createStandaloneLatexExportArtifact } from "@tikz-editor/core/export/index.js";
import { createAddonRuntime } from "@tikz-editor/core/addons/runtime.js";
import {
  checkApiVersion,
  refreshAddonRuntime,
  setStaticAddonRegistrations
} from "../../packages/app/src/addons/loader";
import { getActiveAddonRuntime, setActiveAddonRuntime } from "../../packages/app/src/addons/registry";
import { loadSettings } from "../../packages/app/src/settings/storage";
import { createSmileyAddon } from "../helpers/smiley-addon.js";

afterEach(() => {
  setStaticAddonRegistrations([]);
  setActiveAddonRuntime(null);
});

describe("add-on loader", () => {
  it("activates static registrations by default and installs the runtime", async () => {
    setStaticAddonRegistrations([createSmileyAddon()]);
    const result = await refreshAddonRuntime({ installed: {} });
    expect(result.issues).toEqual([]);
    expect(result.runtime.engines.has("smiley")).toBe(true);
    expect(getActiveAddonRuntime()).toBe(result.runtime);
  });

  it("excludes static registrations disabled in settings", async () => {
    setStaticAddonRegistrations([createSmileyAddon()]);
    const result = await refreshAddonRuntime({
      installed: {
        smiley: { enabled: false, source: { kind: "builtin" }, version: "0.0.1" }
      }
    });
    expect(result.runtime.engines.has("smiley")).toBe(false);
  });

  it("rejects add-ons targeting an incompatible api version", async () => {
    const registration = createSmileyAddon();
    registration.engine.manifest.apiVersion = "^0.3.0";
    setStaticAddonRegistrations([registration]);
    const result = await refreshAddonRuntime({ installed: {} });
    expect(result.runtime.engines.has("smiley")).toBe(false);
    expect(result.issues.some((issue) => issue.addonId === "smiley")).toBe(true);
  });

  it("checks apiVersion ranges", () => {
    const withRange = (range: string) => {
      const registration = createSmileyAddon();
      registration.engine.manifest.apiVersion = range;
      return registration.engine;
    };
    expect(checkApiVersion(withRange("^0.1.0"))).toBeNull();
    expect(checkApiVersion(withRange("^0.2.0"))).toBeNull();
    expect(checkApiVersion(withRange("0.2.0"))).toBeNull();
    expect(checkApiVersion(withRange("^0.3.0"))).not.toBeNull();
    expect(checkApiVersion(withRange("0.1.0"))).not.toBeNull();
    expect(checkApiVersion(withRange("^1.0.0"))).not.toBeNull();
    expect(checkApiVersion(withRange("not-a-range"))).not.toBeNull();
  });

  it("reports url load failures as issues without breaking the runtime", async () => {
    setStaticAddonRegistrations([createSmileyAddon()]);
    const result = await refreshAddonRuntime({
      installed: {
        ghost: { enabled: true, source: { kind: "url", url: "https://127.0.0.1:1/none.js" }, version: "0.0.1" }
      }
    });
    expect(result.runtime.engines.has("smiley")).toBe(true);
    expect(result.runtime.engines.has("ghost")).toBe(false);
    expect(result.issues.some((issue) => issue.addonId === "ghost")).toBe(true);
  });
});

describe("add-on settings persistence", () => {
  it("defaults the addons section when older persisted settings lack it", () => {
    const settings = loadSettings();
    expect(settings.addons).toEqual({ installed: {} });
  });
});

describe("standalone export preamble contribution", () => {
  it("includes requiredPreamble lines for add-ons used in the exported figure", () => {
    const runtime = createAddonRuntime([createSmileyAddon()]);
    const source = "\\begin{tikzpicture}\n\\smiley (0,0);\n\\end{tikzpicture}";
    const artifact = createStandaloneLatexExportArtifact({
      source,
      activeFigureId: "figure:0",
      addons: runtime
    });
    expect(artifact.text).toContain("\\usepackage{smiley}");
    expect(artifact.text.indexOf("\\usepackage{smiley}")).toBeGreaterThan(artifact.text.indexOf("\\usepackage{tikz}"));
    expect(artifact.text.indexOf("\\usepackage{smiley}")).toBeLessThan(artifact.text.indexOf("\\begin{document}"));
  });

  it("omits add-on preamble lines when the figure does not use the add-on", () => {
    const runtime = createAddonRuntime([createSmileyAddon()]);
    const source = "\\begin{tikzpicture}\n\\draw (0,0) -- (1,1);\n\\end{tikzpicture}";
    const artifact = createStandaloneLatexExportArtifact({
      source,
      activeFigureId: "figure:0",
      addons: runtime
    });
    expect(artifact.text).not.toContain("\\usepackage{smiley}");
  });
});
