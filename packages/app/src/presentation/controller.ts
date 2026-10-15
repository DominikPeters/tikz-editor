import type { PresentationCommand, PresentationCursor, PresentationFrame, PresentationPage, PresentationSnapshot, PresentationTimer } from "./types";

export interface PresentationRenderer {
  readonly frames: readonly PresentationFrame[];
  page(cursor: PresentationCursor, signal: AbortSignal): Promise<PresentationPage>;
  pageCount(frame: number, signal: AbortSignal): Promise<number>;
}

export function presentationElapsed(timer: PresentationTimer, now = Date.now()): number {
  return timer.elapsedMs + (timer.runningSince === null ? 0 : Math.max(0, now - timer.runningSince));
}

function first(frame: number): PresentationCursor { return { frame, step: 1, continuation: 1 }; }
function same(left: PresentationCursor, right: PresentationCursor): boolean {
  return left.frame === right.frame && left.step === right.step && left.continuation === right.continuation;
}

/** One owner orders builds, supersedes jumps, and fences all asynchronous results by revision. */
export class PresentationController {
  private snapshot: PresentationSnapshot;
  private listeners = new Set<() => void>();
  private work = new AbortController();
  private previewWork = new AbortController();
  private queue: Promise<void> = Promise.resolve();
  private generation = 0;
  private renderer: PresentationRenderer;
  constructor(params: { sessionId: string; documentId: string; title: string; renderer: PresentationRenderer; budgetMs?: number | null; now?: () => number }) {
    this.renderer = params.renderer;
    this.now = params.now ?? Date.now;
    this.snapshot = { sessionId: params.sessionId, documentId: params.documentId, title: params.title,
      revision: 0, sequence: 0, ended: false, frames: params.renderer.frames,
      current: null, next: null, thumbnails: {}, blank: "none",
      timer: { elapsedMs: 0, runningSince: null, started: false, budgetMs: params.budgetMs ?? null },
      outputAvailable: true, presenterVisible: false, error: null };
  }
  private now: () => number;
  getSnapshot = (): PresentationSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<PresentationSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch, sequence: this.snapshot.sequence + 1 };
    for (const listener of this.listeners) listener();
  }
  setOutputAvailable(value: boolean): void { if (value !== this.snapshot.outputAvailable) this.update({ outputAvailable: value }); }
  setPresenterVisible(value: boolean): void { if (value !== this.snapshot.presenterVisible) this.update({ presenterVisible: value }); }
  setError(error: string | null): void { this.update({ error }); }
  setTitle(title: string): void { if (title !== this.snapshot.title) this.update({ title }); }

  timer(action: "start" | "pause" | "reset"): void {
    const timer = this.snapshot.timer;
    if (action === "reset") this.update({ timer: { ...timer, elapsedMs: 0, runningSince: null, started: false } });
    else if (action === "start" && timer.runningSince === null) this.update({ timer: { ...timer, started: true, runningSince: this.now() } });
    else if (action === "pause" && timer.runningSince !== null) this.update({ timer: { ...timer, elapsedMs: presentationElapsed(timer, this.now()), runningSince: null } });
  }

  private async neighbor(cursor: PresentationCursor, direction: 1 | -1, signal: AbortSignal): Promise<PresentationCursor> {
    const steps = this.renderer.frames[cursor.frame]?.steps ?? 1;
    const count = await this.renderer.pageCount(cursor.frame, signal);
    signal.throwIfAborted();
    const ordinal = cursor.continuation > 1 ? steps + cursor.continuation - 1 : cursor.step;
    const wanted = ordinal + direction;
    if (wanted >= 1 && wanted <= count) return wanted <= steps ? { frame: cursor.frame, step: wanted, continuation: 1 } : { frame: cursor.frame, step: 1, continuation: wanted - steps + 1 };
    const frame = cursor.frame + direction;
    if (frame < 0 || frame >= this.renderer.frames.length) return cursor;
    if (direction === 1) return first(frame);
    const last = await this.renderer.pageCount(frame, signal);
    const lastFrame = this.renderer.frames[frame];
    if (!lastFrame) return cursor;
    const lastSteps = lastFrame.steps;
    return last <= lastSteps ? { frame, step: last, continuation: 1 } : { frame, step: 1, continuation: last - lastSteps + 1 };
  }

  private async commit(cursor: PresentationCursor, generation: number, signal: AbortSignal, metadata: Partial<PresentationSnapshot> = {}, renderFrom = this.renderer): Promise<void> {
    const page = await renderFrom.page(cursor, signal);
    signal.throwIfAborted();
    if (generation !== this.generation || this.snapshot.ended) return;
    this.renderer = renderFrom;
    this.update({ ...metadata, current: page, next: null, error: null });
    this.previewWork.abort();
    this.previewWork = new AbortController();
    const previewSignal = this.previewWork.signal;
    const renderer = this.renderer;
    void (async () => {
      const nextCursor = await this.neighbor(page.cursor, 1, previewSignal);
      if (same(page.cursor, nextCursor)) return;
      const next = await renderer.page(nextCursor, previewSignal);
      if (!previewSignal.aborted && generation === this.generation && this.snapshot.current === page) this.update({ next });
      // One further build/page of lookahead; errors here never alter the live output.
      const ahead = await this.neighbor(nextCursor, 1, previewSignal);
      if (!same(ahead, nextCursor)) await renderer.page(ahead, previewSignal);
    })().catch(() => {});
  }

  private supersede(): number {
    this.generation++;
    this.work.abort(); this.previewWork.abort();
    this.work = new AbortController();
    this.queue = Promise.resolve();
    return this.generation;
  }

  jump(frame: number): Promise<void> {
    if (this.snapshot.ended || !this.renderer.frames[frame]) return Promise.resolve();
    const generation = this.supersede();
    const signal = this.work.signal;
    this.queue = this.commit(first(frame), generation, signal).catch((error: unknown) => { this.renderError(error, signal); });
    return this.queue;
  }

  async replace(renderer: PresentationRenderer, cursor: PresentationCursor, title: string): Promise<boolean> {
    if (this.snapshot.ended) return false;
    if (!renderer.frames.length) { this.setError("There are no slides in this document. The last valid slide is still displayed."); return false; }
    const generation = this.supersede();
    const revision = this.snapshot.revision + 1;
    const signal = this.work.signal;
    const frame = Math.max(0, Math.min(cursor.frame, renderer.frames.length - 1));
    this.queue = (async () => {
      const count = await renderer.pageCount(frame, signal);
      const targetFrame = renderer.frames[frame];
      if (!targetFrame) throw new RangeError(`Missing presentation frame ${frame}`);
      const steps = targetFrame.steps;
      const target = { frame, step: Math.min(cursor.step, steps), continuation: Math.min(cursor.continuation, Math.max(1, count - steps + 1)) };
      await this.commit(target, generation, signal, { frames: renderer.frames, revision, thumbnails: {}, title }, renderer);
    })().catch((error: unknown) => { this.renderError(error, signal); });
    await this.queue;
    return !signal.aborted && generation === this.generation && this.snapshot.revision === revision;
  }

  navigate(type: "next" | "previous" | "next-frame" | "previous-frame"): Promise<void> {
    if (this.snapshot.ended) return Promise.resolve();
    if (type === "next" && !this.snapshot.timer.started) this.timer("start");
    const generation = this.generation, signal = this.work.signal;
    this.queue = this.queue.then(async () => {
      if (signal.aborted || generation !== this.generation || !this.renderer.frames.length) return;
      const cursor = this.snapshot.current?.cursor ?? first(0);
      const direction = type === "next" || type === "next-frame" ? 1 : -1;
      const target = type.endsWith("-frame") ? first(Math.max(0, Math.min(this.renderer.frames.length - 1, cursor.frame + direction))) : await this.neighbor(cursor, direction, signal);
      if (!same(cursor, target) || !this.snapshot.current) await this.commit(target, generation, signal);
    }).catch((error: unknown) => { this.renderError(error, signal); });
    return this.queue;
  }

  private renderError(error: unknown, signal: AbortSignal): void {
    if (!signal.aborted) {
      console.info("[tikz-editor] Presentation render failed", error);
      this.setError("Couldn’t update the slide. The last valid slide is still displayed.");
    }
  }
  async thumbnail(frame: number): Promise<void> {
    if (this.snapshot.thumbnails[frame] || !this.renderer.frames[frame] || this.snapshot.ended) return;
    const generation = this.generation, signal = this.work.signal;
    try {
      const page = await this.renderer.page(first(frame), signal);
      if (generation !== this.generation || signal.aborted) return;
      // Keep published previews bounded too; a long filmstrip requests its visible region.
      const entries: Array<[string, string]> = [...Object.entries(this.snapshot.thumbnails).filter(([index]) => Number(index) !== frame).slice(-31), [String(frame), page.svg]];
      let bytes = entries.reduce((sum, entry) => sum + entry[1].length * 2, 0);
      while (bytes > 8 * 1024 * 1024 && entries.length) bytes -= entries.shift()![1].length * 2;
      this.update({ thumbnails: Object.fromEntries(entries) });
    } catch { /* The live page reports failures; thumbnails are best effort. */ }
  }
  command(command: PresentationCommand): Promise<void> {
    switch (command.type) {
      case "next": case "previous": case "next-frame": case "previous-frame": return this.navigate(command.type);
      case "jump": return this.jump(command.frame);
      case "thumbnail": return this.thumbnail(command.frame);
      case "blank": this.update({ blank: command.value }); break;
      case "timer": this.timer(command.action); break;
      case "stop": this.stop(); break;
      case "show-presenter": case "recover-output": case "swap-displays": break;
      case "close-view": break;
    }
    return Promise.resolve();
  }
  stop(): void {
    if (this.snapshot.ended) return;
    this.supersede();
    this.update({ ended: true, timer: { ...this.snapshot.timer, elapsedMs: presentationElapsed(this.snapshot.timer, this.now()), runningSince: null } });
  }
}
