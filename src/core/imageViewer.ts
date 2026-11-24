import { escapeHtml } from "./html";
import type { FileChangeType } from "./types";

export interface IImageViewerStrings {
  statusAdded: string;
  statusModified: string;
  statusDeleted: string;
  statusRenamed: string;
  statusCopied: string;
  statusChanged: string;
  modeSplit: string;
  modeSwipe: string;
  modeToggle: string;
  base: string;
  head: string;
  bgChecker: string;
  bgLight: string;
  bgDark: string;
  zoomOut: string;
  zoomIn: string;
  zoomToggle: string;
  zoomFit: string;
  pixelCrisp: string;
  openGitHub: string;
  close: string;
  previous: string;
  next: string;
  swipeLabel: string;
  diffViewMode: string;
  imageLightbox: string;
  loading: string;
  tooLarge: string;
  unsupported: string;
  loadFailed: string;
}

export const DEFAULT_IMAGE_VIEWER_STRINGS: IImageViewerStrings = {
  statusAdded: "Added",
  statusModified: "Modified",
  statusDeleted: "Deleted",
  statusRenamed: "Renamed",
  statusCopied: "Copied",
  statusChanged: "Changed",
  modeSplit: "Side by Side",
  modeSwipe: "Swipe",
  modeToggle: "Toggle",
  base: "Base",
  head: "Head",
  bgChecker: "Checkerboard",
  bgLight: "Light background",
  bgDark: "Dark background",
  zoomOut: "Zoom out (-)",
  zoomIn: "Zoom in (+)",
  zoomToggle: "Toggle Fit / 1:1 (0 / 1)",
  zoomFit: "Fit to view (0)",
  pixelCrisp: "Nearest-neighbor (P)",
  openGitHub: "Open on GitHub",
  close: "Close (Esc)",
  previous: "Previous",
  next: "Next",
  swipeLabel: "Swipe comparison",
  diffViewMode: "Diff view mode",
  imageLightbox: "Image preview",
  loading: "Loading image…",
  tooLarge: "The image exceeds the 10 MB preview limit.",
  unsupported: "This file has no supported image preview.",
  loadFailed: "Could not load this image.",
};

export const IMAGE_VIEWER_ICONS = {
  zoomOut: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3.5 8h9"/></svg>',
  zoomIn: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"/></svg>',
  fit: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M2.5 5.5V2.5h3M10.5 2.5h3v3M13.5 10.5v3h-3M5.5 13.5h-3v-3"/></svg>',
  pixel:
    '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="2" y="2" width="4" height="4"/><rect x="10" y="2" width="4" height="4" opacity=".45"/><rect x="6" y="6" width="4" height="4"/><rect x="2" y="10" width="4" height="4" opacity=".45"/><rect x="10" y="10" width="4" height="4"/></svg>',
  externalLink:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M6.5 3.5H3.5v9h9v-3M9.5 2.5h4v4M13.5 2.5L7.5 8.5"/></svg>',
  close: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  prev: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M10 3.5L5.5 8 10 12.5"/></svg>',
  next: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6 3.5L10.5 8 6 12.5"/></svg>',
  expand:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M9.5 2.5h4v4M13.5 2.5L8.5 7.5M6.5 13.5h-4v-4M2.5 13.5l5-5"/></svg>',
  swipe:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M5.5 4.5L2.5 8l3 3.5M10.5 4.5L13.5 8l-3 3.5"/></svg>',
  alert:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="8" cy="8" r="6"/><path d="M8 4.8v3.8M8 11.2h.01"/></svg>',
} as const;

export function safeJsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function formatImageBytes(bytes: number): string {
  const sign = bytes < 0 ? "-" : "";
  const abs = Math.abs(bytes);
  if (abs < 1024) {
    return `${sign}${abs} B`;
  }
  if (abs < 1024 * 1024) {
    return `${sign}${(abs / 1024).toFixed(abs < 10240 ? 1 : 0)} KB`;
  }
  return `${sign}${(abs / (1024 * 1024)).toFixed(2)} MB`;
}

