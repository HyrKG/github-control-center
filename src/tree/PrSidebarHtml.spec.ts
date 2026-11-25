import { runInNewContext, Script } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import {
  buildSidebarFileTree,
  formatDiffNumber,
  renderSidebarHtml,
  type ISidebarClientStrings,
  type ISidebarSnapshot,
} from "./PrSidebarHtml";
import type { IPrFile } from "../core/types";

const DEFAULT_STRINGS: ISidebarClientStrings = {
  signInMessage: "Sign in to GitHub to see pull requests waiting for your review.",
  signInButton: "Sign in to GitHub",
  emptyMessage: "No pull requests waiting for your review. All clear. 🎉",
  loadingFiles: "Loading files…",
  retry: "Retry",
  noChangedFiles: "No changed files",
  checkoutBranch: "Checkout branch",
  openOnGitHub: "Open on GitHub",
  markAsViewed: "Mark file as viewed",
  markAsUnviewed: "Mark file as unviewed",
  expandPr: "Toggle changed files",
  expandRepo: "Toggle repository",
  expandFolder: "Toggle folder",
};

function extractScripts(html: string): { bootJson: string; scriptCode: string } {
  const bootMatch = /<script id="ghcc-boot" type="application\/json" nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html);
  expect(bootMatch).not.toBeNull();
  const scriptMatches = [...html.matchAll(/<script nonce="[^"]+">([\s\S]*?)<\/script>/g)];
  expect(scriptMatches).toHaveLength(1);
  return { bootJson: bootMatch![1], scriptCode: scriptMatches[0][1] };
}

class MockClassList {
  private readonly set = new Set<string>();

  syncFrom(className: string): void {
    this.set.clear();
    for (const token of className.split(/\s+/).filter(Boolean)) {
      this.set.add(token);
    }
  }

  toString(): string {
    return [...this.set].join(" ");
  }

  add(...tokens: string[]): void {
    for (const token of tokens) {
      this.set.add(token);
    }
  }

  remove(...tokens: string[]): void {
    for (const token of tokens) {
      this.set.delete(token);
    }
  }

  toggle(token: string, force?: boolean): boolean {
    if (force === true) {
      this.set.add(token);
      return true;
    }
    if (force === false) {
      this.set.delete(token);
      return false;
    }
    if (this.set.has(token)) {
      this.set.delete(token);
      return false;
    }
    this.set.add(token);
    return true;
  }

  contains(token: string): boolean {
    return this.set.has(token);
  }
}

class MockElement {
  readonly tagName: string;
  readonly attributes = new Map<string, string>();
  readonly children: MockElement[] = [];
  readonly classList = new MockClassList();
  private readonly listeners = new Map<string, Array<(event: MockEvent) => void>>();
  private _textContent = "";
  parentNode: MockElement | null = null;
  type = "";
  tabIndex = 0;

  constructor(
    tagName: string,
    private readonly ownerDoc: MockDocument,
  ) {
    this.tagName = tagName.toLowerCase();
  }

  get className(): string {
    return this.classList.toString();
  }

  set className(value: string) {
    this.classList.syncFrom(value);
  }

  get textContent(): string {
    if (this.children.length === 0) {
      return this._textContent;
    }
    return this._textContent + this.children.map((child) => child.textContent).join("");
  }

  set textContent(value: string) {
    this._textContent = String(value);
    this.children.length = 0;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, String(value));
    if (name === "class") {
      this.className = String(value);
    }
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  appendChild(child: MockElement): MockElement {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...nodes: MockElement[]): void {
    this.children.length = 0;
    this._textContent = "";
    for (const node of nodes) {
      this.appendChild(node);
    }
  }

