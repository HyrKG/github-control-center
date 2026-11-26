import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type * as vscode from "vscode";
import { chineseBundle, setTestLocale } from "../core/localizationTestUtils";
import type { CiState, IPrFile, IPullRequest } from "../core/types";
import type { ISidebarSnapshot } from "./PrSidebarHtml";
import { PrSidebarViewProvider, type FilesLayout, type ISidebarActions } from "./PrSidebarViewProvider";

interface IPrOverrides {
  id?: string;
  number?: number;
  title?: string;
  repo?: string;
  isDraft?: boolean;
  ciState?: CiState;
  createdAt?: string;
  reviewDecision?: string | null;
  viewerReviewState?: string | null;
  isViewerApprovalStale?: boolean;
  isReviewedByMe?: boolean;
  headRefOid?: string;
  additions?: number;
  deletions?: number;
}

function buildPr(overrides: IPrOverrides = {}): IPullRequest {
  return {
    id: overrides.id ?? "PR_1",
    number: overrides.number ?? 1,
    title: overrides.title ?? "A title",
    url: "https://github.com/acme/repo/pull/1",
    repo: overrides.repo ?? "acme/repo",
    author: "jane",
    isDraft: overrides.isDraft ?? false,
    createdAt: overrides.createdAt ?? "2026-07-01T00:00:00Z",
    ciState: overrides.ciState ?? "NONE",
    reviewDecision: overrides.reviewDecision ?? null,
    viewerReviewState: overrides.viewerReviewState ?? null,
    isViewerApprovalStale: overrides.isViewerApprovalStale ?? false,
    isReviewedByMe: overrides.isReviewedByMe,
    headRefName: "feature/thing",
    baseRefOid: "base-oid",
    headRefOid: overrides.headRefOid ?? "head-oid",
    additions: overrides.additions ?? 15,
    deletions: overrides.deletions ?? 4,
  };
}

function buildFile(overrides: Partial<IPrFile> = {}): IPrFile {
  return {
    path: overrides.path ?? "src/app.ts",
    changeType: overrides.changeType ?? "MODIFIED",
    additions: overrides.additions ?? 10,
    deletions: overrides.deletions ?? 2,
    viewedState: overrides.viewedState ?? "UNVIEWED",
  };
}

interface IMockWebviewView {
  badge?: vscode.ViewBadge;
  visible?: boolean;
  htmlWrites: number;
  webview: {
    options: vscode.WebviewOptions;
    html: string;
    postMessage: Mock<(message: unknown) => Promise<boolean>>;
    onDidReceiveMessage: (cb: (message: unknown) => void) => { dispose: () => void };
    emitMessage: (message: unknown) => void;
  };
  onDidChangeVisibility?: (cb: () => void) => { dispose: () => void };
  emitVisibilityChange: (visible: boolean) => void;
  onDidDispose: (cb: () => void) => { dispose: () => void };
  dispose: () => void;
}

function createMockWebviewView(options: { includeVisibility?: boolean; visible?: boolean } = {}): IMockWebviewView {
  let htmlValue = "";
  let onMessage: ((message: unknown) => void) | undefined;
  let onVisibilityChange: (() => void) | undefined;
  let onDispose: (() => void) | undefined;
  const mock: IMockWebviewView = {
    badge: undefined,
    ...(options.includeVisibility ? { visible: options.visible ?? true } : {}),
    htmlWrites: 0,
    webview: {
      options: {},
      get html() {
        return htmlValue;
      },
      set html(value: string) {
        htmlValue = value;
        mock.htmlWrites += 1;
      },
      postMessage: vi.fn().mockResolvedValue(true),
      onDidReceiveMessage: (cb) => {
        onMessage = cb;
        return { dispose: vi.fn() };
      },
      emitMessage: (message) => onMessage?.(message),
    },
    ...(options.includeVisibility
      ? {
          onDidChangeVisibility: (cb: () => void) => {
            onVisibilityChange = cb;
            return { dispose: vi.fn() };
          },
        }
      : {}),
    emitVisibilityChange: (visible) => {
      mock.visible = visible;
      onVisibilityChange?.();
    },
    onDidDispose: (cb) => {
      onDispose = cb;
      return { dispose: vi.fn() };
    },
    dispose: () => onDispose?.(),
  };
  return mock;
}

