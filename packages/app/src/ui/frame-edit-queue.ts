/** Coalesce pointer updates while retaining the final sample and gesture owner. */
export function createFrameEditQueue<Owner, Sample>(
  apply: (owner: Owner, sample: Sample) => void,
  schedule: (callback: FrameRequestCallback) => number = requestAnimationFrame,
  cancelFrame: (id: number) => void = cancelAnimationFrame
) {
  let pending: { owner: Owner; sample: Sample } | null = null;
  let frame: number | null = null;
  const cancel = () => {
    if (frame != null) cancelFrame(frame);
    frame = null;
    pending = null;
  };
  const flush = () => {
    const next = pending;
    cancel();
    if (next) apply(next.owner, next.sample);
  };
  return {
    push(owner: Owner, sample: Sample) {
      pending = { owner, sample };
      frame ??= schedule(flush);
    },
    flush, cancel
  };
}
