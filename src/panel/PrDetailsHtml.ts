import { escapeHtml } from "../core/html";
import {
  DEFAULT_IMAGE_VIEWER_STRINGS,
  IMAGE_VIEWER_CONTROLLER_SCRIPT,
  IMAGE_VIEWER_ICONS,
  IMAGE_VIEWER_SHARED_CSS,
  renderBackdropSwatches,
  renderZoomToolbarControls,
  safeJsonForScript,
} from "../core/imageViewer";
import { gitHubFileRoot } from "../github/fileUrls";
import { MAX_IMAGE_BYTES } from "../core/types";
import type { IBriefState, IPrDetails, IPrTimelineItem, MergeMethod, UpdateBranchMethod } from "../core/types";

export const MERGE_METHOD_LABELS: Record<MergeMethod, string> = {
  SQUASH: "Squash and merge",
  MERGE: "Create a merge commit",
  REBASE: "Rebase and merge",
};

export const UPDATE_METHOD_LABELS: Record<UpdateBranchMethod, string> = {
  REBASE: "Update with rebase",
  MERGE: "Update with merge commit",
};

const REVIEW_STATE_LABELS: Record<string, string> = {
  APPROVED: "approved these changes",
  CHANGES_REQUESTED: "requested changes",
  COMMENTED: "reviewed",
  DISMISSED: "review was dismissed",
  PENDING: "started a review",
};

// text glyphs (not emoji, except the comment bubble) so theme colors apply via CSS
const REVIEW_STATE_ICONS: Record<string, string> = {
  APPROVED: "✓",
  CHANGES_REQUESTED: "↻",
  COMMENTED: "💬",
  DISMISSED: "●",
  PENDING: "●",
  REQUESTED: "●",
};

const REVIEW_DECISION_LABELS: Record<string, string> = {
  APPROVED: "✓ Changes approved",
  CHANGES_REQUESTED: "✗ Changes requested",
  REVIEW_REQUIRED: "● Review required",
};

const MERGEABLE_LABELS: Record<IPrDetails["mergeable"], string> = {
  MERGEABLE: "✓ No conflicts with the base branch",
  CONFLICTING: "✗ This branch has conflicts with the base branch",
  UNKNOWN: "● Checking mergeability…",
};

