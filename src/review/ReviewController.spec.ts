import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { fetchReviewThreads } from "../github/github";
import type { IPullRequest, IReviewThread } from "../core/types";
import { ReviewController } from "./ReviewController";

vi.mock("../github/github", () => ({ fetchReviewThreads: vi.fn() }));
vi.mock("vscode", async (importOriginal) => {
  const original = await importOriginal<typeof vscode>();
  return {
    ...original,
    Uri: { from: original.Uri.from, parse: (url: string) => new URL(url) },
    Range: vi.fn(),
    MarkdownString: class {
      constructor(readonly value: string) {}
    },
    comments: { createCommentController: vi.fn() },
    CommentMode: { Preview: 1 },
    CommentThreadState: { Resolved: 1, Unresolved: 0 },
    CommentThreadCollapsibleState: { Collapsed: 0, Expanded: 1 },
  };
});

const pr: IPullRequest = {
  id: "PR_42",
  repo: "acme/repo",
  headRepo: "contributor/fork",
  title: "Fix it",
  url: "https://github.com/acme/repo/pull/42",
  number: 42,
  author: "contributor",
  isDraft: false,
  createdAt: "",
  ciState: "NONE",
  reviewDecision: null,
  viewerReviewState: null,
  headRefName: "feature",
  baseRefOid: "base-sha",
  headRefOid: "head-sha",
  additions: 5,
  deletions: 1,
};

