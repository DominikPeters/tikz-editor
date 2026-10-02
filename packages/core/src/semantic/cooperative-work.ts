/** The host supplies a real task boundary (a resolved Promise is not a yield). */
export type CooperativeWorkOptions = {
  yieldControl: () => Promise<void>;
  signal?: AbortSignal;
  budgetMs?: number;
  /** Re-enter document-local services for each synchronous batch. */
  run?: <T>(operation: () => T) => T;
};

export function finishWork<T>(work: Generator<void, T, void>): T {
  let step = work.next();
  while (!step.done) step = work.next();
  return step.value;
}

export async function runCooperatively<T>(work: Generator<void, T, void>, options: CooperativeWorkOptions): Promise<T> {
  const run = options.run ?? (operation => operation());
  try {
    while (true) {
      options.signal?.throwIfAborted();
      const deadline = performance.now() + (options.budgetMs ?? 8);
      const step = run(() => {
        let next = work.next();
        while (!next.done && performance.now() < deadline) next = work.next();
        return next;
      });
      if (step.done) return step.value;
      await options.yieldControl();
    }
  } finally {
    // Cancellation closes the private run without throwing through semantic
    // fallback handlers or publishing its unfinished cache.
    work.return(undefined as T);
  }
}
