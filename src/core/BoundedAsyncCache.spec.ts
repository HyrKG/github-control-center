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
});