const BASE_STYLE = `
  :root {
    --gr-green: var(--vscode-charts-green, #2ea043);
    --gr-red: var(--vscode-charts-red, #f85149);
    --gr-purple: var(--vscode-charts-purple, #8957e5);
    --gr-yellow: var(--vscode-charts-yellow, #d0a215);
    --gr-muted: var(--vscode-descriptionForeground);
    --gr-border: var(--vscode-panel-border, rgba(128, 128, 128, 0.35));
    --gr-box-bg: var(--vscode-editorWidget-background, transparent);
    --gr-mono: var(--vscode-editor-font-family, monospace);
  }
  * { box-sizing: border-box; }
  body {
    font-family: var(--vscode-font-family);
    font-size: 13px;
    color: var(--vscode-foreground);
    line-height: 1.5;
    padding: 20px 24px 40px;
    max-width: 1100px;
    margin: 0 auto;
  }
  a { color: var(--vscode-textLink-foreground); text-decoration: none; }
  a:hover { text-decoration: underline; }
  a:focus-visible, button:focus-visible, select:focus-visible, textarea:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: 1px;
  }

  .pr-header { border-bottom: 1px solid var(--gr-border); padding-bottom: 12px; margin-bottom: 20px; }
  .repo-line { color: var(--gr-muted); font-size: 0.92em; margin-bottom: 6px; }
  .pr-header h1 { font-size: 1.5em; font-weight: 500; margin: 0 0 6px; }
  .pr-number { color: var(--gr-muted); font-weight: 300; }
  .state-pill {
    display: inline-block;
    padding: 3px 12px;
    border-radius: 2em;
    color: #fff;
    font-weight: 600;
    font-size: 0.95em;
    margin-right: 8px;
    vertical-align: 2px;
  }
  .state-pill.open { background: var(--gr-green); }
  .state-pill.draft { background: var(--gr-muted); }
  .state-pill.merged { background: var(--gr-purple); }
  .state-pill.closed { background: var(--gr-red); }
  .merge-sentence { color: var(--gr-muted); }
  .branch {
    font-family: var(--gr-mono);
    font-size: 0.92em;
    background: var(--vscode-textCodeBlock-background);
    color: var(--vscode-textLink-foreground);
    padding: 1px 6px;
    border-radius: 6px;
  }
  .branch-action {
    position: relative;
    display: inline-flex;
    align-items: center;
    vertical-align: middle;
    background: transparent;
    border: none;
    padding: 2px;
    margin-left: 2px;
    cursor: pointer;
    color: var(--vscode-textLink-foreground);
  }
  /* webviews suppress native title tooltips, so hover hints are CSS-only */
  .branch-action::after {
    content: attr(data-tooltip);
    position: absolute;
    bottom: calc(100% + 5px);
    left: 50%;
    transform: translateX(-50%);
    background: var(--vscode-editorHoverWidget-background, var(--gr-box-bg));
    color: var(--vscode-editorHoverWidget-foreground, var(--vscode-foreground));
    border: 1px solid var(--vscode-editorHoverWidget-border, var(--gr-border));
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 11px;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.1s;
    z-index: 10;
  }
  .branch-action:hover::after { opacity: 1; }
  .branch-action svg { width: 12px; height: 12px; }
  .branch-action:hover { color: var(--vscode-textLink-activeForeground); }
  .branch-action .copy-icon, .branch-action .copied-icon { display: inline-flex; }
  #copy-branch .copied-icon { display: none; }
  #copy-branch.copied { color: var(--vscode-charts-green, var(--gr-green)); }
  #copy-branch.copied .copy-icon { display: none; }
  #copy-branch.copied .copied-icon { display: inline-flex; }

  .layout { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 28px; align-items: start; }
  @media (max-width: 720px) { .layout { grid-template-columns: minmax(0, 1fr); } }

  .timeline { position: relative; }
  .timeline::before {
    content: "";
    position: absolute;
    top: 8px; bottom: 8px; left: 15px;
    width: 2px;
    background: var(--gr-border);
  }
  .box {
    position: relative;
    background: var(--gr-box-bg);
    border: 1px solid var(--gr-border);
    border-radius: 6px;
    margin: 0 0 16px 40px;
  }
  .box-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--gr-border);
    color: var(--gr-muted);
  }
  .box.no-body .box-header { border-bottom: none; }
  .box-header .author { color: var(--vscode-foreground); font-weight: 600; }
  .avatar {
    width: 28px; height: 28px;
    border-radius: 50%;
    position: absolute;
    left: -40px; top: 6px;
    background: var(--gr-border);
  }
  .box-body { padding: 12px; overflow-x: auto; }
  .box-body img { max-width: 100%; }
  .gcc-mermaid { overflow-x: auto; margin: 8px 0; }
  .gcc-mermaid pre { background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 6px; }
  .mermaid-diagram svg { max-width: 100%; height: auto; }
  .box-body pre { background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 6px; overflow-x: auto; }
  .box-body code { background: var(--vscode-textCodeBlock-background); border-radius: 3px; }
  .review-APPROVED { border-left: 3px solid var(--gr-green); }
  .review-CHANGES_REQUESTED { border-left: 3px solid var(--gr-red); }
  .commit-group { position: relative; margin: 0 0 16px 40px; color: var(--gr-muted); }
  .commit-group-header { padding: 4px 0; }
  .commit-line { display: flex; align-items: baseline; gap: 8px; padding: 1px 0; min-width: 0; }
  .commit-msg { color: var(--vscode-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .commit-sha { font-family: var(--vscode-editor-font-family, monospace); font-size: 0.85em; }
  .code-comments { padding: 0 12px 10px; }
  .older-link { margin: 0 0 16px 40px; display: block; }

  .merge-box { border: 1px solid var(--gr-border); border-radius: 6px; margin-left: 40px; background: var(--gr-box-bg); }
  .merge-box .row { padding: 10px 14px; border-bottom: 1px solid var(--gr-border); }
  .merge-box .row:last-child { border-bottom: none; }
  .merge-box .ok { color: var(--gr-green); }
  .merge-box .ko { color: var(--gr-red); }
  .neutral { color: var(--gr-muted); }
  .merge-box .pending { color: var(--vscode-charts-yellow, #d29922); }
  .merge-box ul { list-style: none; margin: 6px 0 0; padding: 0; max-height: 180px; overflow-y: auto; }
  .merge-box li { padding: 2px 0; color: var(--gr-muted); }
  .check-SUCCESS::before { content: "✓ "; color: var(--gr-green); }
  .check-FAILURE::before, .check-ERROR::before, .check-TIMED_OUT::before, .check-STARTUP_FAILURE::before, .check-CANCELLED::before, .check-ACTION_REQUIRED::before { content: "✗ "; color: var(--gr-red); }
  .check-PENDING::before, .check-EXPECTED::before, .check-STALE::before { content: "● "; color: var(--vscode-charts-yellow, #d29922); }
  .check-NEUTRAL::before, .check-SKIPPED::before { content: "○ "; color: var(--gr-muted); }
  .merge-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

  button, select {
    font-family: var(--vscode-font-family);
    font-size: 13px;
    border-radius: 6px;
    cursor: pointer;
  }
  button {
    border: none;
    padding: 6px 16px;
    background: var(--vscode-button-secondaryBackground, var(--gr-box-bg));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
  }
  button:disabled { opacity: 0.5; cursor: default; }
  .btn-merge, .btn-approve { background: var(--gr-green); color: #fff; }
  .btn-danger { background: var(--gr-red); color: #fff; }
  select {
    background: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
    border: 1px solid var(--vscode-dropdown-border, var(--gr-border));
    padding: 5px 8px;
  }

  .composer { margin: 16px 0 0 40px; }
  .composer textarea {
    width: 100%;
    min-height: 80px;
    resize: vertical;
    font-family: var(--vscode-font-family);
    font-size: 13px;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, var(--gr-border));
    border-radius: 6px;
    padding: 8px;
  }
  .composer .buttons { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }

  .sidebar section { border-bottom: 1px solid var(--gr-border); padding: 0 0 14px; margin-bottom: 14px; }
  .sidebar section:last-child { border-bottom: none; }
  .sidebar h2 { font-size: 0.92em; color: var(--gr-muted); font-weight: 600; margin: 0 0 8px; }
  .sidebar ul { list-style: none; margin: 0; padding: 0; }
  .sidebar li { padding: 2px 0; display: flex; justify-content: space-between; gap: 8px; }
  .reviewer-state { color: var(--gr-muted); white-space: nowrap; }
  .reviewer-state.APPROVED { color: var(--gr-green); }
  .reviewer-state.CHANGES_REQUESTED { color: var(--gr-red); }
  .review-icon { color: var(--gr-muted); }
  .review-icon.APPROVED { color: var(--gr-green); }
  .review-icon.CHANGES_REQUESTED { color: var(--gr-red); }
  .reviewer-state.stale { color: var(--gr-yellow); }
  .label-pill {
    display: inline-block;
    padding: 1px 10px;
    border-radius: 2em;
    font-size: 0.92em;
    margin: 0 4px 4px 0;
  }
  .diffstat { white-space: nowrap; font-family: var(--gr-mono); font-size: 0.92em; }
  .diffstat .add { color: var(--gr-green); }
  .diffstat .del { color: var(--gr-red); }
  .stats-line { color: var(--gr-muted); margin-bottom: 8px; }
  .brief-body { font-size: 0.95em; }
  .brief-body p { margin: 4px 0; }
  .brief-body ul { margin: 4px 0 10px; padding-left: 18px; }
  .brief-body li { margin: 2px 0; }
  .brief-heading { font-weight: 600; margin: 10px 0 4px; }
  .brief-heading:first-child { margin-top: 0; }
  .brief-error { color: var(--gr-red); white-space: pre-wrap; }
  .brief-stale {
    border: 1px solid var(--gr-border);
    border-left: 3px solid var(--gr-yellow);
    border-radius: 4px;
    padding: 6px 10px;
    margin-bottom: 8px;
    font-size: 0.9em;
    color: var(--gr-muted);
  }
  .brief-stale-tag {
    margin-left: 8px;
    font-size: 0.75em;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--gr-yellow);
  }
  .header-actions { margin-top: 10px; display: flex; gap: 8px; }
  .image-fallback {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border-radius: 6px;
    border: 1px dashed var(--gr-border);
    background: var(--vscode-textCodeBlock-background, rgba(128, 128, 128, 0.14));
    color: var(--gr-muted);
    font-size: 12px;
  }
  .image-fallback::before {
    content: "⚠";
    font-size: 13px;
    line-height: 1;
  }
  .brief-section summary { cursor: pointer; font-weight: 600; color: var(--gr-muted); padding: 8px 12px; }
  .brief-section[open] summary { border-bottom: 1px solid var(--gr-border); }
  .brief-avatar { display: flex; align-items: center; justify-content: center; }

  ${IMAGE_VIEWER_SHARED_CSS}

  .box-body .ghcc-inline-img-wrap {
    position: relative;
    display: inline-block;
    max-width: 100%;
    margin: 4px 0;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid var(--gr-border);
    background-color: var(--ghcc-checker-b);
    background-image:
      linear-gradient(45deg, var(--ghcc-checker-a) 25%, transparent 25%),
      linear-gradient(-45deg, var(--ghcc-checker-a) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, var(--ghcc-checker-a) 75%),
      linear-gradient(-45deg, transparent 75%, var(--ghcc-checker-a) 75%);
    background-size: 12px 12px;
    background-position: 0 0, 0 6px, 6px -6px, -6px 0;
    vertical-align: top;
    transition: border-color 0.12s ease;
  }
  .box-body .ghcc-inline-img-wrap:hover {
    border-color: var(--vscode-focusBorder, #007fd4);
  }
  .box-body .ghcc-inline-img-wrap img {
    display: block;
    max-width: 100%;
    max-height: 460px;
    width: auto;
    height: auto;
    cursor: pointer;
  }
  .ghcc-expand-hint {
    position: absolute;
    top: 8px;
    right: 8px;
    width: 26px;
    height: 26px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: rgba(20, 20, 22, 0.72);
    color: #ffffff;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.12s ease;
  }
  .ghcc-expand-hint svg { width: 14px; height: 14px; }
  .ghcc-inline-img-wrap:hover .ghcc-expand-hint,
  .ghcc-inline-img-wrap:focus-within .ghcc-expand-hint {
    opacity: 1;
  }

  .ghcc-lightbox {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: none;
    flex-direction: column;
    background: var(--ghcc-lightbox-scrim);
    backdrop-filter: blur(4px);
  }
  .ghcc-lightbox.open {
    display: flex;
  }
  .ghcc-lightbox [hidden] {
    display: none !important;
  }
  .lb-bar {
    height: 42px;
    flex: 0 0 42px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 0 14px;
    background: var(--ghcc-surface-elevated);
    border-bottom: 1px solid var(--gr-border);
    user-select: none;
  }
  .lb-left {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .lb-counter {
    font-family: var(--gr-mono);
    font-size: 11px;
    color: var(--gr-muted);
    padding: 2px 6px;
    border-radius: 4px;
    background: var(--vscode-textCodeBlock-background, rgba(128, 128, 128, 0.16));
    flex-shrink: 0;
  }
  .lb-caption {
    font-size: 12px;
    color: var(--vscode-foreground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lb-dim {
    font-family: var(--gr-mono);
    font-size: 11px;
    color: var(--gr-muted);
    white-space: nowrap;
    flex-shrink: 0;
  }
  .lb-tools {
    display: flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
  }
  .lb-stage {
    flex: 1;
    min-height: 0;
    position: relative;
    overflow: hidden;
    cursor: grab;
    user-select: none;
    touch-action: none;
  }
  .lb-stage.panning { cursor: grabbing; }
  .ghcc-lightbox .ghcc-btn {
    height: 26px;
    min-width: 26px;
    padding: 0 6px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
    color: var(--vscode-foreground);
    font-size: 12px;
  }
  .ghcc-lightbox .ghcc-btn:hover:not(:disabled) {
    background: var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.31));
  }
  .ghcc-lightbox .ghcc-btn:active:not(:disabled),
  .ghcc-lightbox .ghcc-btn[aria-pressed="true"] {
    background: var(--vscode-toolbar-activeBackground, rgba(99, 102, 103, 0.38));
  }
  .ghcc-lightbox .ghcc-btn[aria-pressed="true"] {
    border-color: var(--gr-border);
  }
  .ghcc-lightbox .ghcc-btn:disabled {
    opacity: 0.4;
  }
  .ghcc-lightbox .ghcc-swatch {
    width: 18px;
    height: 18px;
    padding: 0;
    border-radius: 3px;
    border: 1px solid var(--gr-border);
  }
  .ghcc-lightbox .ghcc-swatch[data-bg="checker"] {
    background-image:
      linear-gradient(45deg, #b8b8be 25%, transparent 25%),
      linear-gradient(-45deg, #b8b8be 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #b8b8be 75%),
      linear-gradient(-45deg, transparent 75%, #b8b8be 75%);
    background-color: #f0f0f2;
    background-size: 8px 8px;
    background-position: 0 0, 0 4px, 4px -4px, -4px 0;
  }
  .ghcc-lightbox .ghcc-swatch[data-bg="light"] {
    background: #f5f5f7;
  }
  .ghcc-lightbox .ghcc-swatch[data-bg="dark"] {
    background: #141416;
  }
  .ghcc-lightbox .ghcc-swatch[aria-pressed="true"] {
    border-color: var(--vscode-focusBorder, #007fd4);
    box-shadow: 0 0 0 1px var(--vscode-focusBorder, #007fd4);
  }
  .ghcc-lightbox .lb-nav {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 36px;
    height: 52px;
    padding: 0;
    border-radius: 6px;
    border: 1px solid var(--gr-border);
    background: var(--ghcc-surface-elevated);
    color: var(--vscode-foreground);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    opacity: 0.78;
    z-index: 10;
    transition: opacity 0.12s ease;
  }
  .ghcc-lightbox .lb-nav:hover {
    opacity: 1;
    background: var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.31));
  }
  .ghcc-lightbox .lb-nav.prev { left: 14px; }
  .ghcc-lightbox .lb-nav.next { right: 14px; }
  .ghcc-lightbox .lb-nav svg { width: 18px; height: 18px; }
`;

