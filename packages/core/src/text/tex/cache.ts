type TexCacheEntry<K, V> = {
  key: K;
  value: V;
  bytes: number;
  previous: TexCacheEntry<K, V> | null;
  next: TexCacheEntry<K, V> | null;
};

/** LRU bounded by both entry count and estimated retained bytes. */
export class TexWeightedLruCache<K, V> {
  private readonly entries = new Map<K, TexCacheEntry<K, V>>();
  private oldest: TexCacheEntry<K, V> | null = null;
  private newest: TexCacheEntry<K, V> | null = null;
  private bytes = 0;

  public constructor(
    private readonly maxEntries: number,
    private readonly maxBytes: number,
    private readonly options: {
      readonly onEvict?: (key: K, value: V) => void;
      /** Preserve immediate rendering of a single result larger than the budget. */
      readonly retainOversizedEntry?: boolean;
    } = {}
  ) {}

  public get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry !== this.newest) {
      this.unlink(entry);
      this.append(entry);
    }
    return entry.value;
  }

  public set(key: K, value: V, bytes: number): boolean {
    this.delete(key);
    if (!Number.isFinite(bytes) || bytes < 0 ||
      (bytes > this.maxBytes && !this.options.retainOversizedEntry)) return false;
    const entry = { key, value, bytes, previous: null, next: null };
    this.entries.set(key, entry);
    this.append(entry);
    this.bytes += bytes;
    while (this.entries.size > this.maxEntries ||
      (this.bytes > this.maxBytes && this.entries.size > 1)) {
      const oldest = this.oldest;
      if (!oldest) break;
      this.delete(oldest.key);
    }
    return this.entries.has(key);
  }

  public delete(key: K): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key);
    this.unlink(entry);
    this.bytes -= entry.bytes;
    this.options.onEvict?.(key, entry.value);
    return true;
  }

  public *values(): IterableIterator<V> {
    for (let entry = this.oldest; entry; entry = entry.next) yield entry.value;
  }

  private unlink(entry: TexCacheEntry<K, V>): void {
    if (entry.previous) entry.previous.next = entry.next;
    else this.oldest = entry.next;
    if (entry.next) entry.next.previous = entry.previous;
    else this.newest = entry.previous;
    entry.previous = null;
    entry.next = null;
  }

  private append(entry: TexCacheEntry<K, V>): void {
    entry.previous = this.newest;
    if (this.newest) this.newest.next = entry;
    else this.oldest = entry;
    this.newest = entry;
  }
}

/** Only call on cache-owned plain objects/arrays, never caller-owned inputs. */
export function freezeTexCacheValue(value: object): number {
  const seen = new Set<object>();
  const pending: object[] = [value];
  let bytes = 0;
  while (pending.length) {
    const current = pending.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    const values: unknown[] = Object.values(current);
    bytes += 48 + values.length * 16;
    for (const child of values) {
      if (typeof child === "string") bytes += 24 + child.length * 2;
      else if (child && typeof child === "object") pending.push(child);
      else bytes += 8;
    }
    Object.freeze(current);
  }
  return bytes;
}
