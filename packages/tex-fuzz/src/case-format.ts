import {
  TEX_FUZZ_SCHEMA_VERSION,
  type TexFuzzCase,
  type TexFuzzReplayBundle,
} from "./model.js";

export function serializeTexFuzzBundle(bundle: TexFuzzReplayBundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

export function parseTexFuzzBundle(value: string): TexFuzzReplayBundle {
  const parsed = JSON.parse(value) as Partial<TexFuzzReplayBundle>;
  if (parsed.case?.schemaVersion !== TEX_FUZZ_SCHEMA_VERSION) {
    throw new Error(`Unsupported or missing TeX fuzz schema version.`);
  }
  if (!parsed.observation?.fingerprint) {
    throw new Error("TeX fuzz bundle is missing a failure observation.");
  }
  return parsed as TexFuzzReplayBundle;
}

export function replayTexFuzzCase(caseData: TexFuzzCase): TexFuzzCase {
  if (caseData.schemaVersion !== TEX_FUZZ_SCHEMA_VERSION) {
    throw new Error("Cannot replay an unsupported TeX fuzz schema.");
  }
  return caseData;
}
