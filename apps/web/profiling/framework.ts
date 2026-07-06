import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import type { TestInfo } from "@playwright/test";
import { fileURLToPath } from "node:url";
import type { AppProfilingSnapshot } from "../../../packages/app/src/profiling";
import { startCDPProfile, stopCDPProfile } from "./helpers";

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const TRACES_DIR = path.join(THIS_DIR, "traces");
export const PROFILE_REPORT_VERSION = 1;

export type ProfilingScenarioCategory =
  | "actions"
  | "basic-drag"
  | "paper"
  | "canvas-edit"
  | "source-edit";

export type ProfilingScenarioManifest = {
  id: string;
  category: ProfilingScenarioCategory;
  description: string;
  specPath: string;
};

export type FrameStats = {
  count: number;
  p95Ms: number | null;
  maxMs: number | null;
  avgMs: number | null;
};

export type ProfilingEnvironmentMetadata = {
  generatedAtIso: string;
  appMode: "production";
  browserProject: string;
  gitCommitSha: string | null;
  tracesDir: string;
};

export type ProfilingVariantReport<
  TMetrics extends Record<string, unknown> = Record<string, unknown>,
  TProbeSnapshot = unknown
> = {
  id: string;
  label: string;
  dimensions: Record<string, string | number | boolean | null>;
  artifacts: {
    cpuProfilePath: string | null;
    analysisPath: string | null;
  };
  metrics: TMetrics;
  frameStats: FrameStats | null;
  instrumentation: AppProfilingSnapshot;
  probeSnapshot: TProbeSnapshot;
};

export type ProfilingScenarioReport<
  TMetrics extends Record<string, unknown> = Record<string, unknown>,
  TProbeSnapshot = unknown
> = {
  version: number;
  scenario: {
    id: string;
    category: ProfilingScenarioCategory;
    description: string;
  };
  environment: ProfilingEnvironmentMetadata;
  variants: Array<ProfilingVariantReport<TMetrics, TProbeSnapshot>>;
};

export function ensureTracesDir(): void {
  fs.mkdirSync(TRACES_DIR, { recursive: true });
}

export function roundNumber(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }
  return Number(value.toFixed(2));
}

export function summarizeFrameDurations(frameDurations: readonly number[]): FrameStats {
  if (frameDurations.length === 0) {
    return {
      count: 0,
      p95Ms: null,
      maxMs: null,
      avgMs: null
    };
  }
  const sorted = [...frameDurations].sort((a, b) => a - b);
  const index = (sorted.length - 1) * 0.95;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const p95 =
    lower === upper
      ? sorted[lower] ?? null
      : (sorted[lower] ?? 0) * (1 - (index - lower)) + (sorted[upper] ?? 0) * (index - lower);
  const total = frameDurations.reduce((sum, value) => sum + value, 0);
  return {
    count: frameDurations.length,
    p95Ms: roundNumber(p95),
    maxMs: roundNumber(Math.max(...frameDurations)),
    avgMs: roundNumber(total / frameDurations.length)
  };
}

export async function performPacedMouseDrag(
  page: import("@playwright/test").Page,
  points: ReadonlyArray<{ x: number; y: number }>,
  delayMs = 16
): Promise<void> {
  if (points.length < 2) {
    throw new Error("A paced mouse drag requires at least two points.");
  }
  const [start, ...rest] = points;
  if (!start) {
    throw new Error("A paced mouse drag requires a start point.");
  }

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (const point of rest) {
    await page.mouse.move(point.x, point.y);
    await page.waitForTimeout(delayMs);
  }
  await page.mouse.up();
}

export function buildLinearDragPath(
  start: { x: number; y: number },
  dx: number,
  dy: number,
  steps: number
): Array<{ x: number; y: number }> {
  const safeSteps = Math.max(1, Math.floor(steps));
  const points: Array<{ x: number; y: number }> = [start];
  for (let step = 1; step <= safeSteps; step += 1) {
    const progress = step / safeSteps;
    points.push({
      x: start.x + dx * progress,
      y: start.y + dy * progress
    });
  }
  return points;
}

export function buildPolylineDragPath(
  start: { x: number; y: number },
  deltas: ReadonlyArray<{ dx: number; dy: number }>,
  stepsPerSegment: number
): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [start];
  let segmentStart = start;
  for (const delta of deltas) {
    const segment = buildLinearDragPath(segmentStart, delta.dx, delta.dy, stepsPerSegment);
    points.push(...segment.slice(1));
    segmentStart = {
      x: segmentStart.x + delta.dx,
      y: segmentStart.y + delta.dy
    };
  }
  return points;
}

