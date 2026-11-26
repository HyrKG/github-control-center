import type * as vscode from "vscode";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chineseBundle, setTestLocale } from "./core/localizationTestUtils";
import type { IPullRequest, IReviewThreadsSnapshot } from "./core/types";
import { activate } from "./extension";
import * as github from "./github/github";
import { toPrUri } from "./review/PrContentProvider";

vi.mock("./github/github", async (importOriginal) => ({
  ...await importOriginal<typeof github>(),
  getSession: vi.fn().mockResolvedValue({ accessToken: "token" }),
  fetchPullRequests: vi.fn(),
  fetchPrDetails: vi.fn(),
  fetchPrFiles: vi.fn().mockResolvedValue([]),
  fetchFileBytes: vi.fn(),
  fetchFileContent: vi.fn().mockResolvedValue("file content"),
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
  const outputLines: string[] = [];
  const webviewPanels: IMockWebviewPanel[] = [];
  const globalStateStore = new Map<string, unknown>();
  const configStore = new Map<string, unknown>();
  const configUpdate = vi.fn(async (key: string, value: unknown) => {
    configStore.set(key, value);
  });
  const clipboardWriteText = vi.fn();
  let onWindowStateChange: ((state: { focused: boolean }) => void) | undefined;
  let onSessionsChange: ((event: { provider: { id: string } }) => void) | undefined;
  let onConfigChange: ((event: vscode.ConfigurationChangeEvent) => void) | undefined;
  let contentProvider: vscode.TextDocumentContentProvider | undefined;

  return {
    registered,
    webviewViewProviders,
    statusBar,
    outputLines,
    webviewPanels,
    globalStateStore,
    configStore,
    configUpdate,
    clipboardWriteText,
    external: vi.fn(),
    createCommentThread: vi.fn(() => ({ ...subscription })),
    emitWindowState: (focused: boolean) => {
      host.window.state.focused = focused;
      onWindowStateChange?.({ focused });
    },
    emitSessionsChange: (providerId: string) => {
      onSessionsChange?.({ provider: { id: providerId } });
    },
    emitConfigChange: (affectedSections: string[]) => {
      onConfigChange?.({
        affectsConfiguration: (section: string) =>
          affectedSections.some((changed) => changed === section || changed.startsWith(`${section}.`) || section.startsWith(`${changed}.`)),
      });
    },
    getContentProvider: () => contentProvider,
    authentication: {
      onDidChangeSessions: (cb: (event: { provider: { id: string } }) => void) => {
        onSessionsChange = cb;
        return subscription;
      },
    },
    commands: {
      registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
        registered.set(id, handler);
        return subscription;
      },
      executeCommand: vi.fn(async (id: string) => registered.get(id)?.()),
    },
    workspace: {
      getConfiguration: () => ({
        get: <T>(key: string, fallback: T) => (configStore.has(key) ? (configStore.get(key) as T) : fallback),
        update: configUpdate,
      }),
      onDidChangeConfiguration: (cb: (event: vscode.ConfigurationChangeEvent) => void) => {
        onConfigChange = cb;
        return subscription;
      },
      registerTextDocumentContentProvider: (_scheme: string, provider: vscode.TextDocumentContentProvider) => {
        contentProvider = provider;
        return subscription;
      },
    },
    window: {
      state: { focused: false },
      createOutputChannel: () => ({ ...subscription, appendLine: vi.fn((line: string) => outputLines.push(line)) }),
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
      onDidChangeWindowState: (cb: (state: { focused: boolean }) => void) => {
        onWindowStateChange = cb;
        return subscription;
      },
      showInformationMessage: vi.fn<(message: string, ...actions: string[]) => Promise<string | undefined>>().mockResolvedValue(undefined),
      showWarningMessage: vi.fn<(message: string, options: unknown, action: string) => Promise<string | undefined>>().mockResolvedValue(undefined),
      showErrorMessage: vi.fn<(message: string) => Promise<string | undefined>>().mockResolvedValue(undefined),
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
    authentication: host.authentication,
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
    ConfigurationTarget: { Global: 1 },
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
    host.outputLines.length = 0;
    host.window.state.focused = false;
    host.globalStateStore.clear();
    host.configStore.clear();
    setTestLocale("zh-cn", chineseBundle());
    vi.mocked(github.getSession).mockResolvedValue({ accessToken: "token" } as vscode.AuthenticationSession);
    vi.mocked(github.fetchPullRequests).mockResolvedValue({ toReview: [], mine: [], reviewed: [] });
    vi.mocked(github.fetchFileContent).mockResolvedValue("file content");
    vi.mocked(github.fetchPrFilePatches).mockResolvedValue([]);
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
    host.clipboardWriteText.mockClear();
    onMessage?.({ command: "copyPrUrl", prId: pr.id });
    expect(host.clipboardWriteText).toHaveBeenCalledExactlyOnceWith(pr.url);
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

  it("opens non-renamed diffs without awaiting patches, logs background patch errors, and awaits patches for renames", async () => {
    let rejectPatches!: (error: Error) => void;
    vi.mocked(github.fetchPrFilePatches).mockImplementationOnce(
      () => new Promise((_, reject) => { rejectPatches = reject; }),
    );
    host.commands.executeCommand.mockClear();

    // MODIFIED file opens vscode.diff immediately even though fetchPrFilePatches has not settled
    await runCommand("openFileDiff", {
      pr,
      file: { path: "src/fast.ts", changeType: "MODIFIED", additions: 1, deletions: 0, viewedState: "UNVIEWED" },
      kind: "file",
    });
    expect(host.commands.executeCommand).toHaveBeenCalledWith(
      "vscode.diff",
      expect.objectContaining({ scheme: "ghcc-pr", path: "/src/fast.ts" }),
      expect.objectContaining({ scheme: "ghcc-pr", path: "/src/fast.ts" }),
      "fast.ts（拉取请求 #42）",
      { preview: true },
    );

    // Background patch warm-up failure lands in output channel, not an error toast
    rejectPatches(new Error("patch timeout"));
    await vi.waitFor(() => expect(host.outputLines.some((line) => line.includes("patch timeout"))).toBe(true));
    expect(host.window.showErrorMessage).not.toHaveBeenCalled();

    // RENAMED file awaits patches to populate previousPath on the LEFT URI
    let resolveRenamePatches!: (patches: Array<{ path: string; previousPath?: string }>) => void;
    vi.mocked(github.fetchPrFilePatches).mockImplementationOnce(
      () => new Promise((resolve) => { resolveRenamePatches = resolve; }),
    );
    host.commands.executeCommand.mockClear();
    const renamedPr = { ...pr, id: "p-renamed", headRefOid: "head-renamed" };
    const openRenamed = runCommand("openFileDiff", {
      pr: renamedPr,
      file: { path: "src/new-name.ts", changeType: "RENAMED", additions: 1, deletions: 0, viewedState: "UNVIEWED" },
      kind: "file",
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(host.commands.executeCommand).not.toHaveBeenCalledWith("vscode.diff", expect.anything(), expect.anything(), expect.anything(), expect.anything());

    resolveRenamePatches([{ path: "src/new-name.ts", previousPath: "src/old-name.ts" }]);
    await openRenamed;
    await vi.waitFor(() => {
      expect(host.commands.executeCommand).toHaveBeenCalledWith(
        "vscode.diff",
        expect.objectContaining({ scheme: "ghcc-pr", path: "/src/old-name.ts" }),
        expect.objectContaining({ scheme: "ghcc-pr", path: "/src/new-name.ts" }),
        "new-name.ts（拉取请求 #42）",
        { preview: true },
      );
    });

    // COPIED and stale file nodes also await patches to resolve previousPath
    for (const [label, extra] of [
      ["copied", { file: { path: "src/copied.ts", changeType: "COPIED" as const, additions: 1, deletions: 0, viewedState: "UNVIEWED" as const } }],
      ["stale", { file: { path: "src/stale.ts", changeType: "MODIFIED" as const, additions: 1, deletions: 0, viewedState: "UNVIEWED" as const }, stale: true }],
    ] as const) {
      let resolveCasePatches!: (patches: Array<{ path: string; previousPath?: string }>) => void;
      vi.mocked(github.fetchPrFilePatches).mockImplementationOnce(
        () => new Promise((resolve) => { resolveCasePatches = resolve; }),
      );
      host.commands.executeCommand.mockClear();
      const casePr = { ...pr, id: `p-${label}`, headRefOid: `head-${label}` };
      void runCommand("openFileDiff", { pr: casePr, kind: "file", ...extra });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(host.commands.executeCommand).not.toHaveBeenCalledWith("vscode.diff", expect.anything(), expect.anything(), expect.anything(), expect.anything());

      resolveCasePatches([{ path: extra.file.path, previousPath: `src/origin-${label}.ts` }]);
      await vi.waitFor(() => {
        expect(host.commands.executeCommand).toHaveBeenCalledWith(
          "vscode.diff",
          expect.objectContaining({ scheme: "ghcc-pr", path: `/src/origin-${label}.ts` }),
          expect.objectContaining({ scheme: "ghcc-pr", path: `/${extra.file.path}` }),
          expect.any(String),
          { preview: true },
        );
      });
    }

    // Stale file node refreshes metadata from loadPrFiles (e.g. MODIFIED -> DELETED marks right side empty)
    const staleDeletedPr = { ...pr, id: "p-stale-del", headRefOid: "head-stale-del" };
    vi.mocked(github.fetchPrFilePatches).mockResolvedValueOnce([{ path: "src/removed.ts" }]);
    vi.mocked(github.fetchPrFiles).mockResolvedValueOnce([
      { path: "src/removed.ts", changeType: "DELETED", additions: 0, deletions: 10, viewedState: "UNVIEWED" },
    ]);
    host.commands.executeCommand.mockClear();
    await runCommand("openFileDiff", {
      pr: staleDeletedPr,
      file: { path: "src/removed.ts", changeType: "MODIFIED", additions: 1, deletions: 0, viewedState: "UNVIEWED" },
      kind: "file",
      stale: true,
    });
    await vi.waitFor(() => {
      expect(host.commands.executeCommand).toHaveBeenCalledWith(
        "vscode.diff",
        expect.objectContaining({ scheme: "ghcc-pr", path: "/src/removed.ts" }),
        expect.objectContaining({ scheme: "ghcc-pr", path: "/src/removed.ts", query: expect.stringContaining("empty=1") }),
        expect.any(String),
        { preview: true },
      );
    });
  });

  it("shares LRU image bytes across preview and details for 40-char SHAs while avoiding stale persistence for branch refs", async () => {
    const headSha = "a".repeat(40);
    const baseSha = "b".repeat(40);
    const shaPr: IPullRequest = { ...pr, id: "p-sha", baseRefOid: baseSha, headRefOid: headSha };
    vi.mocked(github.fetchPrDetails).mockResolvedValue({
      number: shaPr.number,
      title: shaPr.title,
      url: shaPr.url,
      repo: shaPr.repo,
      author: shaPr.author,
      authorAvatarUrl: "",
      state: "OPEN",
      isDraft: false,
      createdAt: shaPr.createdAt,
      bodyHtml: "<p>Image test</p>",
      baseRefName: "main",
      headRefName: shaPr.headRefName,
      headRepo: shaPr.repo,
      headRefOid: headSha,
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

    // Open ADDED image in PrImagePreview (caches headSha entry)
    await runCommand("openFileDiff", {
      pr: shaPr,
      file: { path: "docs/logo.png", changeType: "ADDED", additions: 0, deletions: 0, viewedState: "UNVIEWED" },
      kind: "file",
    });
    await vi.waitFor(() => expect(github.fetchFileBytes).toHaveBeenCalledTimes(1));

    // Open PR details and resolve the exact same repo/SHA/path image -> hits shared cache!
    await runCommand("openPrDetails", shaPr);
    const detailsPanel = host.webviewPanels.find((panel) => panel.viewType === "githubControlCenter.prDetails")!;
    detailsPanel.webview.postMessage.mockClear();
    detailsPanel.webview.emitMessage({
      command: "resolveImage",
      requestId: "req-sha",
      src: `https://github.com/${shaPr.repo}/blob/${headSha}/docs/logo.png`,
    });
    await vi.waitFor(() => expect(detailsPanel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: "imageResolved",
      requestId: "req-sha",
      dataUri: expect.stringContaining("data:image/png;base64,"),
    })));
    expect(github.fetchFileBytes).toHaveBeenCalledTimes(1);

    // Non-SHA branch ref must NOT persist across sequential calls (prevents stale images after push)
    vi.mocked(github.fetchFileBytes).mockClear();
    detailsPanel.webview.postMessage.mockClear();
    const branchUrl = `https://github.com/${shaPr.repo}/blob/main/docs/logo.png`;
    detailsPanel.webview.emitMessage({ command: "resolveImage", requestId: "req-branch-1", src: branchUrl });
    await vi.waitFor(() => expect(detailsPanel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ requestId: "req-branch-1" })));
    detailsPanel.webview.emitMessage({ command: "resolveImage", requestId: "req-branch-2", src: branchUrl });
    await vi.waitFor(() => expect(detailsPanel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({ requestId: "req-branch-2" })));
    expect(github.fetchFileBytes).toHaveBeenCalledTimes(2);
  });

  it("coalesces concurrent refreshes and runs at most one follow-up pass for forced refreshes", async () => {
    let resolveFirst!: (snapshot: { toReview: IPullRequest[]; mine: IPullRequest[]; reviewed: IPullRequest[] }) => void;
    vi.mocked(github.fetchPullRequests)
      .mockReset()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValue({ toReview: [], mine: [], reviewed: [] });

    // Start one refresh (in-flight), then trigger multiple forced manual refreshes while it runs
    void runCommand("refresh");
    await vi.waitFor(() => expect(github.fetchPullRequests).toHaveBeenCalledTimes(1));

    void runCommand("refresh");
    void runCommand("refresh");
    void runCommand("refresh");
    expect(github.fetchPullRequests).toHaveBeenCalledTimes(1);

    resolveFirst({ toReview: [], mine: [], reviewed: [] });
    await vi.waitFor(() => expect(github.fetchPullRequests).toHaveBeenCalledTimes(2));
    await new Promise<void>((resolve) => setImmediate(resolve));
    // Multiple forced calls while in-flight coalesced into exactly one follow-up pass
    expect(github.fetchPullRequests).toHaveBeenCalledTimes(2);
  });

  it("clears image and content caches on GitHub session change so accounts never cross-serve cached data", async () => {
    const headSha = "c".repeat(40);
    const baseSha = "d".repeat(40);
    const shaPr: IPullRequest = { ...pr, id: "p-acct", baseRefOid: baseSha, headRefOid: headSha };
    vi.mocked(github.getSession).mockResolvedValue({ id: "acct-a", accessToken: "token-a" } as vscode.AuthenticationSession);
    vi.mocked(github.fetchFileBytes)
      .mockResolvedValueOnce({ bytes: Uint8Array.of(0x89, 0x50, 0x4e, 0x47), contentType: "image/png" })
      .mockResolvedValueOnce({ bytes: Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x01), contentType: "image/png" });
    vi.mocked(github.fetchFileContent)
      .mockResolvedValueOnce("account A secret")
      .mockResolvedValueOnce("account B secret");

    // Populate both image cache and content provider cache under Account A
    await runCommand("openFileDiff", {
      pr: shaPr,
      file: { path: "docs/secret.png", changeType: "ADDED", additions: 0, deletions: 0, viewedState: "UNVIEWED" },
      kind: "file",
    });
    await vi.waitFor(() => expect(github.fetchFileBytes).toHaveBeenCalledTimes(1));

    const provider = host.getContentProvider()!;
    const uri = toPrUri({
      prId: shaPr.id,
      repo: shaPr.repo,
      prNumber: shaPr.number,
      path: "src/secret.ts",
      sha: headSha,
      headOid: headSha,
      side: "RIGHT",
      isEmpty: false,
    });
    await expect(provider.provideTextDocumentContent(uri, {} as vscode.CancellationToken)).resolves.toBe("account A secret");
    expect(github.fetchFileContent).toHaveBeenCalledTimes(1);

    // Switch GitHub session -> clears all caches AND closes already-open PrImagePreview panels automatically
    vi.mocked(github.getSession).mockResolvedValue({ id: "acct-b", accessToken: "token-b" } as vscode.AuthenticationSession);
    const previewPanelCountBeforeSwitch = host.webviewPanels.filter((panel) => panel.viewType === "githubControlCenter.prImagePreview").length;
    host.emitSessionsChange("github");
    await new Promise<void>((resolve) => setImmediate(resolve));

    // Re-opening the exact same image revision creates a fresh panel and fetches under token-b (no stale panel reuse!)
    await runCommand("openFileDiff", {
      pr: shaPr,
      file: { path: "docs/secret.png", changeType: "ADDED", additions: 0, deletions: 0, viewedState: "UNVIEWED" },
      kind: "file",
    });
    await vi.waitFor(() => expect(github.fetchFileBytes).toHaveBeenCalledTimes(2));
    expect(github.fetchFileBytes).toHaveBeenLastCalledWith("token-b", shaPr.repo, "docs/secret.png", headSha);
    expect(host.webviewPanels.filter((panel) => panel.viewType === "githubControlCenter.prImagePreview")).toHaveLength(previewPanelCountBeforeSwitch + 1);

    await expect(provider.provideTextDocumentContent(uri, {} as vscode.CancellationToken)).resolves.toBe("account B secret");
    expect(github.fetchFileContent).toHaveBeenCalledTimes(2);
    expect(github.fetchFileContent).toHaveBeenLastCalledWith("token-b", shaPr.repo, "src/secret.ts", headSha);
  });

  it("discards in-flight old-account poll responses after a GitHub session switch and refreshes the new account", async () => {
    const prA: IPullRequest = { ...pr, id: "PR_A", title: "Account A private PR" };
    const prB: IPullRequest = { ...pr, id: "PR_B", title: "Account B PR" };
    let resolvePollA!: (snapshot: { toReview: IPullRequest[]; mine: IPullRequest[]; reviewed: IPullRequest[] }) => void;

    vi.mocked(github.getSession).mockResolvedValue({ id: "acct-a", accessToken: "token-a" } as vscode.AuthenticationSession);
    vi.mocked(github.fetchPullRequests)
      .mockReset()
      .mockImplementationOnce(() => new Promise((resolve) => { resolvePollA = resolve; }))
      .mockResolvedValueOnce({ toReview: [prB], mine: [], reviewed: [] });

    // Start poll under Account A (hangs inside fetchPullRequests)
    void runCommand("refresh");
    await vi.waitFor(() => expect(github.fetchPullRequests).toHaveBeenCalledWith("token-a"));

    // Switch to Account B while Account A's poll is still in flight
    vi.mocked(github.getSession).mockResolvedValue({ id: "acct-b", accessToken: "token-b" } as vscode.AuthenticationSession);
    host.emitSessionsChange("github");

    // Account A's stale response arrives late -> must NOT write Account A's PR to sidebar or toast!
    host.window.showInformationMessage.mockClear();
    resolvePollA({ toReview: [prA], mine: [], reviewed: [] });

    // Queued Account B forced refresh runs next and populates only Account B's PR
    await vi.waitFor(() => expect(github.fetchPullRequests).toHaveBeenCalledWith("token-b"));
    await new Promise<void>((resolve) => setImmediate(resolve));

    const toReviewProvider = host.webviewViewProviders.get("githubControlCenter.toReview") as unknown as {
      findPr(id: string): IPullRequest | undefined;
    };
    expect(toReviewProvider.findPr("PR_A")).toBeUndefined();
    expect(toReviewProvider.findPr("PR_B")).toEqual(prB);
    expect(host.window.showInformationMessage).not.toHaveBeenCalledWith(expect.stringContaining("Account A private PR"), expect.anything(), expect.anything());
  });

  it("toggles favoriteRepos case-insensitively, syncs all three sidebar views, and skips network polling on favoriteRepos-only config changes", async () => {
    const prAlpha: IPullRequest = { ...pr, id: "PR_ALPHA", repo: "acme/alpha", number: 101 };
    const prZeta: IPullRequest = { ...pr, id: "PR_ZETA", repo: "acme/zeta", number: 202 };
    const reviewedAlpha: IPullRequest = {
      ...prAlpha,
      id: "PR_REV_ALPHA",
      reviewDecision: "APPROVED",
      viewerReviewState: "APPROVED",
      isViewerApprovalStale: false,
    };
    const reviewedZeta: IPullRequest = {
      ...prZeta,
      id: "PR_REV_ZETA",
      reviewDecision: "APPROVED",
      viewerReviewState: "APPROVED",
      isViewerApprovalStale: false,
    };
    vi.mocked(github.fetchPullRequests).mockResolvedValueOnce({
      toReview: [prAlpha, prZeta],
      reviewed: [reviewedAlpha, reviewedZeta],
      mine: [prAlpha, prZeta],
    });
    await runCommand("refresh");
    await vi.waitFor(() => expect(github.fetchPullRequests).toHaveBeenCalledTimes(2));
    await new Promise<void>((resolve) => setImmediate(resolve));

    const viewIds = [
      "githubControlCenter.toReview",
      "githubControlCenter.reviewed",
      "githubControlCenter.mine",
    ] as const;
    const views = viewIds.map((viewId) => {
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
          emitMessage: (message: unknown) => onMessage?.(message),
        },
      };
      host.webviewViewProviders.get(viewId)!.resolveWebviewView(
        mockView as unknown as vscode.WebviewView,
        {} as vscode.WebviewViewResolveContext,
        {} as vscode.CancellationToken,
      );
      mockView.webview.emitMessage({ command: "ready" });
      return mockView;
    });

    const latestOrder = (view: (typeof views)[number]) => {
      const last = [...view.webview.postMessage.mock.calls].reverse()[0]?.[0] as {
        snapshot: { groups: Array<{ repo: string; favorite: boolean }> };
      };
      return last.snapshot.groups.map((g) => [g.repo, g.favorite]);
    };

    for (const view of views) {
      expect(latestOrder(view)).toEqual([["acme/alpha", false], ["acme/zeta", false]]);
    }

    // Toggle favorite via webview/context payload -> persists globally and pins across all 3 views with zero extra poll
    vi.mocked(github.fetchPullRequests).mockClear();
    await runCommand("toggleFavoriteRepo", { webviewSection: "repo", repo: "acme/zeta", preventDefaultContextMenuItems: true });
    expect(host.configUpdate).toHaveBeenCalledWith("favoriteRepos", ["acme/zeta"], 1);
    expect(github.fetchPullRequests).not.toHaveBeenCalled();
    for (const view of views) {
      expect(latestOrder(view)).toEqual([["acme/zeta", true], ["acme/alpha", false]]);
    }

    // External favoriteRepos config change refreshes all 3 views with zero network polling
    host.configStore.set("favoriteRepos", ["ACME/ALPHA"]);
    host.emitConfigChange(["githubControlCenter.favoriteRepos"]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(github.fetchPullRequests).not.toHaveBeenCalled();
    for (const view of views) {
      expect(latestOrder(view)).toEqual([["acme/alpha", true], ["acme/zeta", false]]);
    }

    // Toggling off matches case-insensitively ("acme/alpha" removes "ACME/ALPHA")
    views[0].webview.emitMessage({ command: "toggleFavoriteRepo", repo: "acme/alpha" });
    await vi.waitFor(() => expect(host.configStore.get("favoriteRepos")).toEqual([]));
    expect(github.fetchPullRequests).not.toHaveBeenCalled();
    for (const view of views) {
      expect(latestOrder(view)).toEqual([["acme/alpha", false], ["acme/zeta", false]]);
    }

    // Changing a poll-affecting setting (e.g. mutedRepos) still triggers a refresh poll
    host.emitConfigChange(["githubControlCenter.mutedRepos"]);
    await vi.waitFor(() => expect(github.fetchPullRequests).toHaveBeenCalledTimes(1));
  });
});

