import type { TexFuzzChoice } from "./model.js";

const UINT32_RANGE = 0x1_0000_0000;

export class TexFuzzRandom {
  readonly #choices: TexFuzzChoice[] = [];
  #state: number;

  constructor(seed: number) {
    if (!Number.isSafeInteger(seed)) {
      throw new RangeError(`TeX fuzz seed must be a safe integer, received ${seed}.`);
    }
    this.#state = seed >>> 0;
  }

  nextUint32(): number {
    this.#state = (this.#state + 0x6d2b79f5) >>> 0;
    let value = this.#state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  }

  int(path: string, upperExclusive: number): number {
    if (!Number.isSafeInteger(upperExclusive) || upperExclusive <= 0 || upperExclusive > UINT32_RANGE) {
      throw new RangeError(`Invalid integer choice bound ${upperExclusive} at ${path}.`);
    }
    const limit = Math.floor(UINT32_RANGE / upperExclusive) * upperExclusive;
    let sample = this.nextUint32();
    while (sample >= limit) {
      sample = this.nextUint32();
    }
    const value = sample % upperExclusive;
    this.#choices.push({ path, upperExclusive, value });
    return value;
  }

  boolean(path: string): boolean {
    return this.int(path, 2) === 1;
  }

  pick<const T>(path: string, values: readonly T[]): T {
    if (values.length === 0) {
      throw new RangeError(`Cannot choose from an empty list at ${path}.`);
    }
    return values[this.int(path, values.length)];
  }

  weightedIndex(path: string, integerWeights: readonly number[]): number {
    if (integerWeights.length === 0) {
      throw new RangeError(`Cannot choose from an empty weight list at ${path}.`);
    }
    let total = 0;
    for (const weight of integerWeights) {
      if (!Number.isSafeInteger(weight) || weight < 0) {
        throw new RangeError(`Invalid integer weight ${weight} at ${path}.`);
      }
      total += weight;
      if (!Number.isSafeInteger(total) || total > UINT32_RANGE) {
        throw new RangeError(`Integer weight total exceeds ${UINT32_RANGE} at ${path}.`);
      }
    }
    if (total === 0) {
      throw new RangeError(`At least one integer weight must be positive at ${path}.`);
    }
    const sample = this.int(path, total);
    let cumulative = 0;
    for (let index = 0; index < integerWeights.length; index += 1) {
      cumulative += integerWeights[index];
      if (sample < cumulative) return index;
    }
    throw new Error(`Unreachable weighted choice state at ${path}.`);
  }

  weightedPick<const T>(path: string, values: readonly T[], integerWeights: readonly number[]): T {
    if (values.length !== integerWeights.length) {
      throw new RangeError(`Weighted value and weight counts differ at ${path}.`);
    }
    return values[this.weightedIndex(path, integerWeights)];
  }

  choices(): readonly TexFuzzChoice[] {
    return this.#choices.map((choice) => ({ ...choice }));
  }
}
