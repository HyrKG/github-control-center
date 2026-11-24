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
});
