import { beforeEach, describe, expect, it, vi } from "vitest";
import { window } from "vscode";
import { MAX_IMAGE_BYTES } from "../core/types";
import { imageMimeType, PrImagePreview } from "./PrImagePreview";

vi.mock("vscode", () => ({ window: { createWebviewPanel: vi.fn() }, ViewColumn: { Active: -1 } }));

const left = { repo: "acme/repo", sha: "base", path: "images/logo.svg", isEmpty: false };
const right = { repo: "contributor/fork", sha: "head", path: "images/logo.svg", isEmpty: false };
const change = { key: "pr:image", title: "logo.svg (PR #42)", changeType: "MODIFIED" as const, left, right };
const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
const svgFile = { bytes: Buffer.from(svg), contentType: "application/octet-stream" };

function mockPanel() {
  let onDispose: () => void = () => undefined;
  const panel = {
    webview: { html: "" },
    reveal: vi.fn(),
    onDidDispose: (callback: () => void) => { onDispose = callback; },
    dispose: () => onDispose(),
  };
  vi.mocked(window.createWebviewPanel).mockReturnValue(panel as unknown as ReturnType<typeof window.createWebviewPanel>);
  return panel;
}

describe("imageMimeType", () => {
  it.each([
    ["png", "image/png"], ["jpg", "image/jpeg"], ["JPEG", "image/jpeg"],
    ["gif", "image/gif"], ["webp", "image/webp"], ["ico", "image/x-icon"],
    ["bmp", "image/bmp"], ["avif", "image/avif"], ["SvG", "image/svg+xml"],
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

  it("compares both revisions and renders SVG only as an image with scripts disabled", async () => {
    const panel = mockPanel();
    const read = vi.fn().mockResolvedValue(svgFile);
    const preview = new PrImagePreview(read);

    await preview.open(change);

    expect(read.mock.calls).toEqual([[left], [right]]);
    expect(panel.webview.html).toContain("Modified");
    expect(panel.webview.html).toContain("<h2>Base</h2>");
    expect(panel.webview.html).toContain("<h2>Head</h2>");
    expect(panel.webview.html).toContain(`${svgFile.bytes.length} bytes`);
    expect(panel.webview.html).toContain("https://github.com/contributor/fork/blob/head/images/logo.svg");
    expect(panel.webview.html).toContain(`<img src="data:image/svg+xml;base64,${svgFile.bytes.toString("base64")}"`);
    expect(panel.webview.html).toContain("default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'none';");
    expect(panel.webview.html).not.toContain("<script>");
    expect(window.createWebviewPanel).toHaveBeenCalledWith(expect.any(String), change.title, -1, {
      enableScripts: false, localResourceRoots: [],
    });
  });

  it.each([
    { changeType: "ADDED" as const, status: "Added", empty: "left" as const, visible: "Head", hidden: "Base", side: right },
    { changeType: "DELETED" as const, status: "Deleted", empty: "right" as const, visible: "Base", hidden: "Head", side: left },
  ])("reads only the existing side of a $changeType image", async ({ changeType, status, empty, visible, hidden, side }) => {
    const panel = mockPanel();
    const read = vi.fn().mockResolvedValue(svgFile);
    const preview = new PrImagePreview(read);

    await preview.open({ ...change, changeType, [empty]: { ...change[empty], isEmpty: true } });

    expect(read).toHaveBeenCalledExactlyOnceWith(side);
    expect(panel.webview.html).toContain(status);
    expect(panel.webview.html).toContain(`<h2>${visible}</h2>`);
    expect(panel.webview.html).not.toContain(`<h2>${hidden}</h2>`);
  });

  it("shows a renamed file at the old Base path and new Head path", async () => {
    const panel = mockPanel();
    const read = vi.fn().mockResolvedValue(svgFile);
    const preview = new PrImagePreview(read);
    const oldFile = { ...left, path: "old/logo #1.svg" };

    await preview.open({ ...change, changeType: "RENAMED", left: oldFile });

    expect(read.mock.calls).toEqual([[oldFile], [right]]);
    expect(panel.webview.html).toContain("Renamed");
    expect(panel.webview.html).toContain("https://github.com/acme/repo/blob/base/old/logo%20%231.svg");
    expect(panel.webview.html).toContain("https://github.com/contributor/fork/blob/head/images/logo.svg");
  });

  it("keeps the other side visible when the Base request fails", async () => {
    const panel = mockPanel();
    let rejectBase: (reason: Error) => void = () => undefined;
    const read = vi.fn()
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectBase = reject; }))
      .mockResolvedValueOnce(svgFile);

    const opened = new PrImagePreview(read).open(change);
    await vi.waitFor(() => expect(panel.webview.html).toContain("<img "));
    expect(panel.webview.html).toContain("Loading image…");
    rejectBase(new Error("404"));
    await opened;

    expect(panel.webview.html).toContain("Could not load this image.");
    expect(panel.webview.html.match(/<img /g)).toHaveLength(1);
  });

  it("links oversized images to GitHub without inlining their bytes", async () => {
    const panel = mockPanel();
    const read = vi.fn().mockResolvedValue({ bytes: new Uint8Array(MAX_IMAGE_BYTES + 1), contentType: "image/svg+xml" });

    await new PrImagePreview(read).open({ ...change, changeType: "ADDED", left: { ...left, isEmpty: true } });

    expect(panel.webview.html).toContain("The image exceeds the 10 MB preview limit.");
    expect(panel.webview.html).toContain("Open on GitHub");
    expect(panel.webview.html).not.toContain("<img ");
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
    const read = vi.fn()
      .mockResolvedValueOnce(svgFile)
      .mockImplementationOnce(() => new Promise((resolve) => { finishOldHead = resolve; }))
      .mockResolvedValue(svgFile);
    const preview = new PrImagePreview(read);

    const firstOpen = preview.open(change);
    await preview.open({ ...change, right: { ...right, sha: "new-head" } });
    finishOldHead(svgFile);
    await firstOpen;

    expect(window.createWebviewPanel).toHaveBeenCalledOnce();
    expect(panel.webview.html).toContain("/blob/new-head/");
    expect(panel.webview.html).not.toContain("/blob/head/");
  });
});
