import { requireDefined } from "../../utils/invariants.js";
import { requireArrayValue } from "../../utils/collections.js";
import type { Intent } from "./intent.js";

/**
 * The revision protocol for step 2 of the migration
 * (design/canvas-editing-architecture.md, "Transactions"): the buffer
 * advances synchronously with every transaction, but the rendered layout
 * lags. An intent that reads the layout waits until the layout reflects
 * the current buffer, and every intent submitted after it waits behind it,
 * so keystrokes are never dropped or reordered.
 *
 * If the layout does not catch up (a render failed), the owner calls
 * `flush()`: queued intents run against the layout as it is, and later
 * intents run immediately until the layout is current again. Structural
 * edits keep their staleness guard for that case.
 */
export type IntentScheduler = {
  submit(intent: Intent): void;
  /** The layout changed; run what can run now. */
  layoutChanged(): void;
  /** Run everything now against the current layout, however stale. */
  flush(): void;
  /** Drop queued intents (the session ended). */
  reset(): void;
  readonly pending: number;
};

export type IntentSchedulerOptions = {
  needsFreshLayout(intent: Intent): boolean;
  isLayoutFresh(): boolean;
  run(intent: Intent): void;
  /** Called when an intent starts waiting on an empty queue. */
  onWait?(): void;
};

export function createIntentScheduler(options: IntentSchedulerOptions): IntentScheduler {
  const queue: Intent[] = [];
  let degraded = false;

  const canRun = (intent: Intent) =>
    degraded || !options.needsFreshLayout(intent) || options.isLayoutFresh();

  const drain = () => {
    while (queue.length > 0 && canRun(requireArrayValue(queue, 0))) {
      options.run(requireDefined(queue.shift(), "Missing required queue.shift()"));
    }
  };

  return {
    submit(intent) {
      if (queue.length === 0 && canRun(intent)) {
        options.run(intent);
        return;
      }
      queue.push(intent);
      if (queue.length === 1) {
        options.onWait?.();
      }
    },
    layoutChanged() {
      if (degraded && options.isLayoutFresh()) {
        degraded = false;
      }
      drain();
    },
    flush() {
      degraded = !options.isLayoutFresh();
      while (queue.length > 0) {
        options.run(requireDefined(queue.shift(), "Missing required queue.shift()"));
      }
    },
    reset() {
      queue.length = 0;
      degraded = false;
    },
    get pending() {
      return queue.length;
    },
  };
}