function htmlDocument(nonce: string, body: string, script = ""): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
  <style>${BASE_STYLE}</style>
</head>
<body>
${body}
${script}
</body>
</html>`;
}

export function renderMessageHtml(message: string, nonce: string): string {
  return htmlDocument(nonce, `<p>${escapeHtml(message)}</p>`);
}

export function formatRelativeDate(isoDate: string, now: number): string {
  const ageInDays = Math.floor((now - new Date(isoDate).getTime()) / 86_400_000);
  if (ageInDays <= 0) {
    return "today";
  }
  if (ageInDays === 1) {
    return "yesterday";
  }
  return `${ageInDays} days ago`;
}

function renderAvatar(avatarUrl: string, author: string): string {
  if (!avatarUrl) {
    return `<span class="avatar" role="img" aria-label="${escapeHtml(author)}"></span>`;
  }
  return `<img class="avatar" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(author)}">`;
}

function renderBriefButton(brief?: IBriefState): string {
  if (!brief || brief.status === "unavailable") {
    return "";
  }
  // a fresh done summary is disabled by design: it's a snapshot of the head commit — a new
  // push flags it stale and re-enables the button; error stays enabled for retries too
  const isFreshDone = brief.status === "done" && !brief.stale;
  const disabled = brief.status === "pending" || isFreshDone ? " disabled" : "";
  let title = "";
  if (isFreshDone) {
    title = ' title="Already summarized — new commits re-enable it"';
  } else if (brief.status === "done") {
    title = ' title="New commits since this summary — click to regenerate"';
  }
  return `<button id="brief"${disabled}${title}>✨ Brief me</button>`;
}

// dedicated row under the state pill — future action buttons land here too
function renderHeaderActions(brief?: IBriefState): string {
  const briefButton = renderBriefButton(brief);
  if (!briefButton) {
    return "";
  }
  return `
    <div class="header-actions">${briefButton}</div>`;
}

// escape first, then style paired backticks and ** bold **: the wrapped content is
// already-escaped text, so a hostile payload inside the markers stays inert. Bold is the most
// common slip past the "backticks only" prompt contract — absorb it rather than fight the model.
function formatBriefInline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

// the system prompt constrains the model to '## ' title lines and '- ' bullets, but models
// reliably slip past it: other heading depths ('#'..'######'), '*'/'+' bullets, '1.' numbered
// lists, backtick code and '**bold**'. The walker absorbs those markers rather than fighting the
// model; everything is escaped, so model output stays inert. Underscore/single-'*' italics are
// deliberately NOT parsed — they collide with snake_case identifiers common in a code summary.
function renderBriefText(text: string): string {
  const parts: string[] = [];
  let listItems: string[] = [];
  let listTag: "ul" | "ol" = "ul";
  function flushList(): void {
    if (listItems.length > 0) {
      parts.push(`<${listTag}>${listItems.join("")}</${listTag}>`);
      listItems = [];
    }
  }
  function pushListItem(tag: "ul" | "ol", item: string): void {
    if (listTag !== tag) {
      flushList();
      listTag = tag;
    }
    listItems.push(`<li>${formatBriefInline(item)}</li>`);
  }
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushList();
      parts.push(`<div class="brief-heading">${formatBriefInline(heading[1])}</div>`);
      continue;
    }
    const bulletItem = /^[-*+]\s+(.*)$/.exec(trimmed);
    if (bulletItem) {
      pushListItem("ul", bulletItem[1]);
      continue;
    }
    const numberedItem = /^\d+\.\s+(.*)$/.exec(trimmed);
    if (numberedItem) {
      pushListItem("ol", numberedItem[1]);
      continue;
    }
    flushList();
    parts.push(`<p>${formatBriefInline(trimmed)}</p>`);
  }
  flushList();
  return parts.join("");
}

function renderBriefSection(brief?: IBriefState): string {
  if (!brief || brief.status === "idle" || brief.status === "unavailable") {
    return "";
  }
  let content: string;
  if (brief.status === "pending") {
    content = "Summarizing…";
  } else if (brief.status === "error") {
    content = `<span class="brief-error">${escapeHtml(brief.text ?? "")}</span>`;
  } else {
    content = renderBriefText(brief.text ?? "");
  }
  // stylized starburst evoking the Claude mark (not the trademarked asset), inline SVG:
  // part of the document, so the nonce-only CSP is untouched. Lives inside <summary>
  // because everything else in a closed <details> is hidden with it
  const providerAvatar =
    '<span class="avatar brief-avatar" aria-hidden="true">' +
    '<svg viewBox="0 0 24 24" width="16" height="16"><g stroke="#D97757" stroke-width="3" stroke-linecap="round">' +
    '<line x1="12" y1="3" x2="12" y2="21"/><line x1="4.2" y1="7.5" x2="19.8" y2="16.5"/><line x1="19.8" y1="7.5" x2="4.2" y2="16.5"/>' +
    "</g></svg></span>";
  const staleTag = brief.stale ? '<span class="brief-stale-tag">outdated</span>' : "";
  const staleBanner = brief.stale
    ? '<div class="brief-stale">⚠ New commits were pushed since this summary — it may be outdated. Click ✨ Brief me to regenerate.</div>'
    : "";
  return `
  <details open class="box brief-section">
    <summary>${providerAvatar}Summary${staleTag}</summary>
    <div class="box-body brief-body">${staleBanner}${content}</div>
  </details>`;
}

