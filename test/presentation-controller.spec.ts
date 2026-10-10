import { describe, expect, it } from "vitest";
import { PresentationController, presentationElapsed, type PresentationRenderer } from "../packages/app/src/presentation/controller.js";
import type { PresentationCursor } from "../packages/app/src/presentation/types.js";

function renderer(steps = [3, 1], count = steps): PresentationRenderer {
  return { frames: steps.map((value, index) => ({ index, title: `Frame ${index}`, steps: value })),
    page: async cursor => ({ cursor, svg: `${cursor.frame}:${cursor.step}:${cursor.continuation}`, notesSvg: null }),
    pageCount: async frame => count[frame] };
}
function session(render = renderer(), now?: () => number) {
  return new PresentationController({ sessionId: "test", documentId: "deck", title: "Deck", renderer: render, now });
}
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }

describe("presentation session", () => {
  it("preserves every next build while rendering is delayed", async () => {
    const delayed = deferred(), base = renderer();
    const controller = session({ ...base, page: async (cursor, signal) => {
      if (cursor.step === 2) await delayed.promise;
      return base.page(cursor, signal);
    } });
    const displayed: number[] = [];
    controller.subscribe(() => { const step = controller.getSnapshot().current?.cursor.step; if (step && displayed.at(-1) !== step) displayed.push(step); });
    await controller.jump(0);
    const second = controller.navigate("next"), third = controller.navigate("next");
    expect(controller.getSnapshot().current?.cursor.step).toBe(1);
    delayed.resolve(); await Promise.all([second, third]);
    expect(displayed).toEqual([1, 2, 3]);
    controller.stop();
  });

  it("supersedes pending jumps and rejects late results even if a renderer ignores cancellation", async () => {
    const delayed = deferred(), base = renderer([1, 1, 1]);
    const controller = session({ ...base, page: async (cursor, signal) => { if (cursor.frame === 1) await delayed.promise; return base.page(cursor, signal); } });
    await controller.jump(0);
    const obsolete = controller.jump(1);
    await controller.jump(2);
    delayed.resolve(); await obsolete;
    expect(controller.getSnapshot().current?.cursor.frame).toBe(2);
    controller.stop();
  });

  it("navigates continuation pages in both directions, and jumps to a frame's first build", async () => {
    const controller = session(renderer([1, 2], [3, 2]));
    await controller.jump(0);
    await controller.navigate("next");
    expect(controller.getSnapshot().current?.cursor).toEqual({ frame: 0, step: 1, continuation: 2 });
    await controller.navigate("next"); await controller.navigate("next");
    expect(controller.getSnapshot().current?.cursor.frame).toBe(1);
    await controller.navigate("previous");
    expect(controller.getSnapshot().current?.cursor.continuation).toBe(3);
    await controller.jump(1);
    expect(controller.getSnapshot().current?.cursor.step).toBe(1);
    controller.stop();
  });

  it("starts the timer once on next, respects pause, and resets elapsed/countdown together", async () => {
    let now = 1000;
    const controller = session(renderer(), () => now);
    await controller.jump(0);
    expect(controller.getSnapshot().timer.started).toBe(false);
    await controller.navigate("next"); now += 5000;
    controller.timer("pause");
    expect(presentationElapsed(controller.getSnapshot().timer, now)).toBe(5000);
    now += 3000; await controller.navigate("next");
    expect(controller.getSnapshot().timer.runningSince).toBeNull();
    controller.timer("start"); now += 2000;
    expect(presentationElapsed(controller.getSnapshot().timer, now)).toBe(7000);
    controller.timer("reset");
    expect(controller.getSnapshot().timer).toMatchObject({ started: false, runningSince: null, elapsedMs: 0 });
    controller.stop();
  });

  it("clamps builds on live replacement without letting the editor's position move the session", async () => {
    const controller = session();
    await controller.jump(0); await controller.navigate("next"); await controller.navigate("next");
    const old: PresentationCursor = controller.getSnapshot().current!.cursor;
    await controller.replace(renderer([1]), old, "Edited deck");
    expect(controller.getSnapshot().current?.cursor).toEqual({ frame: 0, step: 1, continuation: 1 });
    expect(controller.getSnapshot().revision).toBe(1);
    controller.setOutputAvailable(false);
    expect(controller.getSnapshot().current?.cursor.frame).toBe(0);
    expect(controller.getSnapshot().timer.runningSince).not.toBeNull();
    controller.stop();
  });
});
