import type { CooperativeWorkOptions } from "../semantic/cooperative-work.js";

/** One budget shared by a frame's flow preparation and placement units. */
export class BeamerRenderWork {
  private deadline: number;

  constructor(readonly options: CooperativeWorkOptions) {
    this.deadline = performance.now() + (options.budgetMs ?? 8);
  }

  run<T>(operation: () => T): T {
    return this.options.run ? this.options.run(operation) : operation();
  }

  async checkpoint(): Promise<void> {
    this.options.signal?.throwIfAborted();
    if (performance.now() >= this.deadline) {
      await this.options.yieldControl();
      this.options.signal?.throwIfAborted();
      this.deadline = performance.now() + (this.options.budgetMs ?? 8);
    }
  }
}

export function runBeamerRenderOperation<T>(work: BeamerRenderWork | undefined, operation: () => T): T {
  return work ? work.run(operation) : operation();
}
