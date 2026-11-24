import * as vscode from "vscode";
import { FileTooLargeError, type IFileBytes } from "../github/github";
import { gitHubFileUrl } from "../github/fileUrls";
import { escapeHtml } from "../core/html";
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

interface IImageSide {
  repo: string;
  sha: string;
  path: string;
  isEmpty: boolean;
}

interface IImageChange {
  key: string;
  title: string;
  changeType: FileChangeType;
  left: IImageSide;
  right: IImageSide;
}

interface IPreviewSide {
  dataUri?: string;
  size?: number;
  message?: string;
}

export class PrImagePreview implements vscode.Disposable {
  private readonly panels = new Map<string, { panel: vscode.WebviewPanel; revision: string }>();

  constructor(private readonly readFile: (side: IImageSide) => Promise<IFileBytes>) {}

  async open({ key, title, changeType, left, right }: IImageChange): Promise<void> {
    const existing = this.panels.get(key);
    if (existing) {
      existing.panel.reveal();
    }
    const revision = JSON.stringify([changeType, left, right]);
    if (existing?.revision === revision) {
      return;
    }
    const panel = existing?.panel ?? vscode.window.createWebviewPanel("githubControlCenter.prImagePreview", title, vscode.ViewColumn.Active, {
      enableScripts: false,
      localResourceRoots: [],
    });
    const request = { panel, revision };
    this.panels.set(key, request);
    if (!existing) {
      panel.onDidDispose(() => this.panels.delete(key));
    }

    const sides = [
      { label: "Base", side: left },
      { label: "Head", side: right },
    ].filter(({ side }) => !side.isEmpty);
    const results: IPreviewSide[] = sides.map(() => ({ message: "Loading image…" }));
    const render = () => {
      panel.webview.html = renderPreview(
        changeType,
        sides.map(({ label, side }, index) => renderSide(label, side, results[index])).join(""),
      );
    };
    render();
    await Promise.all(sides.map(async ({ side }, index) => {
      results[index] = await this.load(side);
      if (this.panels.get(key) === request) {
        render();
      }
    }));
  }

  private async load(side: IImageSide): Promise<IPreviewSide> {
    try {
      const file = await this.readFile(side);
      const dataUri = imageDataUri(side.path, file);
      return dataUri ? { dataUri, size: file.bytes.byteLength } : { message: "This file has no supported image preview." };
    } catch (error) {
      return { message: error instanceof FileTooLargeError ? error.message : "Could not load this image." };
    }
  }

  dispose(): void {
    for (const { panel } of this.panels.values()) {
      panel.dispose();
    }
  }
}

function renderSide(label: string, { path, repo, sha }: IImageSide, { dataUri, size, message }: IPreviewSide): string {
  const url = gitHubFileUrl({ repo, ref: sha, path });
  const bytes = size === undefined ? "" : ` · ${size.toLocaleString("en-US")} bytes`;
  const content = dataUri ? `<img src="${dataUri}" alt="${escapeHtml(path)}">` : `<p>${escapeHtml(message ?? "")}</p>`;
  return `<section><h2>${label}</h2><p>${escapeHtml(path)}${bytes}</p>${content}
    <p><a href="${escapeHtml(url)}">Open on GitHub</a></p></section>`;
}

function renderPreview(changeType: FileChangeType, sides: string): string {
  const status = changeType[0] + changeType.slice(1).toLowerCase();
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'none';">
  <title>PR image preview</title>
  <style>
    body { padding: 16px; }
    main { display: flex; gap: 16px; }
    section { flex: 1; min-width: 0; padding: 16px; border: 1px solid var(--vscode-panel-border); overflow-wrap: anywhere; }
    h2 { margin-top: 0; }
    img { max-width: 100%; max-height: 75vh; object-fit: contain; }
  </style>
</head>
<body><p>${status}</p><main>${sides}</main></body>
</html>`;
}
