import { isTexFuzzCase, isTexFuzzReplayBundle } from "./validation.js";
import type {
  TexFuzzCase,
  TexFuzzReplayBundle,
} from "./model.js";

export function serializeTexFuzzBundle(bundle: TexFuzzReplayBundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

export function parseTexFuzzBundle(value: string): TexFuzzReplayBundle {
  const parsed: unknown = JSON.parse(value);
  if (!isTexFuzzReplayBundle(parsed)) {
    throw new Error("Unsupported or malformed TeX fuzz replay bundle.");
  }
  return parsed;
}

export function replayTexFuzzCase(caseData: unknown): TexFuzzCase {
  if (!isTexFuzzCase(caseData)) {
    throw new Error("Cannot replay an unsupported TeX fuzz schema.");
  }
  return caseData;
}
