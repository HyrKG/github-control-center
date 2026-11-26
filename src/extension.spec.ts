import type * as vscode from "vscode";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chineseBundle, setTestLocale } from "./core/localizationTestUtils";
import type { IPullRequest, IReviewThreadsSnapshot } from "./core/types";
import { activate } from "./extension";
import * as github from "./github/github";

vi.mock("./github/github", async (importOriginal) => ({
  ...await importOriginal<typeof github>(),
  getSession: vi.fn().mockResolvedValue({ accessToken: "token" }),
  fetchPullRequests: vi.fn(),
  fetchPrDetails: vi.fn(),
  fetchPrFiles: vi.fn().mockResolvedValue([]),
  fetchFileBytes: vi.fn(),
  fetchPrFilePatches: vi.fn().mockResolvedValue([]),
  fetchReviewThreads: vi.fn(),
  submitPendingReview: vi.fn().mockResolvedValue(undefined),
  discardPendingReview: vi.fn().mockResolvedValue(undefined),
}));

interface IMockWebviewPanel {
  viewType: string;
  title: string;
  visible: boolean;
  reveal: ReturnType<typeof vi.fn>;
  dispose: () => void;
  onDidDispose: (cb: () => void) => { dispose: () => void };
  webview: {
    html: string;
    postMessage: ReturnType<typeof vi.fn>;
    asWebviewUri: (uri: { toString(): string }) => { toString(): string };
    onDidReceiveMessage: (cb: (message: unknown) => void) => { dispose: () => void };
    emitMessage: (message: unknown) => void;
  };
}

const host = vi.hoisted(() => {
  const subscription = { dispose: vi.fn() };
  const registered = new Map<string, (...args: unknown[]) => unknown>();
  const webviewViewProviders = new Map<string, vscode.WebviewViewProvider>();
  const statusBar = { ...subscription, hide: vi.fn(), show: vi.fn(), text: "", tooltip: "" };
  const webviewPanels: IMockWebviewPanel[] = [];
  const globalStateStore = new Map<string, unknown>();
  const clipboardWriteText = vi.fn();

  return {
    registered,
    webviewViewProviders,
    statusBar,
    webviewPanels,
    globalStateStore,
    clipboardWriteText,
    external: vi.fn(),
    createCommentThread: vi.fn(() => ({ ...subscription })),
    commands: {
      registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
        registered.set(id, handler);
        return subscription;
      },
      executeCommand: vi.fn(async (id: string) => registered.get(id)?.()),
    },
    workspace: {
      getConfiguration: () => ({ get: <T>(_: string, fallback: T) => fallback, update: vi.fn().mockResolvedValue(undefined) }),
      onDidChangeConfiguration: () => subscription,
      registerTextDocumentContentProvider: () => subscription,
    },
    window: {
      state: { focused: false },
      createOutputChannel: () => ({ ...subscription, appendLine: vi.fn() }),
      createStatusBarItem: () => statusBar,
      registerWebviewViewProvider: vi.fn((viewId: string, provider: vscode.WebviewViewProvider) => {
        webviewViewProviders.set(viewId, provider);
        return subscription;
      }),
      createWebviewPanel: vi.fn((viewType: string, title: string) => {
        let onMessage: ((message: unknown) => void) | undefined;
        let onDispose: (() => void) | undefined;
        const panel: IMockWebviewPanel = {
          viewType,
          title,
          visible: true,
          reveal: vi.fn(),
          dispose: () => onDispose?.(),
          onDidDispose: (cb) => {
            onDispose = cb;
            return subscription;
          },
          webview: {
            html: "",
            postMessage: vi.fn().mockResolvedValue(true),
            asWebviewUri: (uri) => uri,
            onDidReceiveMessage: (cb) => {
              onMessage = cb;
              return subscription;
            },
            emitMessage: (message) => onMessage?.(message),
          },
        };
        webviewPanels.push(panel);
        return panel;
      }),
      onDidChangeWindowState: () => subscription,
      showInformationMessage: vi.fn<(message: string, ...actions: string[]) => Promise<string | undefined>>().mockResolvedValue(undefined),
      showWarningMessage: vi.fn<(message: string, options: unknown, action: string) => Promise<string | undefined>>().mockResolvedValue(undefined),
      showQuickPick: vi.fn<(items: readonly vscode.QuickPickItem[]) => Promise<vscode.QuickPickItem | undefined>>(),
      showInputBox: vi.fn().mockResolvedValue("review summary"),
    },
  };
});

