import { randomUUID } from "node:crypto";
import type * as vscode from "vscode";
import { toErrorMessage } from "../core/errors";
import type { IPrFile, IPullRequest } from "../core/types";
import {
  buildSidebarFileTree,
  renderSidebarHtml,
  type FilesLayout,
  type ISidebarFileView,
  type ISidebarPrFilesState,
  type ISidebarPrView,
  type ISidebarRepoGroupView,
  type ISidebarSnapshot,
  type ReviewTone,
} from "./PrSidebarHtml";
import { createSidebarStrings, type ISidebarStrings, type SidebarViewKind } from "./PrSidebarStrings";

export type { FilesLayout };

export interface IFileNode {
  kind: "file";
  pr: IPullRequest;
  file: IPrFile;
}

export interface ISidebarActions {
  loadFiles(pr: IPullRequest): Promise<IPrFile[]>;
  getLayout(): FilesLayout;
  onSignIn(): void;
  onOpenPrDetails(pr: IPullRequest): void;
  onOpenPrExternal(pr: IPullRequest): void;
  onCheckoutPr(pr: IPullRequest): void;
  onOpenFileDiff(node: IFileNode): void;
  onToggleFileViewed(node: IFileNode, viewed: boolean): Promise<void>;
  onError(message: string): void;
}

interface IFilesCacheEntry {
  headRefOid: string;
  status: "loading" | "loaded" | "error";
  files?: IPrFile[];
  errorMessage?: string;
  requestSeq: number;
}

type SidebarWebviewMessage =
  | { command: "ready" }
  | { command: "signIn" }
  | { command: "openPrDetails"; prId: string }
  | { command: "openPrExternal"; prId: string }
  | { command: "checkoutPr"; prId: string }
  | { command: "togglePrExpand"; prId: string }
  | { command: "retryLoadFiles"; prId: string }
  | { command: "openFileDiff"; prId: string; filePath: string }
  | { command: "toggleFileViewed"; prId: string; filePath: string; viewed: boolean };

// APPROVED here is the "approved by someone else" glyph — the viewer's own approval renders the plain check
const REVIEW_GLYPHS: Record<string, { glyph: string; tone: ReviewTone }> = {
  APPROVED: { glyph: "☑", tone: "approved" },
  CHANGES_REQUESTED: { glyph: "↻", tone: "changes" },
  REVIEW_REQUIRED: { glyph: "●", tone: "pending" },
};

