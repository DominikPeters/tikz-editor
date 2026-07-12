import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { parseTexFuzzBundle } from "./case-format.js";
import {
  normalizeTexFuzzFingerprint,
  texFuzzFindingId,
} from "./fingerprint.js";
import type {
  TexFuzzCase,
  TexFuzzFingerprint,
  TexFuzzReplayBundle,
} from "./model.js";

export const TEX_FUZZ_ARTIFACT_SCHEMA_VERSION = 1 as const;

export type TexFuzzOracleEnvironment = Readonly<Record<string, string>>;

export interface TexFuzzShrinkContinuation {
  readonly candidatesEvaluated: number;
  readonly oracleEvaluations: number;
  readonly elapsedMs: number;
  readonly candidateBudgetRemaining: number;
  readonly oracleBudgetRemaining: number;
  readonly timeBudgetMsRemaining: number;
  /** Serialized cases still awaiting evaluation, in deterministic order. */
  readonly remainingCandidates: readonly TexFuzzCase[];
}

export interface TexFuzzStoredBundle extends TexFuzzReplayBundle {
  readonly artifactSchemaVersion: typeof TEX_FUZZ_ARTIFACT_SCHEMA_VERSION;
  readonly findingId: string;
  readonly witnessId: string;
  readonly shrinkContinuation?: TexFuzzShrinkContinuation;
}

export interface TexFuzzArtifactWitness {
  readonly witnessId: string;
  readonly bundleHash: string;
  /** POSIX-style path relative to the manifest. */
  readonly bundlePath: string;
  readonly sourceHash: string;
  readonly minimizedSourceHash?: string;
}

export interface TexFuzzArtifactFinding {
  readonly findingId: string;
  readonly fingerprint: TexFuzzFingerprint;
  readonly witnesses: readonly TexFuzzArtifactWitness[];
}

export interface TexFuzzArtifactManifest {
  readonly schemaVersion: typeof TEX_FUZZ_ARTIFACT_SCHEMA_VERSION;
  readonly oracleEnvironment: TexFuzzOracleEnvironment;
  readonly findings: readonly TexFuzzArtifactFinding[];
}

export interface TexFuzzPlannedBundle {
  readonly storedBundle: TexFuzzStoredBundle;
  readonly witness: TexFuzzArtifactWitness;
}

export interface TexFuzzArtifactPlan {
  readonly manifest: TexFuzzArtifactManifest;
  readonly bundles: readonly TexFuzzPlannedBundle[];
}

export interface TexFuzzLoadedFailure {
  readonly finding: TexFuzzArtifactFinding;
  readonly witness: TexFuzzArtifactWitness;
  readonly bundle: TexFuzzStoredBundle;
}

export interface TexFuzzRebaselineLink {
  readonly oldFindingIds: readonly string[];
  readonly newFindingIds: readonly string[];
  readonly witnessIds: readonly string[];
}

export interface TexFuzzRebaselinePlan {
  readonly schemaVersion: 1;
  readonly oldEnvironment: TexFuzzOracleEnvironment;
  readonly newEnvironment: TexFuzzOracleEnvironment;
  readonly resolved: readonly string[];
  readonly new: readonly string[];
  readonly unchanged: readonly TexFuzzRebaselineLink[];
  readonly remapped: readonly TexFuzzRebaselineLink[];
  readonly split: readonly TexFuzzRebaselineLink[];
  readonly merged: readonly TexFuzzRebaselineLink[];
  readonly complex: readonly TexFuzzRebaselineLink[];
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right)
    ).map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function texFuzzEnvironmentKey(environment: TexFuzzOracleEnvironment): string {
  return canonicalJson(environment);
}

export function sameTexFuzzEnvironment(
  left: TexFuzzOracleEnvironment,
  right: TexFuzzOracleEnvironment,
): boolean {
  return texFuzzEnvironmentKey(left) === texFuzzEnvironmentKey(right);
}

