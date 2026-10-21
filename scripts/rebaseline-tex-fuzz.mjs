import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  parseTexFuzzArtifactManifest,
  planTexFuzzRebaseline,
} from "../packages/tex-fuzz/dist/index.js";

function usage() {
  return "Usage: node scripts/rebaseline-tex-fuzz.mjs <old-manifest.json> <new-manifest.json> [--out mapping.json]";
}

const args = process.argv.slice(2);
const outputIndex = args.indexOf("--out");
const outputPath = outputIndex < 0 ? undefined : args[outputIndex + 1];
if (outputIndex >= 0) args.splice(outputIndex, 2);
if (args.length !== 2 || (outputIndex >= 0 && outputPath === undefined)) {
  throw new Error(usage());
}

const oldManifest = parseTexFuzzArtifactManifest(readFileSync(resolve(args[0]), "utf8"));
const newManifest = parseTexFuzzArtifactManifest(readFileSync(resolve(args[1]), "utf8"));
const serialized = `${JSON.stringify(planTexFuzzRebaseline(oldManifest, newManifest), null, 2)}\n`;
if (outputPath === undefined) process.stdout.write(serialized);
else writeFileSync(resolve(outputPath), serialized, { flag: "wx" });