export function changeTypeStatus(
  changeType: FileChangeType,
  strings: IImageViewerStrings = DEFAULT_IMAGE_VIEWER_STRINGS,
): { css: string; label: string } {
  switch (changeType) {
    case "ADDED":
      return { css: "added", label: strings.statusAdded };
    case "DELETED":
      return { css: "deleted", label: strings.statusDeleted };
    case "RENAMED":
      return { css: "renamed", label: strings.statusRenamed };
    case "COPIED":
      return { css: "copied", label: strings.statusCopied };
    case "CHANGED":
      return { css: "changed", label: strings.statusChanged };
    default:
      return { css: "modified", label: strings.statusModified };
  }
}

export function renderBackdropSwatches(groupId: string, strings: IImageViewerStrings = DEFAULT_IMAGE_VIEWER_STRINGS): string {
  return `<div class="ghcc-swatches" id="${escapeHtml(groupId)}">
    <button class="ghcc-swatch" type="button" data-bg="checker" aria-pressed="true" aria-label="${escapeHtml(strings.bgChecker)}" data-tooltip="${escapeHtml(strings.bgChecker)}"></button>
    <button class="ghcc-swatch" type="button" data-bg="light" aria-pressed="false" aria-label="${escapeHtml(strings.bgLight)}" data-tooltip="${escapeHtml(strings.bgLight)}"></button>
    <button class="ghcc-swatch" type="button" data-bg="dark" aria-pressed="false" aria-label="${escapeHtml(strings.bgDark)}" data-tooltip="${escapeHtml(strings.bgDark)}"></button>
  </div>`;
}

export function renderZoomToolbarControls(
  prefix: string,
  strings: IImageViewerStrings = DEFAULT_IMAGE_VIEWER_STRINGS,
  pixelated = true,
): string {
  const id = escapeHtml(prefix);
  return `<button class="ghcc-btn" type="button" id="${id}-zoom-out" aria-label="${escapeHtml(strings.zoomOut)}" data-tooltip="${escapeHtml(strings.zoomOut)}">${IMAGE_VIEWER_ICONS.zoomOut}</button>
    <button class="ghcc-btn ghcc-zoom-val" type="button" id="${id}-zoom-val" aria-label="${escapeHtml(strings.zoomToggle)}" data-tooltip="${escapeHtml(strings.zoomToggle)}">100%</button>
    <button class="ghcc-btn" type="button" id="${id}-zoom-in" aria-label="${escapeHtml(strings.zoomIn)}" data-tooltip="${escapeHtml(strings.zoomIn)}">${IMAGE_VIEWER_ICONS.zoomIn}</button>
    <button class="ghcc-btn" type="button" id="${id}-fit" aria-label="${escapeHtml(strings.zoomFit)}" data-tooltip="${escapeHtml(strings.zoomFit)}">${IMAGE_VIEWER_ICONS.fit}</button>
    <button class="ghcc-btn" type="button" id="${id}-pixel" aria-pressed="${pixelated ? "true" : "false"}" aria-label="${escapeHtml(strings.pixelCrisp)}" data-tooltip="${escapeHtml(strings.pixelCrisp)}">${IMAGE_VIEWER_ICONS.pixel}</button>`;
}