  addEventListener(type: string, listener: (event: MockEvent) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  focus(): void {
    this.ownerDoc.activeElement = this;
  }

  click(): void {
    this.dispatchEvent({ type: "click", stopped: false, defaultPrevented: false, stopPropagation() { this.stopped = true; }, preventDefault() { this.defaultPrevented = true; } });
  }

  dispatchEvent(event: MockEvent): void {
    for (const listener of this.listeners.get(event.type) ?? []) {
      listener(event);
    }
    if (!event.stopped) {
      this.parentNode?.dispatchEvent(event);
    }
  }

  findAll(predicate: (el: MockElement) => boolean): MockElement[] {
    const out: MockElement[] = [];
    const visit = (node: MockElement): void => {
      for (const child of node.children) {
        if (predicate(child)) {
          out.push(child);
        }
        visit(child);
      }
    };
    visit(this);
    return out;
  }

  querySelectorAll(selector: string): MockElement[] {
    if (selector === "[data-row-id]") {
      return this.findAll((el) => el.getAttribute("data-row-id") !== null);
    }
    if (selector.startsWith(".")) {
      const cls = selector.slice(1);
      return this.findAll((el) => el.classList.contains(cls));
    }
    return [];
  }
}

interface MockEvent {
  type: string;
  key?: string;
  stopped: boolean;
  defaultPrevented: boolean;
  stopPropagation: () => void;
  preventDefault: () => void;
}

class MockDocument {
  activeElement: MockElement | null = null;
  readonly app: MockElement;
  readonly boot: MockElement;
  private readonly listeners = new Map<string, Array<(event: MockEvent) => void>>();

  constructor(bootJson: string) {
    this.app = new MockElement("div", this);
    this.boot = new MockElement("script", this);
    this.boot.textContent = bootJson;
  }

  getElementById(id: string): MockElement | null {
    if (id === "app") {
      return this.app;
    }
    if (id === "ghcc-boot") {
      return this.boot;
    }
    return null;
  }

  createElement(tag: string): MockElement {
    return new MockElement(tag, this);
  }

  createElementNS(_ns: string, tag: string): MockElement {
    return new MockElement(tag, this);
  }