describe("ReviewController Markdown image context", () => {
  it.each([
    ["LINE", "LEFT", "https://github.com/acme/repo/raw/base-sha/"],
    ["LINE", "RIGHT", "https://github.com/contributor/fork/raw/head-sha/"],
    ["FILE", "RIGHT", "https://github.com/contributor/fork/raw/head-sha/"],
  ] as const)("sets the repo baseUri and preserves trust for %s comments on %s", async (subjectType, side, url) => {
    const createCommentThread = vi.fn((uri: vscode.Uri) => ({ uri, comments: [] }));
    vi.mocked(vscode.comments.createCommentController)
      .mockReturnValue({ createCommentThread } as unknown as ReturnType<typeof vscode.comments.createCommentController>);
    const bodyMarkdown = "![preview](docs/screenshot.png)";
    const thread: IReviewThread = {
      id: "thread",
      path: "src/app.ts",
      line: subjectType === "LINE" ? 5 : null,
      startLine: null,
      side,
      startSide: null,
      isResolved: false,
      isOutdated: false,
      subjectType,
      comments: [{ id: "comment", author: "octocat", bodyMarkdown, isPending: false, createdAt: "2026-01-01" }],
    };
    vi.mocked(fetchReviewThreads).mockResolvedValue({ threads: [thread], pendingReviewId: null, pendingCommentCount: 0 });
    const controller = new ReviewController({ getToken: async () => "token", getPatch: async () => undefined, onPendingChanged: vi.fn() });

    await controller.reload(pr);

    const vsThread = createCommentThread.mock.results[0].value;
    expect(vsThread.comments).toEqual([expect.objectContaining({
      body: expect.objectContaining({ value: bodyMarkdown, baseUri: new URL(url) }),
    })]);
    expect(vsThread.comments[0]).not.toHaveProperty("body.isTrusted");
  });

  it("materializes new threads concurrently via Promise.all without leaking on failure", async () => {
    const dispose = vi.fn();
    const createCommentThread = vi.fn((uri: vscode.Uri) => ({ uri, comments: [], dispose }));
    vi.mocked(vscode.comments.createCommentController)
      .mockReturnValue({ createCommentThread } as unknown as ReturnType<typeof vscode.comments.createCommentController>);

    const makeThread = (id: string, path: string, side: "LEFT" | "RIGHT"): IReviewThread => ({
      id,
      path,
      line: 3,
      startLine: null,
      side,
      startSide: null,
      isResolved: false,
      isOutdated: false,
      subjectType: "LINE",
      comments: [{ id: `c-${id}`, author: "octocat", bodyMarkdown: "note", isPending: false, createdAt: "2026-01-01" }],
    });

    const resolvers: Array<(value: { path: string; previousPath?: string } | undefined) => void> = [];
    const getPatch = vi.fn(
      () => new Promise<{ path: string; previousPath?: string } | undefined>((resolve) => { resolvers.push(resolve); }),
    );
    vi.mocked(fetchReviewThreads).mockResolvedValueOnce({
      threads: [makeThread("t1", "a.ts", "LEFT"), makeThread("t2", "b.ts", "LEFT")],
      pendingReviewId: null,
      pendingCommentCount: 0,
    });
    const controller = new ReviewController({ getToken: async () => "token", getPatch, onPendingChanged: vi.fn() });

    const reloading = controller.reload(pr);
    await vi.waitFor(() => expect(getPatch).toHaveBeenCalledTimes(2));
    // Both LEFT-side patch lookups started before either resolved (concurrent, not serial)
    expect(resolvers).toHaveLength(2);
    resolvers[1]({ path: "b.ts", previousPath: "old-b.ts" });
    resolvers[0]({ path: "a.ts", previousPath: "old-a.ts" });
    await reloading;

    expect(createCommentThread).toHaveBeenCalledTimes(2);
    expect(controller.threadRef(createCommentThread.mock.results[0].value as unknown as vscode.CommentThread)).toEqual({ prId: pr.id, threadId: "t1" });
    expect(controller.threadRef(createCommentThread.mock.results[1].value as unknown as vscode.CommentThread)).toEqual({ prId: pr.id, threadId: "t2" });

    // Failure case: a RIGHT thread and a failing LEFT thread must not leak any CommentThread
    createCommentThread.mockClear();
    const failingGetPatch = vi.fn().mockRejectedValue(new Error("patch failed"));
    const controller2 = new ReviewController({ getToken: async () => "token", getPatch: failingGetPatch, onPendingChanged: vi.fn() });
    vi.mocked(fetchReviewThreads).mockResolvedValueOnce({
      threads: [makeThread("t-right", "r.ts", "RIGHT"), makeThread("t-left", "l.ts", "LEFT")],
      pendingReviewId: null,
      pendingCommentCount: 0,
    });

    await expect(controller2.reload(pr)).rejects.toThrow("patch failed");
    expect(createCommentThread).not.toHaveBeenCalled();
  });

  it("does not create orphan CommentThreads if disposed while reload is in flight", async () => {
    const createCommentThread = vi.fn((uri: vscode.Uri) => ({ uri, comments: [], dispose: vi.fn() }));
    const controllerDispose = vi.fn();
    vi.mocked(vscode.comments.createCommentController).mockReturnValue({
      createCommentThread,
      dispose: controllerDispose,
    } as unknown as ReturnType<typeof vscode.comments.createCommentController>);

    let resolvePatch!: (value: { path: string; previousPath?: string } | undefined) => void;
    const getPatch = vi.fn(
      () => new Promise<{ path: string; previousPath?: string } | undefined>((resolve) => { resolvePatch = resolve; }),
    );
    const onPendingChanged = vi.fn();
    vi.mocked(fetchReviewThreads).mockResolvedValueOnce({
      threads: [{
        id: "t1",
        path: "a.ts",
        line: 3,
        startLine: null,
        side: "LEFT",
        startSide: null,
        isResolved: false,
        isOutdated: false,
        subjectType: "LINE",
        comments: [{ id: "c1", author: "octocat", bodyMarkdown: "note", isPending: false, createdAt: "2026-01-01" }],
      }],
      pendingReviewId: "rev1",
      pendingCommentCount: 1,
    });
    const controller = new ReviewController({ getToken: async () => "token", getPatch, onPendingChanged });

    const reloading = controller.reload(pr);
    await vi.waitFor(() => expect(getPatch).toHaveBeenCalledTimes(1));

    controller.dispose();
    resolvePatch({ path: "a.ts", previousPath: "old-a.ts" });
    await reloading;

    expect(controllerDispose).toHaveBeenCalledOnce();
    expect(createCommentThread).not.toHaveBeenCalled();
    expect(onPendingChanged).not.toHaveBeenCalled();
  });
});
