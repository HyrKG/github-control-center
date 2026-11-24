import type { IBriefState, IPrDetails, IPrTimelineItem, UpdateBranchMethod } from "../core/types";
import type { IPrDetailsStrings } from "./PrDetailsStrings";

// text glyphs (not emoji, except the comment bubble) so theme colors apply via CSS
const REVIEW_STATE_ICONS: Record<string, string> = {
  APPROVED: "✓",
  CHANGES_REQUESTED: "↻",
  COMMENTED: "💬",
  DISMISSED: "●",
  PENDING: "●",
  REQUESTED: "●",
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
  .brief-section summary { cursor: pointer; font-weight: 600; color: var(--gr-muted); padding: 8px 12px; }
  .brief-section[open] summary { border-bottom: 1px solid var(--gr-border); }
  .brief-avatar { display: flex; align-items: center; justify-content: center; }
`;

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Escape the translated sentence before inserting markup with already-escaped values.
function renderSentence(template: string, ...parts: string[]): string {
  return escapeHtml(template).replace(/\{(\d+)\}/g, (placeholder, index: string) => parts[Number(index)] ?? placeholder);
}

function htmlDocument(nonce: string, body: string, lang: string, script = ""): string {
  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
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

export function renderMessageHtml(message: string, nonce: string, lang: string): string {
  return htmlDocument(nonce, `<p>${escapeHtml(message)}</p>`, lang);
}

function formatRelativeDate(isoDate: string, now: number, strings: IPrDetailsStrings): string {
  const ageInDays = Math.floor((now - new Date(isoDate).getTime()) / 86_400_000);
  if (ageInDays <= 0) {
    return strings.today;
  }
  if (ageInDays === 1) {
    return strings.yesterday;
  }
  return strings.daysAgo(ageInDays);
}

function renderAvatar(avatarUrl: string, author: string): string {
  if (!avatarUrl) {
    return `<span class="avatar" role="img" aria-label="${escapeHtml(author)}"></span>`;
  }
  return `<img class="avatar" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(author)}">`;
}

function renderBriefButton(strings: IPrDetailsStrings, brief?: IBriefState): string {
  if (!brief || brief.status === "unavailable") {
    return "";
  }
  // a fresh done summary is disabled by design: it's a snapshot of the head commit — a new
  // push flags it stale and re-enables the button; error stays enabled for retries too
  const isFreshDone = brief.status === "done" && !brief.stale;
  const disabled = brief.status === "pending" || isFreshDone ? " disabled" : "";
  let title = "";
  if (isFreshDone) {
    title = ` title="${escapeHtml(strings.briefDone)}"`;
  } else if (brief.status === "done") {
    title = ` title="${escapeHtml(strings.briefStale)}"`;
  }
  return `<button id="brief"${disabled}${title}>${escapeHtml(strings.briefMe)}</button>`;
}

