import { describe, expect, it, vi } from "vitest";
import { BoundedAsyncCache } from "./BoundedAsyncCache";

describe("BoundedAsyncCache", () => {
  it("deduplicates concurrent in-flight loads for the same key", async () => {
    const cache = new BoundedAsyncCache<string>({
      maxBytes: 100,
      maxEntryBytes: 50,
      sizeOf: (value) => value.length,
    });
    let resolveLoad!: (value: string) => void;
    const create = vi.fn(() => new Promise<string>((resolve) => { resolveLoad = resolve; }));

    const first = cache.load("k1", create);
    const second = cache.load("k1", create);
    resolveLoad("hello");

    await expect(first).resolves.toBe("hello");
    await expect(second).resolves.toBe("hello");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("evicts least-recently-used entries when total bytes exceed the budget", async () => {
    const cache = new BoundedAsyncCache<string>({
      maxBytes: 10,
      maxEntryBytes: 10,
      sizeOf: (value) => value.length,
    });
    const createA = vi.fn(async () => "aaaaa"); // 5 bytes
    const createB = vi.fn(async () => "bbbbb"); // 5 bytes
    const createC = vi.fn(async () => "ccccc"); // 5 bytes

    await cache.load("a", createA);
    await cache.load("b", createB);
    // Touch "a" so "b" becomes least-recently-used
    await cache.load("a", createA);
    // Loading "c" pushes total to 15 > 10, evicting "b" while keeping "a"
    await cache.load("c", createC);

    await cache.load("a", createA);
    await cache.load("c", createC);
    await cache.load("b", createB);

    expect(createA).toHaveBeenCalledTimes(1);
    expect(createC).toHaveBeenCalledTimes(1);
    expect(createB).toHaveBeenCalledTimes(2);
  });

  it("returns oversized values without persisting them or evicting existing entries", async () => {
    const cache = new BoundedAsyncCache<string>({
      maxBytes: 10,
      maxEntryBytes: 6,
      sizeOf: (value) => value.length,
    });
    const createSmall = vi.fn(async () => "small"); // 5 bytes
    const createLarge = vi.fn(async () => "oversized"); // 9 bytes > maxEntryBytes

    await cache.load("small", createSmall);
    await expect(cache.load("large", createLarge)).resolves.toBe("oversized");
    await expect(cache.load("large", createLarge)).resolves.toBe("oversized");
    await expect(cache.load("small", createSmall)).resolves.toBe("small");

    expect(createSmall).toHaveBeenCalledTimes(1);
    expect(createLarge).toHaveBeenCalledTimes(2);
  });

  it("never caches rejected or synchronously throwing loads", async () => {
    const cache = new BoundedAsyncCache<string>({
      maxBytes: 100,
      maxEntryBytes: 50,
      sizeOf: (value) => value.length,
    });
    const create = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(() => {
        throw new Error("sync boom");
      })
      .mockRejectedValueOnce(new Error("async boom"))
      .mockResolvedValueOnce("recovered");

    await expect(cache.load("k", create)).rejects.toThrow("sync boom");
    await expect(cache.load("k", create)).rejects.toThrow("async boom");
    await expect(cache.load("k", create)).resolves.toBe("recovered");
    await expect(cache.load("k", create)).resolves.toBe("recovered");
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("supports in-flight deduplication without persistence when persist is false", async () => {
    const cache = new BoundedAsyncCache<string>({
      maxBytes: 100,
      maxEntryBytes: 50,
      sizeOf: (value) => value.length,
    });
    let resolveFirst!: (value: string) => void;
    const create = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(() => new Promise<string>((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce("v2");

    const a = cache.load("branch-ref", create, { persist: false });
    const b = cache.load("branch-ref", create, { persist: false });
    resolveFirst("v1");

    await expect(a).resolves.toBe("v1");
    await expect(b).resolves.toBe("v1");
    expect(create).toHaveBeenCalledTimes(1);

    // After settlement, persist: false must not serve the stale value
    await expect(cache.load("branch-ref", create, { persist: false })).resolves.toBe("v2");
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("clears entries and blocks stale in-flight loads from backfilling or deleting new-epoch inflight entries", async () => {
    const cache = new BoundedAsyncCache<string>({
      maxBytes: 100,
      maxEntryBytes: 50,
      sizeOf: (value) => Buffer.byteLength(value, "utf8"),
    });
    let resolveStale!: (value: string) => void;
    let resolveFresh!: (value: string) => void;
    const staleCreate = vi.fn(() => new Promise<string>((resolve) => { resolveStale = resolve; }));
    const freshCreate = vi.fn(() => new Promise<string>((resolve) => { resolveFresh = resolve; }));

    const stalePromise = cache.load("k", staleCreate);
    cache.clear();

    // Start a fresh load in the new epoch while stale load is still pending
    const freshPromise1 = cache.load("k", freshCreate);
    resolveStale("stale-value");
    await expect(stalePromise).resolves.toBe("stale-value");

    // Stale load settling must NOT have deleted freshPromise1 from inflight or backfilled entries
    const freshPromise2 = cache.load("k", freshCreate);
    expect(freshCreate).toHaveBeenCalledTimes(1);

    resolveFresh("fresh-value");
    await expect(freshPromise1).resolves.toBe("fresh-value");
    await expect(freshPromise2).resolves.toBe("fresh-value");

    // Cache holds the fresh value, not the stale one
    const verifyCreate = vi.fn(async () => "unexpected");
    await expect(cache.load("k", verifyCreate)).resolves.toBe("fresh-value");
    expect(verifyCreate).not.toHaveBeenCalled();

    // Clearing removes cached entries so the next load re-fetches
    cache.clear();
    const afterClearCreate = vi.fn(async () => "reloaded");
    await expect(cache.load("k", afterClearCreate)).resolves.toBe("reloaded");
    expect(afterClearCreate).toHaveBeenCalledTimes(1);
  });

  it("enforces byte budgets accurately for multi-byte UTF-8 strings", async () => {
    const cache = new BoundedAsyncCache<string>({
      maxBytes: 12,
      maxEntryBytes: 9,
      sizeOf: (value) => Buffer.byteLength(value, "utf8"),
    });
    // Each CJK char is 3 UTF-8 bytes: "你好世界" is 4 chars / 12 bytes (> maxEntryBytes 9)
    const oversized = vi.fn(async () => "你好世界");
    const first = vi.fn(async () => "你好"); // 6 bytes
    const second = vi.fn(async () => "世界"); // 6 bytes
    const third = vi.fn(async () => "测试"); // 6 bytes -> evicts "你好"

    await cache.load("oversized", oversized);
    await cache.load("oversized", oversized);
    expect(oversized).toHaveBeenCalledTimes(2);

    await cache.load("a", first);
    await cache.load("b", second);
    await cache.load("c", third);

    await cache.load("b", second);
    await cache.load("c", third);
    await cache.load("a", first);
    expect(second).toHaveBeenCalledTimes(1);
    expect(third).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(2);
  });
});
