import { escapeHtml } from "../core/html";
import { safeJsonForScript } from "../core/imageViewer";
import { buildFileTree, type IFileTreeFolder } from "./fileTree";
import type { CiState, FileChangeType, IPrFile } from "../core/types";

export type FilesLayout = "flat" | "tree";
export type ReviewTone = "approved" | "changes" | "pending";

export interface ISidebarClientStrings {
  signInMessage: string;
  signInButton: string;
  emptyMessage: string;
  loadingFiles: string;
  retry: string;
  noChangedFiles: string;
  copyPrUrl: string;
  copied: string;
  checkoutBranch: string;
  openOnGitHub: string;
  markAsViewed: string;
  markAsUnviewed: string;
  expandPr: string;
  expandRepo: string;
  expandFolder: string;
  searchPlaceholder: string;
  clearSearch: string;
  noMatchingPrs: string;
  favoriteRepo: string;
  unfavoriteRepo: string;
}

export interface ISidebarFileView {
  path: string;
  name: string;
  dir: string;
  changeType: FileChangeType;
  additions: number;
  deletions: number;
  viewed: boolean;
  tooltip: string;
}

export interface ISidebarFolderView {
  name: string;
  path: string;
  folders: ISidebarFolderView[];
  files: ISidebarFileView[];
}

export type ISidebarPrFilesState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; totalCount: number; folders: ISidebarFolderView[]; files: ISidebarFileView[] };

export interface ISidebarPrView {
  id: string;
  number: number;
  title: string;
  repo: string;
  author: string;
  isDraft: boolean;
  ciState: CiState;
  reviewGlyph: string | null;
  reviewTone: ReviewTone | null;
  additions: number;
  deletions: number;
  meta: string;
  tooltip: string;
  expanded: boolean;
  filesState: ISidebarPrFilesState;
}

export interface ISidebarRepoGroupView {
  repo: string;
  favorite: boolean;
  prs: ISidebarPrView[];
}

export interface ISidebarSnapshot {
  signedIn: boolean;
  layout: FilesLayout;
  groups: ISidebarRepoGroupView[];
}

