export interface IBoundedAsyncCacheOptions<TValue> {
  maxBytes: number;
  maxEntryBytes: number;
  sizeOf(value: TValue): number;
}

interface ICacheEntry<TValue> {
  value: TValue;
  bytes: number;
}

export interface ILoadOptions {
  /** When false, deduplicates concurrent in-flight loads without persisting the resolved value. */
  persist?: boolean;
}

/**
 * Bounded LRU cache for async loads: deduplicates concurrent in-flight loads per key,
 * evicts least-recently-used entries to stay within the byte budget, skips persisting
 * oversized values, and never caches rejected promises.
 */
export class BoundedAsyncCache<TValue> {
  private readonly entries = new Map<string, ICacheEntry<TValue>>();
  private readonly inflight = new Map<string, Promise<TValue>>();
  private totalBytes = 0;
  private epoch = 0;

  constructor(private readonly options: IBoundedAsyncCacheOptions<TValue>) {}

  clear(): void {
    this.epoch += 1;
    this.entries.clear();
    this.inflight.clear();
    this.totalBytes = 0;
  }

  load(key: string, create: () => Promise<TValue>, options?: ILoadOptions): Promise<TValue> {
    const persist = options?.persist ?? true;
    if (persist) {
      const cached = this.entries.get(key);
      if (cached !== undefined) {
        // refresh Map insertion order to track recency
        this.entries.delete(key);
        this.entries.set(key, cached);
        return Promise.resolve(cached.value);
      }
    }

    const pending = this.inflight.get(key);
    if (pending) {
      return pending;
    }

    const loadEpoch = this.epoch;
    let created: Promise<TValue>;
    try {
      created = create();
    } catch (error) {
      return Promise.reject(error);
    }

    const promise = created
      .then((value) => {
        if (persist && this.epoch === loadEpoch) {
          this.set(key, value);
        }
        return value;
      })
      .finally(() => {
        if (this.epoch === loadEpoch) {
          this.inflight.delete(key);
        }
      });

    this.inflight.set(key, promise);
    return promise;
  }

  private set(key: string, value: TValue): void {
    const bytes = Math.max(0, this.options.sizeOf(value));
    if (bytes > this.options.maxEntryBytes || bytes > this.options.maxBytes) {
      return;
    }

    const existing = this.entries.get(key);
    if (existing) {
      this.totalBytes -= existing.bytes;
      this.entries.delete(key);
    }

    while (this.totalBytes + bytes > this.options.maxBytes && this.entries.size > 0) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      const oldest = this.entries.get(oldestKey);
      this.entries.delete(oldestKey);
      if (oldest) {
        this.totalBytes -= oldest.bytes;
      }
    }

    this.entries.set(key, { value, bytes });
    this.totalBytes += bytes;
  }
}