export class PrSidebarViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private webviewReady = false;
  private pendingStateSync = false;
  private lastPostedSnapshotJson: string | undefined;
  private pendingBadge: vscode.ViewBadge | undefined;
  private signedIn = false;
  private prs: IPullRequest[] = [];
  private readonly expandedPrIds = new Set<string>();
  private readonly fileEntries = new Map<string, IFilesCacheEntry>();
  private readonly viewedSeq = new Map<string, number>();
  private requestCounter = 0;

  constructor(
    private readonly viewKind: SidebarViewKind,
    private readonly actions: ISidebarActions,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    this.webviewReady = false;
    this.pendingStateSync = false;
    this.lastPostedSnapshotJson = undefined;
    webviewView.badge = this.pendingBadge;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [],
    };
    const strings = createSidebarStrings(this.viewKind);
    webviewView.webview.html = renderSidebarHtml(randomUUID(), strings.lang, strings.client, this.buildSnapshot(strings));

    webviewView.webview.onDidReceiveMessage((raw: unknown) => {
      void this.handleMessage(raw as SidebarWebviewMessage | null);
    });
    webviewView.onDidChangeVisibility?.(() => {
      if (this.view === webviewView && webviewView.visible && this.pendingStateSync) {
        this.postState();
      }
    });
    webviewView.onDidDispose(() => {
      if (this.view === webviewView) {
        this.view = undefined;
        this.webviewReady = false;
        this.pendingStateSync = false;
        this.lastPostedSnapshotJson = undefined;
      }
    });
  }

  setBadge(badge: vscode.ViewBadge | undefined): void {
    this.pendingBadge = badge;
    if (this.view) {
      this.view.badge = badge;
    }
  }

  setPrs(prs: IPullRequest[]): void {
    this.signedIn = true;
    this.prs = prs;
    const validIds = new Set(prs.map((pr) => pr.id));
    for (const id of [...this.expandedPrIds]) {
      if (!validIds.has(id)) {
        this.expandedPrIds.delete(id);
      }
    }
    for (const id of [...this.fileEntries.keys()]) {
      if (!validIds.has(id)) {
        this.fileEntries.delete(id);
      }
    }
    for (const pr of prs) {
      if (!this.expandedPrIds.has(pr.id)) {
        continue;
      }
      const entry = this.fileEntries.get(pr.id);
      if (!entry || entry.headRefOid !== pr.headRefOid) {
        void this.loadPrFiles(pr, { silent: entry?.status === "loaded" });
      }
    }
    this.postState();
  }

  clear(): void {
    this.signedIn = false;
    this.prs = [];
    this.expandedPrIds.clear();
    this.fileEntries.clear();
    this.postState();
  }

  refresh(): void {
    this.postState();
  }

  findPr(prId: string): IPullRequest | undefined {
    return this.prs.find((pr) => pr.id === prId);
  }

  findFileNode(prId: string, filePath: string): IFileNode | undefined {
    const pr = this.findPr(prId);
    if (!pr) {
      return undefined;
    }
    const entry = this.fileEntries.get(prId);
    const file = entry?.files?.find((candidate) => candidate.path === filePath);
    if (!file) {
      return undefined;
    }
    return { kind: "file", pr, file };
  }

  buildSnapshot(strings: ISidebarStrings = createSidebarStrings(this.viewKind), now: number = Date.now()): ISidebarSnapshot {
    const layout = this.actions.getLayout();
    return {
      signedIn: this.signedIn,
      layout,
      groups: this.signedIn ? this.buildRepoGroups(strings, layout, now) : [],
    };
  }

  private postState(): void {
    if (!this.view || !this.webviewReady) {
      return;
    }
    if (this.view.visible === false) {
      this.pendingStateSync = true;
      return;
    }
    this.pendingStateSync = false;
    const snapshot = this.buildSnapshot();
    const snapshotJson = JSON.stringify(snapshot);
    if (snapshotJson === this.lastPostedSnapshotJson) {
      return;
    }
    this.lastPostedSnapshotJson = snapshotJson;
    void this.view.webview.postMessage({ command: "state", snapshot });
  }

  private async handleMessage(message: SidebarWebviewMessage | null): Promise<void> {
    if (!message || typeof message !== "object" || typeof message.command !== "string") {
      return;
    }
    switch (message.command) {
      case "ready":
        this.webviewReady = true;
        this.postState();
        return;
      case "signIn":
        this.actions.onSignIn();
        return;
      case "openPrDetails": {
        const pr = this.findPr(message.prId);
        if (pr) {
          this.actions.onOpenPrDetails(pr);
        }
        return;
      }
      case "openPrExternal": {
        const pr = this.findPr(message.prId);
        if (pr) {
          this.actions.onOpenPrExternal(pr);
        }
        return;
      }
      case "checkoutPr": {
        const pr = this.findPr(message.prId);
        if (pr) {
          this.actions.onCheckoutPr(pr);
        }
        return;
      }
      case "togglePrExpand": {
        const pr = this.findPr(message.prId);
        if (!pr) {
          return;
        }
        if (this.expandedPrIds.has(pr.id)) {
          this.expandedPrIds.delete(pr.id);
          this.postState();
          return;
        }
        this.expandedPrIds.add(pr.id);
        const existing = this.fileEntries.get(pr.id);
        if (existing?.status === "loaded" && existing.headRefOid === pr.headRefOid) {
          this.postState();
          return;
        }
        await this.loadPrFiles(pr, { silent: false });
        return;
      }
      case "retryLoadFiles": {
        const pr = this.findPr(message.prId);
        if (!pr) {
          return;
        }
        this.expandedPrIds.add(pr.id);
        await this.loadPrFiles(pr, { silent: false });
        return;
      }
      case "openFileDiff": {
        const node = this.findFileNode(message.prId, message.filePath);
        if (node) {
          this.actions.onOpenFileDiff(node);
        }
        return;
      }
      case "toggleFileViewed": {
        if (typeof message.viewed !== "boolean") {
          return;
        }
        const node = this.findFileNode(message.prId, message.filePath);
        if (!node) {
          return;
        }
        const key = `${message.prId}:${message.filePath}`;
        const seq = ++this.requestCounter;
        this.viewedSeq.set(key, seq);
        const previousState = node.file.viewedState;
        // optimistic: node.file is the same object held by the oid cache, so the state survives refreshes
        node.file.viewedState = message.viewed ? "VIEWED" : "UNVIEWED";
        this.postState();
        try {
          await this.actions.onToggleFileViewed(node, message.viewed);
        } catch (error) {
          if (this.viewedSeq.get(key) === seq) {
            node.file.viewedState = previousState;
            this.postState();
          }
          const strings = createSidebarStrings(this.viewKind);
          this.actions.onError(strings.updatingViewedFailed(toErrorMessage(error)));
        }
      }
    }
  }

  private async loadPrFiles(pr: IPullRequest, options: { silent: boolean }): Promise<void> {
    const requestSeq = ++this.requestCounter;
    const previousEntry = this.fileEntries.get(pr.id);
    if (!options.silent) {
      this.fileEntries.set(pr.id, { headRefOid: pr.headRefOid, status: "loading", requestSeq });
      this.postState();
    } else if (previousEntry) {
      this.fileEntries.set(pr.id, { ...previousEntry, requestSeq });
    }

    try {
      const files = await this.actions.loadFiles(pr);
      const current = this.fileEntries.get(pr.id);
      if (current && current.requestSeq !== requestSeq) {
        return;
      }
      if (!this.findPr(pr.id)) {
        return;
      }
      this.fileEntries.set(pr.id, { headRefOid: pr.headRefOid, status: "loaded", files, requestSeq });
      this.postState();
    } catch (error) {
      const current = this.fileEntries.get(pr.id);
      if (current && current.requestSeq !== requestSeq) {
        return;
      }
      if (!this.findPr(pr.id)) {
        return;
      }
      if (options.silent && previousEntry?.status === "loaded") {
        // silent background refresh preserves last good file list and retries on the next poll
        this.fileEntries.set(pr.id, { ...previousEntry, requestSeq });
        return;
      }
      const strings = createSidebarStrings(this.viewKind);
      this.fileEntries.set(pr.id, {
        headRefOid: pr.headRefOid,
        status: "error",
        errorMessage: strings.failedToLoadFiles(toErrorMessage(error)),
        requestSeq,
      });
      this.postState();
    }
  }

  private buildRepoGroups(strings: ISidebarStrings, layout: FilesLayout, now: number): ISidebarRepoGroupView[] {
    const prsByRepo = new Map<string, IPullRequest[]>();
    for (const pr of this.prs) {
      const repoPrs = prsByRepo.get(pr.repo) ?? [];
      repoPrs.push(pr);
      prsByRepo.set(pr.repo, repoPrs);
    }
    return [...prsByRepo.entries()]
      .sort(([firstRepo], [secondRepo]) => firstRepo.localeCompare(secondRepo))
      .map(([repo, repoPrs]) => ({
        repo,
        prs: repoPrs.map((pr) => this.toPrView(pr, strings, layout, now)),
      }));
  }

  private toPrView(pr: IPullRequest, strings: ISidebarStrings, layout: FilesLayout, now: number): ISidebarPrView {
    const reviewBadge = toReviewBadge(pr);
    const viewerReviewLabel = pr.isReviewedByMe ? strings.viewerReviewLabel(pr) : undefined;
    const meta = `${pr.author} · ${strings.formatAge(pr.createdAt, now)}${viewerReviewLabel ? ` · ${viewerReviewLabel}` : ""}`;
    const tooltipLines = [
      pr.repo,
      pr.title,
      pr.isDraft ? strings.byAuthorDraft(pr.author) : strings.byAuthor(pr.author),
      strings.ciLabel(strings.ciStates[pr.ciState]),
    ];
    if (pr.reviewDecision) {
      tooltipLines.push(strings.reviewLabel(strings.reviewDecisions[pr.reviewDecision] ?? pr.reviewDecision));
    }
    if (viewerReviewLabel) {
      tooltipLines.push(strings.yourReviewLabel(viewerReviewLabel));
    }
    const expanded = this.expandedPrIds.has(pr.id);
    return {
      id: pr.id,
      number: pr.number,
      title: pr.title,
      repo: pr.repo,
      author: pr.author,
      isDraft: pr.isDraft,
      ciState: pr.ciState,
      reviewGlyph: reviewBadge?.glyph ?? null,
      reviewTone: reviewBadge?.tone ?? null,
      additions: pr.additions,
      deletions: pr.deletions,
      meta,
      tooltip: tooltipLines.join("\n"),
      expanded,
      filesState: expanded ? this.toFilesState(pr.id, strings, layout) : { status: "idle" },
    };
  }

  private toFilesState(prId: string, strings: ISidebarStrings, layout: FilesLayout): ISidebarPrFilesState {
    const entry = this.fileEntries.get(prId);
    if (!entry) {
      return { status: "idle" };
    }
    if (entry.status === "loading") {
      return { status: "loading" };
    }
    if (entry.status === "error") {
      return { status: "error", message: entry.errorMessage ?? "" };
    }
    const files = entry.files ?? [];
    const toFileView = (file: IPrFile): ISidebarFileView => {
      const separatorIndex = file.path.lastIndexOf("/");
      return {
        path: file.path,
        name: file.path.slice(separatorIndex + 1),
        dir: separatorIndex === -1 ? "" : file.path.slice(0, separatorIndex),
        changeType: file.changeType,
        additions: file.additions,
        deletions: file.deletions,
        viewed: file.viewedState === "VIEWED",
        tooltip: `${file.path}\n${strings.fileDiffSummary(file.additions, file.deletions, strings.changeTypes[file.changeType])}`,
      };
    };
    if (layout === "tree") {
      const root = buildSidebarFileTree(files, toFileView);
      return { status: "loaded", totalCount: files.length, folders: root.folders, files: root.files };
    }
    return { status: "loaded", totalCount: files.length, folders: [], files: files.map(toFileView) };
  }
}

function toReviewBadge(pr: IPullRequest): { glyph: string; tone: ReviewTone } | undefined {
  if (!pr.reviewDecision) {
    return undefined;
  }
  // a stale viewer approval must not render the "current approval" check — it falls back to the generic ☑
  const isApprovedByViewer =
    pr.reviewDecision === "APPROVED" && pr.viewerReviewState === "APPROVED" && !pr.isViewerApprovalStale;
  if (isApprovedByViewer) {
    return { glyph: "✓", tone: "approved" };
  }
  return REVIEW_GLYPHS[pr.reviewDecision];
}
