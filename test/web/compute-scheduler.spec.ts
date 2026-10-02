import { describe, expect, it } from "vitest";

import { createSingleFlightScheduler } from "../../packages/app/src/ui/compute-scheduler";

describe("single-flight compute scheduler", () => {
  it("aborts obsolete work and starts the latest request without reporting an error", async () => {
    const signals: AbortSignal[] = [];
    const completed: number[] = [];
    const errors: unknown[] = [];
    const scheduler = createSingleFlightScheduler<number, number>({
      run: (input, signal) => {
        signals.push(signal);
        return input === 1
          ? new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("Cancelled")), { once: true }))
          : Promise.resolve(input);
      },
      onSuccess: (_input, output) => completed.push(output),
      onError: (_input, error) => errors.push(error)
    });
    scheduler.schedule(1);
    scheduler.schedule(2);
    scheduler.schedule(3);
    expect(signals[0].aborted).toBe(true);
    await waitFor(() => completed.length > 0);
    expect(completed).toEqual([3]);
    expect(errors).toEqual([]);
    scheduler.dispose();
  });

  it("runs at most one request in flight and coalesces to the latest pending input", async () => {
    const started: number[] = [];
    const finished: number[] = [];
    const deferreds = new Map<number, Deferred<number>>();
    let active = 0;
    let maxActive = 0;

    const scheduler = createSingleFlightScheduler<number, number>({
      run: async (input) => {
        started.push(input);
        const deferred = createDeferred<number>();
        deferreds.set(input, deferred);
        active += 1;
        maxActive = Math.max(maxActive, active);
        const value = await deferred.promise;
        active -= 1;
        return value;
      },
      onSuccess: (_input, output) => {
        finished.push(output);
      }
    });

    scheduler.schedule(1);
    scheduler.schedule(2);
    scheduler.schedule(3);

    expect(started).toEqual([1]);
    deferreds.get(1)?.resolve(1);
    await flushMicrotasks();

    expect(started).toEqual([1, 3]);
    deferreds.get(3)?.resolve(3);
    await flushMicrotasks();

    expect(finished).toEqual([3]);
    expect(maxActive).toBe(1);
    scheduler.dispose();
  });

  it("drops intermediate queued inputs during bursts", async () => {
    const started: number[] = [];
    const deferreds = new Map<number, Deferred<number>>();

    const scheduler = createSingleFlightScheduler<number, number>({
      run: async (input) => {
        started.push(input);
        const deferred = createDeferred<number>();
        deferreds.set(input, deferred);
        return deferred.promise;
      }
    });

    scheduler.schedule(10);
    for (let value = 11; value <= 20; value += 1) {
      scheduler.schedule(value);
    }
    expect(started).toEqual([10]);

    deferreds.get(10)?.resolve(10);
    await waitFor(() => started.length === 2);
    expect(started).toEqual([10, 20]);

    deferreds.get(20)?.resolve(20);
    await flushMicrotasks();
    scheduler.dispose();
  });

  it("ignores callbacks after dispose", async () => {
    let successCount = 0;
    const deferred = createDeferred<number>();

    const scheduler = createSingleFlightScheduler<number, number>({
      run: async () => deferred.promise,
      onSuccess: () => {
        successCount += 1;
      }
    });

    scheduler.schedule(1);
    scheduler.dispose();
    deferred.resolve(1);
    await flushMicrotasks();

    expect(successCount).toBe(0);
  });

  it("can invalidate during a typing debounce without publishing or starting queued work", async () => {
    const started: number[] = [];
    const finished: number[] = [];
    const deferred = createDeferred<number>();
    const scheduler = createSingleFlightScheduler<number, number>({
      run: async input => { started.push(input); return input === 1 ? deferred.promise : input; },
      onSuccess: (_input, output) => finished.push(output)
    });
    scheduler.schedule(1);
    scheduler.schedule(2);
    scheduler.invalidate();
    deferred.resolve(1);
    await flushMicrotasks();
    expect(started).toEqual([1]);
    expect(finished).toEqual([]);
    scheduler.schedule(3);
    await waitFor(() => finished.length > 0);
    expect(finished).toEqual([3]);
    scheduler.dispose();
  });
});

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return {
    promise,
    resolve
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function waitFor(
  predicate: () => boolean,
  maxAttempts = 40
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (predicate()) {
      return;
    }
    await flushMicrotasks();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for scheduler state");
}