// dedicated row under the state pill — future action buttons land here too
function renderHeaderActions(strings: IPrDetailsStrings, brief?: IBriefState): string {
  const briefButton = renderBriefButton(strings, brief);
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

function renderBriefSection(strings: IPrDetailsStrings, brief?: IBriefState): string {
  if (!brief || brief.status === "idle" || brief.status === "unavailable") {
    return "";
  }
  let content: string;
  if (brief.status === "pending") {
    content = escapeHtml(strings.summarizing);
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
  const staleTag = brief.stale ? `<span class="brief-stale-tag">${escapeHtml(strings.briefOutdated)}</span>` : "";
  const staleBanner = brief.stale
    ? `<div class="brief-stale">${escapeHtml(strings.briefStaleBanner)}</div>`
    : "";
  return `
  <details open class="box brief-section">
    <summary>${providerAvatar}${escapeHtml(strings.summary)}${staleTag}</summary>
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

function renderHeader(details: IPrDetails, strings: IPrDetailsStrings, brief?: IBriefState): string {
  const isDraft = details.state === "OPEN" && details.isDraft;
  const pillClass = isDraft ? "draft" : PILL_CLASSES[details.state];
  const pillLabel = isDraft ? strings.draft : strings.prStates[details.state];
  const mergeSentence = details.commitsCount === 1 ? strings.mergeOne : strings.mergeMany;
  const checkout = details.state === "OPEN"
    ? `<button id="checkout-branch" class="branch-action" data-tooltip="${escapeHtml(strings.checkoutBranch)}" aria-label="${escapeHtml(strings.checkoutBranch)}">${BRANCH_ICON_SVG}</button>`
    : "";
  const head = `<span class="branch" id="head-branch">${escapeHtml(details.headRefName)}</span><button id="copy-branch" class="branch-action" data-tooltip="${escapeHtml(strings.copyBranch)}" aria-label="${escapeHtml(strings.copyBranch)}"><span class="copy-icon">${COPY_ICON_SVG}</span><span class="copied-icon">${CHECK_ICON_SVG}</span></button>${checkout}`;
  const repoUrl = details.url.replace(/\/pull\/\d+$/, "");
  return `
  <header class="pr-header">
    <div class="repo-line">
      <a href="${escapeHtml(repoUrl)}">${escapeHtml(details.repo)}</a>
      · <a href="${escapeHtml(details.url)}">${escapeHtml(strings.openOnGitHub)}</a>
    </div>
    <h1>${escapeHtml(details.title)} <span class="pr-number">#${details.number}</span></h1>
    <div>
      <span class="state-pill ${pillClass}">${escapeHtml(pillLabel)}</span>
      <span class="merge-sentence">${renderSentence(
        mergeSentence("{0}", details.commitsCount, "{1}", "{2}"),
        `<strong>${escapeHtml(details.author)}</strong>`,
        `<span class="branch">${escapeHtml(details.baseRefName)}</span>`,
        head,
      )}</span>
    </div>${renderHeaderActions(strings, brief)}
  </header>`;
}

const PILL_CLASSES: Record<IPrDetails["state"], string> = {
  OPEN: "open",
  MERGED: "merged",
  CLOSED: "closed",
};

function renderDescription(details: IPrDetails, now: number, strings: IPrDetailsStrings): string {
  return `
  <div class="box">
    ${renderAvatar(details.authorAvatarUrl, details.author)}
    <div class="box-header">
      <span>${renderSentence(
        strings.opened("{0}", formatRelativeDate(details.createdAt, now, strings)),
        `<span class="author">${escapeHtml(details.author)}</span>`,
      )}</span>
    </div>
    <div class="box-body">${details.bodyHtml || `<em>${escapeHtml(strings.noDescription)}</em>`}</div>
  </div>`;
}

// consecutive commits collapse into one avatar + list (GitHub-style) so a push burst stays compact
function renderTimeline(items: IPrTimelineItem[], prUrl: string, now: number, strings: IPrDetailsStrings): string {
  const rendered: string[] = [];
  let commitRun: IPrTimelineItem[] = [];
  const flushCommitRun = () => {
    if (commitRun.length > 0) {
      rendered.push(renderCommitGroup(commitRun, now, strings));
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
    rendered.push(renderTimelineItem(item, prUrl, now, strings));
  }
  flushCommitRun();
  return rendered.join("");
}

function renderCommitGroup(commits: IPrTimelineItem[], now: number, strings: IPrDetailsStrings): string {
  const [first] = commits;
  const lastCommit = commits[commits.length - 1];
  const age = formatRelativeDate(lastCommit.createdAt, now, strings);
  const summary = commits.length === 1 ? strings.commitAdded("{0}", age) : strings.commitsAdded("{0}", commits.length, age);
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
    <div class="commit-group-header">${renderSentence(summary, `<span class="author">${escapeHtml(first.author)}</span>`)}</div>
    ${lines}
  </div>`;
}

function renderTimelineItem(item: IPrTimelineItem, prUrl: string, now: number, strings: IPrDetailsStrings): string {
  const action = item.kind === "review"
    ? strings.reviewTimeline.get(item.reviewState ?? "") ?? strings.timelineReviewed
    : strings.timelineCommented;
  const summary = action("{0}", formatRelativeDate(item.createdAt, now, strings));
  const reviewClass = item.kind === "review" ? ` review-${escapeHtml(item.reviewState ?? "")}` : "";
  const icon = item.kind === "review" ? (REVIEW_STATE_ICONS[item.reviewState ?? ""] ?? "●") : REVIEW_STATE_ICONS.COMMENTED;
  const iconClass = item.kind === "review" && item.reviewState ? ` ${escapeHtml(item.reviewState)}` : "";
  const hasBody = item.bodyHtml !== "";
  const codeComments =
    item.codeCommentsCount && item.codeCommentsCount > 0
      ? `<div class="code-comments"><a href="${escapeHtml(prUrl)}/files">${escapeHtml((item.codeCommentsCount === 1 ? strings.codeComment : strings.codeComments)(item.codeCommentsCount))}</a></div>`
      : "";
  return `
  <div class="box${reviewClass}${hasBody ? "" : " no-body"}">
    ${renderAvatar(item.avatarUrl, item.author)}
    <div class="box-header">
      <span><span class="review-icon${iconClass}">${icon}</span> ${renderSentence(summary, `<span class="author">${escapeHtml(item.author)}</span>`)}</span>
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

function renderMergeBox(details: IPrDetails, defaultUpdateMethod: UpdateBranchMethod, strings: IPrDetailsStrings): string {
  const decision = details.reviewDecision
    ? strings.reviewDecisions.get(details.reviewDecision) ?? details.reviewDecision
    : strings.noReviewRequired;
  const decisionClass = details.reviewDecision === "APPROVED" ? "ok" : details.reviewDecision === "CHANGES_REQUESTED" ? "ko" : "neutral";

  const truncatedChecksCount = details.checksTotal - details.checks.length;
  const failedChecksCount = details.checks.filter((check) => FAILING_CHECK_STATES.has(check.status)).length;
  const inProgressChecksCount = details.checks.filter((check) => !FAILING_CHECK_STATES.has(check.status) && !PASSED_CHECK_STATES.has(check.status)).length;
  let checksSummary: string;
  let checksClass: string;
  if (details.checks.length === 0) {
    checksSummary = strings.noChecks;
    checksClass = "neutral";
  } else if (failedChecksCount > 0) {
    checksSummary = (failedChecksCount === 1 ? strings.checkFailing : strings.checksFailing)(failedChecksCount);
    checksClass = "ko";
  } else if (inProgressChecksCount > 0) {
    checksSummary = (inProgressChecksCount === 1 ? strings.checkInProgress : strings.checksInProgress)(inProgressChecksCount);
    checksClass = "pending";
  } else {
    checksSummary = strings.checksPassed;
    checksClass = "ok";
  }
  const checksList = details.checks
    .map((check) => {
      const name = check.url ? `<a href="${escapeHtml(check.url)}">${escapeHtml(check.name)}</a>` : escapeHtml(check.name);
      return `<li class="check-${escapeHtml(check.status)}">${name}</li>`;
    })
    .join("");
  const moreChecks = truncatedChecksCount > 0 ? `<li>${escapeHtml(strings.moreChecks(truncatedChecksCount))}</li>` : "";

  const mergeableClass = details.mergeable === "MERGEABLE" ? "ok" : details.mergeable === "CONFLICTING" ? "ko" : "neutral";

  const isOpen = details.state === "OPEN";
  const canMerge = isOpen && !details.isDraft && details.mergeMethods.length > 0;
  const canMarkReady = isOpen && details.isDraft && details.viewerDidAuthor;
  const methodOptions = details.mergeMethods
    .map((method) => `<option value="${method}">${escapeHtml(strings.mergeMethods[method])}</option>`)
    .join("");

  const updateMethodsInOrder: UpdateBranchMethod[] = defaultUpdateMethod === "MERGE" ? ["MERGE", "REBASE"] : ["REBASE", "MERGE"];
  const updateMethodOptions = updateMethodsInOrder
    .map((method) => `<option value="${method}">${escapeHtml(strings.updateMethods[method])}</option>`)
    .join("");
  const updateBranchRow =
    isOpen && details.isBehindBase
      ? `<div class="row merge-actions">
          <span class="neutral">${escapeHtml(strings.branchBehind)}</span>
          <button id="update-branch">${escapeHtml(strings.updateBranch)}</button>
          <select id="update-method" aria-label="${escapeHtml(strings.updateMethod)}">${updateMethodOptions}</select>
        </div>`
      : "";

  const actionButtons: string[] = [];
  if (isOpen) {
    actionButtons.push(`<button id="checkout">${escapeHtml(strings.checkoutBranch)}</button>`);
  }
  if (canMarkReady) {
    actionButtons.push(`<button id="ready" class="btn-approve">${escapeHtml(strings.readyForReview)}</button>`);
  }
  if (canMerge) {
    actionButtons.push(`<button id="merge" class="btn-merge">${escapeHtml(strings.mergePr)}</button><select id="merge-method" aria-label="${escapeHtml(strings.mergeMethod)}">${methodOptions}</select>`);
  }
  const mergeActions = actionButtons.length > 0 ? `<div class="row merge-actions">${actionButtons.join("")}</div>` : "";

  return `
  <div class="merge-box">
    <div class="row ${decisionClass}">${escapeHtml(decision)}</div>
    <div class="row ${checksClass}">${escapeHtml(checksSummary)}${checksList ? `<ul>${checksList}${moreChecks}</ul>` : ""}</div>
    <div class="row ${mergeableClass}">${escapeHtml(strings.mergeability[details.mergeable])}</div>
    ${updateBranchRow}
    ${mergeActions}
  </div>`;
}

function renderComposer(details: IPrDetails, strings: IPrDetailsStrings): string {
  const canReview = !details.viewerDidAuthor && details.state === "OPEN";
  const approveDisabled = !details.canApprove;
  const approveAttrs = approveDisabled ? ` disabled title="${escapeHtml(strings.alreadyApproved)}"` : "";
  const reviewButtons = canReview
    ? `<button id="request-changes" class="btn-danger">${escapeHtml(strings.requestChanges)}</button>
       <button id="approve" class="btn-approve"${approveAttrs}>${escapeHtml(strings.approve)}</button>`
    : "";
  const pendingCount = details.pendingReviewCommentCount;
  const pendingActions = canReview ? strings.pendingReviewActions : strings.comment;
  // a pending review can outlive its last draft: only mention drafts when there are some
  let pendingHint = "";
  if (pendingCount !== null) {
    pendingHint = pendingCount === 0
      ? strings.pendingReview(pendingActions)
      : (pendingCount === 1 ? strings.pendingReviewWithDraft : strings.pendingReviewWithDrafts)(pendingCount, pendingActions);
  }
  return `
  <div class="composer">
    ${pendingHint ? `<div class="neutral">${escapeHtml(pendingHint)}</div>` : ""}
    <textarea id="composer-text" placeholder="${escapeHtml(strings.leaveComment)}"></textarea>
    <div class="buttons">
      ${reviewButtons}
      <button id="comment">${escapeHtml(strings.comment)}</button>
    </div>
  </div>`;
}

function reviewerStateLabel(state: string, strings: IPrDetailsStrings): string {
  return strings.reviewerStates.get(state) ?? state.toLowerCase().replaceAll("_", " ");
}

function renderSidebar(details: IPrDetails, strings: IPrDetailsStrings): string {
  const reviewers = details.reviewers.map((reviewer) => {
    const state = reviewerStateLabel(reviewer.state, strings);
    const label = reviewer.isStale ? strings.reviewerStale(state) : state;
    const icon = REVIEW_STATE_ICONS[reviewer.state] ?? "●";
    const stateClass = `${escapeHtml(reviewer.state)}${reviewer.isStale ? " stale" : ""}`;
    return `<li><span>${escapeHtml(reviewer.name)}</span><span class="reviewer-state ${stateClass}">${icon} ${escapeHtml(label)}</span></li>`;
  }).join("");

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
      <h2>${escapeHtml(strings.reviewers)}</h2>
      ${reviewers ? `<ul>${reviewers}</ul>` : `<span class="neutral">${escapeHtml(strings.noReviewers)}</span>`}
    </section>
    <section>
      <h2>${escapeHtml(strings.labels)}</h2>
      ${labels || `<span class="neutral">${escapeHtml(strings.none)}</span>`}
    </section>
    <section>
      <h2>${escapeHtml(strings.filesChanged)}</h2>
      <div class="stats-line">
        <a href="${escapeHtml(details.url)}/files">${escapeHtml((details.changedFiles === 1 ? strings.file : strings.files)(details.changedFiles))}</a> ·
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
  strings: IPrDetailsStrings,
  mermaidScriptUri?: string,
  defaultUpdateMethod: UpdateBranchMethod = "REBASE",
  brief?: IBriefState,
): string {
  const processedDetails: IPrDetails = {
    ...details,
    bodyHtml: replaceMermaidSections(details.bodyHtml),
    timeline: details.timeline.map((item) => ({ ...item, bodyHtml: replaceMermaidSections(item.bodyHtml) })),
  };
  const timelineItems = renderTimeline(processedDetails.timeline, processedDetails.url, now, strings);
  const olderLink = processedDetails.timelineTruncated ? `<a class="older-link" href="${escapeHtml(processedDetails.url)}">${escapeHtml(strings.olderConversation)}</a>` : "";
  const mermaidSupport = renderMermaidSupport(processedDetails, nonce, mermaidScriptUri);

  const body = `
  ${renderHeader(processedDetails, strings, brief)}
  <div class="layout">
    <main>
      ${renderBriefSection(strings, brief)}
      <div class="timeline">
        ${renderDescription(processedDetails, now, strings)}
        ${timelineItems}
      </div>
      ${olderLink}
      ${renderMergeBox(processedDetails, defaultUpdateMethod, strings)}
      ${renderComposer(processedDetails, strings)}
    </main>
    ${renderSidebar(processedDetails, strings)}
  </div>`;

  // the script only forwards user-typed text, the chosen merge method and a composer-has-text
  // boolean — never ids or urls; the prKey below stays inside the webview (setState only)
  const script = `
  <script nonce="${nonce}">
    const vscodeApi = acquireVsCodeApi();
    const prKey = ${JSON.stringify(`${processedDetails.repo}#${processedDetails.number}`)};
    const composerText = document.getElementById("composer-text");
    const allButtons = Array.from(document.querySelectorAll("button"));

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

  return htmlDocument(nonce, body, strings.lang, mermaidSupport.scriptTag + script);
}