export function reportPathForScenario(scenarioId: string): string {
  ensureTracesDir();
  return path.join(TRACES_DIR, `${scenarioId}-report.json`);
}

export function cpuProfileFilename(scenarioId: string, variantId: string): string {
  return `${scenarioId}-${variantId}.cpuprofile`;
}

export async function resetAppProfilingSession(page: import("@playwright/test").Page, label: string): Promise<void> {
  await page.evaluate((nextLabel) => {
    const api = (globalThis as {
      __TIKZ_EDITOR_APP_TEST_API__?: {
        resetProfilingSession?: (label?: string | null) => void;
      };
    }).__TIKZ_EDITOR_APP_TEST_API__;
    if (typeof api?.resetProfilingSession !== "function") {
      throw new Error("App profiling session reset is unavailable.");
    }
    api.resetProfilingSession(nextLabel);
  }, label);
}

export async function readAppProfilingSnapshot(page: import("@playwright/test").Page): Promise<AppProfilingSnapshot> {
  return await page.evaluate(() => {
    const api = (globalThis as {
      __TIKZ_EDITOR_APP_TEST_API__?: {
        getProfilingSnapshot?: () => AppProfilingSnapshot;
      };
    }).__TIKZ_EDITOR_APP_TEST_API__;
    if (typeof api?.getProfilingSnapshot !== "function") {
      throw new Error("App profiling snapshot API is unavailable.");
    }
    return api.getProfilingSnapshot();
  });
}

export async function readSourceRevision(page: import("@playwright/test").Page): Promise<number> {
  return await page.evaluate(() => {
    const api = (globalThis as {
      __TIKZ_EDITOR_APP_TEST_API__?: {
        getSourceRevision?: () => number;
      };
    }).__TIKZ_EDITOR_APP_TEST_API__;
    return api?.getSourceRevision?.() ?? 0;
  });
}

export function buildEnvironmentMetadata(testInfo: TestInfo): ProfilingEnvironmentMetadata {
  return {
    generatedAtIso: new Date().toISOString(),
    appMode: "production",
    browserProject: testInfo.project.name,
    gitCommitSha: readGitCommitSha(),
    tracesDir: TRACES_DIR
  };
}

export function writeScenarioReport<
  TMetrics extends Record<string, unknown>,
  TProbeSnapshot
>(
  manifest: ProfilingScenarioManifest,
  testInfo: TestInfo,
  variants: Array<ProfilingVariantReport<TMetrics, TProbeSnapshot>>
): string {
  ensureTracesDir();
  const report: ProfilingScenarioReport<TMetrics, TProbeSnapshot> = {
    version: PROFILE_REPORT_VERSION,
    scenario: {
      id: manifest.id,
      category: manifest.category,
      description: manifest.description
    },
    environment: buildEnvironmentMetadata(testInfo),
    variants
  };
  const outPath = reportPathForScenario(manifest.id);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  return outPath;
}

export async function captureProfileVariant<
  TMetrics extends Record<string, unknown>,
  TProbeSnapshot
>(params: {
  page: import("@playwright/test").Page;
  scenarioId: string;
  variantId: string;
  label: string;
  dimensions: Record<string, string | number | boolean | null>;
  run: () => Promise<{
    metrics: TMetrics;
    frameStats: FrameStats | null;
    probeSnapshot: TProbeSnapshot;
  }>;
}): Promise<ProfilingVariantReport<TMetrics, TProbeSnapshot>> {
  await resetAppProfilingSession(params.page, `${params.scenarioId}:${params.variantId}`);
  const browserName = params.page.context().browser()?.browserType().name() ?? "unknown";
  const client = browserName === "chromium" ? await startCDPProfile(params.page) : null;
  const result = await params.run();
  const instrumentation = await readAppProfilingSnapshot(params.page);
  const cpuProfilePath =
    client == null
      ? null
      : await stopCDPProfile(client, cpuProfileFilename(params.scenarioId, params.variantId));
  return {
    id: params.variantId,
    label: params.label,
    dimensions: params.dimensions,
    artifacts: {
      cpuProfilePath,
      analysisPath: null
    },
    metrics: result.metrics,
    frameStats: result.frameStats,
    instrumentation,
    probeSnapshot: result.probeSnapshot
  };
}

function readGitCommitSha(): string | null {
  try {
    return execSync("git rev-parse --short HEAD", {
      cwd: path.resolve(THIS_DIR, "../.."),
      stdio: ["ignore", "pipe", "ignore"]
    }).toString("utf8").trim() || null;
  } catch {
    return null;
  }
}