vi.mock("vscode", async (importOriginal) => {
  const original = await importOriginal<typeof vscode>();
  return {
    ...original,
    env: {
      get language() { return original.env.language; },
      openExternal: host.external,
      clipboard: { writeText: host.clipboardWriteText },
    },
    comments: { createCommentController: () => ({ createCommentThread: host.createCommentThread, dispose: vi.fn() }) },
    commands: host.commands,
    workspace: host.workspace,
    window: host.window,
    Uri: {
      parse: original.Uri.parse,
      from: original.Uri.from,
      joinPath: (base: { path: string }, ...segments: string[]) => {
        const joined = [base.path, ...segments].join("/");
        return { scheme: "file", path: joined, toString: () => joined };
      },
    },
    ViewColumn: { Active: -1 },
    StatusBarAlignment: { Left: 1 },
  };
});

const pr: IPullRequest = {
  id: "p1",
  number: 42,
  title: "Original PR title",
  url: "https://github.com/acme/repo/pull/42",
  repo: "acme/repo",
  author: "octocat",
  isDraft: false,
  createdAt: "2026-07-01T00:00:00Z",
  ciState: "NONE",
  reviewDecision: null,
  viewerReviewState: null,
  headRefName: "feature",
  baseRefOid: "base-oid",
  headRefOid: "head-oid",
  additions: 12,
  deletions: 3,
};

const snapshot: IReviewThreadsSnapshot = {
  pendingReviewId: "pending1",
  pendingCommentCount: 1,
  threads: [{
    id: "thread1",
    path: "file.ts",
    line: null,
    startLine: null,
    side: "RIGHT",
    startSide: null,
    isResolved: true,
    isOutdated: false,
    subjectType: "FILE",
    comments: [{ id: "comment1", author: "octocat", bodyMarkdown: "original content", createdAt: pr.createdAt, isPending: true }],
  }],
};

const subscriptions: vscode.Disposable[] = [];

async function runCommand(id: string, ...args: unknown[]): Promise<void> {
  const command = host.registered.get(`githubControlCenter.${id}`);
  expect(command).toBeDefined();
  await command?.(...args);
}

async function openDiff(): Promise<void> {
  await runCommand("openFileDiff", {
    pr,
    file: { path: "file.ts", changeType: "MODIFIED", additions: 1, deletions: 0, viewedState: "UNVIEWED" },
    kind: "file",
  });
  await vi.waitFor(() => expect(host.statusBar.show).toHaveBeenCalled());
}

