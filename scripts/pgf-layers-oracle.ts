/**
 * Shared by scripts/capture-pgf-layer-oracles.mts (which writes the pdfTeX
 * oracles) and test/pgf-layers-oracle.spec.ts (which reads them).
 */
import { createHash } from "node:crypto";
import { join } from "node:path";

import type { Tier2 } from "./pgfplots-oracle/schema.js";

export const PGF_LAYER_FIXTURE_DIR = join("test", "fixtures", "pgf-layers");

export type PgfLayerOracle = {
  sourceSha256: string;
  engine: "pdflatex";
  /** The picture's bounding box TeX reports (pt). */
  boundingBox: { minX: number; minY: number; maxX: number; maxY: number };
  /** The first line of each TeX error. */
  texErrors: string[];
  tier2: Tier2;
};

export function sourceSha256(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}
