import * as vscode from "vscode";
import { toErrorMessage } from "../core/errors";
import { buildFileTree, type IFileTreeFolder } from "./fileTree";
import type { CiState, FileChangeType, IPrFile, IPullRequest } from "../core/types";

export type FilesLayout = "flat" | "tree";

interface IRepoNode {
  kind: "repo";
  label: string;
  prs: IPullRequest[];
}

interface IPrNode {
  kind: "pr";
  pr: IPullRequest;
}

export interface IFileNode {
  kind: "file";
  pr: IPullRequest;
  file: IPrFile;
}

interface IFolderNode {
  kind: "folder";
  pr: IPullRequest;
  folder: IFileTreeFolder;
}

interface IMessageNode {
  kind: "message";
  text: string;
}

export type TreeNode = IRepoNode | IPrNode | IFileNode | IFolderNode | IMessageNode;

// APPROVED here is the "approved by someone else" glyph — the viewer's own approval renders the plain check (see toReviewGlyph)
const REVIEW_GLYPHS: Record<string, string> = {
  APPROVED: "☑",
  CHANGES_REQUESTED: "↻",
  REVIEW_REQUIRED: "●",
};

function toViewerReviewLabel(pr: IPullRequest): string {
  // an approval invalidated by newer commits reads as stale, never as a current approval
  const state = pr.isViewerApprovalStale && pr.viewerReviewState === "APPROVED" ? "DISMISSED" : pr.viewerReviewState;
  switch (state) {
    case "APPROVED": return vscode.l10n.t("✓ you approved");
    case "DISMISSED": return vscode.l10n.t("● review stale");
    case "CHANGES_REQUESTED": return vscode.l10n.t("↻ you requested changes");
    case "COMMENTED": return vscode.l10n.t("💬 you commented");
    default: return vscode.l10n.t("reviewed");
  }
}

const CI_ICONS: Record<CiState, vscode.ThemeIcon> = {
  SUCCESS: new vscode.ThemeIcon("pass", new vscode.ThemeColor("testing.iconPassed")),
  FAILURE: new vscode.ThemeIcon("error", new vscode.ThemeColor("testing.iconFailed")),
  PENDING: new vscode.ThemeIcon("sync~spin"),
  NONE: new vscode.ThemeIcon("circle-outline"),
};

const FILE_CHANGE_ICONS: Record<FileChangeType, vscode.ThemeIcon> = {
  ADDED: new vscode.ThemeIcon("diff-added", new vscode.ThemeColor("gitDecoration.addedResourceForeground")),
  MODIFIED: new vscode.ThemeIcon("diff-modified", new vscode.ThemeColor("gitDecoration.modifiedResourceForeground")),
  CHANGED: new vscode.ThemeIcon("diff-modified", new vscode.ThemeColor("gitDecoration.modifiedResourceForeground")),
  DELETED: new vscode.ThemeIcon("diff-removed", new vscode.ThemeColor("gitDecoration.deletedResourceForeground")),
  RENAMED: new vscode.ThemeIcon("diff-renamed", new vscode.ThemeColor("gitDecoration.renamedResourceForeground")),
  COPIED: new vscode.ThemeIcon("diff-renamed", new vscode.ThemeColor("gitDecoration.renamedResourceForeground")),
};

export class PrTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private prs: IPullRequest[] = [];

  constructor(
    private readonly loadFiles: (pr: IPullRequest) => Promise<IPrFile[]>,
    private readonly getLayout: () => FilesLayout,
  ) {}

  setPrs(prs: IPullRequest[]): void {
    this.prs = prs;
    this._onDidChangeTreeData.fire();
  }

  clear(): void {
    this.setPrs([]);
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getChildren(element?: TreeNode): vscode.ProviderResult<TreeNode[]> {
    if (!element) {
      return groupByRepo(this.prs);
    }
    if (element.kind === "repo") {
      return element.prs.map(toPrNode);
    }
    if (element.kind === "pr") {
      // expansion is user-initiated: unlike the silent poll, failures render in the tree
      return this.loadFiles(element.pr).then(
        (files) => this.toFileChildren(element.pr, files),
        (error: unknown) => [{ kind: "message" as const, text: vscode.l10n.t("Failed to load files: {0}", toErrorMessage(error)) }],
      );
    }
    if (element.kind === "folder") {
      return folderChildren(element.pr, element.folder);
    }
    return [];
  }

  private toFileChildren(pr: IPullRequest, files: IPrFile[]): TreeNode[] {
    if (this.getLayout() === "tree") {
      return folderChildren(pr, buildFileTree(files));
    }
    return files.map((file) => ({ kind: "file" as const, pr, file }));
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    if (node.kind === "repo") {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
      item.iconPath = new vscode.ThemeIcon("repo");
      item.id = `repo:${node.label}`;
      return item;
    }
    if (node.kind === "file") {
      return toFileTreeItem(node, this.getLayout());
    }
    if (node.kind === "folder") {
      return toFolderTreeItem(node);
    }
    if (node.kind === "message") {
      return new vscode.TreeItem(node.text, vscode.TreeItemCollapsibleState.None);
    }
    return toPrTreeItem(node.pr);
  }
}

function folderChildren(pr: IPullRequest, folder: IFileTreeFolder): TreeNode[] {
  return [
    ...folder.folders.map((childFolder) => ({ kind: "folder" as const, pr, folder: childFolder })),
    ...folder.files.map((file) => ({ kind: "file" as const, pr, file })),
  ];
}

