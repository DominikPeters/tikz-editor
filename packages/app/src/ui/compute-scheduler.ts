export type SingleFlightScheduler<Input> = {
  schedule: (input: Input) => void;
  /** Invalidate immediately, even when the next request is still debouncing. */
  invalidate: () => void;
  dispose: () => void;
};

export type SingleFlightSchedulerOptions<Input, Output> = {
  run: (input: Input, signal: AbortSignal) => Promise<Output>;
  onStart?: (input: Input) => void;
  onSuccess?: (input: Input, output: Output) => void;
  onError?: (input: Input, error: unknown) => void;
};

export function createSingleFlightScheduler<Input, Output>(
  options: SingleFlightSchedulerOptions<Input, Output>
): SingleFlightScheduler<Input> {
  let disposed = false;
  let inFlight = false;
  let pending: Input | null = null;
  let active: AbortController | null = null;

  const runNext = (input: Input): void => {
    inFlight = true;
    const controller = new AbortController();
    active = controller;
    options.onStart?.(input);
    void options.run(input, controller.signal)
      .then((output) => {
        if (disposed || controller.signal.aborted) {
          return;
        }
        options.onSuccess?.(input, output);
      })
      .catch((error) => {
        if (disposed || controller.signal.aborted) {
          return;
        }
        options.onError?.(input, error);
      })
      .finally(() => {
        if (disposed) {
          return;
        }
        inFlight = false;
        active = null;
        if (pending == null) {
          return;
        }
        const next = pending;
        pending = null;
        runNext(next);
      });
  };

  return {
    schedule(input: Input): void {
      if (disposed) {
        return;
      }
      if (inFlight) {
        pending = input;
        active?.abort();
        return;
      }
      runNext(input);
    },
    invalidate(): void {
      pending = null;
      active?.abort();
    },
    dispose(): void {
      disposed = true;
      pending = null;
      active?.abort();
    }
  };
}