  addEventListener(type: string, listener: (event: MockEvent) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  emitKeydown(key: string): MockEvent {
    const event: MockEvent = {
      type: "keydown",
      key,
      stopped: false,
      defaultPrevented: false,
      stopPropagation() { this.stopped = true; },
      preventDefault() { this.defaultPrevented = true; },
    };
    for (const listener of this.listeners.get("keydown") ?? []) {
      listener(event);
    }
    return event;
  }
}

function bootSidebarVm(initialSnapshot?: ISidebarSnapshot, initialPersistedState?: unknown) {
  const html = renderSidebarHtml("nonce-xyz", "en", DEFAULT_STRINGS, initialSnapshot);
  const { bootJson, scriptCode } = extractScripts(html);
  // Assert clean compilation before execution
  new Script(scriptCode);

  const mockDocument = new MockDocument(bootJson);
  const postMessage = vi.fn();
  let persistedState = initialPersistedState;
  const setState = vi.fn((next: unknown) => {
    persistedState = next;
  });
  const getState = vi.fn(() => persistedState);
  const windowListeners = new Map<string, Array<(event: { data: unknown }) => void>>();
  const scrollTo = vi.fn();

  const mockWindow = {
    scrollY: 0,
    scrollTo,
    addEventListener(type: string, listener: (event: { data: unknown }) => void) {
      const list = windowListeners.get(type) ?? [];
      list.push(listener);
      windowListeners.set(type, list);
    },
  };

  runInNewContext(scriptCode, {
    document: mockDocument,
    window: mockWindow,
    acquireVsCodeApi: () => ({ postMessage, getState, setState }),
    Set,
    Array,
    JSON,
    Math,
    String,
    Boolean,
    isFinite,
  });

  function sendState(snapshot: ISidebarSnapshot): void {
    for (const listener of windowListeners.get("message") ?? []) {
      listener({ data: { command: "state", snapshot } });
    }
  }

  return { html, scriptCode, mockDocument, mockWindow, postMessage, getState, setState, sendState };
}

function sampleExpandedSnapshot(layout: "tree" | "flat" = "tree"): ISidebarSnapshot {
  const files: IPrFile[] = [
    { path: "src/components/VeryLongFileNameForNarrowSidebarTest.tsx", changeType: "DELETED", additions: 0, deletions: 1320, viewedState: "UNVIEWED" },
    { path: "src/components/Widget.ts", changeType: "ADDED", additions: 27, deletions: 0, viewedState: "VIEWED" },
    { path: "README.md", changeType: "MODIFIED", additions: 1868, deletions: 102, viewedState: "UNVIEWED" },
  ];
  const toView = (file: IPrFile) => {
    const slash = file.path.lastIndexOf("/");
    return {
      path: file.path,
      name: file.path.slice(slash + 1),
      dir: slash === -1 ? "" : file.path.slice(0, slash),
      changeType: file.changeType,
      additions: file.additions,
      deletions: file.deletions,
      viewed: file.viewedState === "VIEWED",
      tooltip: `${file.path}\n+${file.additions} −${file.deletions} · ${file.changeType}`,
    };
  };
  const tree = buildSidebarFileTree(files, toView);
  return {
    signedIn: true,
    layout,
    groups: [
      {
        repo: "acme/control-center",
        prs: [
          {
            id: "PR_1",
            number: 42,
            title: "Refactor sidebar into custom webview with diffstats",
            repo: "acme/control-center",
            author: "octocat",
            isDraft: false,
            ciState: "SUCCESS",
            reviewGlyph: "✓",
            reviewTone: "approved",
            additions: 1895,
            deletions: 1422,
            meta: "octocat · opened today · ✓ you approved",
            tooltip: "acme/control-center\nRefactor sidebar",
            expanded: true,
            filesState:
              layout === "tree"
                ? { status: "loaded", totalCount: files.length, folders: tree.folders, files: tree.files }
                : { status: "loaded", totalCount: files.length, folders: [], files: files.map(toView) },
          },
        ],
      },
    ],
  };
}

describe("formatDiffNumber", () => {
  it("formats zero and large numbers with thousand separators", () => {
    expect(formatDiffNumber(0)).toBe("0");
    expect(formatDiffNumber(27)).toBe("27");
    expect(formatDiffNumber(1320)).toBe("1,320");
    expect(formatDiffNumber(1868)).toBe("1,868");
    expect(formatDiffNumber(1_234_567)).toBe("1,234,567");
    expect(formatDiffNumber(-5)).toBe("0");
  });
});

describe("buildSidebarFileTree", () => {
  it("reuses fileTree compaction and sums additions/deletions across nested folders", () => {
    const files: IPrFile[] = [
      { path: "src/a/b/one.ts", changeType: "ADDED", additions: 100, deletions: 0, viewedState: "UNVIEWED" },
      { path: "src/a/b/two.ts", changeType: "DELETED", additions: 0, deletions: 1320, viewedState: "VIEWED" },
      { path: "README.md", changeType: "MODIFIED", additions: 5, deletions: 2, viewedState: "UNVIEWED" },
    ];
    const root = buildSidebarFileTree(files, (file) => ({
      path: file.path,
      name: file.path.slice(file.path.lastIndexOf("/") + 1),
      dir: file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "",
      changeType: file.changeType,
      additions: file.additions,
      deletions: file.deletions,
      viewed: file.viewedState === "VIEWED",
      tooltip: file.path,
    }));

    expect(root.additions).toBe(105);
    expect(root.deletions).toBe(1322);
    expect(root.folders).toHaveLength(1);
    expect(root.folders[0]).toMatchObject({
      name: "src/a/b",
      path: "src/a/b",
      additions: 100,
      deletions: 1320,
    });
    expect(root.files.map((file) => file.name)).toEqual(["README.md"]);
  });
});

describe("renderSidebarHtml security & CSS priority", () => {
  it("enforces strict nonce-only CSP with zero inline handlers, zero inline styles, and zero innerHTML", () => {
    const html = renderSidebarHtml("nonce-abc", "zh-cn", DEFAULT_STRINGS);

    expect(html).toContain('<html lang="zh-cn">');
    expect(html).toContain("default-src 'none'; style-src 'nonce-nonce-abc'; script-src 'nonce-nonce-abc';");
    expect(html).toContain('<style nonce="nonce-abc">');
    expect(html).toContain('<script nonce="nonce-abc">');
    expect(html).not.toContain("unsafe-inline");
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    expect(html).not.toContain(' style="');
    expect(html).not.toContain("innerHTML");
  });

  it("declares narrow-column priority layout CSS for diffstat, truncation, and line-2 PR actions", () => {
    const html = renderSidebarHtml("nonce-css", "en", DEFAULT_STRINGS);

    // Priority right-side diffstat never shrinks or wraps and uses tabular numerals
    expect(html).toMatch(/\.diffstat\s*\{[^}]*flex:\s*0 0 auto;[^}]*margin-left:\s*auto;[^}]*white-space:\s*nowrap;[^}]*font-variant-numeric:\s*tabular-nums;/s);
    // Left containers shrink to 0 and truncate with ellipsis
    expect(html).toMatch(/\.file-main\s*\{[^}]*flex:\s*1 1 0;[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;/s);
    expect(html).toMatch(/\.file-name\s*\{[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);
    expect(html).toMatch(/\.pr-title-wrap\s*\{[^}]*flex:\s*1 1 0;[^}]*min-width:\s*0;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);
    // Flat-mode directory shrinks before the filename
    expect(html).toMatch(/\.file-dir\s*\{[^}]*flex:\s*0 1000 auto;[^}]*min-width:\s*0;/s);
    // Uses VS Code theme CSS variables
    expect(html).toContain("--vscode-sideBar-background");
    expect(html).toContain("--vscode-charts-green");
    expect(html).toContain("--vscode-charts-red");
    expect(html).toContain("--vscode-gitDecoration-addedResourceForeground");
    expect(html).toContain("--vscode-gitDecoration-deletedResourceForeground");
    expect(html).toContain("--vscode-gitDecoration-modifiedResourceForeground");
    expect(html).toContain("--vscode-gitDecoration-renamedResourceForeground");
  });
});