export const IMAGE_VIEWER_SHARED_CSS = `
  :root {
    --ghcc-canvas-bg: #161617;
    --ghcc-checker-a: #262628;
    --ghcc-checker-b: #1c1c1e;
    --ghcc-surface-elevated: var(--vscode-editorWidget-background, #232325);
    --ghcc-lightbox-scrim: rgba(12, 12, 14, 0.88);
  }
  body.vscode-light,
  body.vscode-high-contrast-light {
    --ghcc-canvas-bg: #f0f0f2;
    --ghcc-checker-a: #e6e6e9;
    --ghcc-checker-b: #f5f5f7;
    --ghcc-surface-elevated: var(--vscode-editorWidget-background, #f6f6f7);
    --ghcc-lightbox-scrim: rgba(24, 24, 28, 0.78);
  }

  .ghcc-btn {
    position: relative;
    height: 26px;
    min-width: 26px;
    padding: 0 6px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
    color: var(--vscode-foreground);
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    user-select: none;
    text-decoration: none;
  }
  .ghcc-btn:hover:not(:disabled) {
    background: var(--vscode-toolbar-hoverBackground, rgba(90, 93, 94, 0.31));
    text-decoration: none;
  }
  .ghcc-btn:active:not(:disabled) {
    background: var(--vscode-toolbar-activeBackground, rgba(99, 102, 103, 0.38));
  }
  .ghcc-btn[aria-pressed="true"] {
    background: var(--vscode-toolbar-activeBackground, rgba(99, 102, 103, 0.38));
    border-color: var(--gr-border);
    color: var(--vscode-foreground);
  }
  .ghcc-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .ghcc-btn svg {
    width: 15px;
    height: 15px;
    flex-shrink: 0;
    display: block;
  }

  .ghcc-btn[data-tooltip]::after,
  .ghcc-swatch[data-tooltip]::after {
    content: attr(data-tooltip);
    position: absolute;
    top: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    background: var(--vscode-editorHoverWidget-background, var(--gr-box-bg));
    color: var(--vscode-editorHoverWidget-foreground, var(--vscode-foreground));
    border: 1px solid var(--vscode-editorHoverWidget-border, var(--gr-border));
    padding: 3px 7px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 400;
    line-height: 1.3;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.1s ease 0.15s;
    z-index: 60;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  }
  .ghcc-btn[data-tooltip]:hover::after,
  .ghcc-swatch[data-tooltip]:hover::after {
    opacity: 1;
  }
  .ghcc-btn[data-tooltip-align="right"]::after,
  .ghcc-swatch[data-tooltip-align="right"]::after {
    left: auto;
    right: 0;
    transform: none;
  }

  .ghcc-sep {
    width: 1px;
    height: 16px;
    background: var(--gr-border);
    margin: 0 2px;
    flex-shrink: 0;
  }

  .ghcc-seg {
    display: inline-flex;
    align-items: center;
    padding: 2px;
    border-radius: 5px;
    background: var(--vscode-textCodeBlock-background, rgba(128, 128, 128, 0.16));
    border: 1px solid var(--gr-border);
    gap: 2px;
  }
  .ghcc-seg button {
    height: 22px;
    padding: 0 8px;
    border: none;
    border-radius: 3px;
    background: transparent;
    color: var(--gr-muted);
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
  }
  .ghcc-seg button:hover:not(:disabled) {
    color: var(--vscode-foreground);
  }
  .ghcc-seg button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .ghcc-seg button[aria-pressed="true"] {
    background: var(--vscode-editor-background);
    color: var(--vscode-foreground);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
    font-weight: 500;
  }

  .ghcc-swatches {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0 2px;
  }
  .ghcc-swatch {
    position: relative;
    width: 18px;
    height: 18px;
    border-radius: 3px;
    border: 1px solid var(--gr-border);
    padding: 0;
    cursor: pointer;
  }
  .ghcc-swatch[data-bg="checker"] {
    background-image:
      linear-gradient(45deg, #b8b8be 25%, transparent 25%),
      linear-gradient(-45deg, #b8b8be 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #b8b8be 75%),
      linear-gradient(-45deg, transparent 75%, #b8b8be 75%);
    background-color: #f0f0f2;
    background-size: 8px 8px;
    background-position: 0 0, 0 4px, 4px -4px, -4px 0;
  }
  .ghcc-swatch[data-bg="light"] {
    background: #f5f5f7;
  }
  .ghcc-swatch[data-bg="dark"] {
    background: #141416;
  }
  .ghcc-swatch[aria-pressed="true"] {
    border-color: var(--vscode-focusBorder);
    box-shadow: 0 0 0 1px var(--vscode-focusBorder);
  }

  .ghcc-zoom-val {
    min-width: 44px;
    font-family: var(--gr-mono);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    text-align: center;
  }

  .ghcc-pill {
    display: inline-flex;
    align-items: center;
    height: 19px;
    padding: 0 8px;
    border-radius: 2em;
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
    flex-shrink: 0;
  }
  .ghcc-pill.added { background: rgba(46, 160, 67, 0.18); color: var(--gr-green); border: 1px solid rgba(46, 160, 67, 0.35); }
  .ghcc-pill.modified,
  .ghcc-pill.changed { background: rgba(208, 162, 21, 0.16); color: var(--gr-yellow); border: 1px solid rgba(208, 162, 21, 0.35); }
  .ghcc-pill.deleted { background: rgba(248, 81, 73, 0.18); color: var(--gr-red); border: 1px solid rgba(248, 81, 73, 0.35); }
  .ghcc-pill.renamed,
  .ghcc-pill.copied { background: rgba(137, 87, 229, 0.18); color: var(--gr-purple); border: 1px solid rgba(137, 87, 229, 0.35); }

  .ghcc-surface[data-bg="checker"] {
    background-color: var(--ghcc-checker-b);
    background-image:
      linear-gradient(45deg, var(--ghcc-checker-a) 25%, transparent 25%),
      linear-gradient(-45deg, var(--ghcc-checker-a) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, var(--ghcc-checker-a) 75%),
      linear-gradient(-45deg, transparent 75%, var(--ghcc-checker-a) 75%);
    background-size: 16px 16px;
    background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  }
  .ghcc-surface[data-bg="light"] {
    background: #f5f5f7;
  }
  .ghcc-surface[data-bg="dark"] {
    background: #121214;
  }

  .canvas-img {
    position: absolute;
    left: 50%;
    top: 50%;
    transform-origin: center center;
    max-width: none;
    max-height: none;
    display: block;
    box-shadow: 0 0 0 calc(1px / var(--ghcc-scale, 1)) rgba(128, 128, 128, 0.28);
    pointer-events: none;
  }
  .pixelated .canvas-img {
    image-rendering: pixelated;
  }
`;