describe("localized extension actions", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    host.webviewPanels.length = 0;
    host.globalStateStore.clear();
    setTestLocale("zh-cn", chineseBundle());
    vi.mocked(github.fetchPullRequests).mockResolvedValue({ toReview: [], mine: [], reviewed: [] });
    vi.mocked(github.fetchReviewThreads).mockResolvedValue(snapshot);
    activate({
      subscriptions,
      extensionUri: { scheme: "file", path: "/ext", toString: () => "/ext" },
      globalState: {
        get: <T>(key: string, fallback?: T) => (host.globalStateStore.has(key) ? host.globalStateStore.get(key) : fallback),
        update: vi.fn(async (key: string, value: unknown) => {
          host.globalStateStore.set(key, value);
        }),
      },
    } as unknown as vscode.ExtensionContext);
    // The first poll seeds the notification tracker.
    await new Promise<void>((resolve) => setImmediate(resolve));
  });

  afterEach(() => {
    subscriptions.splice(0).forEach((subscription) => subscription.dispose());
    host.registered.clear();
    host.webviewViewProviders.clear();
    setTestLocale();
  });

  it.each([
    [0, "评论", "COMMENT"],
    [1, "批准", "APPROVE"],
    [2, "要求修改", "REQUEST_CHANGES"],
  ])("routes translated Quick Pick item %s to %s / %s", async (index, label, event) => {
    await openDiff();
    host.window.showQuickPick.mockImplementationOnce(async (items) => items[index]);

    await runCommand("review.submit");

    await vi.waitFor(() => expect(github.submitPendingReview).toHaveBeenCalledWith("token", pr.id, event, "review summary"));
    expect(host.window.showQuickPick.mock.calls[0][0][index].label).toBe(label);
  });

  it("routes only the localized Discard button to the pending review deletion", async () => {
    await openDiff();
    host.window.showWarningMessage.mockResolvedValueOnce("Discard");
    await runCommand("review.discard");
    expect(github.discardPendingReview).not.toHaveBeenCalled();

    host.window.showWarningMessage.mockImplementationOnce(async (_message, _options, action) => action);
    await runCommand("review.discard");
    await vi.waitFor(() => expect(github.discardPendingReview).toHaveBeenCalledWith("token", "pending1"));
    expect(host.window.showWarningMessage).toHaveBeenLastCalledWith(expect.stringContaining("丢弃"), { modal: true }, "丢弃");
  });

  it.each(["打开", "设置"])("routes the localized notification action %s", async (button) => {
    vi.mocked(github.fetchPullRequests).mockResolvedValueOnce({ toReview: [pr], mine: [], reviewed: [] });
    host.window.showInformationMessage.mockResolvedValueOnce(button);
    await runCommand("refresh");

    await vi.waitFor(() => {
      if (button === "打开") {
        expect(host.external).toHaveBeenCalledWith(expect.objectContaining({ scheme: "https" }));
      } else {
        expect(host.commands.executeCommand).toHaveBeenCalledWith("workbench.action.openSettings", "@ext:mts88.github-control-center");
      }
    });
    expect(host.window.showInformationMessage).toHaveBeenCalledWith(
      "acme/repo 有新的待审查拉取请求：octocat 创建的“Original PR title”", "打开", "设置",
    );
  });

  it.each([
    ["en", {}, "Resolved", "Pending", "PR #42: 1 pending"],
    ["zh-cn", chineseBundle(), "已解决", "待提交", "拉取请求 #42：1 条待提交评论"],
  ] as const)("renders native review labels and status bar in %s", async (locale, bundle, thread, comment, status) => {
    setTestLocale(locale, bundle);
    await openDiff();

    expect(host.createCommentThread.mock.results[0].value).toMatchObject({
      label: thread,
      contextValue: "pending",
      comments: [{ author: { name: "octocat" }, body: { value: "original content" }, label: comment }],
    });
    expect(host.statusBar.text).toContain(status);
  });

  it("syncs pixelated preference bidirectionally between PR details lightbox and file image previews", async () => {
    vi.mocked(github.fetchPrDetails).mockResolvedValue({
      number: pr.number,
      title: pr.title,
      url: pr.url,
      repo: pr.repo,
      author: pr.author,
      authorAvatarUrl: "",
      state: "OPEN",
      isDraft: false,
      createdAt: pr.createdAt,
      bodyHtml: "<p>Preview</p>",
      baseRefName: "main",
      headRefName: pr.headRefName,
      headRepo: pr.repo,
      headRefOid: pr.headRefOid,
      isBehindBase: false,
      commitsCount: 1,
      changedFiles: 1,
      additions: 1,
      deletions: 0,
      labels: [],
      mergeable: "MERGEABLE",
      mergeMethods: ["SQUASH"],
      reviewDecision: null,
      viewerDidAuthor: false,
      canApprove: true,
      pendingReviewCommentCount: null,
      reviewers: [],
      checks: [],
      checksTotal: 0,
      timeline: [],
      timelineTruncated: false,
    });
    vi.mocked(github.fetchFileBytes).mockResolvedValue({
      bytes: Uint8Array.of(0x89, 0x50, 0x4e, 0x47),
      contentType: "image/png",
    });

    await runCommand("openPrDetails", pr);
    await runCommand("openFileDiff", {
      pr,
      file: { path: "images/sprite.png", changeType: "MODIFIED", additions: 0, deletions: 0, viewedState: "UNVIEWED" },
      kind: "file",
    });

    await vi.waitFor(() => {
      expect(host.webviewPanels.some((panel) => panel.viewType === "githubControlCenter.prDetails" && panel.webview.html.includes("Preview"))).toBe(true);
      expect(host.webviewPanels.some((panel) => panel.viewType === "githubControlCenter.prImagePreview" && panel.webview.html.includes('"pixelated":true'))).toBe(true);
    });
    const detailsPanel = host.webviewPanels.find((panel) => panel.viewType === "githubControlCenter.prDetails")!;
    const previewPanelA = host.webviewPanels.find((panel) => panel.viewType === "githubControlCenter.prImagePreview")!;

    // Lightbox toggles pixelated OFF -> persists, syncs open preview panel, and new preview opens with false
    detailsPanel.webview.postMessage.mockClear();
    previewPanelA.webview.postMessage.mockClear();
    detailsPanel.webview.emitMessage({ command: "setPixelated", value: false });

    expect(host.globalStateStore.get("githubControlCenter.imageViewer.pixelated")).toBe(false);
    expect(previewPanelA.webview.postMessage).toHaveBeenCalledExactlyOnceWith({ command: "pixelated", value: false });
    expect(detailsPanel.webview.postMessage).toHaveBeenCalledExactlyOnceWith({ command: "pixelated", value: false });

    await runCommand("openFileDiff", {
      pr,
      file: { path: "images/other.png", changeType: "ADDED", additions: 0, deletions: 0, viewedState: "UNVIEWED" },
      kind: "file",
    });
    await vi.waitFor(() => {
      expect(host.webviewPanels.filter((panel) => panel.viewType === "githubControlCenter.prImagePreview")).toHaveLength(2);
    });
    const previewPanelB = host.webviewPanels.filter((panel) => panel.viewType === "githubControlCenter.prImagePreview")[1];
    expect(previewPanelB.webview.html).toContain('"pixelated":false');

    // File preview toggles pixelated ON -> persists and syncs both open PR details and other preview panels
    detailsPanel.webview.postMessage.mockClear();
    previewPanelA.webview.postMessage.mockClear();
    previewPanelB.webview.postMessage.mockClear();
    previewPanelA.webview.emitMessage({ command: "setPixelated", value: true });

    expect(host.globalStateStore.get("githubControlCenter.imageViewer.pixelated")).toBe(true);
    expect(detailsPanel.webview.postMessage).toHaveBeenCalledExactlyOnceWith({ command: "pixelated", value: true });
    expect(previewPanelA.webview.postMessage).toHaveBeenCalledExactlyOnceWith({ command: "pixelated", value: true });
    expect(previewPanelB.webview.postMessage).toHaveBeenCalledExactlyOnceWith({ command: "pixelated", value: true });
  });

  it("registers all three sidebar webview views, caches the toReview badge until resolve, and resolves webview/context commands", async () => {
    expect([...host.webviewViewProviders.keys()]).toEqual([
      "githubControlCenter.toReview",
      "githubControlCenter.reviewed",
      "githubControlCenter.mine",
    ]);

    vi.mocked(github.fetchPullRequests).mockResolvedValueOnce({ toReview: [pr], mine: [], reviewed: [] });
    vi.mocked(github.fetchPrFiles).mockResolvedValueOnce([
      { path: "src/app.ts", changeType: "MODIFIED", additions: 12, deletions: 3, viewedState: "UNVIEWED" },
    ]);
    await runCommand("refresh");
    await vi.waitFor(() => expect(github.fetchPullRequests).toHaveBeenCalledTimes(2));
    await new Promise<void>((resolve) => setImmediate(resolve));

    // Resolve the toReview WebviewView AFTER poll already set the badge
    let onMessage: ((message: unknown) => void) | undefined;
    const mockView = {
      badge: undefined as vscode.ViewBadge | undefined,
      onDidDispose: () => ({ dispose: vi.fn() }),
      webview: {
        options: {},
        html: "",
        postMessage: vi.fn().mockResolvedValue(true),
        onDidReceiveMessage: (cb: (message: unknown) => void) => {
          onMessage = cb;
          return { dispose: vi.fn() };
        },
      },
    };
    const toReviewProvider = host.webviewViewProviders.get("githubControlCenter.toReview")!;
    toReviewProvider.resolveWebviewView(mockView as unknown as vscode.WebviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);

    expect(mockView.badge).toEqual({ value: 1, tooltip: "1 个拉取请求" });

    // Trigger webview/context commands with { prId }
    await runCommand("copyPrUrl", { webviewSection: "pr", prId: pr.id, preventDefaultContextMenuItems: true });
    expect(host.clipboardWriteText).toHaveBeenCalledWith(pr.url);

    await runCommand("copyBranchName", { webviewSection: "pr", prId: pr.id, preventDefaultContextMenuItems: true });
    expect(host.clipboardWriteText).toHaveBeenCalledWith(pr.headRefName);

    await runCommand("openPr", { webviewSection: "pr", prId: pr.id, preventDefaultContextMenuItems: true });
    expect(host.external).toHaveBeenCalledWith(expect.objectContaining({ scheme: "https", path: "/acme/repo/pull/42" }));

    // Expand PR in webview to load files, then run openTextDiff from webview/context { prId, filePath }
    onMessage?.({ command: "ready" });
    onMessage?.({ command: "togglePrExpand", prId: pr.id });
    await vi.waitFor(() => expect(github.fetchPrFiles).toHaveBeenCalledWith("token", pr.id));
    await new Promise<void>((resolve) => setImmediate(resolve));

    host.commands.executeCommand.mockClear();
    await runCommand("openTextDiff", { webviewSection: "prFile", prId: pr.id, filePath: "src/app.ts", preventDefaultContextMenuItems: true });
    await vi.waitFor(() => {
      expect(host.commands.executeCommand).toHaveBeenCalledWith(
        "vscode.diff",
        expect.objectContaining({ scheme: "ghcc-pr" }),
        expect.objectContaining({ scheme: "ghcc-pr" }),
        "app.ts（拉取请求 #42）",
        { preview: true },
      );
    });
  });
});
