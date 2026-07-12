import { createHash } from "node:crypto";
import type { TexFuzzFingerprint } from "./model.js";

export function normalizeTexFuzzFingerprint(fingerprint: TexFuzzFingerprint): TexFuzzFingerprint {
  return {
    ...fingerprint,
    featureTags: [...new Set(fingerprint.featureTags)].sort(),
  };
}

export function texFuzzFingerprintKey(fingerprint: TexFuzzFingerprint): string {
  const normalized = normalizeTexFuzzFingerprint(fingerprint);
  return JSON.stringify([
    normalized.version,
    normalized.resultClass,
    normalized.code,
    normalized.firstDivergentLayer ?? null,
    normalized.featureTags,
    normalized.mode,
    normalized.structuralLocus,
    normalized.operationKind ?? null,
    normalized.oracleEnvironmentFamily ?? null,
    normalized.severityBucket ?? null,
  ]);
}

export function sameTexFuzzFingerprint(left: TexFuzzFingerprint, right: TexFuzzFingerprint): boolean {
  return texFuzzFingerprintKey(left) === texFuzzFingerprintKey(right);
}

/**
 * Stable, human-copyable identity for a normalized finding. The prefix makes
 * IDs self-describing and leaves room for a future fingerprint schema.
 */
export function texFuzzFindingId(fingerprint: TexFuzzFingerprint): string {
  const digest = createHash("sha256").update(texFuzzFingerprintKey(fingerprint)).digest("hex");
  return `tf${fingerprint.version}-${digest.slice(0, 24)}`;
}
