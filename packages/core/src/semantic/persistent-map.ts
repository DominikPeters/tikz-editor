const DELETED = Symbol("persistent-map-deleted");

type EntryValue<V> = V | typeof DELETED;

type PersistentMapState<K, V> = {
  parent: PersistentMapState<K, V> | null;
  entries: Map<K, EntryValue<V>>;
  sealed: boolean;
  materialized: Map<K, V> | null;
};

export type PersistentMapSnapshot<K, V> = PersistentMapState<K, V>;

export class PersistentMap<K, V> implements Map<K, V> {
  private state: PersistentMapState<K, V>;
  readonly [Symbol.toStringTag] = "Map";

  constructor(snapshot?: PersistentMapSnapshot<K, V>) {
    this.state = snapshot ?? createRootState<K, V>();
  }

  get size(): number {
    return this.materialize().size;
  }

  has(key: K): boolean {
    return this.findEntry(key).found;
  }

  get(key: K): V | undefined {
    const found = this.findEntry(key);
    return found.found ? found.value : undefined;
  }

  set(key: K, value: V): this {
    const writable = this.ensureWritable();
    writable.entries.set(key, value);
    writable.materialized = null;
    return this;
  }

  delete(key: K): boolean {
    if (!this.has(key)) {
      return false;
    }
    const writable = this.ensureWritable();
    writable.entries.set(key, DELETED);
    writable.materialized = null;
    return true;
  }

  clear(): void {
    this.state = createRootState<K, V>();
  }

  entries(): MapIterator<[K, V]> {
    return this.materialize().entries();
  }

  keys(): MapIterator<K> {
    return this.materialize().keys();
  }

  values(): MapIterator<V> {
    return this.materialize().values();
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.entries();
  }

  forEach(
    callbackfn: (value: V, key: K, map: Map<K, V>) => void,
    thisArg?: unknown
  ): void {
    this.materialize().forEach((value, key) => {
      callbackfn.call(thisArg, value, key, this);
    });
  }

  snapshot(): PersistentMapSnapshot<K, V> {
    this.state.sealed = true;
    return this.state;
  }

  restore(snapshot: PersistentMapSnapshot<K, V>): void {
    this.state = snapshot;
  }

  fork(): PersistentMap<K, V> {
    return new PersistentMap(this.snapshot());
  }

  private ensureWritable(): PersistentMapState<K, V> {
    if (!this.state.sealed) {
      return this.state;
    }
    this.state = {
      parent: this.state,
      entries: new Map<K, EntryValue<V>>(),
      sealed: false,
      materialized: null
    };
    return this.state;
  }

  private findEntry(
    key: K
  ): { found: true; value: V } | { found: false } {
    let state: PersistentMapState<K, V> | null = this.state;
    while (state) {
      // A materialized map already folds in this layer and all ancestors, so
      // it caps the chain walk for maps that fork once per drag frame.
      if (state.materialized) {
        if (state.materialized.has(key)) {
          return { found: true, value: state.materialized.get(key) as V };
        }
        return { found: false };
      }
      if (state.entries.has(key)) {
        const entry = state.entries.get(key);
        if (entry === DELETED) {
          return { found: false };
        }
        return { found: true, value: entry as V };
      }
      state = state.parent;
    }
    return { found: false };
  }

  private materialize(): Map<K, V> {
    return materializeState(this.state);
  }
}

function createRootState<K, V>(): PersistentMapState<K, V> {
  return {
    parent: null,
    entries: new Map<K, EntryValue<V>>(),
    sealed: false,
    materialized: new Map<K, V>()
  };
}

function materializeState<K, V>(state: PersistentMapState<K, V>): Map<K, V> {
  const pending: PersistentMapState<K, V>[] = [];
  let current: PersistentMapState<K, V> | null = state;
  while (current && !current.materialized) {
    pending.push(current);
    current = current.parent;
  }
  let materialized = current?.materialized ?? new Map<K, V>();
  for (let index = pending.length - 1; index >= 0; index -= 1) {
    const layer = pending[index];
    if (!layer) {
      continue;
    }
    const next = new Map(materialized);
    for (const [key, entry] of layer.entries) {
      if (entry === DELETED) {
        next.delete(key);
      } else {
        next.set(key, entry);
      }
    }
    layer.materialized = next;
    materialized = next;
  }
  return materialized;
}
