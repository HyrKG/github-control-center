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
    expect(html).toMatch(/<main[^>]*id="a-stage-wrap"[^>]*tabindex="0"/);
  });

  it("defaults to nearest-neighbor, delegates persistence/broadcast to preference, refreshes on open/ready, and syncs standalone panels", async () => {
    let saved = true;
    const panelA = mockPanel();
    const read = vi.fn().mockResolvedValue(svgFile);
    const preference = {
      get: vi.fn(() => saved),
      set: vi.fn((value: boolean) => {
        saved = value;
        preview.syncPixelated(value);
      }),
    };
    const preview = new PrImagePreview(read, undefined, preference);

    await preview.open(change);
    expect(panelA.webview.html).toContain('"pixelated":true');

    const panelB = mockPanel();
    await preview.open({ ...change, key: "pr:other", title: "other.png (PR #42)" });
    expect(panelB.webview.html).toContain('"pixelated":true');

    // User turns off nearest-neighbor on panelA -> delegates to preference.set which broadcasts once via syncPixelated
    panelA.webview.postMessage.mockClear();
    panelB.webview.postMessage.mockClear();
    panelA.webview.emitMessage({ command: "setPixelated", value: false });

    expect(preference.set).toHaveBeenCalledExactlyOnceWith(false);
    expect(saved).toBe(false);
    expect(panelA.webview.postMessage).toHaveBeenCalledExactlyOnceWith({ command: "pixelated", value: false });
    expect(panelB.webview.postMessage).toHaveBeenCalledExactlyOnceWith({ command: "pixelated", value: false });

    // External update (e.g., from details lightbox) is picked up on ready handshake and newly opened panels
    saved = true;
    panelA.webview.postMessage.mockClear();
    panelA.webview.emitMessage({ command: "ready" });
    expect(panelA.webview.postMessage).toHaveBeenCalledWith({ command: "pixelated", value: true });

    const panelC = mockPanel();
    await preview.open({ ...change, key: "pr:third", title: "large.png (PR #42)" });
    expect(panelC.webview.html).toContain('"pixelated":true');
    expect(panelC.webview.html).toMatch(/id="a-pixel"[^>]*aria-pressed="true"/);

    // Standalone preview (without preference) still broadcasts via syncPixelated
    const standaloneA = mockPanel();
    const standalonePreview = new PrImagePreview(read);
    await standalonePreview.open(change);
    const standaloneB = mockPanel();
    await standalonePreview.open({ ...change, key: "pr:standalone-b", title: "b.png (PR #42)" });
    standaloneA.webview.postMessage.mockClear();
    standaloneB.webview.postMessage.mockClear();
    standaloneA.webview.emitMessage({ command: "setPixelated", value: false });
    expect(standaloneB.webview.postMessage).toHaveBeenCalledExactlyOnceWith({ command: "pixelated", value: false });
  });

  it("compiles its inline script cleanly and executes load, Tab guard, pixelated sync, decode error persistence, and primary link alignment", async () => {
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
      decode?: () => Promise<void>;
      parentNode: MockDomEl | null = null;
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
        for (const child of this.children) {
          child.parentNode = null;
        }
        this.children = [];
      }

      get firstElementChild(): MockDomEl | null {
        return this.children[0] ?? null;
      }

      set innerHTML(_value: string) {
        for (const child of this.children) {
          child.parentNode = null;
        }
        this.children = [];
      }

      append(...nodes: Array<MockDomEl | string>): void {
        for (const node of nodes) {
          if (node instanceof MockDomEl) {
            node.parentNode = this;
            this.children.push(node);
          } else {
            this._textContent += node;
          }
        }
      }

      appendChild(node: MockDomEl): MockDomEl {
        node.parentNode = this;
        this.children.push(node);
        return node;
      }

      remove(): void {
        if (this.parentNode) {
          const idx = this.parentNode.children.indexOf(this);
          if (idx >= 0) {
            this.parentNode.children.splice(idx, 1);
          }
          this.parentNode = null;
        }
      }

      contains(target: MockDomEl | null): boolean {
        let cur: MockDomEl | null = target;
        while (cur) {
          if (cur === this) {
            return true;
          }
          cur = cur.parentNode;
        }
        return false;
      }

      setAttribute(name: string, value: string): void {
        this.attrs.set(name, String(value));
      }

      getAttribute(name: string): string | null {
        return this.attrs.get(name) ?? null;
      }

      closest(selector: string): MockDomEl | null {
        const selectors = selector.split(",").map((part) => part.trim());
        for (const candidate of selectors) {
          if (candidate.startsWith(".") && this.className.split(/\s+/).includes(candidate.slice(1))) {
            return this;
          }
          if (!candidate.startsWith(".") && this.tagName.toLowerCase() === candidate.toLowerCase()) {
            return this;
          }
        }
        return this.parentNode?.closest(selector) ?? null;
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

    function bootVm(snapshot: IImagePreviewSnapshot, onCreateElement?: (el: MockDomEl) => void) {
      const html = renderImagePreviewHtml(snapshot, "nonce-runtime");
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
      const toolbar = new MockDomEl("header");
      toolbar.className = "pr-img-toolbar";
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
      toolbar.appendChild(pixelBtn);
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

      const docListeners = new Map<string, Array<(event: Record<string, unknown>) => void>>();
      const windowListeners = new Map<string, Array<(event: Record<string, unknown>) => void>>();
      const postMessage = vi.fn();
      const mockDocument: {
        activeElement: MockDomEl | null;
        getElementById: (id: string) => MockDomEl | null;
        querySelectorAll: (selector: string) => MockDomEl[];
        addEventListener: (type: string, callback: (event: Record<string, unknown>) => void) => void;
        createElement: (tag: string) => MockDomEl;
      } = {
        activeElement: null,
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
        addEventListener: (type: string, callback: (event: Record<string, unknown>) => void) => {
          const list = docListeners.get(type) ?? [];
          list.push(callback);
          docListeners.set(type, list);
        },
        createElement: (tag: string) => {
          const el = new MockDomEl(tag);
          onCreateElement?.(el);
          return el;
        },
      };

      runInNewContext(inlineScript, {
        acquireVsCodeApi: () => ({ postMessage }),
        requestAnimationFrame: (callback: () => void) => callback(),
        queueMicrotask,
        setTimeout,
        clearTimeout,
        document: mockDocument,
        window: {
          addEventListener: (type: string, callback: (event: Record<string, unknown>) => void) => {
            const list = windowListeners.get(type) ?? [];
            list.push(callback);
            windowListeners.set(type, list);
          },
        },
      });

      const emitWindow = (type: string, event: Record<string, unknown>): void => {
        for (const listener of windowListeners.get(type) ?? []) {
          listener(event);
        }
      };
      const emitDoc = (type: string, event: Record<string, unknown>): void => {
        for (const listener of docListeners.get(type) ?? []) {
          listener(event);
        }
      };

      return {
        stageWrap,
        statsEl,
        zoomValBtn,
        zoomInBtn,
        pixelBtn,
        modeButtons,
        sideButtons,
        postMessage,
        mockDocument,
        emitWindow,
        emitDoc,
      };
    }

    // 1. Happy path: ready -> state -> load -> Toggle Tab guard -> host pixelated sync
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

    const vm = bootVm(initialSnapshot);
    expect(vm.postMessage).toHaveBeenCalledWith({ command: "ready" });
    expect(vm.stageWrap.findAll((el) => el.className === "state-title")[0]?.textContent).toBe("Loading image…");

    const loadedSnapshot: IImagePreviewSnapshot = {
      ...initialSnapshot,
      sides: [
        { ...initialSnapshot.sides[0], status: "ready", dataUri: "data:image/png;base64,AA==", size: 128 },
        { ...initialSnapshot.sides[1], status: "ready", dataUri: "data:image/png;base64,BB==", size: 256 },
      ],
    };
    vm.emitWindow("message", { data: { command: "state", snapshot: loadedSnapshot } });

    const imgs = vm.stageWrap.findAll((el) => el.tagName === "img");
    expect(imgs).toHaveLength(2);
    expect(vm.zoomInBtn.disabled).toBe(false);
    expect(vm.pixelBtn.disabled).toBe(false);

    imgs[0].naturalWidth = 32;
    imgs[0].naturalHeight = 16;
    imgs[0].emit("load", {});
    imgs[1].naturalWidth = 32;
    imgs[1].naturalHeight = 16;
    imgs[1].emit("load", {});

    expect(vm.stageWrap.findAll((el) => el.className === "state-empty")).toHaveLength(0);
    expect(vm.statsEl.textContent).toBe("+128 B");
    expect(vm.stageWrap.findAll((el) => el.textContent.includes("32×16"))).toHaveLength(2);
    expect(vm.zoomValBtn.textContent).not.toBe("—");

    // Toggle mode Tab: toolbar focus & Shift+Tab pass through; forward Tab on stage or stage canvas flips head <-> base
    vm.modeButtons[2].click();
    expect(vm.sideButtons[1].getAttribute("aria-pressed")).toBe("true");
    vm.mockDocument.activeElement = vm.pixelBtn;
    const toolbarTab = { key: "Tab", shiftKey: false, target: vm.pixelBtn, preventDefault: vi.fn() };
    vm.emitDoc("keydown", toolbarTab);
    expect(toolbarTab.preventDefault).not.toHaveBeenCalled();
    expect(vm.sideButtons[1].getAttribute("aria-pressed")).toBe("true");

    vm.mockDocument.activeElement = vm.stageWrap;
    const shiftTab = { key: "Tab", shiftKey: true, target: vm.stageWrap, preventDefault: vi.fn() };
    vm.emitDoc("keydown", shiftTab);
    expect(shiftTab.preventDefault).not.toHaveBeenCalled();
    expect(vm.sideButtons[1].getAttribute("aria-pressed")).toBe("true");

    const stageTab = { key: "Tab", shiftKey: false, target: vm.stageWrap, preventDefault: vi.fn() };
    vm.emitDoc("keydown", stageTab);
    expect(stageTab.preventDefault).toHaveBeenCalledOnce();
    expect(vm.sideButtons[0].getAttribute("aria-pressed")).toBe("true");

    const stageCanvas = vm.stageWrap.findAll((el) => el.className.includes("canvas-vp"))[0];
    vm.mockDocument.activeElement = stageCanvas;
    const canvasTab = { key: "Tab", shiftKey: false, target: stageCanvas, preventDefault: vi.fn() };
    vm.emitDoc("keydown", canvasTab);
    expect(canvasTab.preventDefault).toHaveBeenCalledOnce();
    expect(vm.sideButtons[1].getAttribute("aria-pressed")).toBe("true");

    const stageExtLink = vm.stageWrap.findAll((el) => el.className === "pane-ext-link")[0];
    vm.mockDocument.activeElement = stageExtLink;
    const stageLinkTab = { key: "Tab", shiftKey: false, target: stageExtLink, preventDefault: vi.fn() };
    vm.emitDoc("keydown", stageLinkTab);
    expect(stageLinkTab.preventDefault).not.toHaveBeenCalled();
    expect(vm.sideButtons[1].getAttribute("aria-pressed")).toBe("true");

    // Local toggle posts setPixelated; incoming host sync updates UI without echoing
    vm.postMessage.mockClear();
    vm.pixelBtn.click();
    expect(vm.pixelBtn.getAttribute("aria-pressed")).toBe("false");
    expect(vm.postMessage).toHaveBeenCalledExactlyOnceWith({ command: "setPixelated", value: false });

    vm.postMessage.mockClear();
    vm.emitWindow("message", { data: { command: "pixelated", value: true } });
    expect(vm.pixelBtn.getAttribute("aria-pressed")).toBe("true");
    expect(vm.postMessage).not.toHaveBeenCalled();

    // 2. Decode rejection persists across late state snapshots for the same dataUri
    const decodeVm = bootVm(initialSnapshot, (el) => {
      if (el.tagName === "img") {
        el.decode = () => Promise.reject(new Error("corrupt image"));
      }
    });
    const baseReadyHeadLoading: IImagePreviewSnapshot = {
      ...initialSnapshot,
      sides: [
        { ...initialSnapshot.sides[0], status: "ready", dataUri: "data:image/png;base64,BAD=", size: 16 },
        { ...initialSnapshot.sides[1], status: "loading", message: "Loading image…" },
      ],
    };
    decodeVm.emitWindow("message", { data: { command: "state", snapshot: baseReadyHeadLoading } });
    const badImg = decodeVm.stageWrap.findAll((el) => el.tagName === "img")[0];
    badImg.naturalWidth = 10;
    badImg.naturalHeight = 10;
    badImg.emit("load", {});
    await new Promise((resolve) => setImmediate(resolve));
    expect(decodeVm.stageWrap.findAll((el) => el.tagName === "img")).toHaveLength(0);

    // Late snapshot arrives with Head ready and Base still carrying the same failed dataUri -> Base stays error
    const lateSnapshot: IImagePreviewSnapshot = {
      ...initialSnapshot,
      sides: [
        { ...initialSnapshot.sides[0], status: "ready", dataUri: "data:image/png;base64,BAD=", size: 16 },
        { ...initialSnapshot.sides[1], status: "ready", dataUri: "data:image/png;base64,GOOD=", size: 64 },
      ],
    };
    decodeVm.emitWindow("message", { data: { command: "state", snapshot: lateSnapshot } });
    expect(decodeVm.stageWrap.findAll((el) => el.tagName === "img")).toHaveLength(1);
    expect(decodeVm.stageWrap.findAll((el) => el.tagName === "img")[0].src).toBe("data:image/png;base64,GOOD=");
    expect(decodeVm.stageWrap.findAll((el) => el.className === "state-title").some((el) => el.textContent === "Could not load this image.")).toBe(true);

    // Replacing Base with a new dataUri clears the stale failed state and renders normally
    const recoveredVm = bootVm(initialSnapshot, (el) => {
      if (el.tagName === "img") {
        el.decode = () => (el.src.includes("BAD=") ? Promise.reject(new Error("corrupt")) : Promise.resolve());
      }
    });
    recoveredVm.emitWindow("message", { data: { command: "state", snapshot: baseReadyHeadLoading } });
    const failingBaseImg = recoveredVm.stageWrap.findAll((el) => el.tagName === "img")[0];
    failingBaseImg.naturalWidth = 10;
    failingBaseImg.naturalHeight = 10;
    failingBaseImg.emit("load", {});
    await new Promise((resolve) => setImmediate(resolve));
    expect(recoveredVm.stageWrap.findAll((el) => el.tagName === "img")).toHaveLength(0);

    const recoveredSnapshot: IImagePreviewSnapshot = {
      ...initialSnapshot,
      sides: [
        { ...initialSnapshot.sides[0], status: "ready", dataUri: "data:image/png;base64,RECOVERED=", size: 48 },
        { ...initialSnapshot.sides[1], status: "ready", dataUri: "data:image/png;base64,HEAD_OK=", size: 64 },
      ],
    };
    recoveredVm.emitWindow("message", { data: { command: "state", snapshot: recoveredSnapshot } });
    const recoveredImgs = recoveredVm.stageWrap.findAll((el) => el.tagName === "img");
    expect(recoveredImgs).toHaveLength(2);
    expect(recoveredImgs[0].src).toBe("data:image/png;base64,RECOVERED=");
    recoveredImgs[0].naturalWidth = 40;
    recoveredImgs[0].naturalHeight = 20;
    recoveredImgs[0].emit("load", {});
    recoveredImgs[1].naturalWidth = 40;
    recoveredImgs[1].naturalHeight = 20;
    recoveredImgs[1].emit("load", {});
    await new Promise((resolve) => setImmediate(resolve));
    expect(recoveredVm.stageWrap.findAll((el) => el.className === "state-empty")).toHaveLength(0);

    // 3. Complete-broken images (complete === true && naturalWidth === 0) defer failure without re-entrant DOM stacking
    const syncBrokenVm = bootVm(initialSnapshot, (el) => {
      if (el.tagName === "img") {
        el.complete = true;
        el.naturalWidth = 0;
        el.naturalHeight = 0;
      }
    });
    syncBrokenVm.emitWindow("message", { data: { command: "state", snapshot: loadedSnapshot } });
    await new Promise((resolve) => setImmediate(resolve));
    expect(syncBrokenVm.stageWrap.children).toHaveLength(1);
    expect(syncBrokenVm.stageWrap.findAll((el) => el.className === "state-empty")).toHaveLength(1);
    expect(syncBrokenVm.stageWrap.findAll((el) => el.className === "pane")).toHaveLength(0);
    expect(syncBrokenVm.stageWrap.findAll((el) => el.tagName === "img")).toHaveLength(0);
    expect(syncBrokenVm.stageWrap.findAll((el) => el.className === "state-title")[0]?.textContent).toBe("Could not load this image.");

    // 4. User zoom & pan while img.decode() is in-flight is preserved after decode() resolves
    const pendingDecodes: Array<() => void> = [];
    const inFlightVm = bootVm(initialSnapshot, (el) => {
      if (el.tagName === "img") {
        el.decode = () => new Promise<void>((resolve) => {
          pendingDecodes.push(resolve);
        });
      }
    });
    inFlightVm.emitWindow("message", { data: { command: "state", snapshot: loadedSnapshot } });
    const inFlightImgs = inFlightVm.stageWrap.findAll((el) => el.tagName === "img");
    inFlightImgs[0].naturalWidth = 32;
    inFlightImgs[0].naturalHeight = 16;
    inFlightImgs[0].emit("load", {});
    inFlightImgs[1].naturalWidth = 32;
    inFlightImgs[1].naturalHeight = 16;
    inFlightImgs[1].emit("load", {});
    expect(pendingDecodes).toHaveLength(2);

    // User zooms in and pans before decode() settles
    inFlightVm.zoomInBtn.click();
    const firstVp = inFlightVm.stageWrap.findAll((el) => el.className.includes("canvas-vp"))[0];
    firstVp.emit("pointerdown", { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    firstVp.emit("pointermove", { clientX: 140, clientY: 120 });
    firstVp.emit("pointerup", {});
    expect(inFlightVm.zoomValBtn.textContent).toBe("125%");
    const transformBeforeDecode = inFlightImgs[0].style.transform;
    expect(transformBeforeDecode).toBe("translate(40px, 20px) translate(-50%, -50%) scale(1.25)");

    pendingDecodes.forEach((resolve) => resolve());
    await new Promise((resolve) => setImmediate(resolve));
    expect(inFlightVm.zoomValBtn.textContent).toBe("125%");
    expect(inFlightImgs[0].style.transform).toBe(transformBeforeDecode);
    expect(inFlightImgs[1].style.transform).toBe(transformBeforeDecode);

    // 5. Empty stage aligns external link href with primary side (toolarge Base over error Head)
    const emptySnapshot: IImagePreviewSnapshot = {
      revision: "rev-empty",
      changeType: "MODIFIED",
      displayPath: "images/huge.png",
      isRenamed: false,
      sides: [
        {
          side: "base",
          label: "Base",
          path: "images/huge.png",
          url: "https://github.com/acme/repo/blob/base/images/huge.png",
          status: "toolarge",
          message: "The image exceeds the 10 MB preview limit.",
        },
        {
          side: "head",
          label: "Head",
          path: "images/huge.png",
          url: "https://github.com/acme/repo/blob/head/images/huge.png",
          status: "error",
          message: "Could not load this image.",
        },
      ],
    };
    const emptyVm = bootVm(emptySnapshot);
    const actionLink = emptyVm.stageWrap.findAll((el) => el.className === "state-action")[0];
    expect(actionLink?.href).toBe("https://github.com/acme/repo/blob/base/images/huge.png");

    // 6. Fitted state refits when larger second side arrives asynchronously and on Toggle side switch
    const refitVm = bootVm(initialSnapshot);
    const baseOnlyReady: IImagePreviewSnapshot = {
      ...initialSnapshot,
      sides: [
        { ...initialSnapshot.sides[0], status: "ready", dataUri: "data:image/png;base64,SMALL_BASE=", size: 64 },
        { ...initialSnapshot.sides[1], status: "loading", message: "Loading image…" },
      ],
    };
    refitVm.emitWindow("message", { data: { command: "state", snapshot: baseOnlyReady } });
    const baseSmallImg = refitVm.stageWrap.findAll((el) => el.tagName === "img")[0];
    baseSmallImg.naturalWidth = 32;
    baseSmallImg.naturalHeight = 16;
    baseSmallImg.emit("load", {});
    await new Promise((resolve) => setImmediate(resolve));
    expect(refitVm.zoomValBtn.textContent).toBe("700%");
    expect(baseSmallImg.style.transform).toContain("scale(7)");

    const bothDifferentSizes: IImagePreviewSnapshot = {
      ...initialSnapshot,
      sides: [
        { ...initialSnapshot.sides[0], status: "ready", dataUri: "data:image/png;base64,SMALL_BASE=", size: 64 },
        { ...initialSnapshot.sides[1], status: "ready", dataUri: "data:image/png;base64,LARGE_HEAD=", size: 1024 },
      ],
    };
    refitVm.emitWindow("message", { data: { command: "state", snapshot: bothDifferentSizes } });
    const refitImgs = refitVm.stageWrap.findAll((el) => el.tagName === "img");
    expect(refitImgs).toHaveLength(2);
    refitImgs[1].naturalWidth = 400;
    refitImgs[1].naturalHeight = 300;
    refitImgs[1].emit("load", {});
    await new Promise((resolve) => setImmediate(resolve));
    expect(refitVm.zoomValBtn.textContent).toBe("100%");
    expect(refitImgs[0].style.transform).toContain("scale(1)");
    expect(refitImgs[1].style.transform).toContain("scale(1)");

    // Toggle mode while still fitted refits when switching between Head (400×300) and Base (32×16)
    refitVm.modeButtons[2].click();
    expect(refitVm.zoomValBtn.textContent).toBe("100%");
    refitVm.sideButtons[0].click();
    expect(refitVm.zoomValBtn.textContent).toBe("700%");
    refitVm.sideButtons[1].click();
    expect(refitVm.zoomValBtn.textContent).toBe("100%");

    // Manual zoom in Toggle mode disables auto-fit and preserves transform across side switches
    refitVm.zoomInBtn.click();
    expect(refitVm.zoomValBtn.textContent).toBe("125%");
    refitVm.sideButtons[0].click();
    expect(refitVm.zoomValBtn.textContent).toBe("125%");
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