/** Identity of replay evidence, deliberately excluding its failure fingerprint. */
export function texFuzzWitnessId(bundle: TexFuzzReplayBundle): string {
  const evidence = {
    case: bundle.case,
    minimizedCase: bundle.minimizedCase ?? null,
  };
  return `tw1-${hash(canonicalJson(evidence)).slice(0, 24)}`;
}

export function makeTexFuzzStoredBundle(
  bundle: TexFuzzReplayBundle,
  continuation?: TexFuzzShrinkContinuation,
): TexFuzzStoredBundle {
  return {
    ...bundle,
    artifactSchemaVersion: TEX_FUZZ_ARTIFACT_SCHEMA_VERSION,
    findingId: texFuzzFindingId(bundle.observation.fingerprint),
    witnessId: texFuzzWitnessId(bundle),
    ...(continuation === undefined ? {} : { shrinkContinuation: continuation }),
  };
}

export function planTexFuzzArtifacts(
  bundles: readonly TexFuzzReplayBundle[],
  oracleEnvironment: TexFuzzOracleEnvironment,
): TexFuzzArtifactPlan {
  const bundleByHash = new Map<string, TexFuzzPlannedBundle>();
  const witnessesByFinding = new Map<string, Map<string, TexFuzzArtifactWitness>>();
  const fingerprintByFinding = new Map<string, TexFuzzFingerprint>();

  for (const bundle of bundles) {
    if (bundle.oracleEnvironment !== undefined &&
      !sameTexFuzzEnvironment(bundle.oracleEnvironment, oracleEnvironment)) {
      throw new Error("TeX fuzz bundle oracle environment does not match the artifact manifest.");
    }
    const storedBundle = makeTexFuzzStoredBundle({
      ...bundle,
      oracleEnvironment,
    });
    const serialized = canonicalJson(storedBundle);
    const bundleHash = hash(serialized);
    const witness: TexFuzzArtifactWitness = {
      witnessId: storedBundle.witnessId,
      bundleHash,
      bundlePath: `bundles/${storedBundle.findingId}/${bundleHash}.json`,
      sourceHash: hash(bundle.case.source),
      ...(bundle.minimizedCase === undefined
        ? {}
        : { minimizedSourceHash: hash(bundle.minimizedCase.source) }),
    };
    bundleByHash.set(bundleHash, { storedBundle, witness });
    const findingWitnesses = witnessesByFinding.get(storedBundle.findingId) ??
      new Map<string, TexFuzzArtifactWitness>();
    const previous = findingWitnesses.get(witness.witnessId);
    if (previous !== undefined && previous.bundleHash !== bundleHash) {
      throw new Error(`Witness ${witness.witnessId} has conflicting replay bundles.`);
    }
    findingWitnesses.set(witness.witnessId, witness);
    witnessesByFinding.set(storedBundle.findingId, findingWitnesses);
    fingerprintByFinding.set(
      storedBundle.findingId,
      normalizeTexFuzzFingerprint(bundle.observation.fingerprint),
    );
  }

  const findings = [...witnessesByFinding].sort(([left], [right]) => left.localeCompare(right))
    .map(([findingId, witnesses]): TexFuzzArtifactFinding => ({
      findingId,
      fingerprint: fingerprintByFinding.get(findingId)!,
      witnesses: [...witnesses.values()].sort((left, right) =>
        left.witnessId.localeCompare(right.witnessId)
      ),
    }));
  return {
    manifest: {
      schemaVersion: TEX_FUZZ_ARTIFACT_SCHEMA_VERSION,
      oracleEnvironment: canonicalize(oracleEnvironment) as TexFuzzOracleEnvironment,
      findings,
    },
    bundles: [...bundleByHash.values()].sort((left, right) =>
      left.witness.bundlePath.localeCompare(right.witness.bundlePath)
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseTexFuzzArtifactManifest(value: string): TexFuzzArtifactManifest {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed) || parsed.schemaVersion !== TEX_FUZZ_ARTIFACT_SCHEMA_VERSION ||
    !isRecord(parsed.oracleEnvironment) || !Array.isArray(parsed.findings)) {
    throw new Error("Unsupported or malformed TeX fuzz artifact manifest.");
  }
  const findingIds = new Set<string>();
  for (const finding of parsed.findings) {
    if (!isRecord(finding) || typeof finding.findingId !== "string" ||
      !isRecord(finding.fingerprint) || !Array.isArray(finding.witnesses)) {
      throw new Error("Malformed TeX fuzz artifact finding.");
    }
    const fingerprint = finding.fingerprint as unknown as TexFuzzFingerprint;
    if (finding.findingId !== texFuzzFindingId(fingerprint) || findingIds.has(finding.findingId)) {
      throw new Error("Inconsistent or duplicate TeX fuzz artifact finding identity.");
    }
    findingIds.add(finding.findingId);
    const witnessIds = new Set<string>();
    for (const witness of finding.witnesses) {
      if (!isRecord(witness) || typeof witness.witnessId !== "string" ||
        typeof witness.bundleHash !== "string" || !/^[0-9a-f]{64}$/.test(witness.bundleHash) ||
        typeof witness.bundlePath !== "string" || witness.bundlePath.startsWith("/") ||
        witness.bundlePath.split("/").includes("..") || typeof witness.sourceHash !== "string" ||
        witnessIds.has(witness.witnessId)) {
        throw new Error("Malformed or duplicate TeX fuzz artifact witness.");
      }
      witnessIds.add(witness.witnessId);
    }
  }
  return parsed as unknown as TexFuzzArtifactManifest;
}

export function parseTexFuzzStoredBundle(value: string): TexFuzzStoredBundle {
  const base = parseTexFuzzBundle(value);
  const parsed = JSON.parse(value) as Partial<TexFuzzStoredBundle>;
  if (parsed.artifactSchemaVersion !== TEX_FUZZ_ARTIFACT_SCHEMA_VERSION ||
    parsed.findingId !== texFuzzFindingId(base.observation.fingerprint) ||
    parsed.witnessId !== texFuzzWitnessId(base)) {
    throw new Error("Malformed or inconsistent stored TeX fuzz bundle.");
  }
  return parsed as TexFuzzStoredBundle;
}

function resolveBundlePath(manifestPath: string, relativePath: string): string {
  const root = resolve(dirname(manifestPath));
  const path = resolve(root, relativePath);
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    throw new Error(`Artifact bundle path escapes its manifest directory: ${relativePath}`);
  }
  return path;
}

