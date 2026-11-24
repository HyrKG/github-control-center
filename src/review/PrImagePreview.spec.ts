import { beforeEach, describe, expect, it, vi } from "vitest";
import { window } from "vscode";
import { MAX_IMAGE_BYTES } from "../core/types";
import { imageMimeType, PrImagePreview, renderImagePreviewHtml, type IImagePreviewSnapshot } from "./PrImagePreview";

vi.mock("vscode", () => ({ window: { createWebviewPanel: vi.fn() }, ViewColumn: { Active: -1 } }));

const left = { repo: "acme/repo", sha: "base", path: "images/logo.svg", isEmpty: false };
const right = { repo: "contributor/fork", sha: "head", path: "images/logo.svg", isEmpty: false };
const change = { key: "pr:image", title: "logo.svg (PR #42)", changeType: "MODIFIED" as const, left, right };
const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
const svgFile = { bytes: Buffer.from(svg), contentType: "application/octet-stream" };

interface IMockPanel {
  title: string;
  webview: {
    html: string;
    postMessage: ReturnType<typeof vi.fn>;
    onDidReceiveMessage: (callback: (message: unknown) => void) => void;
    emitMessage: (message: unknown) => void;
  };
  reveal: ReturnType<typeof vi.fn>;
  onDidDispose: (callback: () => void) => void;
  dispose: () => void;
}

function mockPanel(): IMockPanel {
  let onDispose: () => void = () => undefined;
  let onMessage: (message: unknown) => void = () => undefined;
  const panel: IMockPanel = {
    title: "",
    webview: {
      html: "",
      postMessage: vi.fn().mockResolvedValue(true),
      onDidReceiveMessage: (callback: (message: unknown) => void) => {
        onMessage = callback;
      },
      emitMessage: (message: unknown) => onMessage(message),
    },
    reveal: vi.fn(),
    onDidDispose: (callback: () => void) => {
      onDispose = callback;
    },
    dispose: () => onDispose(),
  };
  vi.mocked(window.createWebviewPanel).mockReturnValue(panel as unknown as ReturnType<typeof window.createWebviewPanel>);
  return panel;
}

function lastSnapshot(panel: IMockPanel): IImagePreviewSnapshot {
  const calls = panel.webview.postMessage.mock.calls;
  const last = calls[calls.length - 1]?.[0] as { command: string; snapshot: IImagePreviewSnapshot };
  expect(last?.command).toBe("state");
  return last.snapshot;
}

describe("imageMimeType", () => {
  it.each([
    ["png", "image/png"],
    ["jpg", "image/jpeg"],
    ["JPEG", "image/jpeg"],
    ["gif", "image/gif"],
    ["webp", "image/webp"],
    ["ico", "image/x-icon"],
    ["bmp", "image/bmp"],
    ["avif", "image/avif"],
    ["SvG", "image/svg+xml"],
  ])("recognizes %s", (extension, mime) => {
    expect(imageMimeType(`assets/logo.${extension}`)).toBe(mime);
  });

  it("recognizes supported response MIME types and rejects other types for unknown extensions", () => {
    expect(imageMimeType("icon", "Image/Vnd.Microsoft.Icon; charset=binary")).toBe("image/vnd.microsoft.icon");
    expect(imageMimeType("notes.txt", "text/html")).toBeUndefined();
  });
});

