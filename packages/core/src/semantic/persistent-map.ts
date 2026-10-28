const DELETED = { kind: "deleted" } as const;
const MAX_LOOKUP_LAYERS = 64;

type EntryValue<V> = { kind: "value"; value: V } | typeof DELETED;

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
    writable.entries.set(key, { kind: "value", value });
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
    compactMaterializedState(this.state);
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
    let layers = 0;
    while (state) {
      // A materialized map already folds in this layer and all ancestors, so
      // it caps the chain walk for maps that fork once per drag frame.
      if (state.materialized) {
        return mapEntry(state.materialized, key);
      }
      const entry = state.entries.get(key);
      if (entry) {
        return entry.kind === "deleted" ? { found: false } : { found: true, value: entry.value };
      }
      if (++layers >= MAX_LOOKUP_LAYERS) {
        const map = this.materialize();
        return mapEntry(map, key);
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
    compactMaterializedState(state);
    return state.materialized;
  }
  const pending: PersistentMapState<K, V>[] = [];
  let current: PersistentMapState<K, V> | null = state;
  while (current && !current.materialized) {
    pending.push(current);
    current = current.parent;
  }
  // Only the requested version needs a flat map. Copying and caching every
  // ancestor here made one iteration allocate quadratic storage after a long
  // sequence of snapshots. Older snapshots remain lazy and independent.
  const materialized = new Map(current?.materialized);
  for (let index = pending.length - 1; index >= 0; index -= 1) {
    const layer = pending[index];
    if (!layer) {
      continue;
    }
    for (const [key, entry] of layer.entries) {
      if (entry.kind === "deleted") {
        materialized.delete(key);
      } else {
        materialized.set(key, entry.value);
      }
    }
  }
  state.materialized = materialized;
  compactMaterializedState(state);
  return materialized;
}

/** A sealed flat snapshot no longer needs the historical layers it replaced. */
function compactMaterializedState<K, V>(state: PersistentMapState<K, V>): void {
  if (!state.sealed || !state.materialized) return;
  // Writes to a sealed state fork a child, so the complete materialized map
  // stays authoritative. Other live snapshots still own their own ancestors;
  // the current version need not pin overwritten values from every drag frame.
  state.parent = null;
  state.entries.clear();
}

function mapEntry<K, V>(map: ReadonlyMap<K, V>, key: K): { found: true; value: V } | { found: false } {
  const value = map.get(key);
  if (value !== undefined) return { found: true, value };
  if (!map.has(key)) return { found: false };
  // Map.has proves this is a stored undefined value; TypeScript cannot correlate has/get for generic V.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return { found: true, value: value as V };
}
