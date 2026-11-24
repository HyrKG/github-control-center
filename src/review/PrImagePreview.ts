import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import { FileTooLargeError, type IFileBytes } from "../github/github";
import { gitHubFileUrl } from "../github/fileUrls";
import { escapeHtml } from "../core/html";
import {
  changeTypeStatus,
  DEFAULT_IMAGE_VIEWER_STRINGS,
  IMAGE_VIEWER_CONTROLLER_SCRIPT,
  IMAGE_VIEWER_ICONS,
  IMAGE_VIEWER_SHARED_CSS,
  renderBackdropSwatches,
  renderZoomToolbarControls,
  safeJsonForScript,
  type IImageViewerStrings,
} from "../core/imageViewer";
import { MAX_IMAGE_BYTES, type FileChangeType } from "../core/types";

const IMAGE_TYPES = new Map([
  ["png", "image/png"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["gif", "image/gif"],
  ["webp", "image/webp"],
  ["ico", "image/x-icon"],
  ["bmp", "image/bmp"],
  ["avif", "image/avif"],
  ["svg", "image/svg+xml"],
]);
const IMAGE_MIMES = new Set([...IMAGE_TYPES.values(), "image/vnd.microsoft.icon"]);

export function imageMimeType(path: string, contentType?: string | null): string | undefined {
  const mime = contentType?.split(";")[0].trim().toLowerCase();
  if (mime && IMAGE_MIMES.has(mime)) {
    return mime;
  }
  return IMAGE_TYPES.get(/\.([a-z]+)$/i.exec(path)?.[1].toLowerCase() ?? "");
}

export function imageDataUri(path: string, file: IFileBytes): string | undefined {
  if (file.bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new FileTooLargeError();
  }
  const mime = imageMimeType(path, file.contentType);
  return mime && file.bytes.length ? `data:${mime};base64,${Buffer.from(file.bytes).toString("base64")}` : undefined;
}

export interface IImageSide {
  repo: string;
  sha: string;
  path: string;
  isEmpty: boolean;
}

export interface IImageChange {
  key: string;
  title: string;
  changeType: FileChangeType;
  left: IImageSide;
  right: IImageSide;
}

export type PreviewSideStatus = "loading" | "ready" | "toolarge" | "unsupported" | "error";

export interface IImagePreviewSideState {
  side: "base" | "head";
  label: string;
  path: string;
  url: string;
  status: PreviewSideStatus;
  dataUri?: string;
  size?: number;
  message?: string;
}

export interface IImagePreviewSnapshot {
  revision: string;
  changeType: FileChangeType;
  displayPath: string;
  isRenamed: boolean;
  sides: IImagePreviewSideState[];
}

interface IPanelEntry {
  panel: vscode.WebviewPanel;
  revision: string;
  snapshot: IImagePreviewSnapshot;
}

function cloneSnapshot(snapshot: IImagePreviewSnapshot): IImagePreviewSnapshot {
  return {
    ...snapshot,
    sides: snapshot.sides.map((side) => ({ ...side })),
  };
}

export interface IImagePixelatedPreference {
  get(): boolean;
  set(value: boolean): void;
}

export class PrImagePreview implements vscode.Disposable {
  private readonly panels = new Map<string, IPanelEntry>();
  private pixelated: boolean;

  constructor(
    private readonly readFile: (side: IImageSide) => Promise<IFileBytes>,
    private readonly strings: IImageViewerStrings = DEFAULT_IMAGE_VIEWER_STRINGS,
    private readonly preference?: IImagePixelatedPreference,
  ) {
    this.pixelated = preference ? preference.get() : true;
  }

  async open({ key, title, changeType, left, right }: IImageChange): Promise<void> {
    const existing = this.panels.get(key);
    if (existing) {
      existing.panel.reveal();
    }
    const revision = JSON.stringify([changeType, left, right]);
    if (existing?.revision === revision) {
      return;
    }

    const panel =
      existing?.panel ??
      vscode.window.createWebviewPanel("githubControlCenter.prImagePreview", title, vscode.ViewColumn.Active, {
        enableScripts: true,
        localResourceRoots: [],
      });
    panel.title = title;

    const activeSides = [
      { side: "base" as const, label: this.strings.base, source: left },
      { side: "head" as const, label: this.strings.head, source: right },
    ].filter(({ source }) => !source.isEmpty);

    const isRenamed = changeType === "RENAMED" && !left.isEmpty && !right.isEmpty && left.path !== right.path;
    const displayPath = isRenamed ? `${left.path} → ${right.path}` : (!right.isEmpty ? right.path : left.path);
    const snapshot: IImagePreviewSnapshot = {
      revision,
      changeType,
      displayPath,
      isRenamed,
      sides: activeSides.map(({ side, label, source }) => ({
        side,
        label,
        path: source.path,
        url: gitHubFileUrl({ repo: source.repo, ref: source.sha, path: source.path }),
        status: "loading",
        message: this.strings.loading,
      })),
    };

    const request: IPanelEntry = { panel, revision, snapshot };
    this.panels.set(key, request);

    if (!existing) {
      panel.webview.onDidReceiveMessage((message: unknown) => {
        const payload = message as { command?: string; value?: unknown } | null;
        if (payload?.command === "ready") {
          const current = this.panels.get(key);
          if (current && current.panel === panel) {
            void panel.webview.postMessage({ command: "state", snapshot: cloneSnapshot(current.snapshot) });
            void panel.webview.postMessage({ command: "pixelated", value: this.pixelated });
          }
          return;
        }
        if (payload?.command === "setPixelated" && typeof payload.value === "boolean") {
          this.pixelated = payload.value;
          this.preference?.set(payload.value);
          for (const entry of this.panels.values()) {
            if (entry.panel !== panel) {
              void entry.panel.webview.postMessage({ command: "pixelated", value: payload.value });
            }
          }
        }
      });
      panel.onDidDispose(() => {
        if (this.panels.get(key)?.panel === panel) {
          this.panels.delete(key);
        }
      });
    }

    panel.webview.html = renderImagePreviewHtml(snapshot, randomUUID(), this.strings, this.pixelated);

    await Promise.all(
      activeSides.map(async ({ source }, index) => {
        const loaded = await this.load(source);
        if (this.panels.get(key) !== request) {
          return;
        }
        request.snapshot.sides[index] = {
          ...request.snapshot.sides[index],
          ...loaded,
        };
        void panel.webview.postMessage({ command: "state", snapshot: cloneSnapshot(request.snapshot) });
      }),
    );
  }

  private async load(side: IImageSide): Promise<Pick<IImagePreviewSideState, "status" | "dataUri" | "size" | "message">> {
    try {
      const file = await this.readFile(side);
      const dataUri = imageDataUri(side.path, file);
      return dataUri
        ? { status: "ready", dataUri, size: file.bytes.byteLength, message: undefined }
        : { status: "unsupported", dataUri: undefined, size: undefined, message: this.strings.unsupported };
    } catch (error) {
      if (error instanceof FileTooLargeError) {
        return { status: "toolarge", dataUri: undefined, size: undefined, message: error.message };
      }
      return { status: "error", dataUri: undefined, size: undefined, message: this.strings.loadFailed };
    }
  }

  dispose(): void {
    for (const { panel } of this.panels.values()) {
      panel.dispose();
    }
  }
}

const PREVIEW_STYLE = `
  :root {
    --gr-green: var(--vscode-charts-green, #2ea043);
    --gr-red: var(--vscode-charts-red, #f85149);
    --gr-purple: var(--vscode-charts-purple, #8957e5);
    --gr-yellow: var(--vscode-charts-yellow, #d0a215);
    --gr-muted: var(--vscode-descriptionForeground, #9d9d9d);
    --gr-border: var(--vscode-panel-border, rgba(128, 128, 128, 0.35));
    --gr-box-bg: var(--vscode-editorWidget-background, transparent);
    --gr-mono: var(--vscode-editor-font-family, monospace);
  }
  * { box-sizing: border-box; }
  [hidden] { display: none !important; }
  html, body {
    margin: 0;
    padding: 0;
    height: 100%;
    font-family: var(--vscode-font-family);
    font-size: 13px;
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    line-height: 1.5;
    overflow: hidden;
    -webkit-font-smoothing: antialiased;
  }
  a { color: var(--vscode-textLink-foreground); text-decoration: none; }
  a:hover { text-decoration: underline; }
  a:focus-visible, button:focus-visible, [tabindex]:focus-visible {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: 1px;
  }

  ${IMAGE_VIEWER_SHARED_CSS}

  .pr-img-app {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--vscode-editor-background);
  }
  .pr-img-toolbar {
    height: 40px;
    flex: 0 0 40px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 0 12px;
    background: var(--ghcc-surface-elevated);
    border-bottom: 1px solid var(--gr-border);
    user-select: none;
  }
  .pr-img-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    flex: 1 1 auto;
  }
  .pr-img-path {
    font-family: var(--gr-mono);
    font-size: 12px;
    color: var(--vscode-foreground);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pr-img-stats {
    font-family: var(--gr-mono);
    font-size: 11px;
    color: var(--gr-muted);
    white-space: nowrap;
    flex-shrink: 0;
  }
  .pr-img-center {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
  .pr-img-tools {
    display: flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
  }
  .pr-img-stage-wrap {
    flex: 1;
    min-height: 0;
    position: relative;
    display: flex;
    background: var(--ghcc-canvas-bg);
  }

  .diff-split {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1px;
    background: var(--gr-border);
  }
  .diff-split.single-pane {
    grid-template-columns: 1fr;
  }
  .pane {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--vscode-editor-background);
  }
  .pane-head {
    height: 28px;
    flex: 0 0 28px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 0 10px;
    background: var(--ghcc-surface-elevated);
    border-bottom: 1px solid var(--gr-border);
    font-size: 11px;
    user-select: none;
  }
  .pane-head-left {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .side-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .side-dot.base { background: var(--gr-red); }
  .side-dot.head { background: var(--gr-green); }
  .pane-side-name {
    font-weight: 600;
    color: var(--vscode-foreground);
  }
  .pane-head-right {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--gr-muted);
    font-family: var(--gr-mono);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .pane-ext-link {
    color: var(--gr-muted);
    display: inline-flex;
    align-items: center;
    padding: 2px;
    border-radius: 3px;
  }
  .pane-ext-link:hover {
    color: var(--vscode-textLink-foreground);
    background: var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.31));
    text-decoration: none;
  }
  .pane-ext-link svg { width: 13px; height: 13px; }
  .pane-body {
    flex: 1;
    min-height: 0;
    position: relative;
    display: flex;
  }

  .canvas-vp {
    flex: 1;
    min-height: 0;
    position: relative;
    overflow: hidden;
    cursor: grab;
    user-select: none;
    touch-action: none;
  }
  .canvas-vp.panning { cursor: grabbing; }

  .swipe-stage {
    flex: 1;
    min-height: 0;
    position: relative;
    overflow: hidden;
    cursor: grab;
    user-select: none;
    touch-action: none;
  }
  .swipe-stage.panning { cursor: grabbing; }
  .swipe-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .swipe-badge {
    position: absolute;
    top: 10px;
    height: 22px;
    padding: 0 8px;
    border-radius: 4px;
    background: rgba(20, 20, 22, 0.72);
    color: #f3f3f3;
    border: 1px solid rgba(255, 255, 255, 0.14);
    font-size: 11px;
    font-weight: 500;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    pointer-events: none;
    backdrop-filter: blur(4px);
    z-index: 6;
  }
  .swipe-badge.left { left: 10px; }
  .swipe-badge.right { right: 10px; }
  .swipe-divider {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 24px;
    transform: translateX(-50%);
    cursor: ew-resize;
    z-index: 10;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .swipe-divider::before {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    left: 50%;
    width: 2px;
    transform: translateX(-50%);
    background: var(--vscode-focusBorder, #007fd4);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
  }
  .swipe-knob {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--vscode-editor-background);
    border: 1.5px solid var(--vscode-focusBorder, #007fd4);
    color: var(--vscode-foreground);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
    position: relative;
    z-index: 2;
  }
  .swipe-knob svg { width: 14px; height: 14px; }

  .state-empty {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: var(--ghcc-canvas-bg);
  }
  .state-card {
    max-width: 340px;
    padding: 20px 24px;
    border-radius: 6px;
    border: 1px solid var(--gr-border);
    background: var(--gr-box-bg);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    text-align: center;
  }
  .state-card svg {
    width: 24px;
    height: 24px;
    color: var(--gr-muted);
  }
  .state-card.error svg { color: var(--gr-red); }
  .state-card.warn svg { color: var(--gr-yellow); }
  .state-title {
    font-size: 13px;
    font-weight: 500;
    color: var(--vscode-foreground);
    margin: 0;
  }
  .state-action {
    height: 28px;
    padding: 0 12px;
    border-radius: 4px;
    background: var(--vscode-button-secondaryBackground, rgba(128, 128, 128, 0.25));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    font-size: 12px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    text-decoration: none;
  }
  .state-action:hover {
    background: var(--vscode-button-secondaryHoverBackground, rgba(128, 128, 128, 0.35));
    text-decoration: none;
  }
  @keyframes ghcc-spin {
    to { transform: rotate(360deg); }
  }
  .ghcc-spinner {
    width: 20px;
    height: 20px;
    border: 2px solid var(--gr-border);
    border-top-color: var(--vscode-focusBorder, #007fd4);
    border-radius: 50%;
    animation: ghcc-spin 0.8s linear infinite;
  }
`;

export function renderImagePreviewHtml(
  snapshot: IImagePreviewSnapshot,
  nonce: string,
  strings: IImageViewerStrings = DEFAULT_IMAGE_VIEWER_STRINGS,
  pixelated = true,
): string {
  const pill = changeTypeStatus(snapshot.changeType, strings);
  const defaultUrl =
    snapshot.sides.find((side) => side.side === "head")?.url ?? snapshot.sides[0]?.url ?? "#";

  const payload = safeJsonForScript({ snapshot, strings, pixelated: Boolean(pixelated) });
  const iconsJson = safeJsonForScript({
    externalLink: IMAGE_VIEWER_ICONS.externalLink,
    swipe: IMAGE_VIEWER_ICONS.swipe,
    alert: IMAGE_VIEWER_ICONS.alert,
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-${escapeHtml(nonce)}';">
  <title>PR image preview</title>
  <style>${PREVIEW_STYLE}</style>
</head>
<body>
  <div class="pr-img-app">
    <header class="pr-img-toolbar">
      <div class="pr-img-meta">
        <span class="ghcc-pill ${pill.css}" id="a-pill">${escapeHtml(pill.label)}</span>
        <span class="pr-img-path" id="a-path" title="${escapeHtml(snapshot.displayPath)}">${escapeHtml(snapshot.displayPath)}</span>
        <span class="pr-img-stats" id="a-stats"></span>
      </div>

      <div class="pr-img-center" id="a-diff-modes" hidden>
        <div class="ghcc-seg" role="group" aria-label="${escapeHtml(strings.diffViewMode)}">
          <button type="button" data-mode="split" aria-pressed="true">${escapeHtml(strings.modeSplit)}</button>
          <button type="button" data-mode="swipe" aria-pressed="false" disabled>${escapeHtml(strings.modeSwipe)}</button>
          <button type="button" data-mode="single" aria-pressed="false">${escapeHtml(strings.modeToggle)}</button>
        </div>
        <div class="ghcc-seg" id="a-side-toggle" hidden>
          <button type="button" data-side="base" aria-pressed="false">${escapeHtml(strings.base)}</button>
          <button type="button" data-side="head" aria-pressed="true">${escapeHtml(strings.head)}</button>
        </div>
      </div>

      <div class="pr-img-tools">
        ${renderBackdropSwatches("a-swatches", strings)}
        <span class="ghcc-sep"></span>
        ${renderZoomToolbarControls("a", strings, pixelated)}
        <span class="ghcc-sep"></span>
        <a class="ghcc-btn" id="a-github" href="${escapeHtml(defaultUrl)}" target="_blank" rel="noreferrer" aria-label="${escapeHtml(strings.openGitHub)}" data-tooltip="${escapeHtml(strings.openGitHub)}" data-tooltip-align="right">${IMAGE_VIEWER_ICONS.externalLink}</a>
      </div>
    </header>

    <main class="pr-img-stage-wrap" id="a-stage-wrap">
      <div class="state-empty">
        <div class="state-card">
          <div class="ghcc-spinner"></div>
          <p class="state-title">${escapeHtml(strings.loading)}</p>
        </div>
      </div>
    </main>
  </div>

  <script nonce="${escapeHtml(nonce)}">
    (() => {
      "use strict";
      const vscodeApi = acquireVsCodeApi();
      const BOOT = ${payload};
      const ICONS = ${iconsJson};
      const STRINGS = BOOT.strings;

      ${IMAGE_VIEWER_CONTROLLER_SCRIPT}

      const stageWrap = document.getElementById("a-stage-wrap");
      const pillEl = document.getElementById("a-pill");
      const pathEl = document.getElementById("a-path");
      const statsEl = document.getElementById("a-stats");
      const diffModesEl = document.getElementById("a-diff-modes");
      const sideToggleEl = document.getElementById("a-side-toggle");
      const zoomOutBtn = document.getElementById("a-zoom-out");
      const zoomValBtn = document.getElementById("a-zoom-val");
      const zoomInBtn = document.getElementById("a-zoom-in");
      const fitBtn = document.getElementById("a-fit");
      const pixelBtn = document.getElementById("a-pixel");
      const githubLink = document.getElementById("a-github");
      const modeButtons = Array.from(document.querySelectorAll("#a-diff-modes [data-mode]"));
      const swipeModeBtn = modeButtons.find((btn) => btn.dataset.mode === "swipe");
      const sideButtons = Array.from(document.querySelectorAll("#a-side-toggle [data-side]"));
      const swatchButtons = Array.from(document.querySelectorAll("#a-swatches .ghcc-swatch"));

      const STATUS_MAP = {
        ADDED: ["added", STRINGS.statusAdded],
        MODIFIED: ["modified", STRINGS.statusModified],
        DELETED: ["deleted", STRINGS.statusDeleted],
        RENAMED: ["renamed", STRINGS.statusRenamed],
        COPIED: ["copied", STRINGS.statusCopied],
        CHANGED: ["changed", STRINGS.statusChanged],
      };

      const state = {
        snapshot: BOOT.snapshot,
        mode: "split",
        activeSide: "head",
        bg: "checker",
        pixelated: Boolean(BOOT.pixelated),
        swipePct: 50,
        dims: Object.create(null),
        layoutKind: "",
        imgs: [],
        viewports: [],
        splitPanes: Object.create(null),
        singleView: null,
        swipeBadges: null,
      };

      function getSide(sideName) {
        return state.snapshot.sides.find((s) => s.side === sideName) || null;
      }

      function hasTwoSides() {
        return state.snapshot.sides.length === 2;
      }

      function readySides() {
        return state.snapshot.sides.filter((s) => s.status === "ready");
      }

      function bothReady() {
        return hasTwoSides() && state.snapshot.sides.every((s) => s.status === "ready");
      }

      function activeSingleSide() {
        if (hasTwoSides()) {
          return getSide(state.activeSide) || state.snapshot.sides[0] || null;
        }
        return state.snapshot.sides[0] || null;
      }

      function isActiveCanvasReady() {
        if (readySides().length === 0) {
          return false;
        }
        if (hasTwoSides() && state.mode === "single") {
          return activeSingleSide()?.status === "ready";
        }
        return true;
      }

      function sideStatusKey(side) {
        return [side.status, side.dataUri || "", side.size ?? "", side.message || "", side.url].join("|");
      }

      function formatSideMeta(side) {
        const d = state.dims[side.side];
        const parts = [];
        if (d) {
          parts.push(d.w + "×" + d.h);
        }
        if (side.size != null) {
          parts.push(formatImageBytes(side.size));
        }
        return parts.join(" · ");
      }

      function createStateCard(status, message, url) {
        const wrap = document.createElement("div");
        wrap.className = "state-empty";
        const card = document.createElement("div");
        card.className = "state-card" + (status === "error" ? " error" : status === "toolarge" ? " warn" : "");
        if (status === "loading") {
          const spinner = document.createElement("div");
          spinner.className = "ghcc-spinner";
          const title = document.createElement("p");
          title.className = "state-title";
          title.textContent = message || STRINGS.loading;
          card.append(spinner, title);
        } else {
          const iconHolder = document.createElement("span");
          iconHolder.innerHTML = ICONS.alert;
          const title = document.createElement("p");
          title.className = "state-title";
          title.textContent = message || STRINGS.loadFailed;
          card.append(iconHolder.firstElementChild || iconHolder, title);
          if (url && /^https?:\\/\\//i.test(url)) {
            const action = document.createElement("a");
            action.className = "state-action";
            action.href = url;
            action.target = "_blank";
            action.rel = "noreferrer";
            action.textContent = STRINGS.openGitHub + " ↗";
            card.append(action);
          }
        }
        wrap.appendChild(card);
        return wrap;
      }

      function applyTransform(st) {
        const tx = state.pixelated ? Math.round(st.tx) : st.tx;
        const ty = state.pixelated ? Math.round(st.ty) : st.ty;
        const tf = "translate(" + tx + "px, " + ty + "px) translate(-50%, -50%) scale(" + st.scale + ")";
        state.imgs.forEach((img) => {
          img.style.transform = tf;
          img.style.setProperty("--ghcc-scale", String(st.scale));
        });
        zoomValBtn.textContent = isActiveCanvasReady() ? Math.round(st.scale * 100) + "%" : "—";
      }

      const ctrl = createImageTransformController({
        getViewportRect: () => state.viewports.find((vp) => !vp.hidden)?.getBoundingClientRect() || state.viewports[0]?.getBoundingClientRect() || null,
        getRefSize: () => {
          if (!isActiveCanvasReady()) {
            return null;
          }
          if (hasTwoSides() && state.mode === "single") {
            const side = activeSingleSide();
            return side ? state.dims[side.side] || null : null;
          }
          let maxW = 0;
          let maxH = 0;
          readySides().forEach((side) => {
            const d = state.dims[side.side];
            if (d) {
              maxW = Math.max(maxW, d.w);
              maxH = Math.max(maxH, d.h);
            }
          });
          return maxW > 0 && maxH > 0 ? { w: maxW, h: maxH } : null;
        },
        onUpdate: applyTransform,
      });

      function updateMetaDisplays() {
        const snap = state.snapshot;
        const statusInfo = STATUS_MAP[snap.changeType] || STATUS_MAP.MODIFIED;
        pillEl.className = "ghcc-pill " + statusInfo[0];
        pillEl.textContent = statusInfo[1];
        pathEl.textContent = snap.displayPath;
        pathEl.title = snap.displayPath;

        const ready = readySides();
        const canDiff = hasTwoSides() && ready.length > 0;
        if (!bothReady() && state.mode === "swipe") {
          state.mode = "split";
        }
        diffModesEl.hidden = !canDiff;
        if (swipeModeBtn) {
          swipeModeBtn.disabled = !bothReady();
        }
        modeButtons.forEach((btn) => btn.setAttribute("aria-pressed", String(btn.dataset.mode === state.mode)));
        sideToggleEl.hidden = !(canDiff && state.mode === "single");
        sideButtons.forEach((btn) => btn.setAttribute("aria-pressed", String(btn.dataset.side === state.activeSide)));

        const activeReady = isActiveCanvasReady();
        [zoomOutBtn, zoomValBtn, zoomInBtn, fitBtn, pixelBtn].forEach((btn) => {
          btn.disabled = !activeReady;
        });
        if (!activeReady) {
          zoomValBtn.textContent = "—";
        }

        const preferredSide =
          hasTwoSides() && state.mode === "single"
            ? activeSingleSide()
            : getSide("head") || getSide("base");
        githubLink.href = preferredSide?.url || "#";

        if (ready.length === 0) {
          statsEl.textContent = "";
        } else if (hasTwoSides()) {
          const base = getSide("base");
          const head = getSide("head");
          if (base?.status === "ready" && head?.status === "ready") {
            const bd = state.dims.base;
            const hd = state.dims.head;
            const delta = (head.size ?? 0) - (base.size ?? 0);
            const deltaText = (delta > 0 ? "+" : "") + formatImageBytes(delta);
            if (state.mode === "split") {
              const dimDiff = bd && hd && (bd.w !== hd.w || bd.h !== hd.h) ? bd.w + "×" + bd.h + " → " + hd.w + "×" + hd.h + " · " : "";
              statsEl.textContent = dimDiff + deltaText;
            } else if (state.mode === "swipe") {
              const dimText =
                bd && hd
                  ? (bd.w === hd.w && bd.h === hd.h ? hd.w + "×" + hd.h : bd.w + "×" + bd.h + " → " + hd.w + "×" + hd.h)
                  : "";
              statsEl.textContent = [dimText, formatImageBytes(head.size) + " (" + deltaText + ")"].filter(Boolean).join(" · ");
            } else {
              const active = activeSingleSide();
              statsEl.textContent = active ? formatSideMeta(active) : "";
            }
          } else {
            statsEl.textContent = formatSideMeta(ready[0]);
          }
        } else {
          statsEl.textContent = formatSideMeta(snap.sides[0]);
        }

        // Update pane headers & swipe badges with freshly known natural dimensions
        Object.keys(state.splitPanes).forEach((sideName) => {
          const ref = state.splitPanes[sideName];
          const side = getSide(sideName);
          if (ref && side && ref.headMeta) {
            ref.headMeta.textContent = side.status === "ready" ? formatSideMeta(side) : "";
          }
        });
        if (state.singleView) {
          const active = activeSingleSide();
          if (active) {
            state.singleView.dot.className = "side-dot " + active.side;
            state.singleView.label.textContent = active.label;
            state.singleView.meta.textContent = active.status === "ready" ? formatSideMeta(active) : "";
            state.singleView.link.href = active.url;
          }
        }
        if (state.swipeBadges) {
          const bd = state.dims.base;
          const hd = state.dims.head;
          state.swipeBadges.leftText.textContent = STRINGS.base + (bd ? " · " + bd.w + "×" + bd.h : "");
          state.swipeBadges.rightText.textContent = STRINGS.head + (hd ? " · " + hd.w + "×" + hd.h : "");
        }
      }

      function createCanvasImg(side, onLoaded) {
        const img = document.createElement("img");
        img.className = "canvas-img";
        img.alt = side.path;
        img.draggable = false;
        const handleLoad = () => {
          const nw = img.naturalWidth;
          const nh = img.naturalHeight;
          if (nw > 0 && nh > 0) {
            img.width = nw;
            img.height = nh;
            state.dims[side.side] = { w: nw, h: nh };
          }
          onLoaded();
        };
        img.addEventListener("load", handleLoad);
        img.src = side.dataUri || "";
        if (img.complete && img.naturalWidth > 0) {
          handleLoad();
        }
        return img;
      }

      function updateMetaDisplays() {

      function createPaneHeader(side) {
        const head = document.createElement("div");
        head.className = "pane-head";

        const leftBox = document.createElement("div");
        leftBox.className = "pane-head-left";
        const dot = document.createElement("span");
        dot.className = "side-dot " + side.side;
        const name = document.createElement("span");
        name.className = "pane-side-name";
        name.textContent = side.label;
        leftBox.append(dot, name);

        const rightBox = document.createElement("div");
        rightBox.className = "pane-head-right";
        const meta = document.createElement("span");
        meta.textContent = side.status === "ready" ? formatSideMeta(side) : "";
        const extLink = document.createElement("a");
        extLink.className = "pane-ext-link";
        extLink.href = side.url;
        extLink.target = "_blank";
        extLink.rel = "noreferrer";
        extLink.setAttribute("aria-label", STRINGS.openGitHub);
        extLink.innerHTML = ICONS.externalLink;
        rightBox.append(meta, extLink);

        head.append(leftBox, rightBox);
        return { head, dot, name, meta, extLink };
      }

      function populateSplitPaneBody(paneRef, side, preserveTransform) {
        paneRef.body.textContent = "";
        paneRef.statusKey = sideStatusKey(side);
        paneRef.img = null;
        paneRef.vp = null;
        if (paneRef.headLink) {
          paneRef.headLink.href = side.url;
        }
        if (paneRef.headMeta) {
          paneRef.headMeta.textContent = side.status === "ready" ? formatSideMeta(side) : "";
        }

        if (side.status === "ready" && side.dataUri) {
          const vp = document.createElement("div");
          vp.className = "canvas-vp ghcc-surface" + (state.pixelated ? " pixelated" : "");
          vp.dataset.bg = state.bg;
          const img = createCanvasImg(side, () => onImageReady(preserveTransform));
          vp.appendChild(img);
          paneRef.body.appendChild(vp);
          paneRef.vp = vp;
          paneRef.img = img;
          ctrl.bindViewport(vp);
        } else {
          paneRef.body.appendChild(createStateCard(side.status, side.message, side.url));
        }
      }

      function syncSplitCollections() {
        state.imgs = [];
        state.viewports = [];
        state.snapshot.sides.forEach((side) => {
          const ref = state.splitPanes[side.side];
          if (ref?.img) {
            state.imgs.push(ref.img);
          }
          if (ref?.vp) {
            state.viewports.push(ref.vp);
          }
        });
      }

      function syncSingleToggleView(preserveTransform) {
        const sv = state.singleView;
        if (!sv) {
          return;
        }
        state.snapshot.sides.forEach((side) => {
          const key = sideStatusKey(side);
          if (sv.sideKeys[side.side] === key) {
            return;
          }
          sv.sideKeys[side.side] = key;
          if (sv.imgs[side.side]) {
            sv.imgs[side.side].remove();
            delete sv.imgs[side.side];
          }
          if (side.status === "ready" && side.dataUri) {
            const img = createCanvasImg(side, () => onImageReady(preserveTransform));
            img.hidden = side.side !== state.activeSide;
            sv.vp.appendChild(img);
            sv.imgs[side.side] = img;
          }
        });

        const active = activeSingleSide();
        state.imgs = Object.values(sv.imgs);
        state.viewports = [sv.vp];

        Object.entries(sv.imgs).forEach(([sideName, img]) => {
          img.hidden = sideName !== active?.side;
        });

        if (active && active.status === "ready" && sv.imgs[active.side]) {
          sv.vp.hidden = false;
          sv.fallbackHost.hidden = true;
          sv.fallbackHost.textContent = "";
          if (ctrl.state.hasFitted) {
            applyTransform(ctrl.state);
          } else if (state.dims[active.side]) {
            requestAnimationFrame(() => ctrl.fit());
          }
        } else if (active) {
          sv.vp.hidden = true;
          sv.fallbackHost.hidden = false;
          sv.fallbackHost.textContent = "";
          sv.fallbackHost.appendChild(createStateCard(active.status, active.message, active.url));
        }
        updateMetaDisplays();
      }

      function renderStage(options) {
        const forceRebuild = Boolean(options?.forceRebuild);
        const preserveTransform = Boolean(options?.preserveTransform);
        const ready = readySides();

        if (!bothReady() && state.mode === "swipe") {
          state.mode = "split";
        }

        let targetLayout = "split";
        if (ready.length === 0) {
          targetLayout = "empty";
        } else if (hasTwoSides() && state.mode === "swipe" && bothReady()) {
          targetLayout = "swipe";
        } else if (hasTwoSides() && state.mode === "single") {
          targetLayout = "single";
        }

        // Incremental update in Split mode: only patch changed panes so loaded pane keeps zoom & pan
        if (!forceRebuild && targetLayout === "split" && state.layoutKind === "split") {
          let changed = false;
          state.snapshot.sides.forEach((side) => {
            const ref = state.splitPanes[side.side];
            if (ref && ref.statusKey !== sideStatusKey(side)) {
              changed = true;
              populateSplitPaneBody(ref, side, true);
            }
          });
          if (changed) {
            syncSplitCollections();
            if (ctrl.state.hasFitted && !ctrl.state.isFitted) {
              applyTransform(ctrl.state);
            }
          }
          updateMetaDisplays();
          return;
        }

        // Incremental update in Single (Toggle) mode: zero-flicker swap preserving zoom & pan
        if (!forceRebuild && targetLayout === "single" && state.layoutKind === "single" && state.singleView) {
          syncSingleToggleView(true);
          return;
        }

        // Full stage build for layout change
        state.layoutKind = targetLayout;
        state.imgs = [];
        state.viewports = [];
        state.splitPanes = Object.create(null);
        state.singleView = null;
        state.swipeBadges = null;
        stageWrap.textContent = "";

        if (targetLayout === "empty") {
          const sides = state.snapshot.sides;
          const primary =
            sides.find((s) => s.status === "loading") ||
            sides.find((s) => s.status === "toolarge") ||
            sides.find((s) => s.status === "unsupported") ||
            sides[0];
          const url = getSide("head")?.url || getSide("base")?.url || "";
          stageWrap.appendChild(
            createStateCard(primary?.status || "error", primary?.message || STRINGS.loadFailed, url),
          );
          updateMetaDisplays();
          return;
        }

        if (targetLayout === "swipe") {
          const base = getSide("base");
          const head = getSide("head");
          const stage = document.createElement("div");
          stage.className = "swipe-stage ghcc-surface" + (state.pixelated ? " pixelated" : "");
          stage.dataset.bg = state.bg;

          const baseLayer = document.createElement("div");
          baseLayer.className = "swipe-layer";
          const baseImg = createCanvasImg(base, () => onImageReady(preserveTransform));
          baseLayer.appendChild(baseImg);

          const headLayer = document.createElement("div");
          headLayer.className = "swipe-layer";
          const headImg = createCanvasImg(head, () => onImageReady(preserveTransform));
          headLayer.appendChild(headImg);

          const badgeL = document.createElement("div");
          badgeL.className = "swipe-badge left";
          const dotL = document.createElement("span");
          dotL.className = "side-dot base";
          const leftText = document.createElement("span");
          leftText.textContent = STRINGS.base;
          badgeL.append(dotL, leftText);

          const badgeR = document.createElement("div");
          badgeR.className = "swipe-badge right";
          const dotR = document.createElement("span");
          dotR.className = "side-dot head";
          const rightText = document.createElement("span");
          rightText.textContent = STRINGS.head;
          badgeR.append(dotR, rightText);
          state.swipeBadges = { leftText, rightText };

          const divider = document.createElement("div");
          divider.className = "swipe-divider";
          divider.setAttribute("role", "slider");
          divider.setAttribute("aria-label", STRINGS.swipeLabel);
          divider.setAttribute("aria-valuemin", "2");
          divider.setAttribute("aria-valuemax", "98");
          divider.tabIndex = 0;
          const knob = document.createElement("div");
          knob.className = "swipe-knob";
          knob.innerHTML = ICONS.swipe;
          divider.appendChild(knob);

          const applySplit = (pct) => {
            state.swipePct = Math.max(2, Math.min(98, pct));
            baseLayer.style.clipPath = "inset(0 " + (100 - state.swipePct) + "% 0 0)";
            headLayer.style.clipPath = "inset(0 0 0 " + state.swipePct + "%)";
            divider.style.left = state.swipePct + "%";
            divider.setAttribute("aria-valuenow", String(Math.round(state.swipePct)));
          };
          applySplit(state.swipePct);

          let sliding = false;
          divider.addEventListener("pointerdown", (e) => {
            e.stopPropagation();
            sliding = true;
            divider.setPointerCapture?.(e.pointerId);
          });
          divider.addEventListener("pointermove", (e) => {
            if (!sliding) {
              return;
            }
            const r = stage.getBoundingClientRect();
            if (r.width > 0) {
              applySplit(((e.clientX - r.left) / r.width) * 100);
            }
          });
          const endSlide = () => {
            sliding = false;
          };
          divider.addEventListener("pointerup", endSlide);
          divider.addEventListener("pointercancel", endSlide);
          divider.addEventListener("keydown", (e) => {
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              applySplit(state.swipePct - (e.shiftKey ? 10 : 2));
            } else if (e.key === "ArrowRight") {
              e.preventDefault();
              applySplit(state.swipePct + (e.shiftKey ? 10 : 2));
            }
          });

          stage.append(baseLayer, headLayer, badgeL, badgeR, divider);
          stageWrap.appendChild(stage);
          state.imgs.push(baseImg, headImg);
          state.viewports.push(stage);
          ctrl.bindViewport(stage);
          updateMetaDisplays();
          if (ctrl.state.hasFitted && !ctrl.state.isFitted) {
            applyTransform(ctrl.state);
          } else {
            requestAnimationFrame(() => ctrl.fit());
          }
          return;
        }

        if (targetLayout === "single") {
          const grid = document.createElement("div");
          grid.className = "diff-split single-pane";
          const pane = document.createElement("div");
          pane.className = "pane";
          const active = activeSingleSide();
          const header = createPaneHeader(active);
          const body = document.createElement("div");
          body.className = "pane-body";

          const vp = document.createElement("div");
          vp.className = "canvas-vp ghcc-surface" + (state.pixelated ? " pixelated" : "");
          vp.dataset.bg = state.bg;
          ctrl.bindViewport(vp);

          const fallbackHost = document.createElement("div");
          fallbackHost.className = "pane-body";
          fallbackHost.hidden = true;

          body.append(vp, fallbackHost);
          pane.append(header.head, body);
          grid.appendChild(pane);
          stageWrap.appendChild(grid);

          state.singleView = {
            dot: header.dot,
            label: header.name,
            meta: header.meta,
            link: header.extLink,
            vp,
            fallbackHost,
            imgs: Object.create(null),
            sideKeys: Object.create(null),
          };
          syncSingleToggleView(preserveTransform);
          if (ctrl.state.hasFitted && !ctrl.state.isFitted) {
            applyTransform(ctrl.state);
          } else if (ctrl.state.isFitted) {
            requestAnimationFrame(() => ctrl.fit());
          }
          return;
        }

        // Split (Side by Side) or single-file view (Added / Deleted)
        const grid = document.createElement("div");
        const isTwo = hasTwoSides();
        grid.className = "diff-split" + (isTwo ? "" : " single-pane");

        state.snapshot.sides.forEach((side) => {
          const pane = document.createElement("div");
          pane.className = "pane";
          let headMeta = null;
          let headLink = null;
          if (isTwo) {
            const header = createPaneHeader(side);
            headMeta = header.meta;
            headLink = header.extLink;
            pane.appendChild(header.head);
          }
          const body = document.createElement("div");
          body.className = "pane-body";
          pane.appendChild(body);
          grid.appendChild(pane);

          const paneRef = { headMeta, headLink, body, statusKey: "", vp: null, img: null };
          state.splitPanes[side.side] = paneRef;
          populateSplitPaneBody(paneRef, side, preserveTransform);
        });

        stageWrap.appendChild(grid);
        syncSplitCollections();
        updateMetaDisplays();
        if (ctrl.state.hasFitted && !ctrl.state.isFitted) {
          applyTransform(ctrl.state);
        } else {
          requestAnimationFrame(() => ctrl.fit());
        }
      }

      modeButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
          if (btn.disabled) {
            return;
          }
          const nextMode = btn.dataset.mode;
          if (!nextMode || nextMode === state.mode) {
            return;
          }
          state.mode = nextMode;
          renderStage({ forceRebuild: true, preserveTransform: !ctrl.state.isFitted });
        });
      });

      function setActiveSide(nextSide) {
        if (!hasTwoSides() || state.mode !== "single" || nextSide === state.activeSide) {
          return;
        }
        state.activeSide = nextSide;
        syncSingleToggleView(true);
      }

      sideButtons.forEach((btn) => {
        btn.addEventListener("click", () => setActiveSide(btn.dataset.side));
      });

      swatchButtons.forEach((sw) => {
        sw.addEventListener("click", () => {
          state.bg = sw.dataset.bg;
          swatchButtons.forEach((b) => b.setAttribute("aria-pressed", String(b === sw)));
          state.viewports.forEach((vp) => {
            vp.dataset.bg = state.bg;
          });
        });
      });

      function setPixelated(next, notifyHost) {
        state.pixelated = Boolean(next);
        pixelBtn.setAttribute("aria-pressed", String(state.pixelated));
        state.viewports.forEach((vp) => vp.classList.toggle("pixelated", state.pixelated));
        if (isActiveCanvasReady()) {
          applyTransform(ctrl.state);
        }
        if (notifyHost) {
          vscodeApi.postMessage({ command: "setPixelated", value: state.pixelated });
        }
      }

      zoomInBtn.addEventListener("click", () => ctrl.stepZoom(1));
      zoomOutBtn.addEventListener("click", () => ctrl.stepZoom(-1));
      fitBtn.addEventListener("click", () => ctrl.fit());
      zoomValBtn.addEventListener("click", () => ctrl.toggleFitOneToOne());
      pixelBtn.addEventListener("click", () => setPixelated(!state.pixelated, true));

      document.addEventListener("keydown", (e) => {
        if (e.metaKey || e.ctrlKey || e.altKey) {
          return;
        }
        if (e.key === "Tab" && hasTwoSides() && state.mode === "single") {
          e.preventDefault();
          setActiveSide(state.activeSide === "head" ? "base" : "head");
          return;
        }
        if (!isActiveCanvasReady()) {
          return;
        }
        if (e.key === "+" || e.key === "=") {
          e.preventDefault();
          ctrl.stepZoom(1);
        } else if (e.key === "-") {
          e.preventDefault();
          ctrl.stepZoom(-1);
        } else if (e.key === "0") {
          e.preventDefault();
          ctrl.fit();
        } else if (e.key === "1") {
          e.preventDefault();
          ctrl.setZoom(1);
        } else if (e.key === "p" || e.key === "P") {
          e.preventDefault();
          pixelBtn.click();
        }
      });

      window.addEventListener("resize", () => {
        if (isActiveCanvasReady()) {
          ctrl.refitIfFitted();
        }
      });

      window.addEventListener("message", (event) => {
        if (event.data?.command === "pixelated" && typeof event.data.value === "boolean") {
          setPixelated(event.data.value, false);
          return;
        }
        if (event.data?.command !== "state" || !event.data.snapshot) {
          return;
        }
        state.snapshot = event.data.snapshot;
        renderStage({ preserveTransform: !ctrl.state.isFitted });
      });

      renderStage();
      vscodeApi.postMessage({ command: "ready" });
    })();
  </script>
</body>
</html>`;
}
