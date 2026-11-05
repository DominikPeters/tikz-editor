import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { setImmediate } from "node:timers/promises";

/** Run real GC after WeakRef creation jobs have ended, without exposing global gc. */
export async function collectTestGarbage(): Promise<void> {
  setFlagsFromString("--expose-gc");
  let collectGarbage: () => void;
  try {
    collectGarbage = runInNewContext("gc") as () => void;
  } finally {
    setFlagsFromString("--no-expose-gc");
  }
  for (let index = 0; index < 5; index++) {
    await setImmediate();
    collectGarbage();
  }
}
