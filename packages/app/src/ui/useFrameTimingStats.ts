import { requireArrayValue } from "@tikz-editor/core/utils/collections";
import { useEffect, useRef, useState } from "react";
import type { CanvasDragKind } from "../store/types";

const SAMPLE_WINDOW_MS = 1_000;
const PUBLISH_INTERVAL_MS = 200;

type FrameSample = {
  atMs: number;
  frameMs: number;
  dragKind: CanvasDragKind | null;
};

export type FrameTimingStats = {
  fps: number | null;
  p95FrameMs: number | null;
  maxFrameMs: number | null;
  frameCount: number;
  dragFps: number | null;
  dragP95FrameMs: number | null;
  dragMaxFrameMs: number | null;
  dragFrameCount: number;
};

const EMPTY_STATS: FrameTimingStats = {
  fps: null,
  p95FrameMs: null,
  maxFrameMs: null,
  frameCount: 0,
  dragFps: null,
  dragP95FrameMs: null,
  dragMaxFrameMs: null,
  dragFrameCount: 0
};

export function useFrameTimingStats(activeDragKind: CanvasDragKind | null, enabled = true): FrameTimingStats {
  const [stats, setStats] = useState<FrameTimingStats>(EMPTY_STATS);
  const activeDragKindRef = useRef<CanvasDragKind | null>(activeDragKind);

  useEffect(() => {
    activeDragKindRef.current = activeDragKind;
  }, [activeDragKind]);

  useEffect(() => {
    if (!enabled) {
      setStats(EMPTY_STATS);
      return;
    }

    const samples: FrameSample[] = [];
    let previousFrameTs: number | null = null;
    let lastPublishedTs = 0;
    let rafId = 0;

    const step = (nowTs: number) => {
      if (previousFrameTs != null) {
        const frameMs = Math.max(0, nowTs - previousFrameTs);
        samples.push({
          atMs: nowTs,
          frameMs,
          dragKind: activeDragKindRef.current
        });

        const cutoffTs = nowTs - SAMPLE_WINDOW_MS;
        while (samples.length > 0 && requireArrayValue(samples, 0).atMs < cutoffTs) {
          samples.shift();
        }

        if (lastPublishedTs === 0 || nowTs - lastPublishedTs >= PUBLISH_INTERVAL_MS) {
          lastPublishedTs = nowTs;
          setStats(computeStats(samples));
        }
      }

      previousFrameTs = nowTs;
      rafId = window.requestAnimationFrame(step);
    };

    rafId = window.requestAnimationFrame(step);
    return () => { window.cancelAnimationFrame(rafId); };
  }, [enabled]);

  return stats;
}

function computeStats(samples: readonly FrameSample[]): FrameTimingStats {
  if (samples.length === 0) {
    return EMPTY_STATS;
  }

  const allDurations = samples.map((sample) => sample.frameMs);
  const dragDurations = samples.filter((sample) => sample.dragKind != null).map((sample) => sample.frameMs);

  return {
    fps: (allDurations.length * 1_000) / SAMPLE_WINDOW_MS,
    p95FrameMs: percentile(allDurations, 0.95),
    maxFrameMs: max(allDurations),
    frameCount: allDurations.length,
    dragFps: dragDurations.length > 0 ? (dragDurations.length * 1_000) / SAMPLE_WINDOW_MS : null,
    dragP95FrameMs: dragDurations.length > 0 ? percentile(dragDurations, 0.95) : null,
    dragMaxFrameMs: dragDurations.length > 0 ? max(dragDurations) : null,
    dragFrameCount: dragDurations.length
  };
}

function max(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return Math.max(...values);
}

function percentile(values: readonly number[], quantile: number): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * quantile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sorted[lower] ?? null;
  }
  const weight = index - lower;
  return (sorted[lower] ?? 0) * (1 - weight) + (sorted[upper] ?? 0) * weight;
}