export function loadStoredTexFuzzFailures(
  manifestPath: string,
  expectedEnvironment: TexFuzzOracleEnvironment,
): readonly TexFuzzLoadedFailure[] {
  const manifest = parseTexFuzzArtifactManifest(readFileSync(manifestPath, "utf8"));
  if (!sameTexFuzzEnvironment(manifest.oracleEnvironment, expectedEnvironment)) {
    throw new Error("Stored TeX fuzz oracle environment does not exactly match the requested environment.");
  }
  const loaded: TexFuzzLoadedFailure[] = [];
  for (const finding of manifest.findings) {
    for (const witness of finding.witnesses) {
      const bundleText = readFileSync(resolveBundlePath(manifestPath, witness.bundlePath), "utf8");
      if (hash(canonicalJson(JSON.parse(bundleText))) !== witness.bundleHash) {
        throw new Error(`Stored TeX fuzz bundle hash mismatch: ${witness.bundlePath}`);
      }
      const bundle = parseTexFuzzStoredBundle(bundleText);
      if (bundle.findingId !== finding.findingId || bundle.witnessId !== witness.witnessId ||
        !sameTexFuzzEnvironment(bundle.oracleEnvironment ?? {}, expectedEnvironment)) {
        throw new Error(`Stored TeX fuzz bundle metadata mismatch: ${witness.bundlePath}`);
      }
      loaded.push({ finding, witness, bundle });
    }
  }
  return loaded;
}