// GitHub octicons (copy / check), inline SVG: part of the document, so the nonce-only CSP is untouched
const COPY_ICON_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>';
const CHECK_ICON_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 1.06-1.06l2.72 2.72 6.72-6.72a.751.751 0 0 1 1.06 0Z"/></svg>';
const BRANCH_ICON_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z"/></svg>';

function renderHeader(details: IPrDetails, brief?: IBriefState): string {
  const pill = details.state === "OPEN" && details.isDraft ? { css: "draft", label: "Draft" } : PILLS[details.state];
  const repoUrl = details.url.replace(/\/pull\/\d+$/, "");
  return `
  <header class="pr-header">
    <div class="repo-line">
      <a href="${escapeHtml(repoUrl)}">${escapeHtml(details.repo)}</a>
      · <a href="${escapeHtml(details.url)}">Open on GitHub</a>
    </div>
    <h1>${escapeHtml(details.title)} <span class="pr-number">#${details.number}</span></h1>
    <div>
      <span class="state-pill ${pill.css}">${pill.label}</span>
      <span class="merge-sentence">
        <strong>${escapeHtml(details.author)}</strong> wants to merge ${details.commitsCount} ${details.commitsCount === 1 ? "commit" : "commits"}
        into <span class="branch">${escapeHtml(details.baseRefName)}</span>
        from <span class="branch" id="head-branch">${escapeHtml(details.headRefName)}</span><button id="copy-branch" class="branch-action" data-tooltip="Copy branch name" aria-label="Copy branch name"><span class="copy-icon">${COPY_ICON_SVG}</span><span class="copied-icon">${CHECK_ICON_SVG}</span></button>${details.state === "OPEN" ? `<button id="checkout-branch" class="branch-action" data-tooltip="Checkout branch" aria-label="Checkout branch">${BRANCH_ICON_SVG}</button>` : ""}
      </span>
    </div>${renderHeaderActions(brief)}
  </header>`;
}

const PILLS: Record<IPrDetails["state"], { css: string; label: string }> = {
  OPEN: { css: "open", label: "Open" },
  MERGED: { css: "merged", label: "Merged" },
  CLOSED: { css: "closed", label: "Closed" },
};

function renderDescription(details: IPrDetails, now: number): string {
  return `
  <div class="box">
    ${renderAvatar(details.authorAvatarUrl, details.author)}
    <div class="box-header">
      <span><span class="author">${escapeHtml(details.author)}</span> opened ${formatRelativeDate(details.createdAt, now)}</span>
    </div>
    <div class="box-body">${details.bodyHtml || `<em>No description provided.</em>`}</div>
  </div>`;
}

// consecutive commits collapse into one avatar + list (GitHub-style) so a push burst stays compact
function renderTimeline(items: IPrTimelineItem[], prUrl: string, now: number): string {
  const rendered: string[] = [];
  let commitRun: IPrTimelineItem[] = [];
  const flushCommitRun = () => {
    if (commitRun.length > 0) {
      rendered.push(renderCommitGroup(commitRun, now));
      commitRun = [];
    }
  };
  for (const item of items) {
    if (item.kind === "commit") {
      const isNewAuthorRun = commitRun.length > 0 && commitRun[commitRun.length - 1].author !== item.author;
      if (isNewAuthorRun) {
        flushCommitRun();
      }
      commitRun.push(item);
      continue;
    }
    flushCommitRun();
    rendered.push(renderTimelineItem(item, prUrl, now));
  }
  flushCommitRun();
  return rendered.join("");
}

function renderCommitGroup(commits: IPrTimelineItem[], now: number): string {
  const [first] = commits;
  const lastCommit = commits[commits.length - 1];
  const countLabel = commits.length === 1 ? "added a commit" : `added ${commits.length} commits`;
  const lines = commits
    .map(
      (commit) => `
      <div class="commit-line">
        <span class="commit-msg">${escapeHtml(commit.commitMessage ?? "")}</span>
        <a class="commit-sha" href="${escapeHtml(commit.commitUrl ?? "")}">${escapeHtml(commit.commitSha ?? "")}</a>
      </div>`,
    )
    .join("");
  return `
  <div class="commit-group">
    ${renderAvatar(first.avatarUrl, first.author)}
    <div class="commit-group-header"><span class="author">${escapeHtml(first.author)}</span> ${countLabel} ${formatRelativeDate(lastCommit.createdAt, now)}</div>
    ${lines}
  </div>`;
}

function renderTimelineItem(item: IPrTimelineItem, prUrl: string, now: number): string {
  const action = item.kind === "review" ? (REVIEW_STATE_LABELS[item.reviewState ?? ""] ?? "reviewed") : "commented";
  const reviewClass = item.kind === "review" ? ` review-${escapeHtml(item.reviewState ?? "")}` : "";
  const icon = item.kind === "review" ? (REVIEW_STATE_ICONS[item.reviewState ?? ""] ?? "●") : REVIEW_STATE_ICONS.COMMENTED;
  const iconClass = item.kind === "review" && item.reviewState ? ` ${escapeHtml(item.reviewState)}` : "";
  const hasBody = item.bodyHtml !== "";
  const codeComments =
    item.codeCommentsCount && item.codeCommentsCount > 0
      ? `<div class="code-comments"><a href="${escapeHtml(prUrl)}/files">${item.codeCommentsCount} ${item.codeCommentsCount === 1 ? "comment" : "comments"} on files</a></div>`
      : "";
  return `
  <div class="box${reviewClass}${hasBody ? "" : " no-body"}">
    ${renderAvatar(item.avatarUrl, item.author)}
    <div class="box-header">
      <span><span class="review-icon${iconClass}">${icon}</span> <span class="author">${escapeHtml(item.author)}</span> ${action} ${formatRelativeDate(item.createdAt, now)}</span>
    </div>
    ${hasBody ? `<div class="box-body">${item.bodyHtml}</div>` : ""}
    ${codeComments}
  </div>`;
}

// buckets mirror GitHub's own statusCheckRollup semantics (the same rollup the sidebar consumes):
// cancelled/action-required block a merge as "not successful", stale awaits re-evaluation.
// Green is NOT the default bucket — states outside both Sets render as in progress, so an
// unknown/future GitHub state can never silently report "All checks passed".
const FAILING_CHECK_STATES = new Set(["FAILURE", "ERROR", "TIMED_OUT", "STARTUP_FAILURE", "CANCELLED", "ACTION_REQUIRED"]);
const PASSED_CHECK_STATES = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);

