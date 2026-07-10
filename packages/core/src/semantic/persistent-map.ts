const DELETED = Symbol("persistent-map-deleted");

type EntryValue<V> = V | typeof DELETED;

type PersistentMapState<K, V> = {
  parent: PersistentMapState<K, V> | null;
  entries: Map<K, EntryValue<V>>;
  sealed: boolean;
  materialized: Map<K, V> | null;
};

export type PersistentMapSnapshot<K, V> = PersistentMapState<K, V>;

export class PersistentMap<K, V> implements ReadonlyMap<K, V> {
  private state: PersistentMapState<K, V>;

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
    callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void,
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
  if (state.materialized) {
    return state.materialized;
  }
  const materialized = state.parent ? new Map(materializeState(state.parent)) : new Map<K, V>();
  for (const [key, entry] of state.entries) {
    if (entry === DELETED) {
      materialized.delete(key);
    } else {
      materialized.set(key, entry);
    }
  }
  state.materialized = materialized;
  return materialized;
}
