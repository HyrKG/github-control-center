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
  fetchPrFilePatches: vi.fn().mockResolvedValue([]),
  fetchReviewThreads: vi.fn(),
  submitPendingReview: vi.fn().mockResolvedValue(undefined),
  discardPendingReview: vi.fn().mockResolvedValue(undefined),
}));

const host = vi.hoisted(() => {
  const subscription = { dispose: vi.fn() };
  const registered = new Map<string, (...args: unknown[]) => unknown>();
  const statusBar = { ...subscription, hide: vi.fn(), show: vi.fn(), text: "", tooltip: "" };

  return {
    registered,
    statusBar,
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
      getConfiguration: () => ({ get: <T>(_: string, fallback: T) => fallback }),
      onDidChangeConfiguration: () => subscription,
      registerTextDocumentContentProvider: () => subscription,
    },
    window: {
      state: { focused: false },
      createOutputChannel: () => ({ ...subscription, appendLine: vi.fn() }),
      createStatusBarItem: () => statusBar,
      createTreeView: () => ({ ...subscription, onDidChangeCheckboxState: () => subscription }),
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
    env: { get language() { return original.env.language; }, openExternal: host.external },
    comments: { createCommentController: () => ({ createCommentThread: host.createCommentThread, dispose: vi.fn() }) },
    commands: host.commands,
    workspace: host.workspace,
    window: host.window,
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
    setTestLocale("zh-cn", chineseBundle());
    vi.mocked(github.fetchPullRequests).mockResolvedValue({ toReview: [], mine: [], reviewed: [] });
    vi.mocked(github.fetchReviewThreads).mockResolvedValue(snapshot);
    activate({ subscriptions, globalState: { get: () => [] } } as unknown as vscode.ExtensionContext);
    // The first poll seeds the notification tracker.
    await new Promise<void>((resolve) => setImmediate(resolve));
  });

  afterEach(() => {
    subscriptions.splice(0).forEach((subscription) => subscription.dispose());
    host.registered.clear();
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
});
