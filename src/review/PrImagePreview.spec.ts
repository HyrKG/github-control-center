import { runInNewContext, Script } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { window } from "vscode";
import { chineseBundle, setTestLocale } from "../core/localizationTestUtils";
import { MAX_IMAGE_BYTES } from "../core/types";
import { imageMimeType, PrImagePreview, renderImagePreviewHtml, type IImagePreviewSnapshot } from "./PrImagePreview";

vi.mock("vscode", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, ViewColumn: { Active: -1 }, window: { createWebviewPanel: vi.fn() } };
});

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
  const last = [...calls].reverse().find(([payload]) => (payload as { command?: string })?.command === "state")?.[0] as
    | { command: string; snapshot: IImagePreviewSnapshot }
    | undefined;
  expect(last?.command).toBe("state");
  return last!.snapshot;
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
  afterEach(() => setTestLocale());

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
    expect(panel.webview.postMessage).toHaveBeenCalledTimes(2);
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ command: "pixelated", value: true });
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
    expect(html).toContain("Nearest-neighbor (P)");
    expect(html).toContain("cursor: grab;");
    expect(html).not.toContain("cursor: zoom-in");
    expect(html).not.toContain("crisp-edges");
    expect(html).not.toContain("maybeAutoPixelate");
    expect(html).toContain('"pixelated":true');
    expect(html).toMatch(/id="a-pixel"[^>]*aria-pressed="true"/);
  });

  it("defaults to nearest-neighbor, persists preference across new panels, and broadcasts changes to open panels", async () => {
    let saved = true;
    const preference = {
      get: vi.fn(() => saved),
      set: vi.fn((value: boolean) => {
        saved = value;
      }),
    };
    const panelA = mockPanel();
    const read = vi.fn().mockResolvedValue(svgFile);
    const preview = new PrImagePreview(read, undefined, preference);

    await preview.open(change);
    expect(panelA.webview.html).toContain('"pixelated":true');

    const panelB = mockPanel();
    await preview.open({ ...change, key: "pr:other", title: "other.png (PR #42)" });
    expect(panelB.webview.html).toContain('"pixelated":true');

    // User turns off nearest-neighbor on panelA -> preference updates and panelB syncs
    panelA.webview.postMessage.mockClear();
    panelB.webview.postMessage.mockClear();
    panelA.webview.emitMessage({ command: "setPixelated", value: false });

    expect(preference.set).toHaveBeenCalledWith(false);
    expect(saved).toBe(false);
    expect(panelA.webview.postMessage).not.toHaveBeenCalled();
    expect(panelB.webview.postMessage).toHaveBeenCalledExactlyOnceWith({ command: "pixelated", value: false });

    // Opening a third image (or a new PrImagePreview instance) keeps the persisted false state
    const panelC = mockPanel();
    await preview.open({ ...change, key: "pr:third", title: "large.png (PR #42)" });
    expect(panelC.webview.html).toContain('"pixelated":false');
    expect(panelC.webview.html).toMatch(/id="a-pixel"[^>]*aria-pressed="false"/);
  });

  it("compiles its inline script cleanly and executes the image load and fallback lifecycle", () => {
    class MockDomEl {
      className = "";
      title = "";
      value = "";
      disabled = false;
      hidden = false;
      href = "";
      src = "";
      alt = "";
      draggable = true;
      tabIndex = 0;
      width = 0;
      height = 0;
      naturalWidth = 0;
      naturalHeight = 0;
      complete = false;
      dataset: Record<string, string> = {};
      children: MockDomEl[] = [];
      attrs = new Map<string, string>();
      listeners = new Map<string, Array<(event: Record<string, unknown>) => void>>();
      style: Record<string, unknown> = { transform: "", clipPath: "", left: "", setProperty: vi.fn() };
      private _textContent = "";
      private readonly classes = new Set<string>();
      classList = {
        add: (...names: string[]) => names.forEach((name) => this.classes.add(name)),
        remove: (...names: string[]) => names.forEach((name) => this.classes.delete(name)),
        contains: (name: string) => this.classes.has(name),
        toggle: (name: string, force?: boolean) => {
          const next = force === undefined ? !this.classes.has(name) : Boolean(force);
          if (next) {
            this.classes.add(name);
          } else {
            this.classes.delete(name);
          }
          return next;
        },
      };

      constructor(public readonly tagName: string, public readonly id = "") {}

      get textContent(): string {
        return this._textContent;
      }

      set textContent(value: string) {
        this._textContent = value;
        this.children = [];
      }

      get firstElementChild(): MockDomEl | null {
        return this.children[0] ?? null;
      }

      set innerHTML(_value: string) {
        this.children = [];
      }

      append(...nodes: Array<MockDomEl | string>): void {
        for (const node of nodes) {
          if (node instanceof MockDomEl) {
            this.children.push(node);
          } else {
            this._textContent += node;
          }
        }
      }

      appendChild(node: MockDomEl): MockDomEl {
        this.children.push(node);
        return node;
      }

      remove(): void {}

      setAttribute(name: string, value: string): void {
        this.attrs.set(name, String(value));
      }

      getAttribute(name: string): string | null {
        return this.attrs.get(name) ?? null;
      }

      addEventListener(type: string, callback: (event: Record<string, unknown>) => void): void {
        const list = this.listeners.get(type) ?? [];
        list.push(callback);
        this.listeners.set(type, list);
      }

      emit(type: string, event: Record<string, unknown> = {}): void {
        for (const callback of this.listeners.get(type) ?? []) {
          callback(event);
        }
      }

      click(): void {
        this.emit("click", {});
      }

      setPointerCapture(): void {}

      releasePointerCapture(): void {}

      getBoundingClientRect(): { left: number; top: number; right: number; bottom: number; width: number; height: number } {
        return { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 };
      }

      findAll(predicate: (el: MockDomEl) => boolean): MockDomEl[] {
        const results: MockDomEl[] = [];
        const walk = (node: MockDomEl): void => {
          if (predicate(node)) {
            results.push(node);
          }
          for (const child of node.children) {
            walk(child);
          }
        };
        walk(this);
        return results;
      }
    }

    const initialSnapshot: IImagePreviewSnapshot = {
      revision: "rev-runtime",
      changeType: "MODIFIED",
      displayPath: "images/sprite.png",
      isRenamed: false,
      sides: [
        {
          side: "base",
          label: "Base",
          path: "images/sprite.png",
          url: "https://github.com/acme/repo/blob/base/images/sprite.png",
          status: "loading",
          message: "Loading image…",
        },
        {
          side: "head",
          label: "Head",
          path: "images/sprite.png",
          url: "https://github.com/acme/repo/blob/head/images/sprite.png",
          status: "loading",
          message: "Loading image…",
        },
      ],
    };

    const html = renderImagePreviewHtml(initialSnapshot, "nonce-runtime");
    const match = /<script\b[^>]*>([\s\S]*?)<\/script>/.exec(html);
    expect(match?.[1]).toBeTruthy();
    const inlineScript = match![1];
    expect(() => new Script(inlineScript)).not.toThrow();

    const byId = new Map<string, MockDomEl>();
    const makeEl = (id: string, tagName = "div", dataset: Record<string, string> = {}): MockDomEl => {
      const el = new MockDomEl(tagName, id);
      el.dataset = dataset;
      byId.set(id, el);
      return el;
    };
    const stageWrap = makeEl("a-stage-wrap", "main");
    makeEl("a-pill", "span");
    makeEl("a-path", "span");
    const statsEl = makeEl("a-stats", "span");
    makeEl("a-diff-modes", "div");
    makeEl("a-side-toggle", "div");
    makeEl("a-zoom-out", "button");
    const zoomValBtn = makeEl("a-zoom-val", "button");
    const zoomInBtn = makeEl("a-zoom-in", "button");
    makeEl("a-fit", "button");
    const pixelBtn = makeEl("a-pixel", "button");
    pixelBtn.setAttribute("aria-pressed", "true");
    makeEl("a-github", "a");

    const modeButtons = [
      Object.assign(new MockDomEl("button"), { dataset: { mode: "split" } }),
      Object.assign(new MockDomEl("button"), { dataset: { mode: "swipe" } }),
      Object.assign(new MockDomEl("button"), { dataset: { mode: "single" } }),
    ];
    const sideButtons = [
      Object.assign(new MockDomEl("button"), { dataset: { side: "base" } }),
      Object.assign(new MockDomEl("button"), { dataset: { side: "head" } }),
    ];
    const swatchButtons = [
      Object.assign(new MockDomEl("button"), { dataset: { bg: "checker" } }),
      Object.assign(new MockDomEl("button"), { dataset: { bg: "light" } }),
    ];

    const windowListeners = new Map<string, Array<(event: Record<string, unknown>) => void>>();
    const postMessage = vi.fn();

    runInNewContext(inlineScript, {
      acquireVsCodeApi: () => ({ postMessage }),
      requestAnimationFrame: (callback: () => void) => callback(),
      document: {
        getElementById: (id: string) => byId.get(id) ?? null,
        querySelectorAll: (selector: string) => {
          if (selector === "#a-diff-modes [data-mode]") {
            return modeButtons;
          }
          if (selector === "#a-side-toggle [data-side]") {
            return sideButtons;
          }
          if (selector === "#a-swatches .ghcc-swatch") {
            return swatchButtons;
          }
          return [];
        },
        addEventListener: () => undefined,
        createElement: (tag: string) => new MockDomEl(tag),
      },
      window: {
        addEventListener: (type: string, callback: (event: Record<string, unknown>) => void) => {
          const list = windowListeners.get(type) ?? [];
          list.push(callback);
          windowListeners.set(type, list);
        },
      },
    });

    expect(postMessage).toHaveBeenCalledWith({ command: "ready" });
    expect(stageWrap.findAll((el) => el.className === "state-title")[0]?.textContent).toBe("Loading image…");

    const loadedSnapshot: IImagePreviewSnapshot = {
      ...initialSnapshot,
      sides: [
        { ...initialSnapshot.sides[0], status: "ready", dataUri: "data:image/png;base64,AA==", size: 128 },
        { ...initialSnapshot.sides[1], status: "ready", dataUri: "data:image/png;base64,BB==", size: 256 },
      ],
    };
    for (const listener of windowListeners.get("message") ?? []) {
      listener({ data: { command: "state", snapshot: loadedSnapshot } });
    }

    const imgs = stageWrap.findAll((el) => el.tagName === "img");
    expect(imgs).toHaveLength(2);
    expect(zoomInBtn.disabled).toBe(false);
    expect(pixelBtn.disabled).toBe(false);

    imgs[0].naturalWidth = 32;
    imgs[0].naturalHeight = 16;
    imgs[0].emit("load", {});
    imgs[1].naturalWidth = 32;
    imgs[1].naturalHeight = 16;
    imgs[1].emit("load", {});

    expect(stageWrap.findAll((el) => el.className === "state-empty")).toHaveLength(0);
    expect(statsEl.textContent).toBe("+128 B");
    expect(stageWrap.findAll((el) => el.textContent.includes("32×16"))).toHaveLength(2);
    expect(zoomValBtn.textContent).not.toBe("—");

    pixelBtn.click();
    expect(pixelBtn.getAttribute("aria-pressed")).toBe("false");
    expect(postMessage).toHaveBeenCalledWith({ command: "setPixelated", value: false });

    imgs[0].emit("error", {});
    expect(stageWrap.findAll((el) => el.className === "state-title").some((el) => el.textContent === "Could not load this image.")).toBe(true);
  });

  it("localizes preview HTML, toolbar labels, and loading text when locale bundle is set", async () => {
    setTestLocale("zh-cn", chineseBundle());
    const panel = mockPanel();
    const read = vi.fn().mockResolvedValue(svgFile);
    const preview = new PrImagePreview(read);

    await preview.open(change);

    expect(panel.webview.html).toContain('<html lang="zh-cn">');
    expect(panel.webview.html).toContain("<title>PR 图片预览</title>");
    expect(panel.webview.html).toContain("并排");
    expect(panel.webview.html).toContain("卷帘");
    expect(panel.webview.html).toContain("临近插值 (P)");
    expect(panel.webview.html).toContain("正在加载图片…");
    expect(lastSnapshot(panel).sides.map((side) => side.label)).toEqual(["Base", "Head"]);
  });
});