describe("window focus cooldown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    host.webviewPanels.length = 0;
    host.outputLines.length = 0;
    host.window.state.focused = true;
    host.globalStateStore.clear();
    host.configStore.clear();
    vi.mocked(github.getSession).mockResolvedValue({ accessToken: "token" } as vscode.AuthenticationSession);
    vi.mocked(github.fetchPullRequests).mockResolvedValue({ toReview: [], mine: [], reviewed: [] });
    vi.mocked(github.fetchFileContent).mockResolvedValue("file content");
    vi.mocked(github.fetchPrFilePatches).mockResolvedValue([]);
    vi.mocked(github.fetchReviewThreads).mockResolvedValue(snapshot);
  });

  afterEach(() => {
    subscriptions.splice(0).forEach((subscription) => subscription.dispose());
    host.registered.clear();
    host.webviewViewProviders.clear();
    vi.useRealTimers();
  });

  function activateFresh(): void {
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
  }

  it("skips immediate fetch on focus within 30s of a successful refresh and fetches once cooldown elapses", async () => {
    activateFresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(github.fetchPullRequests).toHaveBeenCalledTimes(1);

    // Blur and refocus after 10s (< 30s cooldown) -> no immediate refresh
    host.emitWindowState(false);
    await vi.advanceTimersByTimeAsync(10_000);
    host.emitWindowState(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(github.fetchPullRequests).toHaveBeenCalledTimes(1);

    // Blur and refocus after another 25s (total 35s >= 30s cooldown) -> immediate catch-up refresh
    host.emitWindowState(false);
    await vi.advanceTimersByTimeAsync(25_000);
    host.emitWindowState(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(github.fetchPullRequests).toHaveBeenCalledTimes(2);
  });

  it("fetches immediately on focus when no refresh has succeeded yet", async () => {
    vi.mocked(github.fetchPullRequests)
      .mockRejectedValueOnce(new Error("initial network failure"))
      .mockResolvedValue({ toReview: [], mine: [], reviewed: [] });

    activateFresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(github.fetchPullRequests).toHaveBeenCalledTimes(1);

    // Refocus after 5s — initial refresh failed so cooldown does not apply
    host.emitWindowState(false);
    await vi.advanceTimersByTimeAsync(5_000);
    host.emitWindowState(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(github.fetchPullRequests).toHaveBeenCalledTimes(2);
  });

  it("keeps the poll loop alive and executes queued forced refreshes even when getSession rejects", async () => {
    let rejectFirstSession!: (error: Error) => void;
    vi.mocked(github.getSession)
      .mockReset()
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectFirstSession = reject; }))
      .mockResolvedValue({ accessToken: "token" } as vscode.AuthenticationSession);

    activateFresh();
    // Queue a forced refresh while the initial poll's getSession is pending
    void runCommand("refresh");

    // Reject the initial getSession -> must log failure, still run the queued forced refresh, and keep polling
    rejectFirstSession(new Error("auth provider offline"));
    await vi.advanceTimersByTimeAsync(0);

    expect(host.outputLines.some((line) => line.includes("auth provider offline"))).toBe(true);
    expect(github.fetchPullRequests).toHaveBeenCalledTimes(1);

    // Advance past the next scheduled poll interval (150s base) to verify the poll timer survived
    await vi.advanceTimersByTimeAsync(150_000);
    expect(github.fetchPullRequests).toHaveBeenCalledTimes(2);
  });
});