function renderMergeBox(details: IPrDetails, defaultUpdateMethod: UpdateBranchMethod): string {
  const decision = details.reviewDecision ? (REVIEW_DECISION_LABELS[details.reviewDecision] ?? details.reviewDecision) : "● No review required";
  const decisionClass = details.reviewDecision === "APPROVED" ? "ok" : details.reviewDecision === "CHANGES_REQUESTED" ? "ko" : "neutral";

  const truncatedChecksCount = details.checksTotal - details.checks.length;
  const failedChecksCount = details.checks.filter((check) => FAILING_CHECK_STATES.has(check.status)).length;
  const inProgressChecksCount = details.checks.filter((check) => !FAILING_CHECK_STATES.has(check.status) && !PASSED_CHECK_STATES.has(check.status)).length;
  let checksSummary: string;
  let checksClass: string;
  if (details.checks.length === 0) {
    checksSummary = "● No checks";
    checksClass = "neutral";
  } else if (failedChecksCount > 0) {
    checksSummary = `✗ ${failedChecksCount} failing ${failedChecksCount === 1 ? "check" : "checks"}`;
    checksClass = "ko";
  } else if (inProgressChecksCount > 0) {
    checksSummary = `● ${inProgressChecksCount} ${inProgressChecksCount === 1 ? "check" : "checks"} in progress`;
    checksClass = "pending";
  } else {
    checksSummary = "✓ All checks passed";
    checksClass = "ok";
  }
  const checksList = details.checks
    .map((check) => {
      const name = check.url ? `<a href="${escapeHtml(check.url)}">${escapeHtml(check.name)}</a>` : escapeHtml(check.name);
      return `<li class="check-${escapeHtml(check.status)}">${name}</li>`;
    })
    .join("");
  const moreChecks = truncatedChecksCount > 0 ? `<li>+${truncatedChecksCount} more on GitHub</li>` : "";

  const mergeableClass = details.mergeable === "MERGEABLE" ? "ok" : details.mergeable === "CONFLICTING" ? "ko" : "neutral";

  const isOpen = details.state === "OPEN";
  const canMerge = isOpen && !details.isDraft && details.mergeMethods.length > 0;
  const canMarkReady = isOpen && details.isDraft && details.viewerDidAuthor;
  const methodOptions = details.mergeMethods
    .map((method) => `<option value="${method}">${MERGE_METHOD_LABELS[method]}</option>`)
    .join("");

  const updateMethodsInOrder: UpdateBranchMethod[] = defaultUpdateMethod === "MERGE" ? ["MERGE", "REBASE"] : ["REBASE", "MERGE"];
  const updateMethodOptions = updateMethodsInOrder
    .map((method) => `<option value="${method}">${UPDATE_METHOD_LABELS[method]}</option>`)
    .join("");
  const updateBranchRow =
    isOpen && details.isBehindBase
      ? `<div class="row merge-actions">
          <span class="neutral">This branch is out-of-date with the base branch</span>
          <button id="update-branch">Update branch</button>
          <select id="update-method" aria-label="Update method">${updateMethodOptions}</select>
        </div>`
      : "";

  const actionButtons: string[] = [];
  if (isOpen) {
    actionButtons.push(`<button id="checkout">Checkout branch</button>`);
  }
  if (canMarkReady) {
    actionButtons.push(`<button id="ready" class="btn-approve">Ready for review</button>`);
  }
  if (canMerge) {
    actionButtons.push(`<button id="merge" class="btn-merge">Merge pull request</button><select id="merge-method" aria-label="Merge method">${methodOptions}</select>`);
  }
  const mergeActions = actionButtons.length > 0 ? `<div class="row merge-actions">${actionButtons.join("")}</div>` : "";

  return `
  <div class="merge-box">
    <div class="row ${decisionClass}">${decision}</div>
    <div class="row ${checksClass}">${checksSummary}${checksList ? `<ul>${checksList}${moreChecks}</ul>` : ""}</div>
    <div class="row ${mergeableClass}">${MERGEABLE_LABELS[details.mergeable]}</div>
    ${updateBranchRow}
    ${mergeActions}
  </div>`;
}

function renderComposer(details: IPrDetails): string {
  const canReview = !details.viewerDidAuthor && details.state === "OPEN";
  const approveDisabled = !details.canApprove;
  const approveAttrs = approveDisabled ? ` disabled title="You already approved this Pull Request"` : "";
  const reviewButtons = canReview
    ? `<button id="request-changes" class="btn-danger">Request changes</button>
       <button id="approve" class="btn-approve"${approveAttrs}>Approve</button>`
    : "";
  const pendingCount = details.pendingReviewCommentCount;
  const pendingActions = canReview ? "Comment, Approve or Request changes" : "Comment";
  const draftCountLabel = pendingCount === 1 ? "1 draft comment" : `${pendingCount} draft comments`;
  // a pending review can outlive its last draft: only mention drafts when there are some
  const draftSuffix = pendingCount === 0 ? "" : ` with ${draftCountLabel}`;
  const pendingHint =
    pendingCount === null
      ? ""
      : `<div class="neutral">You have a pending review${draftSuffix} — ${pendingActions} will submit it.</div>`;
  return `
  <div class="composer">
    ${pendingHint}
    <textarea id="composer-text" placeholder="Leave a comment"></textarea>
    <div class="buttons">
      ${reviewButtons}
      <button id="comment">Comment</button>
    </div>
  </div>`;
}

function renderSidebar(details: IPrDetails): string {
  const reviewers = details.reviewers
    .map(
      (reviewer) =>
        `<li><span>${escapeHtml(reviewer.name)}</span><span class="reviewer-state ${escapeHtml(reviewer.state)}${reviewer.isStale ? " stale" : ""}">${REVIEW_STATE_ICONS[reviewer.state] ?? "●"} ${escapeHtml(reviewer.state.toLowerCase().replaceAll("_", " "))}${reviewer.isStale ? " · stale" : ""}</span></li>`,
    )
    .join("");

  const labels = details.labels
    .map((label) => {
      const isValidColor = /^[0-9a-fA-F]{6}$/.test(label.color);
      const color = isValidColor ? `#${label.color}` : "var(--gr-muted)";
      const style = `background: color-mix(in srgb, ${color} 22%, transparent); color: ${color}; border: 1px solid color-mix(in srgb, ${color} 45%, transparent);`;
      return `<span class="label-pill" style="${style}">${escapeHtml(label.name)}</span>`;
    })
    .join("");

  return `
  <aside class="sidebar">
    <section>
      <h2>Reviewers</h2>
      ${reviewers ? `<ul>${reviewers}</ul>` : `<span class="neutral">No reviewers yet</span>`}
    </section>
    <section>
      <h2>Labels</h2>
      ${labels || `<span class="neutral">None</span>`}
    </section>
    <section>
      <h2>Files changed</h2>
      <div class="stats-line">
        <a href="${escapeHtml(details.url)}/files">${details.changedFiles} ${details.changedFiles === 1 ? "file" : "files"}</a> ·
        <span class="diffstat"><span class="add">+${details.additions}</span> <span class="del">−${details.deletions}</span></span>
      </div>
    </section>
  </aside>`;
}

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/gi, (_match, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

// bodyHTML is already sanitized by GitHub. Match complete tags so quoted attributes and
// code samples cannot be mistaken for an image tag or a src attribute.
export function normalizeBodyImages(html: string, fileRoot: string): string {
  return html.replace(/<!--[\s\S]*?-->|<[a-z][\w:-]*(?=[\s/>])(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi, (tag) => {
    if (!/^<(?:img|source)(?=[\s/>])/i.test(tag)) {
      return tag;
    }
    return tag.replace(/(\s+)([^\s=/>]+)(\s*=\s*)("([^"]*)"|'([^']*)'|([^\s>]+))/g,
      (attr, space: string, name: string, equals: string, _quoted, double: string | undefined, single: string | undefined, bare: string) => {
        const attribute = name.toLowerCase();
        if (attribute !== "src" && attribute !== "srcset") {
          return attr;
        }
        const value = decodeHtmlEntities(double ?? single ?? bare);
        const normalized = attribute === "src" ? normalizeImageUrl(value, fileRoot) : normalizeSrcset(value, fileRoot);
        return `${space}${name}${equals}"${escapeHtml(normalized)}"`;
      });
  });
}

function normalizeImageUrl(src: string, fileRoot: string): string {
  const value = src.trim();
  if (!value) {
    return value;
  }
  if (/^data:/i.test(value)) {
    const comma = value.indexOf(",");
    const payload = value.slice(comma + 1);
    const size = /;base64$/i.test(value.slice(0, comma))
      ? Math.floor((payload.length - (payload.match(/={1,2}$/)?.[0].length ?? 0)) * 3 / 4)
      : Buffer.byteLength(payload.replace(/%[\da-f]{2}/gi, "_"));
    return size > MAX_IMAGE_BYTES ? "data:," : value;
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) {
    return value;
  }
  try {
    const url = new URL(value, "https://github.com/");
    return value.startsWith("/") ? url.href : fileRoot + url.pathname.slice(1) + url.search + url.hash;
  } catch {
    return value;
  }
}

function normalizeSrcset(value: string, fileRoot: string): string {
  const candidates: string[] = [];
  let rest = value;
  for (;;) {
    // As in HTML's srcset parser, commas inside URL tokens (including data URLs) belong
    // to the URL. Trailing commas or commas following a descriptor end a candidate.
    rest = rest.replace(/^[\s,]+/, "");
    const token = /^\S+/.exec(rest)?.[0];
    if (!token) {
      return candidates.join(", ");
    }
    rest = rest.slice(token.length);
    const url = token.replace(/,+$/, "");
    const end = rest.indexOf(",");
    const descriptor = token === url ? (end < 0 ? rest : rest.slice(0, end)).trim() : "";
    if (token === url) {
      rest = end < 0 ? "" : rest.slice(end + 1);
    }
    const normalized = normalizeImageUrl(url, fileRoot);
    candidates.push(descriptor ? `${normalized} ${descriptor}` : normalized);
  }
}

// GitHub ships each ```mermaid fence as a <section> rendered by its own site JS (dead in a webview).
// The diagram source in data-json is HTML-encoded TWICE: once for the attribute, once inside the payload.
// We swap the section for a plain <pre> with the fully decoded source — always readable, even unrendered —
// and the webview bootstrap upgrades it to an inline SVG.
function replaceMermaidSections(html: string): string {
  return html.replace(/<section[^>]*data-type="mermaid"[\s\S]*?<\/section>/g, (section) => {
    const jsonAttribute = section.match(/data-json="([^"]*)"/);
    if (!jsonAttribute) {
      return section;
    }
    try {
      const payload = JSON.parse(decodeHtmlEntities(jsonAttribute[1])) as { data?: string };
      const source = decodeHtmlEntities(payload.data ?? "");
      if (!source) {
        return section;
      }
      return `<div class="gcc-mermaid"><pre>${escapeHtml(source)}</pre></div>`;
    } catch {
      return section;
    }
  });
}

