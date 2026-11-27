import * as vscode from "vscode";
import { viewerLanguage } from "../core/imageViewerStrings";
import type { CiState, FileChangeType, IPullRequest } from "../core/types";
import type { ISidebarClientStrings } from "./PrSidebarHtml";

export type SidebarViewKind = "toReview" | "reviewed" | "mine";

export interface ISidebarStrings {
  lang: string;
  client: ISidebarClientStrings;
  ciStates: Record<CiState, string>;
  reviewDecisions: Record<string, string>;
  changeTypes: Record<FileChangeType, string>;
  byAuthor: (author: string) => string;
  byAuthorDraft: (author: string) => string;
  ciLabel: (state: string) => string;
  reviewLabel: (decision: string) => string;
  yourReviewLabel: (state: string) => string;
  fileDiffSummary: (additions: number, deletions: number, changeType: string) => string;
  failedToLoadFiles: (error: string) => string;
  updatingViewedFailed: (error: string) => string;
  viewerReviewLabel: (pr: IPullRequest) => string;
  formatAge: (createdAt: string, now?: number) => string;
}

function welcomeStrings(viewKind: SidebarViewKind): { signInMessage: string; emptyMessage: string } {
  switch (viewKind) {
    case "toReview":
      return {
        signInMessage: vscode.l10n.t("Sign in to GitHub to see pull requests waiting for your review."),
        emptyMessage: vscode.l10n.t("No pull requests waiting for your review. All clear. 🎉"),
      };
    case "reviewed":
      return {
        signInMessage: vscode.l10n.t("Sign in to GitHub to see the pull requests you approved."),
        emptyMessage: vscode.l10n.t("No approved pull requests. Approvals land here until new commits arrive or the pull request is merged."),
      };
    case "mine":
      return {
        signInMessage: vscode.l10n.t("Sign in to GitHub to see your open pull requests."),
        emptyMessage: vscode.l10n.t("You have no open pull requests."),
      };
  }
}

export function createSidebarStrings(viewKind: SidebarViewKind): ISidebarStrings {
  const welcome = welcomeStrings(viewKind);
  return {
    lang: viewerLanguage(),
    client: {
      signInMessage: welcome.signInMessage,
      signInButton: vscode.l10n.t("Sign in to GitHub"),
      emptyMessage: welcome.emptyMessage,
      loadingFiles: vscode.l10n.t("Loading files…"),
      retry: vscode.l10n.t("Retry"),
      noChangedFiles: vscode.l10n.t("No changed files"),
      copyPrUrl: vscode.l10n.t("Copy pull request URL"),
      copied: vscode.l10n.t("Copied"),
      checkoutBranch: vscode.l10n.t("Checkout branch"),
      openOnGitHub: vscode.l10n.t("Open on GitHub"),
      markAsViewed: vscode.l10n.t("Mark file as viewed"),
      markAsUnviewed: vscode.l10n.t("Mark file as unviewed"),
      expandPr: vscode.l10n.t("Toggle changed files"),
      expandRepo: vscode.l10n.t("Toggle repository"),
      expandFolder: vscode.l10n.t("Toggle folder"),
      searchPlaceholder: vscode.l10n.t("Filter PR title (space: AND, |: OR)…"),
      clearSearch: vscode.l10n.t("Clear search"),
      noMatchingPrs: vscode.l10n.t("No matching pull requests"),
      favoriteRepo: vscode.l10n.t("Favorite repository"),
      unfavoriteRepo: vscode.l10n.t("Unfavorite repository"),
    },
    ciStates: {
      SUCCESS: vscode.l10n.t("SUCCESS"),
      FAILURE: vscode.l10n.t("FAILURE"),
      PENDING: vscode.l10n.t("PENDING"),
      NONE: vscode.l10n.t("NONE"),
    },
    reviewDecisions: {
      APPROVED: vscode.l10n.t("APPROVED"),
      CHANGES_REQUESTED: vscode.l10n.t("CHANGES_REQUESTED"),
      REVIEW_REQUIRED: vscode.l10n.t("REVIEW_REQUIRED"),
    },
    changeTypes: {
      ADDED: vscode.l10n.t("ADDED"),
      MODIFIED: vscode.l10n.t("MODIFIED"),
      CHANGED: vscode.l10n.t("CHANGED"),
      DELETED: vscode.l10n.t("DELETED"),
      RENAMED: vscode.l10n.t("RENAMED"),
      COPIED: vscode.l10n.t("COPIED"),
    },
    byAuthor: (author) => vscode.l10n.t("by {0}", author),
    byAuthorDraft: (author) => vscode.l10n.t("by {0} · draft", author),
    ciLabel: (state) => vscode.l10n.t("CI: {0}", state),
    reviewLabel: (decision) => vscode.l10n.t("Review: {0}", decision),
    yourReviewLabel: (state) => vscode.l10n.t("Your review: {0}", state),
    fileDiffSummary: (additions, deletions, changeType) => vscode.l10n.t("+{0} −{1} · {2}", additions, deletions, changeType),
    failedToLoadFiles: (error) => vscode.l10n.t("Failed to load files: {0}", error),
    updatingViewedFailed: (error) => vscode.l10n.t("Updating the viewed state failed: {0}", error),
    viewerReviewLabel: (pr) => {
      // an approval invalidated by newer commits reads as stale, never as a current approval
      const state = pr.isViewerApprovalStale && pr.viewerReviewState === "APPROVED" ? "DISMISSED" : pr.viewerReviewState;
      switch (state) {
        case "APPROVED": return vscode.l10n.t("✓ you approved");
        case "DISMISSED": return vscode.l10n.t("● review stale");
        case "CHANGES_REQUESTED": return vscode.l10n.t("↻ you requested changes");
        case "COMMENTED": return vscode.l10n.t("💬 you commented");
        default: return vscode.l10n.t("reviewed");
      }
    },
    formatAge: (createdAt, now = Date.now()) => {
      const ageInDays = Math.floor((now - new Date(createdAt).getTime()) / 86_400_000);
      if (ageInDays <= 0) {
        return vscode.l10n.t("opened today");
      }
      if (ageInDays === 1) {
        return vscode.l10n.t("opened yesterday");
      }
      return vscode.l10n.t("opened {0} days ago", ageInDays);
    },
  };
}