describe("sidebar webview runtime (node:vm)", () => {
  it("boots cleanly, posts ready, and handles signed-out and empty states", () => {
    const vm = bootSidebarVm({ signedIn: false, layout: "tree", groups: [] });

    expect(vm.postMessage).toHaveBeenCalledExactlyOnceWith({ command: "ready" });
    expect(vm.mockDocument.app.textContent).toContain(DEFAULT_STRINGS.signInMessage);
    const signInBtn = vm.mockDocument.app.findAll((el) => el.classList.contains("btn-primary"))[0];
    expect(signInBtn?.textContent).toBe("Sign in to GitHub");

    vm.postMessage.mockClear();
    signInBtn.click();
    expect(vm.postMessage).toHaveBeenCalledExactlyOnceWith({ command: "signIn" });

    vm.sendState({ signedIn: true, layout: "tree", groups: [] });
    expect(vm.mockDocument.app.textContent).toContain(DEFAULT_STRINGS.emptyMessage);
    expect(vm.mockDocument.app.findAll((el) => el.classList.contains("btn-primary"))).toHaveLength(0);
  });

  it("renders repo groups, PR rows, compacted folders, and file rows with explicit right-aligned +0/-1,320 diffstats", () => {
    const vm = bootSidebarVm(sampleExpandedSnapshot("tree"));

    const repoRows = vm.mockDocument.app.querySelectorAll(".repo-row");
    expect(repoRows).toHaveLength(1);
    expect(repoRows[0].findAll((el) => el.classList.contains("repo-name"))[0].textContent).toBe("acme/control-center");
    expect(repoRows[0].findAll((el) => el.classList.contains("repo-count"))[0].textContent).toBe("1");

    const prRows = vm.mockDocument.app.querySelectorAll(".pr-row");
    expect(prRows).toHaveLength(1);
    const prContext = JSON.parse(prRows[0].getAttribute("data-vscode-context")!);
    expect(prContext).toEqual({ webviewSection: "pr", prId: "PR_1", preventDefaultContextMenuItems: true });
    expect(prRows[0].findAll((el) => el.classList.contains("pr-num"))[0].textContent).toBe("#42");
    expect(prRows[0].findAll((el) => el.classList.contains("diff-add"))[0].textContent).toBe("+1,895");
    expect(prRows[0].findAll((el) => el.classList.contains("diff-del"))[0].textContent).toBe("-1,422");
    // Hover actions live exclusively inside .pr-line-2 (never .pr-line-1)
    const line1 = prRows[0].findAll((el) => el.classList.contains("pr-line-1"))[0];
    const line2 = prRows[0].findAll((el) => el.classList.contains("pr-line-2"))[0];
    expect(line1.findAll((el) => el.classList.contains("pr-actions"))).toHaveLength(0);
    expect(line2.findAll((el) => el.classList.contains("pr-action-btn"))).toHaveLength(2);

    // Compacted folder row with aggregated diffstat
    const folderRows = vm.mockDocument.app.querySelectorAll(".folder-row");
    expect(folderRows).toHaveLength(1);
    expect(folderRows[0].findAll((el) => el.classList.contains("folder-name"))[0].textContent).toBe("src/components");
    expect(folderRows[0].findAll((el) => el.classList.contains("diff-add"))[0].textContent).toBe("+27");
    expect(folderRows[0].findAll((el) => el.classList.contains("diff-del"))[0].textContent).toBe("-1,320");

    // File rows show explicit +0 / -0 and thousand separators
    const fileRows = vm.mockDocument.app.querySelectorAll(".file-row");
    expect(fileRows).toHaveLength(3);
    const diffstats = fileRows.map((row) => [
      row.findAll((el) => el.classList.contains("file-name"))[0].textContent,
      row.findAll((el) => el.classList.contains("diff-add"))[0].textContent,
      row.findAll((el) => el.classList.contains("diff-del"))[0].textContent,
    ]);
    expect(diffstats).toEqual([
      ["VeryLongFileNameForNarrowSidebarTest.tsx", "+0", "-1,320"],
      ["Widget.ts", "+27", "-0"],
      ["README.md", "+1,868", "-102"],
    ]);

    // Tree layout omits .file-dir; flat layout shows .file-dir
    expect(vm.mockDocument.app.querySelectorAll(".file-dir")).toHaveLength(0);
    const firstFileContext = JSON.parse(fileRows[0].getAttribute("data-vscode-context")!);
    expect(firstFileContext).toEqual({
      webviewSection: "prFile",
      prId: "PR_1",
      filePath: "src/components/VeryLongFileNameForNarrowSidebarTest.tsx",
      preventDefaultContextMenuItems: true,
    });

    vm.sendState(sampleExpandedSnapshot("flat"));
    expect(vm.mockDocument.app.querySelectorAll(".folder-row")).toHaveLength(0);
    const flatDirs = vm.mockDocument.app.querySelectorAll(".file-dir").map((el) => el.textContent);
    expect(flatDirs).toEqual(["src/components", "src/components"]);
  });

  it("handles PR actions, checkbox optimistic toggle without opening diff, rollback from host, and retry on load error", () => {
    const vm = bootSidebarVm(sampleExpandedSnapshot("tree"));
    vm.postMessage.mockClear();

    const prRow = vm.mockDocument.app.querySelectorAll(".pr-row")[0];
    const [checkoutBtn, openExtBtn] = prRow.findAll((el) => el.classList.contains("pr-action-btn"));
    checkoutBtn.click();
    openExtBtn.click();
    expect(vm.postMessage.mock.calls).toEqual([
      [{ command: "checkoutPr", prId: "PR_1" }],
      [{ command: "openPrExternal", prId: "PR_1" }],
    ]);

    vm.postMessage.mockClear();
    prRow.findAll((el) => el.classList.contains("pr-chevron-btn"))[0].click();
    expect(vm.postMessage).toHaveBeenCalledExactlyOnceWith({ command: "togglePrExpand", prId: "PR_1" });

    vm.postMessage.mockClear();
    prRow.click();
    expect(vm.postMessage).toHaveBeenCalledExactlyOnceWith({ command: "openPrDetails", prId: "PR_1" });

    // Checkbox click stops propagation (no openFileDiff) and optimistically marks viewed
    vm.postMessage.mockClear();
    const firstFileRow = vm.mockDocument.app.querySelectorAll(".file-row")[0];
    expect(firstFileRow.classList.contains("is-viewed")).toBe(false);
    firstFileRow.findAll((el) => el.classList.contains("file-check"))[0].click();
    expect(vm.postMessage).toHaveBeenCalledExactlyOnceWith({
      command: "toggleFileViewed",
      prId: "PR_1",
      filePath: "src/components/VeryLongFileNameForNarrowSidebarTest.tsx",
      viewed: true,
    });
    expect(vm.mockDocument.app.querySelectorAll(".file-row")[0].classList.contains("is-viewed")).toBe(true);

    // Host rollback snapshot reverts checkbox UI
    vm.sendState(sampleExpandedSnapshot("tree"));
    expect(vm.mockDocument.app.querySelectorAll(".file-row")[0].classList.contains("is-viewed")).toBe(false);

    // Clicking file body opens diff
    vm.postMessage.mockClear();
    vm.mockDocument.app.querySelectorAll(".file-row")[0].click();
    expect(vm.postMessage).toHaveBeenCalledExactlyOnceWith({
      command: "openFileDiff",
      prId: "PR_1",
      filePath: "src/components/VeryLongFileNameForNarrowSidebarTest.tsx",
    });

    // Error state shows retry button that triggers retryLoadFiles
    const errorSnapshot = sampleExpandedSnapshot("tree");
    errorSnapshot.groups[0].prs[0].filesState = { status: "error", message: "Failed to load files: rate limit" };
    vm.sendState(errorSnapshot);
    vm.postMessage.mockClear();
    const retryBtn = vm.mockDocument.app.querySelectorAll(".retry-btn")[0];
    expect(retryBtn?.textContent).toBe("Retry");
    retryBtn.click();
    expect(vm.postMessage).toHaveBeenCalledExactlyOnceWith({ command: "retryLoadFiles", prId: "PR_1" });
  });

  it("supports keyboard navigation: arrows, expand/collapse, Enter, and Space viewed toggle", () => {
    const vm = bootSidebarVm(sampleExpandedSnapshot("tree"));
    vm.postMessage.mockClear();

    const rows = () => vm.mockDocument.app.querySelectorAll("[data-row-id]");
    // Focus starts on repo row (index 0)
    rows()[0].focus();
    // ArrowDown -> PR row
    vm.mockDocument.emitKeydown("ArrowDown");
    expect(vm.mockDocument.activeElement?.getAttribute("data-row-kind")).toBe("pr");
    // Enter on PR -> openPrDetails
    vm.mockDocument.emitKeydown("Enter");
    expect(vm.postMessage).toHaveBeenLastCalledWith({ command: "openPrDetails", prId: "PR_1" });

    // ArrowRight on already-expanded PR -> moves to folder row
    vm.mockDocument.emitKeydown("ArrowRight");
    expect(vm.mockDocument.activeElement?.getAttribute("data-row-kind")).toBe("folder");

    // ArrowLeft on expanded folder -> collapses it locally and persists UI state
    vm.mockDocument.emitKeydown("ArrowLeft");
    expect(vm.setState).toHaveBeenCalled();
    expect(vm.mockDocument.app.querySelectorAll(".file-row")).toHaveLength(1); // only README.md visible

    // ArrowRight on collapsed folder -> expands it back
    vm.mockDocument.emitKeydown("ArrowRight");
    expect(vm.mockDocument.app.querySelectorAll(".file-row")).toHaveLength(3);

    // ArrowDown to first file, Space toggles viewed, Enter opens file diff
    vm.mockDocument.emitKeydown("ArrowDown");
    expect(vm.mockDocument.activeElement?.getAttribute("data-row-kind")).toBe("file");
    vm.postMessage.mockClear();
    vm.mockDocument.emitKeydown(" ");
    expect(vm.postMessage).toHaveBeenCalledWith({
      command: "toggleFileViewed",
      prId: "PR_1",
      filePath: "src/components/VeryLongFileNameForNarrowSidebarTest.tsx",
      viewed: true,
    });
    vm.postMessage.mockClear();
    vm.mockDocument.emitKeydown("Enter");
    expect(vm.postMessage).toHaveBeenCalledWith({
      command: "openFileDiff",
      prId: "PR_1",
      filePath: "src/components/VeryLongFileNameForNarrowSidebarTest.tsx",
    });

    // ArrowLeft on file jumps focus back to its parent folder
    vm.mockDocument.emitKeydown("ArrowLeft");
    expect(vm.mockDocument.activeElement?.getAttribute("data-row-kind")).toBe("folder");
  });

  it("neutralizes XSS payloads in repo names, PR titles, authors, file paths, and error messages", () => {
    const xssTitle = '<script>alert("xss")</script><img src=x onerror="alert(1)">';
    const xssRepo = 'evil/"><svg onload=alert(2)>';
    const xssFile = 'src/<img src=x onerror=alert(3)>/bad.ts';
    const snap: ISidebarSnapshot = {
      signedIn: true,
      layout: "flat",
      groups: [
        {
          repo: xssRepo,
          prs: [
            {
              id: "PR_XSS",
              number: 99,
              title: xssTitle,
              repo: xssRepo,
              author: "<script>evil()</script>",
              isDraft: false,
              ciState: "FAILURE",
              reviewGlyph: null,
              reviewTone: null,
              additions: 1,
              deletions: 2,
              meta: "<script>evil()</script> · opened today",
              tooltip: xssTitle,
              expanded: true,
              filesState: {
                status: "loaded",
                totalCount: 1,
                folders: [],
                files: [
                  {
                    path: xssFile,
                    name: "bad.ts",
                    dir: "src/<img src=x onerror=alert(3)>",
                    changeType: "ADDED",
                    additions: 1,
                    deletions: 0,
                    viewed: false,
                    tooltip: xssFile,
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const vm = bootSidebarVm(snap);
    // Raw closing/opening tags must never appear unescaped in the boot JSON script block
    expect(vm.html).not.toContain('<script>alert("xss")</script>');
    expect(vm.html).not.toContain("<img src=x");
    // Rendered DOM contains no injected script or img elements; text renders literally via textContent
    expect(vm.mockDocument.app.findAll((el) => el.tagName === "script" || el.tagName === "img")).toHaveLength(0);
    expect(vm.mockDocument.app.querySelectorAll(".pr-title")[0].textContent).toBe(xssTitle);
    expect(vm.mockDocument.app.querySelectorAll(".repo-name")[0].textContent).toBe(xssRepo);
    expect(vm.mockDocument.app.querySelectorAll(".file-dir")[0].textContent).toBe("src/<img src=x onerror=alert(3)>");
  });
});