function renderMermaidSupport(details: IPrDetails, nonce: string, mermaidScriptUri: string | undefined): { scriptTag: string; bootstrap: string } {
  const bodies = [details.bodyHtml, ...details.timeline.map((item) => item.bodyHtml)];
  const hasMermaid = bodies.some((html) => html.includes('class="gcc-mermaid"'));
  if (!hasMermaid || !mermaidScriptUri) {
    return { scriptTag: "", bootstrap: "" };
  }
  // bundled mermaid, loaded lazily from the extension (no CDN: CSP stays nonce-only, PR content stays local)
  const bootstrap = `
    const isDarkTheme = document.body.classList.contains("vscode-dark") || document.body.classList.contains("vscode-high-contrast");
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: isDarkTheme ? "dark" : "default" });
    document.querySelectorAll(".gcc-mermaid").forEach(async (container, index) => {
      const sourceElement = container.querySelector("pre");
      if (!sourceElement) {
        return;
      }
      const renderId = "gccMermaid" + index;
      try {
        const rendered = await mermaid.render(renderId, sourceElement.textContent);
        container.innerHTML = rendered.svg;
        container.classList.add("mermaid-diagram");
      } catch {
        // mermaid leaves its error artwork in the document on failure: remove it, keep the readable source
        for (const strayId of [renderId, "d" + renderId]) {
          const strayElement = document.getElementById(strayId);
          if (strayElement) {
            strayElement.remove();
          }
        }
      }
    });`;
  return { scriptTag: `<script nonce="${nonce}" src="${escapeHtml(mermaidScriptUri)}"></script>`, bootstrap };
}