function witnessOwners(manifest: TexFuzzArtifactManifest): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  for (const finding of manifest.findings) {
    for (const witness of finding.witnesses) {
      const owners = result.get(witness.witnessId) ?? new Set();
      owners.add(finding.findingId);
      result.set(witness.witnessId, owners);
    }
  }
  return result;
}

export function planTexFuzzRebaseline(
  oldManifest: TexFuzzArtifactManifest,
  newManifest: TexFuzzArtifactManifest,
): TexFuzzRebaselinePlan {
  const oldOwners = witnessOwners(oldManifest);
  const newOwners = witnessOwners(newManifest);
  const oldIds = new Set(oldManifest.findings.map((finding) => finding.findingId));
  const newIds = new Set(newManifest.findings.map((finding) => finding.findingId));
  const sharedWitnesses = [...oldOwners.keys()].filter((id) => newOwners.has(id)).sort();
  const adjacency = new Map<string, Set<string>>();
  const witnessEdges = new Map<string, readonly string[]>();
  for (const witnessId of sharedWitnesses) {
    const oldNodes = [...oldOwners.get(witnessId)!].map((id) => `old:${id}`);
    const newNodes = [...newOwners.get(witnessId)!].map((id) => `new:${id}`);
    witnessEdges.set(witnessId, [...oldNodes, ...newNodes]);
    for (const oldNode of oldNodes) {
      const neighbors = adjacency.get(oldNode) ?? new Set();
      for (const newNode of newNodes) neighbors.add(newNode);
      adjacency.set(oldNode, neighbors);
    }
    for (const newNode of newNodes) {
      const neighbors = adjacency.get(newNode) ?? new Set();
      for (const oldNode of oldNodes) neighbors.add(oldNode);
      adjacency.set(newNode, neighbors);
    }
  }

  const links: Array<{ old: Set<string>; next: Set<string>; witnesses: string[] }> = [];
  const visited = new Set<string>();
  for (const start of [...adjacency.keys()].sort()) {
    if (visited.has(start)) continue;
    const nodes = new Set<string>();
    const queue = [start];
    while (queue.length > 0) {
      const node = queue.pop()!;
      if (visited.has(node)) continue;
      visited.add(node);
      nodes.add(node);
      queue.push(...(adjacency.get(node) ?? []));
    }
    links.push({
      old: new Set([...nodes].filter((node) => node.startsWith("old:")).map((node) => node.slice(4))),
      next: new Set([...nodes].filter((node) => node.startsWith("new:")).map((node) => node.slice(4))),
      witnesses: sharedWitnesses.filter((id) => witnessEdges.get(id)!.some((node) => nodes.has(node))),
    });
  }

  const result = {
    unchanged: [] as TexFuzzRebaselineLink[],
    remapped: [] as TexFuzzRebaselineLink[],
    split: [] as TexFuzzRebaselineLink[],
    merged: [] as TexFuzzRebaselineLink[],
    complex: [] as TexFuzzRebaselineLink[],
  };
  for (const link of links) {
    const item: TexFuzzRebaselineLink = {
      oldFindingIds: [...link.old].sort(),
      newFindingIds: [...link.next].sort(),
      witnessIds: link.witnesses,
    };
    if (link.old.size === 1 && link.next.size === 1) {
      const unchanged = item.oldFindingIds[0] === item.newFindingIds[0];
      result[unchanged ? "unchanged" : "remapped"].push(item);
    } else if (link.old.size === 1) result.split.push(item);
    else if (link.next.size === 1) result.merged.push(item);
    else result.complex.push(item);
  }

  const linkedOld = new Set(links.flatMap((link) => [...link.old]));
  const linkedNew = new Set(links.flatMap((link) => [...link.next]));
  return {
    schemaVersion: 1,
    oldEnvironment: oldManifest.oracleEnvironment,
    newEnvironment: newManifest.oracleEnvironment,
    resolved: [...oldIds].filter((id) => !linkedOld.has(id)).sort(),
    new: [...newIds].filter((id) => !linkedNew.has(id)).sort(),
    ...result,
  };
}