function toFolderTreeItem(node: IFolderNode): vscode.TreeItem {
  const item = new vscode.TreeItem(node.folder.name, vscode.TreeItemCollapsibleState.Expanded);
  item.id = `${node.pr.id}:dir:${node.folder.path}`;
  item.iconPath = new vscode.ThemeIcon("folder");
  return item;
}

function toPrNode(pr: IPullRequest): IPrNode {
  return { kind: "pr", pr };
}

function groupByRepo(prs: IPullRequest[]): IRepoNode[] {
  const prsByRepo = new Map<string, IPullRequest[]>();
  for (const pr of prs) {
    const repoPrs = prsByRepo.get(pr.repo) ?? [];
    repoPrs.push(pr);
    prsByRepo.set(pr.repo, repoPrs);
  }
  return [...prsByRepo.entries()]
    .sort(([firstRepo], [secondRepo]) => firstRepo.localeCompare(secondRepo))
    .map(([repo, repoPrs]) => ({ kind: "repo" as const, label: repo, prs: repoPrs }));
}

function toReviewGlyph(pr: IPullRequest): string | undefined {
  if (!pr.reviewDecision) {
    return undefined;
  }
  // a stale viewer approval must not render the "current approval" check — it falls back to the generic ☑
  const isApprovedByViewer =
    pr.reviewDecision === "APPROVED" && pr.viewerReviewState === "APPROVED" && !pr.isViewerApprovalStale;
  if (isApprovedByViewer) {
    return "✓";
  }
  return REVIEW_GLYPHS[pr.reviewDecision];
}

function toPrTreeItem(pr: IPullRequest): vscode.TreeItem {
  const reviewGlyph = toReviewGlyph(pr);
  const label = reviewGlyph ? `${reviewGlyph} ${pr.title}` : pr.title;
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
  // stable id: keeps the node's expansion state across the poll's full-tree refresh
  item.id = pr.id;
  const viewerReviewLabel = pr.isReviewedByMe ? toViewerReviewLabel(pr) : undefined;
  item.description = `${pr.author} · ${formatAge(pr.createdAt)}${viewerReviewLabel ? ` · ${viewerReviewLabel}` : ""}`;
  item.iconPath = pr.isDraft ? new vscode.ThemeIcon("git-pull-request-draft") : CI_ICONS[pr.ciState];
  const ciStates: Record<CiState, string> = {
    SUCCESS: vscode.l10n.t("SUCCESS"),
    FAILURE: vscode.l10n.t("FAILURE"),
    PENDING: vscode.l10n.t("PENDING"),
    NONE: vscode.l10n.t("NONE"),
  };
  const reviewDecisions: Record<string, string> = {
    APPROVED: vscode.l10n.t("APPROVED"),
    CHANGES_REQUESTED: vscode.l10n.t("CHANGES_REQUESTED"),
    REVIEW_REQUIRED: vscode.l10n.t("REVIEW_REQUIRED"),
  };
  const tooltip = [
    pr.repo,
    pr.title,
    pr.isDraft ? vscode.l10n.t("by {0} · draft", pr.author) : vscode.l10n.t("by {0}", pr.author),
    vscode.l10n.t("CI: {0}", ciStates[pr.ciState]),
  ];
  if (pr.reviewDecision) {
    tooltip.push(vscode.l10n.t("Review: {0}", reviewDecisions[pr.reviewDecision] ?? pr.reviewDecision));
  }
  if (viewerReviewLabel) {
    tooltip.push(vscode.l10n.t("Your review: {0}", viewerReviewLabel));
  }
  item.tooltip = tooltip.join("\n");
  item.contextValue = "pr";
  item.command = {
    command: "githubControlCenter.openPrDetails",
    title: vscode.l10n.t("Open Pull Request Details"),
    arguments: [pr],
  };
  return item;
}

function toFileTreeItem(node: IFileNode, layout: FilesLayout): vscode.TreeItem {
  const { pr, file } = node;
  const separatorIndex = file.path.lastIndexOf("/");
  const item = new vscode.TreeItem(file.path.slice(separatorIndex + 1), vscode.TreeItemCollapsibleState.None);
  item.id = `${pr.id}:${file.path}`;
  // in the tree layout the directory is implicit in the hierarchy
  item.description = layout === "tree" || separatorIndex === -1 ? "" : file.path.slice(0, separatorIndex);
  item.iconPath = FILE_CHANGE_ICONS[file.changeType];
  const changeTypes: Record<FileChangeType, string> = {
    ADDED: vscode.l10n.t("ADDED"),
    MODIFIED: vscode.l10n.t("MODIFIED"),
    CHANGED: vscode.l10n.t("CHANGED"),
    DELETED: vscode.l10n.t("DELETED"),
    RENAMED: vscode.l10n.t("RENAMED"),
    COPIED: vscode.l10n.t("COPIED"),
  };
  item.tooltip = `${file.path}\n${vscode.l10n.t("+{0} −{1} · {2}", file.additions, file.deletions, changeTypes[file.changeType])}`;
  item.contextValue = "prFile";
  item.checkboxState = file.viewedState === "VIEWED" ? vscode.TreeItemCheckboxState.Checked : vscode.TreeItemCheckboxState.Unchecked;
  item.command = {
    command: "githubControlCenter.openFileDiff",
    title: vscode.l10n.t("Open File Diff"),
    arguments: [node],
  };
  return item;
}

function formatAge(createdAt: string): string {
  const ageInDays = Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000);
  if (ageInDays <= 0) {
    return vscode.l10n.t("opened today");
  }
  if (ageInDays === 1) {
    return vscode.l10n.t("opened yesterday");
  }
  return vscode.l10n.t("opened {0} days ago", ageInDays);
}