export const IMAGE_VIEWER_CONTROLLER_SCRIPT = `
  const GHCC_MIN_SCALE = 0.1;
  const GHCC_MAX_SCALE = 16;
  const GHCC_DRAG_THRESHOLD = 4;

  function formatImageBytes(bytes) {
    if (bytes == null || Number.isNaN(bytes)) {
      return "";
    }
    const sign = bytes < 0 ? "-" : "";
    const abs = Math.abs(bytes);
    if (abs < 1024) {
      return sign + abs + " B";
    }
    if (abs < 1024 * 1024) {
      return sign + (abs / 1024).toFixed(abs < 10240 ? 1 : 0) + " KB";
    }
    return sign + (abs / (1024 * 1024)).toFixed(2) + " MB";
  }

  function computeFitScale(vw, vh, nw, nh) {
    if (!vw || !vh || !nw || !nh) {
      return 1;
    }
    const pad = 32;
    const maxSide = Math.max(nw, nh);
    if (maxSide <= 64) {
      const target = Math.min(vw - pad, vh - pad) * 0.42;
      return Math.max(4, Math.min(12, Math.floor(target / maxSide) || 4));
    }
    const availW = Math.max(1, vw - pad);
    const availH = Math.max(1, vh - pad);
    return Math.max(GHCC_MIN_SCALE, Math.min(1, availW / nw, availH / nh));
  }

  function createImageTransformController({ getViewportRect, getRefSize, onUpdate }) {
    const state = {
      scale: 1,
      tx: 0,
      ty: 0,
      fitScale: 1,
      isFitted: true,
      hasFitted: false,
      dragging: false,
      moved: false,
      justDragged: false,
      startX: 0,
      startY: 0,
      px: 0,
      py: 0,
    };

    function fit() {
      const rect = getViewportRect();
      const ref = getRefSize();
      if (!rect || !ref || !rect.width || !rect.height) {
        return false;
      }
      state.fitScale = computeFitScale(rect.width, rect.height, ref.w, ref.h);
      state.scale = state.fitScale;
      state.tx = 0;
      state.ty = 0;
      state.isFitted = true;
      state.hasFitted = true;
      onUpdate(state);
      return true;
    }

    function refitIfFitted() {
      if (state.isFitted) {
        fit();
      } else {
        onUpdate(state);
      }
    }

    function setZoom(nextScale, clientX, clientY, anchorRect) {
      const clamped = Math.max(GHCC_MIN_SCALE, Math.min(GHCC_MAX_SCALE, nextScale));
      const rect = anchorRect || getViewportRect();
      if (rect && clientX != null && clientY != null) {
        const mx = clientX - rect.left - rect.width / 2;
        const my = clientY - rect.top - rect.height / 2;
        const ratio = clamped / state.scale;
        state.tx = mx - (mx - state.tx) * ratio;
        state.ty = my - (my - state.ty) * ratio;
      } else if (clamped <= state.fitScale + 0.001) {
        state.tx = 0;
        state.ty = 0;
      }
      state.scale = clamped;
      state.isFitted = false;
      state.hasFitted = true;
      onUpdate(state);
    }

    function stepZoom(dir, clientX, clientY, anchorRect) {
      const factor = dir > 0 ? 1.25 : 1 / 1.25;
      setZoom(state.scale * factor, clientX, clientY, anchorRect);
    }

    function toggleFitOneToOne(clientX, clientY, anchorRect) {
      const ref = getRefSize();
      const isTiny = Boolean(ref && Math.max(ref.w, ref.h) <= 64);
      if (Math.abs(state.scale - state.fitScale) < 0.02) {
        setZoom(isTiny ? 1 : (state.fitScale >= 0.98 ? 2 : 1), clientX, clientY, anchorRect);
      } else {
        fit();
      }
    }

    function consumeJustDragged() {
      if (!state.justDragged) {
        return false;
      }
      state.justDragged = false;
      return true;
    }

    function bindViewport(el) {
      el.addEventListener("wheel", (e) => {
        e.preventDefault();
        const factor = Math.exp(-e.deltaY * 0.0022);
        setZoom(state.scale * factor, e.clientX, e.clientY, el.getBoundingClientRect());
      }, { passive: false });

      el.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 || e.target?.closest?.(".swipe-divider, .lb-nav, .state-empty")) {
          return;
        }
        state.dragging = true;
        state.moved = false;
        state.startX = e.clientX;
        state.startY = e.clientY;
        state.px = e.clientX;
        state.py = e.clientY;
        el.setPointerCapture?.(e.pointerId);
        el.classList.add("panning");
      });

      el.addEventListener("pointermove", (e) => {
        if (!state.dragging) {
          return;
        }
        if (!state.moved) {
          if (Math.hypot(e.clientX - state.startX, e.clientY - state.startY) < GHCC_DRAG_THRESHOLD) {
            return;
          }
          state.moved = true;
          state.isFitted = false;
          state.tx += e.clientX - state.startX;
          state.ty += e.clientY - state.startY;
        } else {
          state.tx += e.clientX - state.px;
          state.ty += e.clientY - state.py;
        }
        state.px = e.clientX;
        state.py = e.clientY;
        onUpdate(state);
      });

      const endDrag = () => {
        if (!state.dragging) {
          return;
        }
        state.dragging = false;
        el.classList.remove("panning");
        if (state.moved) {
          state.justDragged = true;
          setTimeout(() => {
            state.justDragged = false;
          }, 0);
        }
      };
      el.addEventListener("pointerup", endDrag);
      el.addEventListener("pointercancel", endDrag);
    }

    return { state, fit, refitIfFitted, setZoom, stepZoom, toggleFitOneToOne, consumeJustDragged, bindViewport };
  }
`;
