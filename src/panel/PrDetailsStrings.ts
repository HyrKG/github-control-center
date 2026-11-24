import * as vscode from "vscode";
import { createImageViewerStrings, viewerLanguage } from "../core/imageViewerStrings";
import type { MergeMethod, UpdateBranchMethod } from "../core/types";

export function mergeMethodLabels(): Record<MergeMethod, string> {
  return {
    SQUASH: vscode.l10n.t("Squash and merge"),
    MERGE: vscode.l10n.t("Create a merge commit"),
    REBASE: vscode.l10n.t("Rebase and merge"),
  };
}

export function updateMethodLabels(): Record<UpdateBranchMethod, string> {
  return {
    REBASE: vscode.l10n.t("Update with rebase"),
    MERGE: vscode.l10n.t("Update with merge commit"),
  };
}

export function prDetailsLanguage(): string {
  return viewerLanguage();
}

export type IPrDetailsStrings = ReturnType<typeof createPrDetailsStrings>;

export function createPrDetailsStrings() {
  return {
    lang: prDetailsLanguage(),
    imageViewer: createImageViewerStrings(),
    today: vscode.l10n.t("today"),
    yesterday: vscode.l10n.t("yesterday"),
    briefDone: vscode.l10n.t("Already summarized — new commits re-enable it"),
    briefStale: vscode.l10n.t("New commits since this summary — click to regenerate"),
    briefMe: vscode.l10n.t("✨ Brief me"),
    summarizing: vscode.l10n.t("Summarizing…"),
    briefOutdated: vscode.l10n.t("outdated"),
    briefStaleBanner: vscode.l10n.t("⚠ New commits were pushed since this summary — it may be outdated. Click ✨ Brief me to regenerate."),
    summary: vscode.l10n.t("Summary"),
    draft: vscode.l10n.t("Draft"),
    openOnGitHub: vscode.l10n.t("Open on GitHub"),
    copyBranch: vscode.l10n.t("Copy branch name"),
    checkoutBranch: vscode.l10n.t("Checkout branch"),
    noDescription: vscode.l10n.t("No description provided."),
    noReviewRequired: vscode.l10n.t("● No review required"),
    noChecks: vscode.l10n.t("● No checks"),
    checksPassed: vscode.l10n.t("✓ All checks passed"),
    branchBehind: vscode.l10n.t("This branch is out-of-date with the base branch"),
    updateBranch: vscode.l10n.t("Update branch"),
    updateMethod: vscode.l10n.t("Update method"),
    readyForReview: vscode.l10n.t("Ready for review"),
    mergePr: vscode.l10n.t("Merge pull request"),
    mergeMethod: vscode.l10n.t("Merge method"),
    alreadyApproved: vscode.l10n.t("You already approved this Pull Request"),
    requestChanges: vscode.l10n.t("Request changes"),
    approve: vscode.l10n.t("Approve"),
    comment: vscode.l10n.t("Comment"),
    leaveComment: vscode.l10n.t("Leave a comment"),
    pendingReviewActions: vscode.l10n.t("Comment, Approve or Request changes"),
    reviewers: vscode.l10n.t("Reviewers"),
    noReviewers: vscode.l10n.t("No reviewers yet"),
    labels: vscode.l10n.t("Labels"),
    none: vscode.l10n.t("None"),
    filesChanged: vscode.l10n.t("Files changed"),
    olderConversation: vscode.l10n.t("View older conversation on GitHub"),
    daysAgo: (count: number) => vscode.l10n.t("{0} days ago", count),
    mergeOne: (author: string, count: number, base: string, head: string) => vscode.l10n.t("{0} wants to merge {1} commit into {2} from {3}", author, count, base, head),
    mergeMany: (author: string, count: number, base: string, head: string) => vscode.l10n.t("{0} wants to merge {1} commits into {2} from {3}", author, count, base, head),
    opened: (author: string, age: string) => vscode.l10n.t("{0} opened {1}", author, age),
    commitAdded: (author: string, age: string) => vscode.l10n.t("{0} added a commit {1}", author, age),
    commitsAdded: (author: string, count: number, age: string) => vscode.l10n.t("{0} added {1} commits {2}", author, count, age),
    reviewTimeline: new Map([
      ["APPROVED", (author: string, age: string) => vscode.l10n.t("{0} approved these changes {1}", author, age)],
      ["CHANGES_REQUESTED", (author: string, age: string) => vscode.l10n.t("{0} requested changes {1}", author, age)],
      ["COMMENTED", (author: string, age: string) => vscode.l10n.t("{0} reviewed {1}", author, age)],
      ["DISMISSED", (author: string, age: string) => vscode.l10n.t("{0} review was dismissed {1}", author, age)],
      ["PENDING", (author: string, age: string) => vscode.l10n.t("{0} started a review {1}", author, age)],
    ]),
    timelineReviewed: (author: string, age: string) => vscode.l10n.t("{0} reviewed {1}", author, age),
    timelineCommented: (author: string, age: string) => vscode.l10n.t("{0} commented {1}", author, age),
    codeComment: (count: number) => vscode.l10n.t("{0} comment on files", count),
    codeComments: (count: number) => vscode.l10n.t("{0} comments on files", count),
    checkFailing: (count: number) => vscode.l10n.t("✗ {0} failing check", count),
    checksFailing: (count: number) => vscode.l10n.t("✗ {0} failing checks", count),
    checkInProgress: (count: number) => vscode.l10n.t("● {0} check in progress", count),
    checksInProgress: (count: number) => vscode.l10n.t("● {0} checks in progress", count),
    moreChecks: (count: number) => vscode.l10n.t("+{0} more on GitHub", count),
    pendingReview: (actions: string) => vscode.l10n.t("You have a pending review — {0} will submit it.", actions),
    pendingReviewWithDraft: (count: number, actions: string) => vscode.l10n.t("You have a pending review with {0} draft comment — {1} will submit it.", count, actions),
    pendingReviewWithDrafts: (count: number, actions: string) => vscode.l10n.t("You have a pending review with {0} draft comments — {1} will submit it.", count, actions),
    file: (count: number) => vscode.l10n.t("{0} file", count),
    files: (count: number) => vscode.l10n.t("{0} files", count),
    reviewerStale: (state: string) => vscode.l10n.t("{0} · stale", state),
    prStates: {
      OPEN: vscode.l10n.t({ message: "Open", comment: ["Pull request state"] }),
      MERGED: vscode.l10n.t("Merged"),
      CLOSED: vscode.l10n.t("Closed"),
    },
    mergeability: {
      MERGEABLE: vscode.l10n.t("✓ No conflicts with the base branch"),
      CONFLICTING: vscode.l10n.t("✗ This branch has conflicts with the base branch"),
      UNKNOWN: vscode.l10n.t("● Checking mergeability…"),
    },
    reviewDecisions: new Map([
      ["APPROVED", vscode.l10n.t("✓ Changes approved")],
      ["CHANGES_REQUESTED", vscode.l10n.t("✗ Changes requested")],
      ["REVIEW_REQUIRED", vscode.l10n.t("● Review required")],
    ]),
    reviewerStates: new Map([
      ["APPROVED", vscode.l10n.t("approved")],
      ["CHANGES_REQUESTED", vscode.l10n.t("changes requested")],
      ["COMMENTED", vscode.l10n.t("commented")],
      ["DISMISSED", vscode.l10n.t("dismissed")],
      ["PENDING", vscode.l10n.t("pending")],
      ["REQUESTED", vscode.l10n.t("requested")],
    ]),
    mergeMethods: mergeMethodLabels(),
    updateMethods: updateMethodLabels(),
  };
}

