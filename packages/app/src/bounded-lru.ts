/** Entry and estimated-byte limits; oversize entries are never retained. */
export class BoundedLru<K, V> {
  private entries = new Map<K, { value: V; weight: number }>();
  private bytes = 0;
  constructor(readonly maxEntries: number, readonly maxBytes: number) {}
  get size(): number { return this.entries.size; }
  get retainedBytes(): number { return this.bytes; }
  get(key: K): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key); this.entries.set(key, entry);
    return entry.value;
  }
  set(key: K, value: V, weight: number): void {
    const previous = this.entries.get(key);
    if (previous) { this.entries.delete(key); this.bytes -= previous.weight; }
    if (weight > this.maxBytes) return;
    this.entries.set(key, { value, weight }); this.bytes += weight;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.entries.entries().next().value;
      if (!oldest) break;
      this.entries.delete(oldest[0]); this.bytes -= oldest[1].weight;
    }
  }
  fork(): BoundedLru<K, V> {
    const copy = new BoundedLru<K, V>(this.maxEntries, this.maxBytes);
    copy.entries = new Map(this.entries); copy.bytes = this.bytes;
    return copy;
  }
}