describe("PrImagePreview", () => {
  beforeEach(() => vi.clearAllMocks());

  it("compares both revisions via postMessage, renders SVG only as data URI, and locks CSP to a per-render nonce", async () => {
    const panel = mockPanel();
    const read = vi.fn().mockResolvedValue(svgFile);
    const preview = new PrImagePreview(read);

    await preview.open(change);

    expect(read.mock.calls).toEqual([[left], [right]]);
    expect(window.createWebviewPanel).toHaveBeenCalledWith(expect.any(String), change.title, -1, {
      enableScripts: true,
      localResourceRoots: [],
    });

    const cspMatch = /default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-([^']+)';/.exec(panel.webview.html);
    expect(cspMatch).not.toBeNull();
    const nonce = cspMatch![1];
    expect(panel.webview.html).toContain(`<script nonce="${nonce}">`);
    expect(panel.webview.html).not.toContain("onclick=");
    expect(panel.webview.html).toContain("Modified");
    expect(panel.webview.html).toContain("Side by Side");
    expect(panel.webview.html).toContain("Swipe");
    expect(panel.webview.html).toContain("Toggle");

    // Incremental postMessage updates: one per loaded side without replacing webview.html
    expect(panel.webview.postMessage).toHaveBeenCalledTimes(2);
    const snap = lastSnapshot(panel);
    expect(snap.changeType).toBe("MODIFIED");
    expect(snap.sides).toEqual([
      expect.objectContaining({
        side: "base",
        label: "Base",
        status: "ready",
        size: svgFile.bytes.length,
        url: "https://github.com/acme/repo/blob/base/images/logo.svg",
        dataUri: `data:image/svg+xml;base64,${svgFile.bytes.toString("base64")}`,
      }),
      expect.objectContaining({
        side: "head",
        label: "Head",
        status: "ready",
        size: svgFile.bytes.length,
        url: "https://github.com/contributor/fork/blob/head/images/logo.svg",
        dataUri: `data:image/svg+xml;base64,${svgFile.bytes.toString("base64")}`,
      }),
    ]);

    // Raw SVG markup is never injected directly into HTML
    expect(panel.webview.html).not.toContain("<script>alert(1)</script>");
  });

  it("replies with the latest snapshot on webview ready handshake to prevent load/boot races", async () => {
    const panel = mockPanel();
    const read = vi.fn().mockResolvedValue(svgFile);
    const preview = new PrImagePreview(read);

    await preview.open(change);
    panel.webview.postMessage.mockClear();

    panel.webview.emitMessage({ command: "ready" });
    expect(panel.webview.postMessage).toHaveBeenCalledOnce();
    const snap = lastSnapshot(panel);
    expect(snap.sides.every((s) => s.status === "ready")).toBe(true);
  });

  it.each([
    { changeType: "ADDED" as const, status: "Added", empty: "left" as const, visible: "Head", sideName: "head", side: right },
    { changeType: "DELETED" as const, status: "Deleted", empty: "right" as const, visible: "Base", sideName: "base", side: left },
  ])("reads only the existing side of a $changeType image", async ({ changeType, status, empty, visible, sideName, side }) => {
    const panel = mockPanel();
    const read = vi.fn().mockResolvedValue(svgFile);
    const preview = new PrImagePreview(read);

    await preview.open({ ...change, changeType, [empty]: { ...change[empty], isEmpty: true } });

    expect(read).toHaveBeenCalledExactlyOnceWith(side);
    expect(panel.webview.html).toContain(status);
    const snap = lastSnapshot(panel);
    expect(snap.sides).toHaveLength(1);
    expect(snap.sides[0]).toMatchObject({ side: sideName, label: visible, status: "ready" });
  });

  it("shows a renamed file with both paths and distinct Base/Head GitHub URLs", async () => {
    const panel = mockPanel();
    const read = vi.fn().mockResolvedValue(svgFile);
    const preview = new PrImagePreview(read);
    const oldFile = { ...left, path: "old/logo #1.svg" };

    await preview.open({ ...change, changeType: "RENAMED", left: oldFile });

    expect(read.mock.calls).toEqual([[oldFile], [right]]);
    expect(panel.webview.html).toContain("Renamed");
    expect(panel.webview.html).toContain("old/logo #1.svg → images/logo.svg");
    const snap = lastSnapshot(panel);
    expect(snap.isRenamed).toBe(true);
    expect(snap.displayPath).toBe("old/logo #1.svg → images/logo.svg");
    expect(snap.sides[0].url).toBe("https://github.com/acme/repo/blob/base/old/logo%20%231.svg");
    expect(snap.sides[1].url).toBe("https://github.com/contributor/fork/blob/head/images/logo.svg");
  });

  it("keeps the other side visible via incremental state updates when the Base request fails", async () => {
    const panel = mockPanel();
    let rejectBase: (reason: Error) => void = () => undefined;
    const read = vi
      .fn()
      .mockImplementationOnce(() => new Promise((_resolve, reject) => {
        rejectBase = reject;
      }))
      .mockResolvedValueOnce(svgFile);

    const opened = new PrImagePreview(read).open(change);
    const initialHtml = panel.webview.html;
    await vi.waitFor(() => expect(panel.webview.postMessage).toHaveBeenCalledTimes(1));

    const midSnap = lastSnapshot(panel);
    expect(midSnap.sides[0]).toMatchObject({ side: "base", status: "loading", message: "Loading image…" });
    expect(midSnap.sides[1]).toMatchObject({ side: "head", status: "ready" });

    rejectBase(new Error("404"));
    await opened;

    // webview.html was NOT replaced when sides settled
    expect(panel.webview.html).toBe(initialHtml);
    const finalSnap = lastSnapshot(panel);
    expect(finalSnap.sides[0]).toMatchObject({ side: "base", status: "error", message: "Could not load this image.", dataUri: undefined });
    expect(finalSnap.sides[1]).toMatchObject({ side: "head", status: "ready" });
  });

  it("links oversized images to GitHub without inlining their bytes", async () => {
    const panel = mockPanel();
    const read = vi.fn().mockResolvedValue({ bytes: new Uint8Array(MAX_IMAGE_BYTES + 1), contentType: "image/svg+xml" });

    await new PrImagePreview(read).open({ ...change, changeType: "ADDED", left: { ...left, isEmpty: true } });

    const snap = lastSnapshot(panel);
    expect(snap.sides[0]).toMatchObject({
      status: "toolarge",
      message: "The image exceeds the 10 MB preview limit.",
      dataUri: undefined,
      url: "https://github.com/contributor/fork/blob/head/images/logo.svg",
    });
  });

  it("marks empty or unsupported files as unsupported", async () => {
    const panel = mockPanel();
    const read = vi.fn().mockResolvedValue({ bytes: new Uint8Array(0), contentType: "application/octet-stream" });

    await new PrImagePreview(read).open({ ...change, changeType: "ADDED", left: { ...left, isEmpty: true } });

    const snap = lastSnapshot(panel);
    expect(snap.sides[0]).toMatchObject({
      status: "unsupported",
      message: "This file has no supported image preview.",
      dataUri: undefined,
    });
  });

  it("reuses a panel even while loading and allows reopening after disposal", async () => {
    const panel = mockPanel();
    const read = vi.fn().mockResolvedValue(svgFile);
    const preview = new PrImagePreview(read);

    await Promise.all([preview.open(change), preview.open(change)]);
    expect(window.createWebviewPanel).toHaveBeenCalledOnce();
    expect(panel.reveal).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledTimes(2);

    panel.dispose();
    await preview.open(change);
    expect(window.createWebviewPanel).toHaveBeenCalledTimes(2);
  });

  it("refreshes the same tab after a push and ignores the older request's results", async () => {
    const panel = mockPanel();
    let finishOldHead: (file: typeof svgFile) => void = () => undefined;
    const read = vi
      .fn()
      .mockResolvedValueOnce(svgFile)
      .mockImplementationOnce(() => new Promise((resolve) => {
        finishOldHead = resolve;
      }))
      .mockResolvedValue(svgFile);
    const preview = new PrImagePreview(read);

    const firstOpen = preview.open(change);
    await preview.open({ ...change, right: { ...right, sha: "new-head" } });
    const countBeforeStale = panel.webview.postMessage.mock.calls.length;
    finishOldHead(svgFile);
    await firstOpen;

    expect(window.createWebviewPanel).toHaveBeenCalledOnce();
    expect(panel.webview.postMessage).toHaveBeenCalledTimes(countBeforeStale);
    expect(lastSnapshot(panel).sides[1].url).toContain("/blob/new-head/");
    expect(panel.webview.html).toContain("/blob/new-head/");
    expect(panel.webview.html).not.toContain("/blob/head/");
  });

  it("safely escapes filenames containing </script> in both HTML and embedded JSON", () => {
    const hostilePath = 'assets/evil</script><img onerror="alert(1)">.png';
    const html = renderImagePreviewHtml(
      {
        revision: "rev-1",
        changeType: "ADDED",
        displayPath: hostilePath,
        isRenamed: false,
        sides: [
          {
            side: "head",
            label: "Head",
            path: hostilePath,
            url: "https://github.com/acme/repo/blob/head/assets/evil.png",
            status: "loading",
            message: "Loading image…",
          },
        ],
      },
      "nonce-abc",
    );

    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(html).toContain("\\u003c/script>");
    expect(html).not.toContain('onerror="alert(1)"');
  });
});
