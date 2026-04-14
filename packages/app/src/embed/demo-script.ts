import type { EditAction } from "tikz-editor/edit/actions";
import type { EditorAction } from "../store/types";

export type Easing = "linear" | "easeInOut" | "easeOut";

export type CursorKeyframe = {
  t: number;
  x: number;
  y: number;
  ease?: Easing;
  visible?: boolean;
  pressed?: boolean;
};

// Discrete events applied to the scoped store at their scheduled time.
// Synthetic pointer events are reserved for a later pass; until then, demos
// drive state via direct dispatch.
export type DemoEvent =
  | { t: number; kind: "dispatch"; action: EditAction }
  | { t: number; kind: "storeAction"; action: EditorAction }
  | { t: number; kind: "loadSource"; source: string };

export type DemoScript = {
  id: string;
  duration: number;
  initialSource: string;
  cursor: CursorKeyframe[];
  events: DemoEvent[];
};

export type CursorFrameState = {
  x: number;
  y: number;
  visible: boolean;
  pressed: boolean;
};

// Throws if the script's cursor or event tracks aren't sorted by `t`. Demos
// are authored by hand and forgetting to sort is easy — catch it early.
export function validateDemoScript(script: DemoScript): void {
  for (let i = 1; i < script.cursor.length; i += 1) {
    if (script.cursor[i]!.t < script.cursor[i - 1]!.t) {
      throw new Error(`DemoScript "${script.id}": cursor keyframes must be sorted by t (index ${i})`);
    }
  }
  for (let i = 1; i < script.events.length; i += 1) {
    if (script.events[i]!.t < script.events[i - 1]!.t) {
      throw new Error(`DemoScript "${script.id}": events must be sorted by t (index ${i})`);
    }
  }
  if (script.duration <= 0) {
    throw new Error(`DemoScript "${script.id}": duration must be > 0`);
  }
}

const EASING_FNS: Record<Easing, (t: number) => number> = {
  linear: (t) => t,
  easeInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  easeOut: (t) => 1 - Math.pow(1 - t, 3)
};

// Resolve cursor state at time `t` from a sorted keyframe list. Returns null
// when the track is empty.
export function resolveCursorAt(keyframes: readonly CursorKeyframe[], t: number): CursorFrameState | null {
  if (keyframes.length === 0) {
    return null;
  }
  if (t <= keyframes[0]!.t) {
    const kf = keyframes[0]!;
    return { x: kf.x, y: kf.y, visible: kf.visible ?? true, pressed: kf.pressed ?? false };
  }
  for (let i = 0; i < keyframes.length - 1; i += 1) {
    const a = keyframes[i]!;
    const b = keyframes[i + 1]!;
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t;
      const raw = span <= 0 ? 1 : (t - a.t) / span;
      const eased = (EASING_FNS[b.ease ?? "linear"] ?? EASING_FNS.linear)(raw);
      return {
        x: a.x + (b.x - a.x) * eased,
        y: a.y + (b.y - a.y) * eased,
        visible: b.visible ?? a.visible ?? true,
        pressed: b.pressed ?? a.pressed ?? false
      };
    }
  }
  const last = keyframes[keyframes.length - 1]!;
  return { x: last.x, y: last.y, visible: last.visible ?? true, pressed: last.pressed ?? false };
}