export function createDetailsSessionStrings() {
  return {
    signInToLoad: vscode.l10n.t("Sign in to GitHub to load pull request details."),
    signInToAct: vscode.l10n.t("Sign in to GitHub to act on pull requests."),
    submitReview: vscode.l10n.t("Submit review"),
    comment: vscode.l10n.t("Comment"),
    requestChanges: vscode.l10n.t("Request changes"),
    approve: vscode.l10n.t("Approve"),
    merge: vscode.l10n.t("Merge"),
    readyForReview: vscode.l10n.t("Ready for review"),
    needsComment: vscode.l10n.t("Request changes needs a comment explaining what to change."),
    forkCheckoutUnavailable: vscode.l10n.t("Checkout of cross-fork PRs is not supported. Open the PR on GitHub instead."),
    loadFailed: (error: string) => vscode.l10n.t("Failed to load pull request details: {0}", error),
    actionFailed: (action: string, error: string) => vscode.l10n.t("{0} failed: {1}", action, error),
    confirmSubmit: (title: string) => vscode.l10n.t("Submit review with your draft comments: \"{0}\"?", title),
    submitted: (title: string) => vscode.l10n.t("Review submitted: {0}", title),
    commentPosted: (title: string) => vscode.l10n.t("Comment posted on: {0}", title),
    changesRequested: (title: string) => vscode.l10n.t("Changes requested on: {0}", title),
    approved: (title: string) => vscode.l10n.t("Approved: {0}", title),
    confirmWithDrafts: (action: string, title: string) => vscode.l10n.t("{0} and submit your draft comments: \"{1}\"?", action, title),
    confirmReview: (action: string, title: string) => vscode.l10n.t("{0}: \"{1}\"?", action, title),
    confirmMerge: (method: string, title: string, branch: string) => vscode.l10n.t("{0}: \"{1}\" into {2}?", method, title, branch),
    merged: (title: string) => vscode.l10n.t("Merged: {0}", title),
    markedReady: (title: string) => vscode.l10n.t("Marked as ready for review: {0}", title),
    branchUpdated: (method: string, title: string) => vscode.l10n.t("Branch updated ({0}): {1}", method, title),
    branchUpdateMethod: (method: UpdateBranchMethod) => method === "REBASE" ? vscode.l10n.t("rebase") : vscode.l10n.t("merge"),
  };
}