export function renderPrDetailsHtml(
  details: IPrDetails,
  nonce: string,
  now: number,
  mermaidScriptUri?: string,
  defaultUpdateMethod: UpdateBranchMethod = "REBASE",
  brief?: IBriefState,
  pixelated = true,
): string {
  const fileRoot = gitHubFileRoot(details.headRepo, details.headRefOid, "raw");
  const processBody = (html: string) => normalizeBodyImages(replaceMermaidSections(html), fileRoot);
  const processedDetails: IPrDetails = {
    ...details,
    bodyHtml: processBody(details.bodyHtml),
    timeline: details.timeline.map((item) => ({ ...item, bodyHtml: processBody(item.bodyHtml) })),
  };
  const timelineItems = renderTimeline(processedDetails.timeline, processedDetails.url, now);
  const olderLink = processedDetails.timelineTruncated ? `<a class="older-link" href="${escapeHtml(processedDetails.url)}">View older conversation on GitHub</a>` : "";
  const mermaidSupport = renderMermaidSupport(processedDetails, nonce, mermaidScriptUri);

  const strings = DEFAULT_IMAGE_VIEWER_STRINGS;
  const body = `
  ${renderHeader(processedDetails, brief)}
  <div class="layout">
    <main>
      ${renderBriefSection(brief)}
      <div class="timeline">
        ${renderDescription(processedDetails, now)}
        ${timelineItems}
      </div>
      ${olderLink}
      ${renderMergeBox(processedDetails, defaultUpdateMethod)}
      ${renderComposer(processedDetails)}
    </main>
    ${renderSidebar(processedDetails)}
  </div>
  <div class="ghcc-lightbox" id="ghcc-lightbox" role="dialog" aria-modal="true" aria-label="${escapeHtml(strings.imageLightbox)}">
    <div class="lb-bar">
      <div class="lb-left">
        <span class="lb-counter" id="lb-counter" hidden></span>
        <span class="lb-caption" id="lb-caption"></span>
        <span class="lb-dim" id="lb-dim"></span>
      </div>
      <div class="lb-tools">
        ${renderBackdropSwatches("lb-swatches", strings)}
        <span class="ghcc-sep"></span>
        ${renderZoomToolbarControls("lb", strings, pixelated)}
        <span class="ghcc-sep"></span>
        <a class="ghcc-btn" id="lb-github" href="${escapeHtml(processedDetails.url)}" target="_blank" rel="noreferrer" aria-label="${escapeHtml(strings.openGitHub)}" data-tooltip="${escapeHtml(strings.openGitHub)}">${IMAGE_VIEWER_ICONS.externalLink}</a>
        <button class="ghcc-btn" type="button" id="lb-close" aria-label="${escapeHtml(strings.close)}" data-tooltip="${escapeHtml(strings.close)}" data-tooltip-align="right">${IMAGE_VIEWER_ICONS.close}</button>
      </div>
    </div>
    <div class="lb-stage ghcc-surface${pixelated ? " pixelated" : ""}" id="lb-stage" data-bg="checker">
      <button class="lb-nav prev" id="lb-prev" type="button" aria-label="${escapeHtml(strings.previous)}" hidden>${IMAGE_VIEWER_ICONS.prev}</button>
      <img class="canvas-img" id="lb-img" alt="">
      <button class="lb-nav next" id="lb-next" type="button" aria-label="${escapeHtml(strings.next)}" hidden>${IMAGE_VIEWER_ICONS.next}</button>
    </div>
  </div>`;

  const script = `
  <script nonce="${nonce}">
    const vscodeApi = acquireVsCodeApi();
    const prKey = ${safeJsonForScript(`${processedDetails.repo}#${processedDetails.number}`)};
    const prUrl = ${safeJsonForScript(processedDetails.url)};
    const EXPAND_ICON_SVG = ${safeJsonForScript(IMAGE_VIEWER_ICONS.expand)};
    const composerText = document.getElementById("composer-text");
    const allButtons = Array.from(document.querySelectorAll("button")).filter((button) => !button.closest?.(".ghcc-lightbox"));
    const requestedImages = new WeakSet();
    const failingImages = new Map();

    ${IMAGE_VIEWER_CONTROLLER_SCRIPT}

    function showImageFallback(image, url, message) {
      const placeholder = document.createElement("span");
      placeholder.className = "image-fallback";
      const link = document.createElement("a");
      link.href = url || prUrl;
      link.textContent = "Open on GitHub";
      placeholder.append((message || "Could not load this image.") + " ", link);
      const target = image.closest(".ghcc-inline-img-wrap") || image.closest("picture") || image;
      const parent = target.parentElement;
      if (parent?.matches("a") && parent.children.length === 1 && !parent.textContent.trim()) {
        parent.replaceWith(placeholder);
      } else {
        target.replaceWith(placeholder);
      }
    }

    function resolveFailedImage(image) {
      if (!(image instanceof HTMLImageElement) || !image.closest(".timeline .box-body") || requestedImages.has(image)) {
        return;
      }
      requestedImages.add(image);
      const src = image.currentSrc || image.getAttribute("src") || "";
      if (/^data:/i.test(src)) {
        showImageFallback(image, prUrl, src === "data:," ? "The image exceeds the 10 MB preview limit." : undefined);
        return;
      }
      const requestId = crypto.randomUUID();
      failingImages.set(requestId, image);
      vscodeApi.postMessage({ command: "resolveImage", src, requestId });
    }

    function resolveSafeExternalUrl(image) {
      const anchor = image.closest?.("a");
      const anchorHref = anchor?.getAttribute?.("href") || "";
      if (/^https?:\\/\\//i.test(anchorHref)) {
        return anchorHref;
      }
      const imgSrc = image.getAttribute?.("src") || image.currentSrc || "";
      if (/^https?:\\/\\//i.test(imgSrc)) {
        return imgSrc;
      }
      return prUrl;
    }

    const lbEl = document.getElementById("ghcc-lightbox");
    const lbStage = document.getElementById("lb-stage");
    const lbImg = document.getElementById("lb-img");
    const lbCounter = document.getElementById("lb-counter");
    const lbCaption = document.getElementById("lb-caption");
    const lbDim = document.getElementById("lb-dim");
    const lbZoomVal = document.getElementById("lb-zoom-val");
    const lbGithub = document.getElementById("lb-github");
    const lbPrev = document.getElementById("lb-prev");
    const lbNext = document.getElementById("lb-next");
    const lbPixelBtn = document.getElementById("lb-pixel");
    const lbCloseBtn = document.getElementById("lb-close");
    const lbZoomInBtn = document.getElementById("lb-zoom-in");
    const lbZoomOutBtn = document.getElementById("lb-zoom-out");
    const lbFitBtn = document.getElementById("lb-fit");
    const lbSwatches = Array.from(document.querySelectorAll("#lb-swatches .ghcc-swatch"));

    const lbState = { items: [], index: 0, bg: "checker", pixelated: ${Boolean(pixelated)} };
    let lbCtrl = null;

    function collectLightboxImages() {
      return Array.from(document.querySelectorAll(".timeline .box-body .ghcc-inline-img-wrap img"))
        .filter((img) => img.isConnected && img.naturalWidth > 0);
    }

    function closeLightbox() {
      if (lbEl) {
        lbEl.classList.remove("open");
      }
    }

    function showLightboxIndex(index) {
      if (!lbEl || !lbStage || !lbImg || !lbCtrl || lbState.items.length === 0) {
        return;
      }
      lbState.index = ((index % lbState.items.length) + lbState.items.length) % lbState.items.length;
      const item = lbState.items[lbState.index];
      lbEl.classList.add("open");
      const multi = lbState.items.length > 1;
      if (lbCounter) {
        lbCounter.textContent = (lbState.index + 1) + " / " + lbState.items.length;
        lbCounter.hidden = !multi;
      }
      if (lbPrev) {
        lbPrev.hidden = !multi;
      }
      if (lbNext) {
        lbNext.hidden = !multi;
      }
      if (lbCaption) {
        lbCaption.textContent = item.alt || "";
      }
      if (lbGithub) {
        lbGithub.href = item.href;
      }
      lbStage.classList.toggle("pixelated", lbState.pixelated);
      lbPixelBtn?.setAttribute("aria-pressed", String(lbState.pixelated));

      const onReady = () => {
        const nw = lbImg.naturalWidth || item.w || 0;
        const nh = lbImg.naturalHeight || item.h || 0;
        if (nw > 0 && nh > 0) {
          lbImg.width = nw;
          lbImg.height = nh;
          if (lbDim) {
            lbDim.textContent = nw + "×" + nh;
          }
        } else if (lbDim) {
          lbDim.textContent = "";
        }
        lbCtrl.fit();
      };
      lbImg.onload = onReady;
      lbImg.alt = item.alt || "";
      lbImg.src = item.src;
      if (lbImg.complete && lbImg.naturalWidth > 0) {
        onReady();
      }
    }

    function openLightboxForImage(clickedImg) {
      if (!lbEl || !lbStage || !lbImg || !lbCtrl) {
        return;
      }
      const images = collectLightboxImages();
      const idx = images.indexOf(clickedImg);
      if (idx < 0) {
        return;
      }
      lbState.items = images.map((img) => ({
        src: img.currentSrc || img.getAttribute("src") || "",
        alt: img.alt || "",
        href: resolveSafeExternalUrl(img),
        w: img.naturalWidth,
        h: img.naturalHeight,
      }));
      showLightboxIndex(idx);
    }

    if (lbEl && lbStage && lbImg) {
      lbCtrl = createImageTransformController({
        getViewportRect: () => lbStage.getBoundingClientRect(),
        getRefSize: () => {
          const nw = lbImg.naturalWidth || lbImg.width;
          const nh = lbImg.naturalHeight || lbImg.height;
          return nw && nh ? { w: nw, h: nh } : null;
        },
        onUpdate: (st) => {
          const tx = lbState.pixelated ? Math.round(st.tx) : st.tx;
          const ty = lbState.pixelated ? Math.round(st.ty) : st.ty;
          lbImg.style.transform = "translate(" + tx + "px, " + ty + "px) translate(-50%, -50%) scale(" + st.scale + ")";
          lbImg.style.setProperty("--ghcc-scale", String(st.scale));
          if (lbZoomVal) {
            lbZoomVal.textContent = Math.round(st.scale * 100) + "%";
          }
        },
      });
      lbCtrl.bindViewport(lbStage);

      lbSwatches.forEach((sw) => {
        sw.addEventListener("click", () => {
          lbState.bg = sw.dataset.bg;
          lbSwatches.forEach((b) => b.setAttribute("aria-pressed", String(b === sw)));
          lbStage.dataset.bg = lbState.bg;
        });
      });
      lbZoomInBtn?.addEventListener("click", () => lbCtrl.stepZoom(1));
      lbZoomOutBtn?.addEventListener("click", () => lbCtrl.stepZoom(-1));
      lbFitBtn?.addEventListener("click", () => lbCtrl.fit());
      lbZoomVal?.addEventListener("click", () => lbCtrl.toggleFitOneToOne());
      lbPixelBtn?.addEventListener("click", () => {
        lbState.pixelated = !lbState.pixelated;
        lbPixelBtn.setAttribute("aria-pressed", String(lbState.pixelated));
        lbStage.classList.toggle("pixelated", lbState.pixelated);
        if (lbEl.classList.contains("open")) {
          lbCtrl.refitIfFitted();
        }
        vscodeApi.postMessage({ command: "setPixelated", value: lbState.pixelated });
      });
      lbCloseBtn?.addEventListener("click", closeLightbox);
      lbPrev?.addEventListener("click", () => showLightboxIndex(lbState.index - 1));
      lbNext?.addEventListener("click", () => showLightboxIndex(lbState.index + 1));
      let stagePointerDown = null;
      lbStage.addEventListener("pointerdown", (event) => {
        stagePointerDown = { x: event.clientX, y: event.clientY };
      });
      lbStage.addEventListener("click", (event) => {
        const down = stagePointerDown;
        stagePointerDown = null;
        if (event.target !== lbStage || lbCtrl.consumeJustDragged()) {
          return;
        }
        if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) >= GHCC_DRAG_THRESHOLD) {
          return;
        }
        const rect = lbImg.getBoundingClientRect();
        const onImage =
          rect.width > 0 &&
          rect.height > 0 &&
          event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom;
        if (!onImage) {
          closeLightbox();
        }
      });

      document.addEventListener("keydown", (event) => {
        if (!lbEl.classList.contains("open") || event.metaKey || event.ctrlKey || event.altKey) {
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          closeLightbox();
        } else if (event.key === "ArrowLeft") {
          if (lbState.items.length > 1) {
            event.preventDefault();
            showLightboxIndex(lbState.index - 1);
          }
        } else if (event.key === "ArrowRight") {
          if (lbState.items.length > 1) {
            event.preventDefault();
            showLightboxIndex(lbState.index + 1);
          }
        } else if (event.key === "+" || event.key === "=") {
          event.preventDefault();
          lbCtrl.stepZoom(1);
        } else if (event.key === "-") {
          event.preventDefault();
          lbCtrl.stepZoom(-1);
        } else if (event.key === "0") {
          event.preventDefault();
          lbCtrl.fit();
        } else if (event.key === "1") {
          event.preventDefault();
          lbCtrl.setZoom(1);
        } else if (event.key === "p" || event.key === "P") {
          event.preventDefault();
          lbPixelBtn?.click();
        }
      });

      window.addEventListener("resize", () => {
        if (lbEl.classList.contains("open")) {
          lbCtrl.refitIfFitted();
        }
      });
    }

    function enhanceInlineImage(image) {
      if (
        !(image instanceof HTMLImageElement) ||
        !image.isConnected ||
        !image.closest?.(".timeline .box-body") ||
        image.closest?.(".ghcc-inline-img-wrap")
      ) {
        return;
      }
      if (!image.complete || image.naturalWidth === 0) {
        return;
      }
      if (image.naturalHeight > 0 && image.naturalHeight <= 36 && image.naturalWidth <= 200) {
        return;
      }
      const wrapTarget = image.closest?.("picture") || image;
      const parent = wrapTarget.parentNode;
      if (!parent) {
        return;
      }
      const wrap = document.createElement("span");
      wrap.className = "ghcc-inline-img-wrap";
      parent.insertBefore(wrap, wrapTarget);
      wrap.appendChild(wrapTarget);

      const hint = document.createElement("span");
      hint.className = "ghcc-expand-hint";
      hint.setAttribute("aria-hidden", "true");
      hint.innerHTML = EXPAND_ICON_SVG;
      wrap.appendChild(hint);

      wrap.addEventListener("click", (event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
          return;
        }
        event.preventDefault();
        openLightboxForImage(image);
      });
    }

    document.addEventListener("error", (event) => resolveFailedImage(event.target), true);
    document.querySelectorAll(".timeline .box-body img").forEach((image) => {
      if (image.complete && image.naturalWidth === 0 && (image.currentSrc || image.getAttribute("src"))) {
        resolveFailedImage(image);
      } else if (image.complete && image.naturalWidth > 0) {
        enhanceInlineImage(image);
      } else {
        image.addEventListener("load", () => enhanceInlineImage(image), { once: true });
      }
    });

    // reenable must restore exactly what send froze: buttons rendered disabled by design
    // (brief pending/done) stay disabled when a confirmation is cancelled or a mutation fails
    let frozenButtons = [];
    function send(message) {
      frozenButtons = allButtons.filter((button) => !button.disabled);
      frozenButtons.forEach((button) => { button.disabled = true; });
      vscodeApi.postMessage(message);
    }

    function wire(id, buildMessage) {
      const button = document.getElementById(id);
      if (button) {
        button.addEventListener("click", () => send(buildMessage()));
      }
      return button;
    }

    const commentButton = wire("comment", () => ({ command: "comment", text: composerText.value }));
    const requestChangesButton = wire("request-changes", () => ({ command: "review", event: "REQUEST_CHANGES", text: composerText.value }));
    wire("approve", () => ({ command: "review", event: "APPROVE", text: composerText.value }));
    wire("merge", () => ({ command: "merge", method: document.getElementById("merge-method").value }));
    wire("ready", () => ({ command: "readyForReview" }));
    wire("update-branch", () => ({ command: "updateBranch", method: document.getElementById("update-method").value }));
    wire("checkout", () => ({ command: "checkout" }));
    wire("checkout-branch", () => ({ command: "checkout" }));

    // the branch name never leaves the webview: copied via the clipboard API, no message posted
    const copyBranchButton = document.getElementById("copy-branch");
    if (copyBranchButton) {
      let copiedResetTimer;
      copyBranchButton.addEventListener("click", () => {
        navigator.clipboard.writeText(document.getElementById("head-branch").textContent).then(() => {
          copyBranchButton.classList.add("copied");
          clearTimeout(copiedResetTimer);
          copiedResetTimer = setTimeout(() => copyBranchButton.classList.remove("copied"), 1500);
        });
      });
    }

    // brief is read-only and re-renders on its own: wired outside send() so a click
    // does not freeze the composer and the other action buttons. Its self-disable is not part
    // of frozenButtons, so a reenable (no silent render possible) must restore it separately.
    let briefClickPending = false;
    const briefButton = document.getElementById("brief");
    if (briefButton) {
      briefButton.addEventListener("click", () => {
        briefButton.disabled = true;
        briefClickPending = true;
        vscodeApi.postMessage({ command: "brief" });
      });
    }

    function syncComposerButtons() {
      const hasText = composerText.value.trim().length > 0;
      // a pending review submits on Comment even with an empty summary: the drafts carry the content
      commentButton.disabled = !hasText && ${processedDetails.pendingReviewCommentCount === null};
      if (requestChangesButton) {
        requestChangesButton.disabled = !hasText;
      }
      return hasText;
    }
    // the extension skips background panel refreshes while the composer holds text,
    // so a poll re-render never wipes a draft comment
    let composerHadText = false;
    composerText.addEventListener("input", () => {
      const hasText = syncComposerButtons();
      if (hasText !== composerHadText) {
        composerHadText = hasText;
        vscodeApi.postMessage({ command: "composerState", hasText });
      }
    });
    syncComposerButtons();

    // full HTML replaces (background refresh, post-mutation re-render) reset the scroll and
    // re-open the brief <details>: restore both when the same PR renders again
    const savedState = vscodeApi.getState();
    const sameSavedPr = savedState && savedState.prKey === prKey;
    if (sameSavedPr && typeof savedState.scrollY === "number") {
      window.scrollTo(0, savedState.scrollY);
    }
    const briefDetails = document.querySelector(".brief-section");
    if (briefDetails && sameSavedPr && savedState.briefCollapsed) {
      briefDetails.open = false;
    }
    function saveViewState() {
      vscodeApi.setState({ prKey, scrollY: window.scrollY, briefCollapsed: briefDetails ? !briefDetails.open : false });
    }
    if (briefDetails) {
      briefDetails.addEventListener("toggle", saveViewState);
    }
    let scrollSaveTimer;
    window.addEventListener("scroll", () => {
      if (scrollSaveTimer) {
        return;
      }
      scrollSaveTimer = setTimeout(() => {
        scrollSaveTimer = undefined;
        saveViewState();
      }, 200);
    });

    // the extension re-enables the buttons when a confirmation is cancelled or a mutation fails,
    // so the typed comment survives instead of being wiped by a full re-render
    window.addEventListener("message", (event) => {
      if (event.data?.command === "imageResolved") {
        const { requestId, dataUri, url, message } = event.data;
        const image = failingImages.get(requestId);
        failingImages.delete(requestId);
        if (!image?.isConnected) {
          return;
        }
        if (!dataUri) {
          showImageFallback(image, url, message);
          return;
        }
        image.addEventListener("error", () => showImageFallback(image, url), { once: true });
        image.addEventListener("load", () => enhanceInlineImage(image), { once: true });
        image.closest("picture")?.querySelectorAll("source").forEach((source) => source.remove());
        image.removeAttribute("srcset");
        image.src = dataUri;
        if (image.complete && image.naturalWidth > 0) {
          enhanceInlineImage(image);
        }
        return;
      }
      if (event.data && event.data.command === "reenable") {
        frozenButtons.forEach((button) => { button.disabled = false; });
        frozenButtons = [];
        // restore the brief button only when a click is what disabled it (never a done/pending render)
        if (briefClickPending && briefButton) {
          briefButton.disabled = false;
        }
        briefClickPending = false;
        syncComposerButtons();
      }
    });
${mermaidSupport.bootstrap}
  </script>`;

  return htmlDocument(nonce, body, mermaidSupport.scriptTag + script);
}