function lastPostedSnapshot(view: IMockWebviewView): ISidebarSnapshot {
  const calls = view.webview.postMessage.mock.calls;
  const last = [...calls].reverse().find(([payload]) => (payload as { command?: string })?.command === "state")?.[0] as
    | { command: string; snapshot: ISidebarSnapshot }
    | undefined;
  expect(last?.command).toBe("state");
  return last!.snapshot;
}

describe("PrSidebarViewProvider", () => {
  let layout: FilesLayout;
  let favoriteRepos: string[];
  let actions: ISidebarActions & {
    loadFiles: Mock<(pr: IPullRequest) => Promise<IPrFile[]>>;
    onSignIn: Mock<() => void>;
    onOpenPrDetails: Mock<(pr: IPullRequest) => void>;
    onOpenPrExternal: Mock<(pr: IPullRequest) => void>;
    onCopyPrUrl: Mock<(pr: IPullRequest) => void>;
    onCheckoutPr: Mock<(pr: IPullRequest) => void>;
    onToggleFavoriteRepo: Mock<(repo: string) => void>;
    onOpenFileDiff: Mock<(node: { kind: "file"; pr: IPullRequest; file: IPrFile }) => void>;
    onToggleFileViewed: Mock<(node: { kind: "file"; pr: IPullRequest; file: IPrFile }, viewed: boolean) => Promise<void>>;
    onError: Mock<(message: string) => void>;
  };
  let provider: PrSidebarViewProvider;

  beforeEach(() => {
    layout = "tree";
    favoriteRepos = [];
    actions = {
      loadFiles: vi.fn(async () => [buildFile()]),
      getLayout: () => layout,
      getFavoriteRepos: () => favoriteRepos,
      onSignIn: vi.fn(),
      onOpenPrDetails: vi.fn(),
      onOpenPrExternal: vi.fn(),
      onCopyPrUrl: vi.fn(),
      onCheckoutPr: vi.fn(),
      onToggleFavoriteRepo: vi.fn(),
      onOpenFileDiff: vi.fn(),
      onToggleFileViewed: vi.fn().mockResolvedValue(undefined),
      onError: vi.fn(),
    };
    provider = new PrSidebarViewProvider("toReview", actions);
  });

  afterEach(() => {
    setTestLocale();
  });

  it("caches badge set before resolveWebviewView and updates it live after resolve", () => {
    provider.setBadge({ value: 5, tooltip: "5 pull requests" });
    const view = createMockWebviewView();

    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    expect(view.badge).toEqual({ value: 5, tooltip: "5 pull requests" });

    provider.setBadge({ value: 2, tooltip: "2 pull requests" });
    expect(view.badge).toEqual({ value: 2, tooltip: "2 pull requests" });

    provider.setBadge(undefined);
    expect(view.badge).toBeUndefined();
  });

  it("writes webview.html only once on resolve and syncs all updates via postMessage after ready", async () => {
    const view = createMockWebviewView();
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    expect(view.htmlWrites).toBe(1);

    // Updates before ready are not posted yet
    provider.setPrs([buildPr()]);
    expect(view.webview.postMessage).not.toHaveBeenCalled();

    // Ready handshake delivers current snapshot
    view.webview.emitMessage({ command: "ready" });
    expect(view.webview.postMessage).toHaveBeenCalledTimes(1);
    expect(lastPostedSnapshot(view).groups).toHaveLength(1);

    // Subsequent updates never rewrite webview.html
    provider.setPrs([buildPr({ id: "PR_2", number: 2 })]);
    layout = "flat";
    provider.refresh();
    provider.clear();
    expect(view.htmlWrites).toBe(1);
    expect(lastPostedSnapshot(view).signedIn).toBe(false);
  });

  it("localizes welcome/empty strings per view kind and tooltips in English and Simplified Chinese", () => {
    setTestLocale("zh-cn", chineseBundle());
    const reviewedView = createMockWebviewView();
    const reviewedProvider = new PrSidebarViewProvider("reviewed", actions);
    reviewedProvider.resolveWebviewView(reviewedView as unknown as vscode.WebviewView);
    expect(reviewedView.webview.html).toContain("登录 GitHub 后即可查看你已批准的拉取请求。");
    expect(reviewedView.webview.html).toContain("暂无已批准的拉取请求");

    const mineView = createMockWebviewView();
    const mineProvider = new PrSidebarViewProvider("mine", actions);
    mineProvider.resolveWebviewView(mineView as unknown as vscode.WebviewView);
    expect(mineView.webview.html).toContain("登录 GitHub 后即可查看你尚未关闭的拉取请求。");
    expect(mineView.webview.html).toContain("你没有尚未关闭的拉取请求。");

    const pr = buildPr({
      createdAt: new Date().toISOString(),
      ciState: "SUCCESS",
      reviewDecision: "APPROVED",
      viewerReviewState: "APPROVED",
      isReviewedByMe: true,
    });
    provider.setPrs([pr]);
    const snap = provider.buildSnapshot();
    expect(snap.groups[0].prs[0].meta).toContain("今天创建");
    expect(snap.groups[0].prs[0].meta).toContain("✓ 你已批准");
    expect(snap.groups[0].prs[0].tooltip).toContain("持续集成：通过");
    expect(snap.groups[0].prs[0].tooltip).toContain("审查：已批准");
  });

  it("groups PRs alphabetically by repo and maps review glyphs, stale approvals, and additions/deletions", () => {
    provider.setPrs([
      buildPr({ id: "1", repo: "acme/zeta", reviewDecision: "APPROVED", viewerReviewState: "APPROVED", additions: 1200, deletions: 34 }),
      buildPr({ id: "2", repo: "acme/alpha", reviewDecision: "APPROVED", viewerReviewState: "APPROVED", isViewerApprovalStale: true, isReviewedByMe: true }),
      buildPr({ id: "3", repo: "acme/zeta", reviewDecision: "CHANGES_REQUESTED" }),
    ]);

    const snap = provider.buildSnapshot();
    expect(snap.groups.map((g) => g.repo)).toEqual(["acme/alpha", "acme/zeta"]);
    expect(snap.groups[0].prs[0]).toMatchObject({ reviewGlyph: "☑", reviewTone: "approved" });
    expect(snap.groups[0].prs[0].meta).toContain("● review stale");
    expect(snap.groups[1].prs[0]).toMatchObject({ reviewGlyph: "✓", reviewTone: "approved", additions: 1200, deletions: 34 });
    expect(snap.groups[1].prs[1]).toMatchObject({ reviewGlyph: "↻", reviewTone: "changes" });
  });

  it("lazily loads PR files on expand, supports retry on failure, and silently refreshes on headRefOid change", async () => {
    const view = createMockWebviewView();
    const pr = buildPr({ id: "PR_1", headRefOid: "oid-1" });
    provider.setPrs([pr]);
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    view.webview.emitMessage({ command: "ready" });

    // No file load before expand
    expect(actions.loadFiles).not.toHaveBeenCalled();

    // First expand fails -> error state shown
    actions.loadFiles.mockRejectedValueOnce(new Error("boom"));
    view.webview.emitMessage({ command: "togglePrExpand", prId: "PR_1" });
    await vi.waitFor(() => {
      expect(lastPostedSnapshot(view).groups[0].prs[0].filesState).toEqual({
        status: "error",
        message: "Failed to load files: boom",
      });
    });

    // Retry succeeds -> files loaded in tree layout
    actions.loadFiles.mockResolvedValueOnce([buildFile({ path: "src/sub/a.ts", additions: 3, deletions: 7 })]);
    view.webview.emitMessage({ command: "retryLoadFiles", prId: "PR_1" });
    await vi.waitFor(() => {
      const state = lastPostedSnapshot(view).groups[0].prs[0].filesState;
      expect(state.status).toBe("loaded");
      if (state.status === "loaded") {
        expect(state.folders[0]).toMatchObject({ name: "src/sub", path: "src/sub" });
        expect(state.folders[0].files[0]).toMatchObject({ path: "src/sub/a.ts", additions: 3, deletions: 7 });
      }
    });

    // Collapsing & re-expanding same headRefOid reuses loaded files without extra loadFiles call
    actions.loadFiles.mockClear();
    view.webview.emitMessage({ command: "togglePrExpand", prId: "PR_1" });
    expect(lastPostedSnapshot(view).groups[0].prs[0].expanded).toBe(false);
    view.webview.emitMessage({ command: "togglePrExpand", prId: "PR_1" });
    expect(lastPostedSnapshot(view).groups[0].prs[0].expanded).toBe(true);
    expect(actions.loadFiles).not.toHaveBeenCalled();

    // Poll brings a new headRefOid -> silent background refresh updates files without flashing loading state
    const refreshedFile = buildFile({ path: "src/sub/b.ts", additions: 99, deletions: 0 });
    actions.loadFiles.mockResolvedValueOnce([refreshedFile]);
    view.webview.postMessage.mockClear();
    provider.setPrs([buildPr({ id: "PR_1", headRefOid: "oid-2" })]);
    await vi.waitFor(() => {
      const state = lastPostedSnapshot(view).groups[0].prs[0].filesState;
      expect(state.status).toBe("loaded");
      if (state.status === "loaded") {
        expect(state.folders[0].files[0].path).toBe("src/sub/b.ts");
      }
    });
    // Verify no "loading" state was posted during silent refresh
    const postedStatuses = view.webview.postMessage.mock.calls.map(
      ([msg]) => (msg as { snapshot: ISidebarSnapshot }).snapshot.groups[0].prs[0].filesState.status,
    );
    expect(postedStatuses).not.toContain("loading");
  });

  it("optimistically updates viewed state and rolls back with an error toast on failure", async () => {
    const view = createMockWebviewView();
    const file = buildFile({ path: "src/app.ts", viewedState: "UNVIEWED" });
    actions.loadFiles.mockResolvedValueOnce([file]);
    provider.setPrs([buildPr()]);
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    view.webview.emitMessage({ command: "ready" });

    view.webview.emitMessage({ command: "togglePrExpand", prId: "PR_1" });
    await vi.waitFor(() => expect(provider.findFileNode("PR_1", "src/app.ts")).toBeDefined());

    let rejectMutation!: (error: Error) => void;
    actions.onToggleFileViewed.mockImplementationOnce(
      () => new Promise<void>((_, reject) => { rejectMutation = reject; }),
    );

    view.webview.emitMessage({ command: "toggleFileViewed", prId: "PR_1", filePath: "src/app.ts", viewed: true });
    // Immediately reflected optimistically
    expect(file.viewedState).toBe("VIEWED");
    expect(lastPostedSnapshot(view).groups[0].prs[0].filesState).toMatchObject({
      status: "loaded",
      folders: [{ files: [{ path: "src/app.ts", viewed: true }] }],
    });

    // Reject -> rolls back state, re-posts snapshot, and surfaces error
    rejectMutation(new Error("network down"));
    await vi.waitFor(() => expect(actions.onError).toHaveBeenCalledWith("Updating the viewed state failed: network down"));
    expect(file.viewedState).toBe("UNVIEWED");
    expect(lastPostedSnapshot(view).groups[0].prs[0].filesState).toMatchObject({
      status: "loaded",
      folders: [{ files: [{ path: "src/app.ts", viewed: false }] }],
    });
  });

  it("dispatches signIn, PR actions, and openFileDiff messages and stops posting after dispose", async () => {
    const view = createMockWebviewView();
    const pr = buildPr();
    const file = buildFile();
    actions.loadFiles.mockResolvedValueOnce([file]);
    provider.setPrs([pr]);
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    view.webview.emitMessage({ command: "ready" });
    view.webview.emitMessage({ command: "togglePrExpand", prId: pr.id });
    await vi.waitFor(() => expect(provider.findFileNode(pr.id, file.path)).toBeDefined());

    view.webview.emitMessage({ command: "signIn" });
    view.webview.emitMessage({ command: "openPrDetails", prId: pr.id });
    view.webview.emitMessage({ command: "openPrExternal", prId: pr.id });
    view.webview.emitMessage({ command: "copyPrUrl", prId: pr.id });
    view.webview.emitMessage({ command: "checkoutPr", prId: pr.id });
    view.webview.emitMessage({ command: "openFileDiff", prId: pr.id, filePath: file.path });

    expect(actions.onSignIn).toHaveBeenCalledOnce();
    expect(actions.onOpenPrDetails).toHaveBeenCalledWith(pr);
    expect(actions.onOpenPrExternal).toHaveBeenCalledWith(pr);
    expect(actions.onCopyPrUrl).toHaveBeenCalledWith(pr);
    expect(actions.onCheckoutPr).toHaveBeenCalledWith(pr);
    expect(actions.onOpenFileDiff).toHaveBeenCalledWith({ kind: "file", pr, file });

    view.webview.postMessage.mockClear();
    view.dispose();
    provider.refresh();
    expect(view.webview.postMessage).not.toHaveBeenCalled();
  });

  it("skips postMessage when the serialized snapshot is unchanged and resets cache on re-resolve", () => {
    const view = createMockWebviewView();
    const pr = buildPr({ id: "PR_1", title: "Same" });
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    view.webview.emitMessage({ command: "ready" });
    view.webview.postMessage.mockClear();

    provider.setPrs([pr]);
    expect(view.webview.postMessage).toHaveBeenCalledTimes(1);

    // Identical state on subsequent poll or refresh skips postMessage
    provider.setPrs([buildPr({ id: "PR_1", title: "Same" })]);
    provider.refresh();
    expect(view.webview.postMessage).toHaveBeenCalledTimes(1);

    // Changed state posts again
    provider.setPrs([buildPr({ id: "PR_1", title: "Updated" })]);
    expect(view.webview.postMessage).toHaveBeenCalledTimes(2);

    // Re-resolving a new view resets lastPostedSnapshotJson so initial ready posts state
    const view2 = createMockWebviewView();
    provider.resolveWebviewView(view2 as unknown as vscode.WebviewView);
    view2.webview.emitMessage({ command: "ready" });
    expect(view2.webview.postMessage).toHaveBeenCalledTimes(1);
  });

  it("defers state posts while the view is hidden and flushes when it becomes visible", () => {
    const view = createMockWebviewView({ includeVisibility: true, visible: true });
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    view.webview.emitMessage({ command: "ready" });
    view.webview.postMessage.mockClear();

    // Hide view -> updates are deferred
    view.emitVisibilityChange(false);
    provider.setPrs([buildPr({ id: "PR_1", title: "Deferred update" })]);
    expect(view.webview.postMessage).not.toHaveBeenCalled();

    // Show view -> deferred snapshot flushes immediately
    view.emitVisibilityChange(true);
    expect(view.webview.postMessage).toHaveBeenCalledTimes(1);
    expect(lastPostedSnapshot(view).groups[0].prs[0].title).toBe("Deferred update");

    // Re-hiding and showing with no new changes does not re-post
    view.webview.postMessage.mockClear();
    view.emitVisibilityChange(false);
    view.emitVisibilityChange(true);
    expect(view.webview.postMessage).not.toHaveBeenCalled();
  });

  it("re-posts snapshot when webview reloads (ready) and recovers when postMessage returns false or rejects", async () => {
    const view = createMockWebviewView({ includeVisibility: true, visible: true });
    provider.setPrs([buildPr({ id: "PR_1", title: "Alpha" })]);
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    view.webview.emitMessage({ command: "ready" });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(view.webview.postMessage).toHaveBeenCalledTimes(1);

    // Webview reloads and emits ready again with unchanged data -> must re-post!
    view.webview.emitMessage({ command: "ready" });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(view.webview.postMessage).toHaveBeenCalledTimes(2);

    // Next postMessage resolves to false (undelivered) -> must not latch dedup cache
    view.webview.postMessage.mockResolvedValueOnce(false);
    provider.setPrs([buildPr({ id: "PR_1", title: "Beta" })]);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(view.webview.postMessage).toHaveBeenCalledTimes(3);

    // Visibility restore (or refresh) retries delivering "Beta"
    view.emitVisibilityChange(true);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(view.webview.postMessage).toHaveBeenCalledTimes(4);
    expect(lastPostedSnapshot(view).groups[0].prs[0].title).toBe("Beta");

    // Rejected postMessage also does not latch dedup cache
    view.webview.postMessage.mockRejectedValueOnce(new Error("webview disposed"));
    provider.setPrs([buildPr({ id: "PR_1", title: "Gamma" })]);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(view.webview.postMessage).toHaveBeenCalledTimes(5);

    provider.refresh();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(view.webview.postMessage).toHaveBeenCalledTimes(6);
    expect(lastPostedSnapshot(view).groups[0].prs[0].title).toBe("Gamma");

    // Failed latest postMessage clears lastPostedSnapshotJson so reverting to an earlier state still re-posts
    view.webview.postMessage.mockResolvedValueOnce(false);
    provider.setPrs([buildPr({ id: "PR_1", title: "Delta" })]);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(view.webview.postMessage).toHaveBeenCalledTimes(7);

    // Reverting to "Gamma" (previously delivered before "Delta" failed) must NOT be suppressed
    provider.setPrs([buildPr({ id: "PR_1", title: "Gamma" })]);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(view.webview.postMessage).toHaveBeenCalledTimes(8);
    expect(lastPostedSnapshot(view).groups[0].prs[0].title).toBe("Gamma");
  });

  it("marks file nodes as stale while a silent headRefOid refresh is still in flight", async () => {
    const view = createMockWebviewView();
    const file = buildFile({ path: "src/app.ts", changeType: "MODIFIED" });
    actions.loadFiles.mockResolvedValueOnce([file]);
    provider.setPrs([buildPr({ id: "PR_1", headRefOid: "oid-1" })]);
    provider.resolveWebviewView(view as unknown as vscode.WebviewView);
    view.webview.emitMessage({ command: "ready" });
    view.webview.emitMessage({ command: "togglePrExpand", prId: "PR_1" });
    await vi.waitFor(() => expect(provider.findFileNode("PR_1", "src/app.ts")).toEqual({
      kind: "file",
      pr: expect.objectContaining({ headRefOid: "oid-1" }),
      file,
    }));

    // Poll brings new headRefOid while silent reload is pending
    let resolveReload!: (files: IPrFile[]) => void;
    actions.loadFiles.mockImplementationOnce(() => new Promise<IPrFile[]>((resolve) => { resolveReload = resolve; }));
    provider.setPrs([buildPr({ id: "PR_1", headRefOid: "oid-2" })]);

    expect(provider.findFileNode("PR_1", "src/app.ts")).toEqual({
      kind: "file",
      pr: expect.objectContaining({ headRefOid: "oid-2" }),
      file,
      stale: true,
    });

    // Once silent reload finishes, the node is fresh again (no stale flag)
    const freshFile = buildFile({ path: "src/app.ts", changeType: "RENAMED" });
    resolveReload([freshFile]);
    await vi.waitFor(() => expect(provider.findFileNode("PR_1", "src/app.ts")).toEqual({
      kind: "file",
      pr: expect.objectContaining({ headRefOid: "oid-2" }),
      file: freshFile,
    }));
  });

  it("pins favorite repos case-insensitively ahead of non-favorites, syncs across views, and dispatches toggleFavoriteRepo", () => {
    favoriteRepos = ["ACME/ZETA", "  acme/middle  "];
    const prs = [
      buildPr({ id: "1", repo: "acme/alpha" }),
      buildPr({ id: "2", repo: "acme/zeta" }),
      buildPr({ id: "3", repo: "acme/beta" }),
      buildPr({ id: "4", repo: "acme/middle" }),
    ];

    const reviewedProvider = new PrSidebarViewProvider("reviewed", actions);
    const mineProvider = new PrSidebarViewProvider("mine", actions);
    const toReviewView = createMockWebviewView();
    const reviewedView = createMockWebviewView();
    const mineView = createMockWebviewView();

    for (const [p, v] of [[provider, toReviewView], [reviewedProvider, reviewedView], [mineProvider, mineView]] as const) {
      p.setPrs(prs);
      p.resolveWebviewView(v as unknown as vscode.WebviewView);
      v.webview.emitMessage({ command: "ready" });
      const snap = lastPostedSnapshot(v);
      expect(snap.groups.map((g) => [g.repo, g.favorite])).toEqual([
        ["acme/middle", true],
        ["acme/zeta", true],
        ["acme/alpha", false],
        ["acme/beta", false],
      ]);
    }

    // Clicking star in webview dispatches onToggleFavoriteRepo (and ignores blank repo)
    toReviewView.webview.emitMessage({ command: "toggleFavoriteRepo", repo: "   " });
    expect(actions.onToggleFavoriteRepo).not.toHaveBeenCalled();

    toReviewView.webview.emitMessage({ command: "toggleFavoriteRepo", repo: "acme/beta" });
    expect(actions.onToggleFavoriteRepo).toHaveBeenCalledExactlyOnceWith("acme/beta");

    // Updating favorites and refreshing re-orders all three views
    favoriteRepos = ["acme/beta"];
    for (const [p, v] of [[provider, toReviewView], [reviewedProvider, reviewedView], [mineProvider, mineView]] as const) {
      p.refresh();
      expect(lastPostedSnapshot(v).groups.map((g) => [g.repo, g.favorite])).toEqual([
        ["acme/beta", true],
        ["acme/alpha", false],
        ["acme/middle", false],
        ["acme/zeta", false],
      ]);
    }
  });
});