export function formatDiffNumber(value: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  return String(safe).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function buildSidebarFileTree(
  files: IPrFile[],
  toFileView: (file: IPrFile) => ISidebarFileView,
): ISidebarFolderView {
  const root = buildFileTree(files);
  return toFolderView(root, toFileView);
}

function toFolderView(
  folder: IFileTreeFolder,
  toFileView: (file: IPrFile) => ISidebarFileView,
): ISidebarFolderView {
  return {
    name: folder.name,
    path: folder.path,
    folders: folder.folders.map((child) => toFolderView(child, toFileView)),
    files: folder.files.map(toFileView),
  };
}

const MAX_INDENT_DEPTH = 6;

function depthRules(): string {
  const lines: string[] = [];
  for (let depth = 0; depth <= MAX_INDENT_DEPTH; depth++) {
    lines.push(`.depth-${depth} { padding-left: ${16 + depth * 10}px; }`);
  }
  return lines.join("\n");
}

const SIDEBAR_CSS = `
:root {
  --ghcc-bg: var(--vscode-sideBar-background, transparent);
  --ghcc-fg: var(--vscode-sideBar-foreground, var(--vscode-foreground, #cccccc));
  --ghcc-muted: var(--vscode-descriptionForeground, rgba(204, 204, 204, 0.72));
  --ghcc-hover-bg: var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.06));
  --ghcc-active-bg: var(--vscode-list-activeSelectionBackground, rgba(9, 71, 113, 0.65));
  --ghcc-inactive-bg: var(--vscode-list-inactiveSelectionBackground, var(--ghcc-hover-bg));
  --ghcc-focus: var(--vscode-focusBorder, #007fd4);
  --ghcc-border: var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border, rgba(128, 128, 128, 0.2)));
  --ghcc-badge-bg: var(--vscode-badge-background, rgba(128, 128, 128, 0.28));
  --ghcc-badge-fg: var(--vscode-badge-foreground, var(--ghcc-fg));
  --ghcc-btn-bg: var(--vscode-button-background, #0e639c);
  --ghcc-btn-fg: var(--vscode-button-foreground, #ffffff);
  --ghcc-btn-hover: var(--vscode-button-hoverBackground, #1177bb);
  --ghcc-diff-add: var(--vscode-charts-green, var(--vscode-gitDecoration-addedResourceForeground, #3fb950));
  --ghcc-diff-del: var(--vscode-charts-red, var(--vscode-gitDecoration-deletedResourceForeground, #f85149));
  --ghcc-file-add: var(--vscode-gitDecoration-addedResourceForeground, var(--vscode-charts-green, #3fb950));
  --ghcc-file-del: var(--vscode-gitDecoration-deletedResourceForeground, var(--vscode-charts-red, #f85149));
  --ghcc-file-mod: var(--vscode-gitDecoration-modifiedResourceForeground, var(--vscode-charts-yellow, #d29922));
  --ghcc-file-ren: var(--vscode-charts-blue, var(--vscode-gitDecoration-renamedResourceForeground, #3794ff));
  --ghcc-ci-pass: var(--vscode-testing-iconPassed, var(--vscode-charts-green, #3fb950));
  --ghcc-ci-fail: var(--vscode-testing-iconFailed, var(--vscode-charts-red, #f85149));
  --ghcc-ci-pending: var(--vscode-charts-yellow, #d29922);
  --ghcc-checkbox-bg: var(--vscode-checkbox-background, transparent);
  --ghcc-checkbox-border: var(--vscode-checkbox-border, rgba(128, 128, 128, 0.55));
  --ghcc-checkbox-fg: var(--vscode-checkbox-foreground, var(--ghcc-fg));
  --ghcc-input-bg: var(--vscode-input-background, rgba(128, 128, 128, 0.12));
  --ghcc-input-fg: var(--vscode-input-foreground, var(--ghcc-fg));
  --ghcc-input-placeholder: var(--vscode-input-placeholderForeground, var(--ghcc-muted));
  --ghcc-input-border: var(--vscode-input-border, var(--ghcc-border));
  --ghcc-favorite: var(--vscode-charts-yellow, #e3b341);
}

* {
  box-sizing: border-box;
}

html, body {
  margin: 0;
  padding: 0;
  width: 100%;
  min-height: 100%;
  overflow-x: hidden;
  background: var(--ghcc-bg);
  color: var(--ghcc-fg);
  font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
  font-size: var(--vscode-font-size, 13px);
  line-height: 1.35;
  -webkit-font-smoothing: antialiased;
}

#app {
  width: 100%;
  max-width: 100%;
  padding: 0;
  user-select: none;
}

#search-bar {
  position: sticky;
  top: 0;
  z-index: 2;
  width: 100%;
  max-width: 100%;
  padding: 5px 8px 6px;
  background: var(--ghcc-bg);
  border-bottom: 1px solid var(--ghcc-border);
  overflow: hidden;
}

.search-input-wrap {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  min-width: 0;
  height: 24px;
  padding: 0 4px 0 7px;
  border: 1px solid var(--ghcc-input-border);
  border-radius: 2px;
  background: var(--ghcc-input-bg);
}

.search-input-wrap:focus-within {
  border-color: var(--ghcc-focus);
}

.search-icon {
  color: var(--ghcc-input-placeholder);
}

.search-icon svg {
  width: 12px;
  height: 12px;
}

.search-input {
  flex: 1 1 0;
  min-width: 0;
  width: 0;
  height: 100%;
  padding: 0;
  margin: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--ghcc-input-fg);
  font-family: inherit;
  font-size: 12px;
  line-height: 22px;
  user-select: text;
}

.search-input::placeholder {
  color: var(--ghcc-input-placeholder);
}

.search-clear {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--ghcc-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.search-clear:hover {
  background: var(--ghcc-hover-bg);
  color: var(--ghcc-fg);
}

.search-clear:focus-visible {
  outline: 1px solid var(--ghcc-focus);
  outline-offset: -1px;
}

.search-clear svg {
  width: 11px;
  height: 11px;
}

#search-bar.is-hidden,
.search-clear.is-hidden {
  display: none;
}

#tree-root {
  width: 100%;
  max-width: 100%;
  padding: 2px 0 8px;
}

.empty-state {
  padding: 12px 16px;
  color: var(--ghcc-muted);
  font-size: 12.5px;
  line-height: 1.5;
  user-select: text;
}

.empty-state p {
  margin: 0 0 10px;
}

.empty-state p:last-child {
  margin-bottom: 0;
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  max-width: 240px;
  padding: 5px 12px;
  border: none;
  border-radius: 2px;
  background: var(--ghcc-btn-bg);
  color: var(--ghcc-btn-fg);
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
}

.btn-primary:hover {
  background: var(--ghcc-btn-hover);
}

.btn-primary:focus-visible {
  outline: 1px solid var(--ghcc-focus);
  outline-offset: 2px;
}

.tree-list {
  width: 100%;
  max-width: 100%;
  outline: none;
}

.row {
  position: relative;
  width: 100%;
  max-width: 100%;
  overflow: hidden;
  cursor: pointer;
  outline: none;
}

.row:hover {
  background: var(--ghcc-hover-bg);
}

.row.is-selected {
  background: var(--ghcc-inactive-bg);
  box-shadow: inset 2px 0 0 var(--ghcc-active-bg);
}

.row:focus-visible,
.row.is-focused:focus {
  outline: 1px solid var(--ghcc-focus);
  outline-offset: -1px;
}

.icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
}

.icon svg {
  width: 14px;
  height: 14px;
  display: block;
}

.chevron {
  width: 14px;
  height: 14px;
  color: var(--ghcc-muted);
  transition: transform 0.1s ease;
}

.chevron.is-expanded {
  transform: rotate(90deg);
}

/* Repo group header */
.repo-row {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 8px 0 6px;
  margin-top: 2px;
  color: var(--ghcc-muted);
}

.repo-row:first-child {
  margin-top: 0;
}

.repo-row.is-favorite .repo-icon {
  color: var(--ghcc-favorite);
}

.repo-name {
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.repo-right {
  flex: 0 0 auto;
  margin-left: auto;
  display: inline-flex;
  align-items: center;
}

.repo-actions {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  max-width: 0;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
  margin-right: 0;
  transition: opacity 0.12s ease;
}

.repo-row:hover .repo-actions,
.repo-row:focus-within .repo-actions {
  max-width: 22px;
  opacity: 1;
  pointer-events: auto;
  margin-right: 4px;
}

.repo-action-btn {
  flex: 0 0 auto;
  width: 18px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--ghcc-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.repo-action-btn:hover {
  background: var(--ghcc-hover-bg);
  color: var(--ghcc-fg);
}

.repo-action-btn.is-favorite,
.repo-action-btn.is-favorite:hover {
  color: var(--ghcc-favorite);
}

.repo-action-btn:focus-visible {
  outline: 1px solid var(--ghcc-focus);
  outline-offset: -1px;
}

.repo-action-btn svg {
  width: 12px;
  height: 12px;
}

.repo-count {
  flex: 0 0 auto;
  padding: 0 5px;
  min-width: 16px;
  height: 15px;
  line-height: 15px;
  border-radius: 999px;
  background: var(--ghcc-badge-bg);
  color: var(--ghcc-badge-fg);
  font-size: 10px;
  font-weight: 600;
  text-align: center;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* PR row (compact 2-line layout) */
.pr-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 5px 8px 5px 6px;
}

.pr-line-1 {
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
}

.pr-main {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
}

.pr-chevron-btn {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  padding: 0;
  margin: 0;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--ghcc-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.pr-chevron-btn:hover {
  background: var(--ghcc-hover-bg);
  color: var(--ghcc-fg);
}

.pr-title-wrap {
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  line-height: 17px;
}

.pr-num {
  color: var(--ghcc-muted);
  font-variant-numeric: tabular-nums;
  margin-right: 4px;
}

.pr-title {
  color: var(--ghcc-fg);
  font-weight: 500;
}

.pr-right {
  flex: 0 0 auto;
  margin-left: auto;
  padding-left: 8px;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}

.pr-review {
  flex: 0 0 auto;
  font-size: 11px;
  line-height: 1;
}

.pr-review-approved {
  color: var(--ghcc-ci-pass);
}

.pr-review-changes {
  color: var(--ghcc-ci-fail);
}

.pr-review-pending {
  color: var(--ghcc-ci-pending);
}

.pr-line-2 {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-left: 20px;
  width: 100%;
  min-width: 0;
  height: 16px;
}

.pr-meta {
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--ghcc-muted);
}

.pr-actions {
  flex: 0 0 auto;
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  max-width: 0;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease;
}

.pr-row:hover .pr-actions,
.pr-row:focus-within .pr-actions,
.pr-row.is-focused .pr-actions {
  max-width: 68px;
  opacity: 1;
  pointer-events: auto;
}

.pr-action-btn {
  flex: 0 0 auto;
  width: 18px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--ghcc-muted);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.pr-action-btn:hover {
  background: var(--ghcc-hover-bg);
  color: var(--ghcc-fg);
}

.pr-action-btn:focus-visible {
  outline: 1px solid var(--ghcc-focus);
  outline-offset: -1px;
}

.pr-action-btn.is-copied,
.pr-action-btn.is-copied:hover {
  color: var(--ghcc-ci-pass);
}

.pr-action-btn svg {
  width: 12px;
  height: 12px;
}

/* Status & file change icon tones */
.ci-draft { color: var(--ghcc-muted); }
.ci-SUCCESS { color: var(--ghcc-ci-pass); }
.ci-FAILURE { color: var(--ghcc-ci-fail); }
.ci-PENDING { color: var(--ghcc-ci-pending); }
.ci-NONE { color: var(--ghcc-muted); }

@keyframes ghcc-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.spin svg {
  animation: ghcc-spin 1.1s linear infinite;
}

.change-ADDED { color: var(--ghcc-file-add); }
.change-MODIFIED, .change-CHANGED { color: var(--ghcc-file-mod); }
.change-DELETED { color: var(--ghcc-file-del); }
.change-RENAMED, .change-COPIED { color: var(--ghcc-file-ren); }

/* Right-aligned priority diffstat (never wraps, never shrinks, never clipped) */
.diffstat {
  flex: 0 0 auto;
  margin-left: auto;
  padding-left: 8px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  font-size: 11.5px;
  font-weight: 500;
  line-height: 1;
}

.pr-right .diffstat {
  margin-left: 0;
  padding-left: 0;
}

.diff-add {
  color: var(--ghcc-diff-add);
  white-space: nowrap;
}

.diff-del {
  color: var(--ghcc-diff-del);
  white-space: nowrap;
}

/* Folder row */
.folder-row {
  display: flex;
  align-items: center;
  height: 22px;
  padding-right: 8px;
}

.folder-main {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
}

.folder-icon {
  color: var(--ghcc-muted);
}

.folder-name {
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  color: var(--ghcc-fg);
}

/* File row */
.file-row {
  display: flex;
  align-items: center;
  height: 23px;
  padding-right: 8px;
}

.file-main {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  overflow: hidden;
}

.file-check {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  padding: 0;
  margin: 0;
  border: 1px solid var(--ghcc-checkbox-border);
  border-radius: 3px;
  background: var(--ghcc-checkbox-bg);
  color: var(--ghcc-checkbox-fg);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.file-check:hover {
  border-color: var(--ghcc-focus);
}

.file-check:focus-visible {
  outline: 1px solid var(--ghcc-focus);
  outline-offset: 1px;
}

.file-check svg {
  width: 10px;
  height: 10px;
}

.file-row.is-viewed .file-check {
  background: var(--ghcc-active-bg);
  border-color: var(--ghcc-active-bg);
  color: #ffffff;
}

.file-label-group {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  align-items: baseline;
  overflow: hidden;
}

.file-name {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  color: var(--ghcc-fg);
}

.file-row.is-viewed .file-name {
  opacity: 0.62;
}

.file-dir {
  flex: 0 1000 auto;
  min-width: 0;
  margin-left: 5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--ghcc-muted);
  opacity: 0.82;
}

/* Loading / Error / Empty-files child rows */
.status-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 22px;
  padding: 2px 8px 2px 26px;
  color: var(--ghcc-muted);
  font-size: 12px;
}

.status-row.is-error {
  color: var(--ghcc-ci-fail);
}

.status-text {
  flex: 1 1 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.retry-btn {
  flex: 0 0 auto;
  margin-left: auto;
  padding: 1px 7px;
  border: 1px solid var(--ghcc-border);
  border-radius: 3px;
  background: transparent;
  color: var(--ghcc-fg);
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
}

.retry-btn:hover {
  background: var(--ghcc-hover-bg);
}

.retry-btn:focus-visible {
  outline: 1px solid var(--ghcc-focus);
  outline-offset: 1px;
}

${depthRules()}
`;

const SIDEBAR_SCRIPT = `
(function () {
  var vscode = acquireVsCodeApi();
  var cfg = JSON.parse(document.getElementById("ghcc-boot").textContent || "{}");
  var strings = cfg.strings || {};
  var snapshot = cfg.initialSnapshot || { signedIn: false, layout: "tree", groups: [] };
  var persisted = (typeof vscode.getState === "function" && vscode.getState()) || {};
  var collapsedRepos = new Set(Array.isArray(persisted.collapsedRepos) ? persisted.collapsedRepos : []);
  var collapsedFolders = new Set(Array.isArray(persisted.collapsedFolders) ? persisted.collapsedFolders : []);
  var searchQuery = typeof persisted.searchQuery === "string" ? persisted.searchQuery : "";
  var searchBar = document.getElementById("search-bar");
  var treeRoot = document.getElementById("tree-root");
  var searchInput = null;
  var searchClearBtn = null;
  var focusedRowId = null;
  var selectedRowId = null;
  var copiedPrTimers = Object.create(null);
  var copyButtons = Object.create(null);
  var MAX_DEPTH = ${MAX_INDENT_DEPTH};
  var SVG_NS = "http://www.w3.org/2000/svg";

  var ICON_SPECS = {
    chevron: [{ tag: "path", d: "M6 3.5L10.5 8 6 12.5", stroke: "currentColor", sw: "1.6", fill: "none", cap: "round", join: "round" }],
    repo: [
      { tag: "path", d: "M3.5 2.5A1.5 1.5 0 0 1 5 1h7.5v11.5H5a1.5 1.5 0 0 0-1.5 1.5V2.5z", stroke: "currentColor", sw: "1.3", fill: "none", join: "round" },
      { tag: "path", d: "M3.5 12.5A1.5 1.5 0 0 1 5 11h7.5v3.5H5a1.5 1.5 0 0 1-1.5-1.5v-.5z", stroke: "currentColor", sw: "1.3", fill: "none", join: "round" },
    ],
    folder: [{ tag: "path", d: "M1.75 3.5A1.25 1.25 0 0 1 3 2.25h3.1l1.4 1.5H13A1.25 1.25 0 0 1 14.25 5v7.5A1.25 1.25 0 0 1 13 13.75H3a1.25 1.25 0 0 1-1.25-1.25v-9z", stroke: "currentColor", sw: "1.25", fill: "none", join: "round" }],
    draft: [
      { tag: "circle", cx: "8", cy: "8", r: "5.25", stroke: "currentColor", sw: "1.4", fill: "none", dash: "2.2 2" },
    ],
    ciPass: [
      { tag: "circle", cx: "8", cy: "8", r: "5.75", stroke: "currentColor", sw: "1.35", fill: "none" },
      { tag: "path", d: "M5.4 8.2l1.8 1.8 3.5-3.8", stroke: "currentColor", sw: "1.45", fill: "none", cap: "round", join: "round" },
    ],
    ciFail: [
      { tag: "circle", cx: "8", cy: "8", r: "5.75", stroke: "currentColor", sw: "1.35", fill: "none" },
      { tag: "path", d: "M5.7 5.7l4.6 4.6M10.3 5.7l-4.6 4.6", stroke: "currentColor", sw: "1.45", fill: "none", cap: "round" },
    ],
    ciPending: [
      { tag: "circle", cx: "8", cy: "8", r: "5.5", stroke: "currentColor", sw: "1.4", fill: "none", op: "0.28" },
      { tag: "path", d: "M8 2.5A5.5 5.5 0 0 1 13.5 8", stroke: "currentColor", sw: "1.6", fill: "none", cap: "round" },
    ],
    ciNone: [
      { tag: "circle", cx: "8", cy: "8", r: "5.25", stroke: "currentColor", sw: "1.35", fill: "none" },
    ],
    fileAdded: [
      { tag: "rect", x: "2", y: "2", width: "12", height: "12", rx: "2.2", stroke: "currentColor", sw: "1.3", fill: "none" },
      { tag: "path", d: "M8 5v6M5 8h6", stroke: "currentColor", sw: "1.5", fill: "none", cap: "round" },
    ],
    fileModified: [
      { tag: "rect", x: "2", y: "2", width: "12", height: "12", rx: "2.2", stroke: "currentColor", sw: "1.3", fill: "none" },
      { tag: "circle", cx: "8", cy: "8", r: "2.1", fill: "currentColor" },
    ],
    fileDeleted: [
      { tag: "rect", x: "2", y: "2", width: "12", height: "12", rx: "2.2", stroke: "currentColor", sw: "1.3", fill: "none" },
      { tag: "path", d: "M5 8h6", stroke: "currentColor", sw: "1.5", fill: "none", cap: "round" },
    ],
    fileRenamed: [
      { tag: "rect", x: "2", y: "2", width: "12", height: "12", rx: "2.2", stroke: "currentColor", sw: "1.3", fill: "none" },
      { tag: "path", d: "M4.8 8h6M8.5 5.6L11 8l-2.5 2.4", stroke: "currentColor", sw: "1.4", fill: "none", cap: "round", join: "round" },
    ],
    check: [
      { tag: "path", d: "M3.2 8.4l3.1 3.1 6.5-6.8", stroke: "currentColor", sw: "2", fill: "none", cap: "round", join: "round" },
    ],
    copy: [
      { tag: "rect", x: "5.5", y: "5.5", width: "8.5", height: "8.5", rx: "1.4", stroke: "currentColor", sw: "1.3", fill: "none" },
      { tag: "path", d: "M4.5 10.5H3.5A1.5 1.5 0 0 1 2 9V3A1.5 1.5 0 0 1 3.5 1.5H9A1.5 1.5 0 0 1 10.5 3v1", stroke: "currentColor", sw: "1.3", fill: "none", cap: "round" },
    ],
    branch: [
      { tag: "circle", cx: "5", cy: "3.5", r: "1.6", stroke: "currentColor", sw: "1.3", fill: "none" },
      { tag: "circle", cx: "5", cy: "12.5", r: "1.6", stroke: "currentColor", sw: "1.3", fill: "none" },
      { tag: "circle", cx: "11.5", cy: "5.5", r: "1.6", stroke: "currentColor", sw: "1.3", fill: "none" },
      { tag: "path", d: "M5 5.1v5.8M11.5 7.1c0 2-1.5 2.9-4.5 2.9H5", stroke: "currentColor", sw: "1.3", fill: "none" },
    ],
    external: [
      { tag: "path", d: "M6.5 3.5h-3v9h9v-3M9.5 2.5h4v4M13.5 2.5L7.5 8.5", stroke: "currentColor", sw: "1.35", fill: "none", cap: "round", join: "round" },
    ],
    alert: [
      { tag: "circle", cx: "8", cy: "8", r: "5.75", stroke: "currentColor", sw: "1.35", fill: "none" },
      { tag: "path", d: "M8 4.8v3.7M8 11.1h.01", stroke: "currentColor", sw: "1.5", fill: "none", cap: "round" },
    ],
    search: [
      { tag: "circle", cx: "7", cy: "7", r: "4.5", stroke: "currentColor", sw: "1.4", fill: "none" },
      { tag: "path", d: "M10.4 10.4L13.8 13.8", stroke: "currentColor", sw: "1.5", fill: "none", cap: "round" },
    ],
    close: [
      { tag: "path", d: "M4.5 4.5l7 7M11.5 4.5l-7 7", stroke: "currentColor", sw: "1.5", fill: "none", cap: "round" },
    ],
    star: [
      { tag: "path", d: "M8 2.1l1.75 3.55 3.92.57-2.84 2.76.67 3.9L8 11.04l-3.5 1.84.67-3.9-2.84-2.76 3.92-.57L8 2.1z", stroke: "currentColor", sw: "1.3", fill: "none", join: "round" },
    ],
    starFilled: [
      { tag: "path", d: "M8 2.1l1.75 3.55 3.92.57-2.84 2.76.67 3.9L8 11.04l-3.5 1.84.67-3.9-2.84-2.76 3.92-.57L8 2.1z", stroke: "currentColor", sw: "1.1", fill: "currentColor", join: "round" },
    ],
  };

  function persistUiState() {
    if (typeof vscode.setState === "function") {
      vscode.setState({
        collapsedRepos: Array.from(collapsedRepos),
        collapsedFolders: Array.from(collapsedFolders),
        searchQuery: searchQuery,
      });
    }
  }

  function formatNumber(value) {
    var n = typeof value === "number" && isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
    return String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",");
  }

  function createSvg(name) {
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    var shapes = ICON_SPECS[name] || [];
    for (var i = 0; i < shapes.length; i++) {
      var spec = shapes[i];
      var node = document.createElementNS(SVG_NS, spec.tag);
      if (spec.d) { node.setAttribute("d", spec.d); }
      if (spec.cx) { node.setAttribute("cx", spec.cx); }
      if (spec.cy) { node.setAttribute("cy", spec.cy); }
      if (spec.r) { node.setAttribute("r", spec.r); }
      if (spec.x) { node.setAttribute("x", spec.x); }
      if (spec.y) { node.setAttribute("y", spec.y); }
      if (spec.width) { node.setAttribute("width", spec.width); }
      if (spec.height) { node.setAttribute("height", spec.height); }
      if (spec.rx) { node.setAttribute("rx", spec.rx); }
      if (spec.stroke) { node.setAttribute("stroke", spec.stroke); }
      if (spec.sw) { node.setAttribute("stroke-width", spec.sw); }
      if (spec.fill) { node.setAttribute("fill", spec.fill); }
      if (spec.cap) { node.setAttribute("stroke-linecap", spec.cap); }
      if (spec.join) { node.setAttribute("stroke-linejoin", spec.join); }
      if (spec.dash) { node.setAttribute("stroke-dasharray", spec.dash); }
      if (spec.op) { node.setAttribute("opacity", spec.op); }
      svg.appendChild(node);
    }
    return svg;
  }

  function makeIcon(name, extraClass) {
    var span = document.createElement("span");
    span.className = extraClass ? "icon " + extraClass : "icon";
    span.appendChild(createSvg(name));
    return span;
  }

  function makeDiffstat(additions, deletions) {
    var wrap = document.createElement("span");
    wrap.className = "diffstat";
    var addEl = document.createElement("span");
    addEl.className = "diff-add";
    addEl.textContent = "+" + formatNumber(additions);
    var delEl = document.createElement("span");
    delEl.className = "diff-del";
    delEl.textContent = "-" + formatNumber(deletions);
    wrap.appendChild(addEl);
    wrap.appendChild(delEl);
    return wrap;
  }

  function fileIconName(changeType) {
    if (changeType === "ADDED") { return "fileAdded"; }
    if (changeType === "DELETED") { return "fileDeleted"; }
    if (changeType === "RENAMED" || changeType === "COPIED") { return "fileRenamed"; }
    return "fileModified";
  }

  function prStatusIconName(pr) {
    if (pr.isDraft) { return "draft"; }
    if (pr.ciState === "SUCCESS") { return "ciPass"; }
    if (pr.ciState === "FAILURE") { return "ciFail"; }
    if (pr.ciState === "PENDING") { return "ciPending"; }
    return "ciNone";
  }

  function depthClass(depth) {
    var clamped = Math.max(0, Math.min(MAX_DEPTH, depth));
    return "depth-" + clamped;
  }

  function findFileInFolders(folders, path) {
    for (var i = 0; i < folders.length; i++) {
      var folder = folders[i];
      for (var j = 0; j < folder.files.length; j++) {
        if (folder.files[j].path === path) { return folder.files[j]; }
      }
      var nested = findFileInFolders(folder.folders, path);
      if (nested) { return nested; }
    }
    return null;
  }

  function findLocalFile(prId, filePath) {
    for (var g = 0; g < snapshot.groups.length; g++) {
      var prs = snapshot.groups[g].prs;
      for (var p = 0; p < prs.length; p++) {
        var pr = prs[p];
        if (pr.id !== prId || pr.filesState.status !== "loaded") { continue; }
        for (var i = 0; i < pr.filesState.files.length; i++) {
          if (pr.filesState.files[i].path === filePath) { return pr.filesState.files[i]; }
        }
        return findFileInFolders(pr.filesState.folders, filePath);
      }
    }
    return null;
  }

  function toggleViewed(prId, filePath) {
    var file = findLocalFile(prId, filePath);
    var nextViewed = file ? !file.viewed : true;
    if (file) {
      file.viewed = nextViewed;
      render();
    }
    vscode.postMessage({ command: "toggleFileViewed", prId: prId, filePath: filePath, viewed: nextViewed });
  }

  function setActiveRow(rowId, shouldFocus) {
    focusedRowId = rowId;
    if (!treeRoot) { return; }
    var rows = treeRoot.querySelectorAll("[data-row-id]");
    var targetEl = null;
    for (var i = 0; i < rows.length; i++) {
      var el = rows[i];
      var match = el.getAttribute("data-row-id") === rowId;
      el.tabIndex = match ? 0 : -1;
      el.classList.toggle("is-focused", match);
      if (match) { targetEl = el; }
    }
    if (shouldFocus && targetEl && typeof targetEl.focus === "function") {
      targetEl.focus();
    }
  }

  function renderFileRow(pr, file, depth, parentRowId, showDir) {
    var rowId = "file:" + pr.id + ":" + file.path;
    var row = document.createElement("div");
    row.className = "row file-row " + depthClass(depth) + (file.viewed ? " is-viewed" : "");
    row.setAttribute("role", "treeitem");
    row.setAttribute("data-row-id", rowId);
    row.setAttribute("data-row-kind", "file");
    row.setAttribute("data-parent-id", parentRowId);
    row.setAttribute("data-pr-id", pr.id);
    row.setAttribute("data-file-path", file.path);
    row.setAttribute("title", file.tooltip);
    row.setAttribute("data-vscode-context", JSON.stringify({
      webviewSection: "prFile",
      prId: pr.id,
      filePath: file.path,
      preventDefaultContextMenuItems: true,
    }));

    var main = document.createElement("div");
    main.className = "file-main";

    var checkBtn = document.createElement("button");
    checkBtn.type = "button";
    checkBtn.className = "file-check";
    checkBtn.tabIndex = -1;
    checkBtn.setAttribute("role", "checkbox");
    checkBtn.setAttribute("aria-checked", file.viewed ? "true" : "false");
    checkBtn.setAttribute("aria-label", file.viewed ? (strings.markAsUnviewed || "Mark file as unviewed") : (strings.markAsViewed || "Mark file as viewed"));
    checkBtn.setAttribute("title", file.viewed ? (strings.markAsUnviewed || "Mark file as unviewed") : (strings.markAsViewed || "Mark file as viewed"));
    if (file.viewed) {
      checkBtn.appendChild(createSvg("check"));
    }
    checkBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      setActiveRow(rowId, false);
      toggleViewed(pr.id, file.path);
    });

    var statusIcon = makeIcon(fileIconName(file.changeType), "file-status-icon change-" + file.changeType);

    var labelGroup = document.createElement("div");
    labelGroup.className = "file-label-group";

    var nameEl = document.createElement("span");
    nameEl.className = "file-name";
    nameEl.textContent = file.name;
    labelGroup.appendChild(nameEl);

    if (showDir && file.dir) {
      var dirEl = document.createElement("span");
      dirEl.className = "file-dir";
      dirEl.textContent = file.dir;
      labelGroup.appendChild(dirEl);
    }

    main.appendChild(checkBtn);
    main.appendChild(statusIcon);
    main.appendChild(labelGroup);

    row.appendChild(main);
    row.appendChild(makeDiffstat(file.additions, file.deletions));

    row.addEventListener("click", function () {
      selectedRowId = rowId;
      setActiveRow(rowId, true);
      vscode.postMessage({ command: "openFileDiff", prId: pr.id, filePath: file.path });
    });

    return row;
  }

  function renderFolderItems(fragment, pr, folders, files, depth, parentRowId, showDir) {
    for (var i = 0; i < folders.length; i++) {
      var folder = folders[i];
      var folderKey = pr.id + ":" + folder.path;
      var folderRowId = "folder:" + folderKey;
      var isExpanded = !collapsedFolders.has(folderKey);

      var row = document.createElement("div");
      row.className = "row folder-row " + depthClass(depth);
      row.setAttribute("role", "treeitem");
      row.setAttribute("aria-expanded", isExpanded ? "true" : "false");
      row.setAttribute("data-row-id", folderRowId);
      row.setAttribute("data-row-kind", "folder");
      row.setAttribute("data-parent-id", parentRowId);
      row.setAttribute("data-folder-key", folderKey);
      row.setAttribute("title", folder.path);
      row.setAttribute("data-vscode-context", JSON.stringify({ preventDefaultContextMenuItems: true }));

      var main = document.createElement("div");
      main.className = "folder-main";
      main.appendChild(makeIcon("chevron", isExpanded ? "chevron is-expanded" : "chevron"));
      main.appendChild(makeIcon("folder", "folder-icon"));

      var nameEl = document.createElement("span");
      nameEl.className = "folder-name";
      nameEl.textContent = folder.name;
      main.appendChild(nameEl);

      row.appendChild(main);

      (function (key, id) {
        row.addEventListener("click", function () {
          if (collapsedFolders.has(key)) {
            collapsedFolders.delete(key);
          } else {
            collapsedFolders.add(key);
          }
          persistUiState();
          focusedRowId = id;
          render(true);
        });
      })(folderKey, folderRowId);

      fragment.appendChild(row);

      if (isExpanded) {
        renderFolderItems(fragment, pr, folder.folders, folder.files, depth + 1, folderRowId, false);
      }
    }

    for (var j = 0; j < files.length; j++) {
      fragment.appendChild(renderFileRow(pr, files[j], depth, parentRowId, showDir));
    }
  }

  function renderPrChildren(fragment, pr, prRowId) {
    var state = pr.filesState;
    if (state.status === "loading") {
      var loadingRow = document.createElement("div");
      loadingRow.className = "status-row";
      loadingRow.appendChild(makeIcon("ciPending", "spin"));
      var loadingText = document.createElement("span");
      loadingText.className = "status-text";
      loadingText.textContent = strings.loadingFiles || "Loading files…";
      loadingRow.appendChild(loadingText);
      fragment.appendChild(loadingRow);
      return;
    }

    if (state.status === "error") {
      var retryRowId = "retry:" + pr.id;
      var errRow = document.createElement("div");
      errRow.className = "row status-row is-error";
      errRow.setAttribute("role", "treeitem");
      errRow.setAttribute("data-row-id", retryRowId);
      errRow.setAttribute("data-row-kind", "retry");
      errRow.setAttribute("data-parent-id", prRowId);
      errRow.setAttribute("data-pr-id", pr.id);
      errRow.setAttribute("title", state.message);
      errRow.appendChild(makeIcon("alert", "ci-FAILURE"));
      var errText = document.createElement("span");
      errText.className = "status-text";
      errText.textContent = state.message;
      errRow.appendChild(errText);
      var retryBtn = document.createElement("button");
      retryBtn.type = "button";
      retryBtn.className = "retry-btn";
      retryBtn.tabIndex = -1;
      retryBtn.textContent = strings.retry || "Retry";
      retryBtn.addEventListener("click", function (event) {
        event.stopPropagation();
        vscode.postMessage({ command: "retryLoadFiles", prId: pr.id });
      });
      errRow.addEventListener("click", function () {
        vscode.postMessage({ command: "retryLoadFiles", prId: pr.id });
      });
      errRow.appendChild(retryBtn);
      fragment.appendChild(errRow);
      return;
    }

    if (state.status === "loaded") {
      if (state.totalCount === 0) {
        var emptyRow = document.createElement("div");
        emptyRow.className = "status-row";
        var emptyText = document.createElement("span");
        emptyText.className = "status-text";
        emptyText.textContent = strings.noChangedFiles || "No changed files";
        emptyRow.appendChild(emptyText);
        fragment.appendChild(emptyRow);
        return;
      }
      renderFolderItems(fragment, pr, state.folders, state.files, 0, prRowId, snapshot.layout === "flat");
    }
  }

  function applyCopyBtnState(button, isCopied) {
    var label = isCopied ? (strings.copied || "Copied") : (strings.copyPrUrl || "Copy pull request URL");
    button.classList.toggle("is-copied", isCopied);
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    button.replaceChildren(createSvg(isCopied ? "check" : "copy"));
  }

  function renderPrRow(pr, repoRowId) {
    var prRowId = "pr:" + pr.id;
    var row = document.createElement("div");
    row.className = "row pr-row";
    row.setAttribute("role", "treeitem");
    row.setAttribute("aria-expanded", pr.expanded ? "true" : "false");
    row.setAttribute("data-row-id", prRowId);
    row.setAttribute("data-row-kind", "pr");
    row.setAttribute("data-parent-id", repoRowId);
    row.setAttribute("data-pr-id", pr.id);
    row.setAttribute("title", pr.tooltip);
    row.setAttribute("data-vscode-context", JSON.stringify({
      webviewSection: "pr",
      prId: pr.id,
      preventDefaultContextMenuItems: true,
    }));

    var line1 = document.createElement("div");
    line1.className = "pr-line-1";

    var main = document.createElement("div");
    main.className = "pr-main";

    var chevronBtn = document.createElement("button");
    chevronBtn.type = "button";
    chevronBtn.className = "pr-chevron-btn";
    chevronBtn.tabIndex = -1;
    chevronBtn.setAttribute("aria-label", strings.expandPr || "Toggle changed files");
    chevronBtn.appendChild(makeIcon("chevron", pr.expanded ? "chevron is-expanded" : "chevron"));
    chevronBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      focusedRowId = prRowId;
      vscode.postMessage({ command: "togglePrExpand", prId: pr.id });
    });

    var statusTone = pr.isDraft ? "ci-draft" : ("ci-" + pr.ciState + (pr.ciState === "PENDING" ? " spin" : ""));
    var statusIcon = makeIcon(prStatusIconName(pr), statusTone);

    var titleWrap = document.createElement("span");
    titleWrap.className = "pr-title-wrap";
    var numEl = document.createElement("span");
    numEl.className = "pr-num";
    numEl.textContent = "#" + pr.number;
    var titleEl = document.createElement("span");
    titleEl.className = "pr-title";
    titleEl.textContent = pr.title;
    titleWrap.appendChild(numEl);
    titleWrap.appendChild(titleEl);

    main.appendChild(chevronBtn);
    main.appendChild(statusIcon);
    main.appendChild(titleWrap);

    var right = document.createElement("div");
    right.className = "pr-right";
    if (pr.reviewGlyph) {
      var revEl = document.createElement("span");
      revEl.className = "pr-review" + (pr.reviewTone ? " pr-review-" + pr.reviewTone : "");
      revEl.textContent = pr.reviewGlyph;
      right.appendChild(revEl);
    }
    right.appendChild(makeDiffstat(pr.additions, pr.deletions));

    line1.appendChild(main);
    line1.appendChild(right);

    var line2 = document.createElement("div");
    line2.className = "pr-line-2";

    var metaEl = document.createElement("span");
    metaEl.className = "pr-meta";
    metaEl.textContent = pr.meta;

    var actions = document.createElement("div");
    actions.className = "pr-actions";

    var copyUrlBtn = document.createElement("button");
    copyUrlBtn.type = "button";
    copyUrlBtn.className = "pr-action-btn";
    copyUrlBtn.tabIndex = -1;
    copyButtons[pr.id] = copyUrlBtn;
    applyCopyBtnState(copyUrlBtn, Boolean(copiedPrTimers[pr.id]));
    copyUrlBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      vscode.postMessage({ command: "copyPrUrl", prId: pr.id });
      if (copiedPrTimers[pr.id]) {
        clearTimeout(copiedPrTimers[pr.id]);
      }
      applyCopyBtnState(copyUrlBtn, true);
      copiedPrTimers[pr.id] = setTimeout(function () {
        delete copiedPrTimers[pr.id];
        var currentBtn = copyButtons[pr.id];
        if (currentBtn) {
          applyCopyBtnState(currentBtn, false);
        }
      }, 1500);
    });

    var checkoutBtn = document.createElement("button");
    checkoutBtn.type = "button";
    checkoutBtn.className = "pr-action-btn";
    checkoutBtn.tabIndex = -1;
    checkoutBtn.setAttribute("aria-label", strings.checkoutBranch || "Checkout branch");
    checkoutBtn.setAttribute("title", strings.checkoutBranch || "Checkout branch");
    checkoutBtn.appendChild(createSvg("branch"));
    checkoutBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      vscode.postMessage({ command: "checkoutPr", prId: pr.id });
    });

    var openExtBtn = document.createElement("button");
    openExtBtn.type = "button";
    openExtBtn.className = "pr-action-btn";
    openExtBtn.tabIndex = -1;
    openExtBtn.setAttribute("aria-label", strings.openOnGitHub || "Open on GitHub");
    openExtBtn.setAttribute("title", strings.openOnGitHub || "Open on GitHub");
    openExtBtn.appendChild(createSvg("external"));
    openExtBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      vscode.postMessage({ command: "openPrExternal", prId: pr.id });
    });

    actions.appendChild(copyUrlBtn);
    actions.appendChild(checkoutBtn);
    actions.appendChild(openExtBtn);

    line2.appendChild(metaEl);
    line2.appendChild(actions);

    row.appendChild(line1);
    row.appendChild(line2);

    row.addEventListener("click", function () {
      selectedRowId = prRowId;
      setActiveRow(prRowId, true);
      vscode.postMessage({ command: "openPrDetails", prId: pr.id });
    });

    return row;
  }

  function clearSearch(focusInput) {
    searchQuery = "";
    if (searchInput) {
      searchInput.value = "";
    }
    persistUiState();
    render(false);
    if (focusInput && searchInput && typeof searchInput.focus === "function") {
      searchInput.focus();
    }
  }

  function initSearchBar() {
    if (!searchBar) { return; }
    var wrap = document.createElement("div");
    wrap.className = "search-input-wrap";
    wrap.appendChild(makeIcon("search", "search-icon"));

    searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.className = "search-input";
    searchInput.setAttribute("id", "search-input");
    var placeholder = strings.searchPlaceholder || "Filter by PR title…";
    searchInput.setAttribute("placeholder", placeholder);
    searchInput.setAttribute("aria-label", placeholder);
    searchInput.setAttribute("autocomplete", "off");
    searchInput.setAttribute("spellcheck", "false");
    searchInput.value = searchQuery;
    searchInput.addEventListener("input", function () {
      searchQuery = searchInput.value;
      persistUiState();
      render(false);
    });

    searchClearBtn = document.createElement("button");
    searchClearBtn.type = "button";
    searchClearBtn.className = "search-clear" + (searchQuery.length === 0 ? " is-hidden" : "");
    searchClearBtn.setAttribute("id", "search-clear");
    var clearLabel = strings.clearSearch || "Clear search";
    searchClearBtn.setAttribute("aria-label", clearLabel);
    searchClearBtn.setAttribute("title", clearLabel);
    searchClearBtn.appendChild(createSvg("close"));
    searchClearBtn.addEventListener("click", function () {
      clearSearch(true);
    });

    wrap.appendChild(searchInput);
    wrap.appendChild(searchClearBtn);
    searchBar.replaceChildren(wrap);
  }

  function render(restoreFocus) {
    if (!treeRoot) { return; }
    copyButtons = Object.create(null);

    var prevActive = document.activeElement;
    var hadFocusInList = Boolean(prevActive && prevActive.getAttribute && prevActive.getAttribute("data-row-id"));
    var prevScrollY = typeof window.scrollY === "number" ? window.scrollY : 0;

    var hasGroups = Boolean(snapshot.groups && snapshot.groups.length > 0);
    var showSearch = Boolean(snapshot.signedIn && (hasGroups || searchQuery.length > 0));
    if (searchBar) {
      searchBar.classList.toggle("is-hidden", !showSearch);
    }
    if (searchClearBtn) {
      searchClearBtn.classList.toggle("is-hidden", searchQuery.length === 0);
    }

    if (!snapshot.signedIn) {
      var signInWrap = document.createElement("div");
      signInWrap.className = "empty-state";
      var signInMsg = document.createElement("p");
      signInMsg.textContent = strings.signInMessage || "";
      var signInBtn = document.createElement("button");
      signInBtn.type = "button";
      signInBtn.className = "btn-primary";
      signInBtn.textContent = strings.signInButton || "Sign in to GitHub";
      signInBtn.addEventListener("click", function () {
        vscode.postMessage({ command: "signIn" });
      });
      signInWrap.appendChild(signInMsg);
      signInWrap.appendChild(signInBtn);
      treeRoot.replaceChildren(signInWrap);
      return;
    }

    var query = searchQuery.trim().toLowerCase();
    var isSearching = query.length > 0;

    if (!hasGroups) {
      var emptyWrap = document.createElement("div");
      emptyWrap.className = "empty-state";
      var emptyMsg = document.createElement("p");
      emptyMsg.textContent = isSearching ? (strings.noMatchingPrs || "No matching pull requests") : (strings.emptyMessage || "");
      emptyWrap.appendChild(emptyMsg);
      treeRoot.replaceChildren(emptyWrap);
      return;
    }

    var visibleGroups = [];
    for (var g = 0; g < snapshot.groups.length; g++) {
      var rawGroup = snapshot.groups[g];
      var matchedPrs = isSearching
        ? rawGroup.prs.filter(function (pr) {
            return (pr.title || "").toLowerCase().indexOf(query) !== -1;
          })
        : rawGroup.prs;
      if (matchedPrs.length > 0) {
        visibleGroups.push({
          repo: rawGroup.repo,
          favorite: Boolean(rawGroup.favorite),
          prs: matchedPrs,
        });
      }
    }

    if (visibleGroups.length === 0) {
      var noMatchWrap = document.createElement("div");
      noMatchWrap.className = "empty-state";
      var noMatchMsg = document.createElement("p");
      noMatchMsg.textContent = strings.noMatchingPrs || "No matching pull requests";
      noMatchWrap.appendChild(noMatchMsg);
      treeRoot.replaceChildren(noMatchWrap);
      return;
    }

    var tree = document.createElement("div");
    tree.className = "tree-list";
    tree.setAttribute("role", "tree");

    for (var i = 0; i < visibleGroups.length; i++) {
      var group = visibleGroups[i];
      var repoRowId = "repo:" + group.repo;
      var repoExpanded = isSearching || !collapsedRepos.has(group.repo);

      var repoRow = document.createElement("div");
      repoRow.className = group.favorite ? "row repo-row is-favorite" : "row repo-row";
      repoRow.setAttribute("role", "treeitem");
      repoRow.setAttribute("aria-expanded", repoExpanded ? "true" : "false");
      repoRow.setAttribute("data-row-id", repoRowId);
      repoRow.setAttribute("data-row-kind", "repo");
      repoRow.setAttribute("data-repo", group.repo);
      repoRow.setAttribute("title", group.repo);
      repoRow.setAttribute("data-vscode-context", JSON.stringify({
        webviewSection: "repo",
        repo: group.repo,
        preventDefaultContextMenuItems: true,
      }));

      repoRow.appendChild(makeIcon("chevron", repoExpanded ? "chevron is-expanded" : "chevron"));
      repoRow.appendChild(makeIcon("repo", "repo-icon"));

      var repoName = document.createElement("span");
      repoName.className = "repo-name";
      repoName.textContent = group.repo;
      repoRow.appendChild(repoName);

      var repoRight = document.createElement("div");
      repoRight.className = "repo-right";

      var repoActions = document.createElement("div");
      repoActions.className = "repo-actions";

      var favBtn = document.createElement("button");
      favBtn.type = "button";
      favBtn.className = group.favorite ? "repo-action-btn is-favorite" : "repo-action-btn";
      favBtn.tabIndex = -1;
      var favLabel = group.favorite ? (strings.unfavoriteRepo || "Unfavorite repository") : (strings.favoriteRepo || "Favorite repository");
      favBtn.setAttribute("aria-label", favLabel);
      favBtn.setAttribute("title", favLabel);
      favBtn.appendChild(createSvg(group.favorite ? "starFilled" : "star"));
      (function (repoNameKey) {
        favBtn.addEventListener("click", function (event) {
          event.stopPropagation();
          vscode.postMessage({ command: "toggleFavoriteRepo", repo: repoNameKey });
        });
      })(group.repo);
      repoActions.appendChild(favBtn);

      var countEl = document.createElement("span");
      countEl.className = "repo-count";
      countEl.textContent = String(group.prs.length);

      repoRight.appendChild(repoActions);
      repoRight.appendChild(countEl);
      repoRow.appendChild(repoRight);

      (function (repoNameKey, id, searching) {
        repoRow.addEventListener("click", function () {
          if (searching) {
            focusedRowId = id;
            setActiveRow(id, true);
            return;
          }
          if (collapsedRepos.has(repoNameKey)) {
            collapsedRepos.delete(repoNameKey);
          } else {
            collapsedRepos.add(repoNameKey);
          }
          persistUiState();
          focusedRowId = id;
          render(true);
        });
      })(group.repo, repoRowId, isSearching);

      tree.appendChild(repoRow);

      if (repoExpanded) {
        for (var j = 0; j < group.prs.length; j++) {
          var pr = group.prs[j];
          var prRowId = "pr:" + pr.id;
          tree.appendChild(renderPrRow(pr, repoRowId));
          if (pr.expanded) {
            renderPrChildren(tree, pr, prRowId);
          }
        }
      }
    }

    treeRoot.replaceChildren(tree);

    var rows = tree.querySelectorAll("[data-row-id]");
    var focusTarget = null;
    for (var r = 0; r < rows.length; r++) {
      var rowEl = rows[r];
      var id = rowEl.getAttribute("data-row-id");
      if (id === selectedRowId) {
        rowEl.classList.add("is-selected");
      }
      if (id === focusedRowId) {
        focusTarget = rowEl;
      }
      rowEl.tabIndex = -1;
    }
    if (!focusTarget && rows.length > 0) {
      focusTarget = rows[0];
      focusedRowId = focusTarget.getAttribute("data-row-id");
    }
    if (focusTarget) {
      focusTarget.tabIndex = 0;
      focusTarget.classList.add("is-focused");
      if ((restoreFocus || hadFocusInList) && typeof focusTarget.focus === "function") {
        focusTarget.focus();
      }
    }
    if (prevScrollY > 0 && typeof window.scrollTo === "function") {
      window.scrollTo(0, prevScrollY);
    }
  }

  document.addEventListener("keydown", function (event) {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.key === "f" || event.key === "F")) {
      if (searchInput && searchBar && !searchBar.classList.contains("is-hidden")) {
        event.preventDefault();
        if (typeof searchInput.focus === "function") { searchInput.focus(); }
        if (typeof searchInput.select === "function") { searchInput.select(); }
      }
      return;
    }

    if (event.key === "Escape" && searchQuery.length > 0) {
      event.preventDefault();
      clearSearch(document.activeElement === searchInput);
      return;
    }

    if (!treeRoot) { return; }
    var rows = Array.prototype.slice.call(treeRoot.querySelectorAll("[data-row-id]"));

    if (searchInput && document.activeElement === searchInput) {
      if (event.key === "ArrowDown" && rows.length > 0) {
        event.preventDefault();
        setActiveRow(rows[0].getAttribute("data-row-id"), true);
      }
      return;
    }

    if (rows.length === 0) { return; }

    var active = document.activeElement;
    var isSearching = searchQuery.trim().length > 0;
    var currentIndex = rows.indexOf(active);
    if (currentIndex === -1) {
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].getAttribute("data-row-id") === focusedRowId) {
          currentIndex = i;
          break;
        }
      }
    }
    if (currentIndex === -1) { currentIndex = 0; }
    var current = rows[currentIndex];
    var kind = current.getAttribute("data-row-kind");
    var rowId = current.getAttribute("data-row-id");

    if (event.key === "ArrowDown") {
      event.preventDefault();
      var next = rows[Math.min(rows.length - 1, currentIndex + 1)];
      setActiveRow(next.getAttribute("data-row-id"), true);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      var prev = rows[Math.max(0, currentIndex - 1)];
      setActiveRow(prev.getAttribute("data-row-id"), true);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      var expanded = current.getAttribute("aria-expanded") === "true";
      if (kind === "repo") {
        var repo = current.getAttribute("data-repo");
        if (!expanded && repo) {
          collapsedRepos.delete(repo);
          persistUiState();
          render(true);
        } else if (currentIndex + 1 < rows.length) {
          setActiveRow(rows[currentIndex + 1].getAttribute("data-row-id"), true);
        }
      } else if (kind === "pr") {
        var prId = current.getAttribute("data-pr-id");
        if (!expanded && prId) {
          focusedRowId = rowId;
          vscode.postMessage({ command: "togglePrExpand", prId: prId });
        } else if (currentIndex + 1 < rows.length) {
          setActiveRow(rows[currentIndex + 1].getAttribute("data-row-id"), true);
        }
      } else if (kind === "folder") {
        var folderKey = current.getAttribute("data-folder-key");
        if (!expanded && folderKey) {
          collapsedFolders.delete(folderKey);
          persistUiState();
          render(true);
        } else if (currentIndex + 1 < rows.length) {
          setActiveRow(rows[currentIndex + 1].getAttribute("data-row-id"), true);
        }
      }
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      var isExpanded = current.getAttribute("aria-expanded") === "true";
      if (kind === "repo" && isExpanded) {
        var rKey = current.getAttribute("data-repo");
        if (rKey && !isSearching) {
          collapsedRepos.add(rKey);
          persistUiState();
          render(true);
        }
        return;
      }
      if (kind === "pr" && isExpanded) {
        var pId = current.getAttribute("data-pr-id");
        if (pId) {
          focusedRowId = rowId;
          vscode.postMessage({ command: "togglePrExpand", prId: pId });
        }
        return;
      }
      if (kind === "folder" && isExpanded) {
        var fKey = current.getAttribute("data-folder-key");
        if (fKey) {
          collapsedFolders.add(fKey);
          persistUiState();
          render(true);
        }
        return;
      }
      var parentId = current.getAttribute("data-parent-id");
      if (parentId) {
        setActiveRow(parentId, true);
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (kind === "pr") {
        var openPrId = current.getAttribute("data-pr-id");
        if (openPrId) {
          selectedRowId = rowId;
          vscode.postMessage({ command: "openPrDetails", prId: openPrId });
        }
      } else if (kind === "file") {
        var diffPrId = current.getAttribute("data-pr-id");
        var diffPath = current.getAttribute("data-file-path");
        if (diffPrId && diffPath) {
          selectedRowId = rowId;
          vscode.postMessage({ command: "openFileDiff", prId: diffPrId, filePath: diffPath });
        }
      } else if (kind === "retry") {
        var retryPrId = current.getAttribute("data-pr-id");
        if (retryPrId) {
          vscode.postMessage({ command: "retryLoadFiles", prId: retryPrId });
        }
      } else if (kind === "repo") {
        var toggleRepo = current.getAttribute("data-repo");
        if (toggleRepo && !isSearching) {
          if (collapsedRepos.has(toggleRepo)) { collapsedRepos.delete(toggleRepo); } else { collapsedRepos.add(toggleRepo); }
          persistUiState();
          render(true);
        }
      } else if (kind === "folder") {
        var toggleFolder = current.getAttribute("data-folder-key");
        if (toggleFolder) {
          if (collapsedFolders.has(toggleFolder)) { collapsedFolders.delete(toggleFolder); } else { collapsedFolders.add(toggleFolder); }
          persistUiState();
          render(true);
        }
      }
      return;
    }
    if (event.key === " ") {
      if (kind === "file") {
        event.preventDefault();
        var checkPrId = current.getAttribute("data-pr-id");
        var checkPath = current.getAttribute("data-file-path");
        if (checkPrId && checkPath) {
          toggleViewed(checkPrId, checkPath);
        }
      } else if (kind === "pr") {
        event.preventDefault();
        var spacePrId = current.getAttribute("data-pr-id");
        if (spacePrId) {
          vscode.postMessage({ command: "togglePrExpand", prId: spacePrId });
        }
      } else if (kind === "repo" || kind === "folder") {
        event.preventDefault();
        current.click();
      }
    }
  });

  window.addEventListener("message", function (event) {
    var message = event.data;
    if (!message || typeof message !== "object") { return; }
    if (message.command === "state" && message.snapshot) {
      snapshot = message.snapshot;
      render(false);
    }
  });

  initSearchBar();
  render(false);
  vscode.postMessage({ command: "ready" });
})();
`;

export function renderSidebarHtml(
  nonce: string,
  lang: string,
  strings: ISidebarClientStrings,
  initialSnapshot?: ISidebarSnapshot,
): string {
  const safeNonce = escapeHtml(nonce);
  const safeLang = escapeHtml(lang);
  const boot = safeJsonForScript({
    strings,
    initialSnapshot: initialSnapshot ?? { signedIn: false, layout: "tree", groups: [] },
  });
  return `<!DOCTYPE html>
<html lang="${safeLang}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${safeNonce}'; script-src 'nonce-${safeNonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${safeNonce}">${SIDEBAR_CSS}</style>
</head>
<body>
<div id="app" data-vscode-context="{&quot;preventDefaultContextMenuItems&quot;:true}"><div id="search-bar" class="search-bar is-hidden"></div><div id="tree-root"></div></div>
<script id="ghcc-boot" type="application/json" nonce="${safeNonce}">${boot}</script>
<script nonce="${safeNonce}">${SIDEBAR_SCRIPT}</script>
</body>
</html>`;
}
