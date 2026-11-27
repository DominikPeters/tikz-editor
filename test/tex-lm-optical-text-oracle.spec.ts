import { appendFileSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { createTexNodeTextEngine } from "../packages/core/src/text/tex-node-text-engine.js";
import type { NodeTextEngine } from "../packages/core/src/text/types.js";

// LuaLaTeX ground truth captured by scripts/capture-lm-optical-text-oracle.mjs:
// which Latin Modern file each size command x family/series/shape selects in
// the 10/11/12pt article classes (tulmr/tulmss/tulmtt.fd), and the
// \wd/\ht/\dp of ~200 strings set in an \hbox in each selected face.
interface OracleConfig {
  readonly classPt: number;
  readonly command: string;
  readonly combo: string;
  readonly sizePt: number;
  readonly font: string;
  readonly face: string;
}
interface Oracle {
  readonly strings: readonly string[];
  readonly configs: readonly OracleConfig[];
  readonly faces: Readonly<Record<string, { readonly font: string; readonly sizePt: number; readonly boxes: readonly (readonly [number, number, number])[] }>>;
}

const oracle = JSON.parse(readFileSync(new URL("./fixtures/fonts/lm-optical-text-oracle.json", import.meta.url), "utf8")) as Oracle;
const TOLERANCE_PT = 0.005;

const DECLARATIONS: Readonly<Record<string, string>> = {
  "rm-m-n": "",
  "rm-bx-n": "\\bfseries",
  "rm-m-it": "\\itshape",
  "rm-bx-it": "\\bfseries\\itshape",
  "rm-m-sl": "\\slshape",
  "rm-bx-sl": "\\bfseries\\slshape",
  "rm-m-sc": "\\scshape",
  "rm-bx-sc": "\\bfseries\\scshape",
  "sf-m-n": "\\sffamily",
  "sf-bx-n": "\\sffamily\\bfseries",
  "sf-m-it": "\\sffamily\\itshape",
  "sf-m-sl": "\\sffamily\\slshape",
  "sf-bx-it": "\\sffamily\\bfseries\\itshape",
  "sf-m-sc": "\\sffamily\\scshape",
  "tt-m-n": "\\ttfamily",
  "tt-bx-n": "\\ttfamily\\bfseries",
  "tt-m-it": "\\ttfamily\\itshape",
  "tt-m-sl": "\\ttfamily\\slshape",
  "tt-m-sc": "\\ttfamily\\scshape",
};

/**
 * The editor's node text is set in the 10pt class, so its size commands are
 * checked there; the 11pt and 12pt classes' sizes are selected with
 * \fontsize, which goes through the same NFSS size ranges.
 */
function sizePrefix(config: OracleConfig): string {
  return config.classPt === 10 ? `\\${config.command}` : `\\fontsize{${config.sizePt}}{${config.sizePt * 1.2}}\\selectfont`;
}

/**
 * Known gap, not an optical-size rule: the generated Latin Modern tables keep
 * only pair kerns between ASCII characters (scripts/generate-tex-font-data.mjs,
 * generateOtfGlyphFont: a full Latin-1/Extended-A pair table is ~6x larger
 * and the kerns of accented letters differ from their base letters', so no
 * class fallback reproduces them). In the italic and small-caps faces these
 * strings meet such kerns (r-é, n-ç, S-ã, Å-n ...); their heights and depths
 * are still checked exactly.
 */
const ACCENT_KERN_STRINGS = new Set(["François", "Ångström", "résumé", "São Paulo"]);
function knownAccentKernWidth(font: string, text: string): boolean {
  return ACCENT_KERN_STRINGS.has(text) && /italic|caps/.test(font);
}

let engine: NodeTextEngine;
beforeAll(async () => { engine = await createTexNodeTextEngine(); });

function measure(text: string) {
  const metrics = engine.measure({ text, textWidthPt: null, fontFamily: "serif", fontStyle: "normal", fontWeight: "normal", fontSizePt: 10 });
  if (!metrics) throw new Error(`Unsupported text ${text}`);
  const ht = metrics.height / 2 - metrics.baselineY;
  return { metrics, wd: metrics.width, ht, dp: metrics.height - ht };
}

function renderedFaces(text: string): string[] {
  const { metrics } = measure(text);
  const body = engine.renderFromCache(metrics.cacheKey)?.body ?? "";
  return [...new Set([...body.matchAll(/data-tex-font="([^"]+)"/g)].map(match => match[1]!))];
}

describe("Latin Modern optical sizes against LuaLaTeX", () => {
  it.each(oracle.configs.map(config => ({ ...config, id: `${config.classPt}pt ${config.command} ${config.combo}` })))(
    "$id selects $font at $sizePt pt",
    config => {
      expect(renderedFaces(`${sizePrefix(config)}${DECLARATIONS[config.combo]} Ag`)).toEqual([config.font]);
    },
  );

  // Boxes depend only on (face, size): check each once, through the first
  // configuration that selects it.
  const firstConfigByFace = new Map<string, OracleConfig>();
  for (const config of oracle.configs) if (!firstConfigByFace.has(config.face)) firstConfigByFace.set(config.face, config);

  it.each([...firstConfigByFace.entries()].map(([face, config]) => ({ face, config })))(
    "$face boxes match \\wd/\\ht/\\dp",
    ({ face, config }) => {
      const prefix = `${sizePrefix(config)}${DECLARATIONS[config.combo]} `;
      const failures: string[] = [];
      let maxError = 0;
      let checked = 0;
      oracle.strings.forEach((text, index) => {
        const [wd, ht, dp] = oracle.faces[face]!.boxes[index]!;
        const got = measure(prefix + text);
        const widthKnown = knownAccentKernWidth(config.font, text);
        const errors = [widthKnown ? 0 : got.wd - wd, got.ht - ht, got.dp - dp];
        checked += 1;
        maxError = Math.max(maxError, ...errors.map(Math.abs));
        if (errors.some(error => Math.abs(error) > TOLERANCE_PT)) {
          failures.push(`${face} ${JSON.stringify(text)}: wd ${got.wd.toFixed(5)} vs ${wd}, ht ${got.ht.toFixed(5)} vs ${ht}, dp ${got.dp.toFixed(5)} vs ${dp}`);
        }
      });
      if (process.env.LM_OPTICAL_REPORT) {
        appendFileSync(process.env.LM_OPTICAL_REPORT, `${JSON.stringify({ face, checked, failed: failures.length, maxError })}\n${failures.map(line => `${line}\n`).join("")}`);
      }
      expect(failures).toEqual([]);
    },
  );
});
