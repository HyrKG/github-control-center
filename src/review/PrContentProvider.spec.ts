import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { PrContentProvider } from "./PrContentProvider";
import { encodePrUriParts, PR_URI_SCHEME, type IPrFileRef } from "./prUri";

function buildRef(overrides: Partial<IPrFileRef> = {}): IPrFileRef {
  return {
    prId: overrides.prId ?? "PR_42",
    repo: overrides.repo ?? "acme/repo",
    prNumber: overrides.prNumber ?? 42,
    path: overrides.path ?? "src/app.ts",
    sha: overrides.sha ?? "abc123",
    headOid: overrides.headOid ?? "head456",
    side: overrides.side ?? "RIGHT",
    isEmpty: overrides.isEmpty ?? false,
  };
}

function toUri(ref: IPrFileRef): vscode.Uri {
  const { path, query } = encodePrUriParts(ref);
  return vscode.Uri.from({ scheme: PR_URI_SCHEME, path, query });
}

describe("PrContentProvider", () => {
  it("should return an empty string for the empty side without fetching", async () => {
    const fetchContent = vi.fn();
    const provider = new PrContentProvider(fetchContent);

    const content = await provider.provideTextDocumentContent(toUri(buildRef({ isEmpty: true })));

    expect(content).toBe("");
    expect(fetchContent).not.toHaveBeenCalled();
  });

  it("should fetch and return the pinned file content", async () => {
    const fetchContent = vi.fn(async () => "file body");
    const provider = new PrContentProvider(fetchContent);

    const content = await provider.provideTextDocumentContent(toUri(buildRef()));

    expect(content).toBe("file body");
    expect(fetchContent).toHaveBeenCalledWith(buildRef());
  });

  it("should cache content by uri and not fetch twice", async () => {
    const fetchContent = vi.fn(async () => "file body");
    const provider = new PrContentProvider(fetchContent);
    const uri = toUri(buildRef());

    await provider.provideTextDocumentContent(uri);
    await provider.provideTextDocumentContent(uri);

    expect(fetchContent).toHaveBeenCalledTimes(1);
  });

  it("should not cache bodies larger than one megabyte", async () => {
    const bigBody = "x".repeat(1_048_577);
    const fetchContent = vi.fn(async () => bigBody);
    const provider = new PrContentProvider(fetchContent);
    const uri = toUri(buildRef());

    await provider.provideTextDocumentContent(uri);
    await provider.provideTextDocumentContent(uri);

    expect(fetchContent).toHaveBeenCalledTimes(2);
  });

  it("should deduplicate concurrent fetches for the same uri", async () => {
    let resolveFetch!: (value: string) => void;
    const fetchContent = vi.fn(() => new Promise<string>((resolve) => { resolveFetch = resolve; }));
    const provider = new PrContentProvider(fetchContent);
    const uri = toUri(buildRef());

    const first = provider.provideTextDocumentContent(uri);
    const second = provider.provideTextDocumentContent(uri);
    resolveFetch("shared body");

    await expect(first).resolves.toBe("shared body");
    await expect(second).resolves.toBe("shared body");
    expect(fetchContent).toHaveBeenCalledTimes(1);
  });

  it("should evict least-recently-used uris when total cached bytes exceed the budget", async () => {
    const fetchContent = vi.fn(async (ref: IPrFileRef) => ref.path.slice(0, 6).padEnd(6, "_"));
    const provider = new PrContentProvider(fetchContent, 12);
    const uriA = toUri(buildRef({ path: "a.ts" }));
    const uriB = toUri(buildRef({ path: "b.ts" }));
    const uriC = toUri(buildRef({ path: "c.ts" }));

    await provider.provideTextDocumentContent(uriA);
    await provider.provideTextDocumentContent(uriB);
    await provider.provideTextDocumentContent(uriA); // refresh A so B is LRU
    await provider.provideTextDocumentContent(uriC); // evicts B

    fetchContent.mockClear();
    await provider.provideTextDocumentContent(uriA);
    await provider.provideTextDocumentContent(uriC);
    expect(fetchContent).not.toHaveBeenCalled();

    await provider.provideTextDocumentContent(uriB);
    expect(fetchContent).toHaveBeenCalledTimes(1);
  });

  it("should propagate fetch errors so the editor surfaces them and retry next time", async () => {
    const fetchContent = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("404"))
      .mockResolvedValueOnce("recovered");
    const provider = new PrContentProvider(fetchContent);
    const uri = toUri(buildRef());

    await expect(provider.provideTextDocumentContent(uri)).rejects.toThrow("404");
    await expect(provider.provideTextDocumentContent(uri)).resolves.toBe("recovered");
    expect(fetchContent).toHaveBeenCalledTimes(2);
  });

  it("should drop cached entries and ignore stale in-flight responses after clear()", async () => {
    let resolveStale!: (value: string) => void;
    const fetchContent = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(() => new Promise<string>((resolve) => { resolveStale = resolve; }))
      .mockResolvedValueOnce("new account body");
    const provider = new PrContentProvider(fetchContent);
    const uri = toUri(buildRef());

    const stale = provider.provideTextDocumentContent(uri);
    provider.clear();
    resolveStale("old account body");
    await expect(stale).resolves.toBe("old account body");

    await expect(provider.provideTextDocumentContent(uri)).resolves.toBe("new account body");
    expect(fetchContent).toHaveBeenCalledTimes(2);
  });

  it("should measure multi-byte UTF-8 bodies by byte length when enforcing the cache budget", async () => {
    // Each CJK char is 3 UTF-8 bytes -> "一二三" is 9 bytes; two of them (18 bytes) exceed budget 12
    const fetchContent = vi.fn(async (ref: IPrFileRef) => (ref.path === "a.ts" ? "一二三" : "四五六"));
    const provider = new PrContentProvider(fetchContent, 12);
    const uriA = toUri(buildRef({ path: "a.ts" }));
    const uriB = toUri(buildRef({ path: "b.ts" }));

    await provider.provideTextDocumentContent(uriA);
    await provider.provideTextDocumentContent(uriB); // evicts uriA because 9 + 9 > 12

    fetchContent.mockClear();
    await provider.provideTextDocumentContent(uriB);
    expect(fetchContent).not.toHaveBeenCalled();

    await provider.provideTextDocumentContent(uriA);
    expect(fetchContent).toHaveBeenCalledTimes(1);
  });
});
