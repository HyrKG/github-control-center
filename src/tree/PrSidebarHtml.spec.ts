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
  copyPrUrl: "Copy pull request URL",
  copied: "Copied",
  checkoutBranch: "Checkout branch",
  openOnGitHub: "Open on GitHub",
  markAsViewed: "Mark file as viewed",
  markAsUnviewed: "Mark file as unviewed",
  expandPr: "Toggle changed files",
  expandRepo: "Toggle repository",
  expandFolder: "Toggle folder",
  searchPlaceholder: "Filter by PR title…",
  clearSearch: "Clear search",
  noMatchingPrs: "No matching pull requests",
  favoriteRepo: "Favorite repository",
  unfavoriteRepo: "Unfavorite repository",
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
  value = "";
  tabIndex = 0;
  selected = false;

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

  select(): void {
    this.selected = true;
  }

  click(): void {
    this.dispatchEvent({ type: "click", stopped: false, defaultPrevented: false, stopPropagation() { this.stopped = true; }, preventDefault() { this.defaultPrevented = true; } });
  }

  input(nextValue: string, options: { isComposing?: boolean } = {}): void {
    this.value = nextValue;
    this.dispatchEvent({
      type: "input",
      isComposing: Boolean(options.isComposing),
      stopped: false,
      defaultPrevented: false,
      stopPropagation() { this.stopped = true; },
      preventDefault() { this.defaultPrevented = true; },
    });
  }

  emitComposition(type: "compositionstart" | "compositionend", nextValue?: string): void {
    if (nextValue !== undefined) {
      this.value = nextValue;
    }
    this.dispatchEvent({
      type,
      stopped: false,
      defaultPrevented: false,
      stopPropagation() { this.stopped = true; },
      preventDefault() { this.defaultPrevented = true; },
    });
  }

  contains(other: MockElement | null): boolean {
    let cur = other;
    while (cur) {
      if (cur === this) {
        return true;
      }
      cur = cur.parentNode;
    }
    return false;
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
  keyCode?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
  stopped: boolean;
  defaultPrevented: boolean;
  stopPropagation: () => void;
  preventDefault: () => void;
}

class MockDocument {
  activeElement: MockElement | null = null;
  readonly body: MockElement;
  readonly app: MockElement;
  readonly searchBar: MockElement;
  readonly treeRoot: MockElement;
  readonly boot: MockElement;
  private readonly listeners = new Map<string, Array<(event: MockEvent) => void>>();

  constructor(bootJson: string) {
    this.body = new MockElement("body", this);
    this.app = new MockElement("div", this);
    this.app.setAttribute("id", "app");
    this.searchBar = new MockElement("div", this);
    this.searchBar.setAttribute("id", "search-bar");
    this.searchBar.className = "search-bar is-hidden";
    this.treeRoot = new MockElement("div", this);
    this.treeRoot.setAttribute("id", "tree-root");
    this.app.appendChild(this.searchBar);
    this.app.appendChild(this.treeRoot);
    this.body.appendChild(this.app);
    this.boot = new MockElement("script", this);
    this.boot.setAttribute("id", "ghcc-boot");
    this.boot.textContent = bootJson;
  }

  getElementById(id: string): MockElement | null {
    if (id === "app") {
      return this.app;
    }
    if (id === "search-bar") {
      return this.searchBar;
    }
    if (id === "tree-root") {
      return this.treeRoot;
    }
    if (id === "ghcc-boot") {
      return this.boot;
    }
    return this.app.findAll((el) => el.getAttribute("id") === id)[0] ?? null;
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

  emitKeydown(
    key: string,
    modifiers: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean; isComposing?: boolean; keyCode?: number } = {},
  ): MockEvent {
    const event: MockEvent = {
      type: "keydown",
      key,
      keyCode: modifiers.keyCode,
      ctrlKey: Boolean(modifiers.ctrlKey),
      metaKey: Boolean(modifiers.metaKey),
      shiftKey: Boolean(modifiers.shiftKey),
      altKey: Boolean(modifiers.altKey),
      isComposing: Boolean(modifiers.isComposing),
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
    setTimeout,
    clearTimeout,
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
        favorite: false,
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
  it("reuses fileTree compaction without adding folder diffstat fields", () => {
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

    expect(root).not.toHaveProperty("additions");
    expect(root).not.toHaveProperty("deletions");
    expect(root.folders).toHaveLength(1);
    expect(root.folders[0]).toMatchObject({
      name: "src/a/b",
      path: "src/a/b",
    });
    expect(root.folders[0]).not.toHaveProperty("additions");
    expect(root.folders[0]).not.toHaveProperty("deletions");
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
    // Uses overflow-x: clip on html, body so position: sticky #search-bar sticks to viewport
    expect(html).toMatch(/html,\s*body\s*\{[^}]*overflow-x:\s*clip;/s);
    expect(html).not.toMatch(/html,\s*body\s*\{[^}]*overflow-x:\s*hidden;/s);
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
    const actionBtns = line2.findAll((el) => el.classList.contains("pr-action-btn"));
    expect(actionBtns).toHaveLength(3);
    expect(actionBtns.map((btn) => btn.getAttribute("aria-label"))).toEqual([
      "Copy pull request URL",
      "Checkout branch",
      "Open on GitHub",
    ]);

    // Compacted folder row has no diffstat; only PR rows and file rows show diffstats
    const folderRows = vm.mockDocument.app.querySelectorAll(".folder-row");
    expect(folderRows).toHaveLength(1);
    expect(folderRows[0].findAll((el) => el.classList.contains("folder-name"))[0].textContent).toBe("src/components");
    expect(folderRows[0].findAll((el) => el.classList.contains("diffstat"))).toHaveLength(0);
    expect(prRows[0].findAll((el) => el.classList.contains("diffstat"))).toHaveLength(1);

    // File rows show explicit +0 / -0 and thousand separators
    const fileRows = vm.mockDocument.app.querySelectorAll(".file-row");
    expect(fileRows).toHaveLength(3);
    for (const fileRow of fileRows) {
      expect(fileRow.findAll((el) => el.classList.contains("diffstat"))).toHaveLength(1);
    }
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
    const [copyUrlBtn, checkoutBtn, openExtBtn] = prRow.findAll((el) => el.classList.contains("pr-action-btn"));
    copyUrlBtn.click();
    checkoutBtn.click();
    openExtBtn.click();
    expect(vm.postMessage.mock.calls).toEqual([
      [{ command: "copyPrUrl", prId: "PR_1" }],
      [{ command: "checkoutPr", prId: "PR_1" }],
      [{ command: "openPrExternal", prId: "PR_1" }],
    ]);
    expect(copyUrlBtn.classList.contains("is-copied")).toBe(true);
    expect(copyUrlBtn.getAttribute("aria-label")).toBe("Copied");
    expect(copyUrlBtn.getAttribute("title")).toBe("Copied");

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

  it("shows temporary copied state on copyPrUrl click, resets timer on repeat click, and survives re-render", () => {
    vi.useFakeTimers();
    try {
      const vm = bootSidebarVm(sampleExpandedSnapshot("tree"));
      vm.postMessage.mockClear();

      const getCopyBtn = () => vm.mockDocument.app.querySelectorAll(".pr-row")[0].findAll((el) => el.classList.contains("pr-action-btn"))[0];
      const copyBtn = getCopyBtn();
      expect(copyBtn.classList.contains("is-copied")).toBe(false);
      expect(copyBtn.getAttribute("title")).toBe("Copy pull request URL");

      copyBtn.click();
      expect(vm.postMessage).toHaveBeenCalledExactlyOnceWith({ command: "copyPrUrl", prId: "PR_1" });
      expect(copyBtn.classList.contains("is-copied")).toBe(true);
      expect(copyBtn.getAttribute("aria-label")).toBe("Copied");
      expect(copyBtn.getAttribute("title")).toBe("Copied");

      // Re-click at 1000ms resets the 1500ms timer
      vi.advanceTimersByTime(1000);
      expect(getCopyBtn().classList.contains("is-copied")).toBe(true);
      getCopyBtn().click();

      // Re-render at +1000ms (2000ms total, 1000ms since second click) keeps copied state on the new button
      vi.advanceTimersByTime(1000);
      vm.sendState(sampleExpandedSnapshot("flat"));
      expect(getCopyBtn().classList.contains("is-copied")).toBe(true);
      expect(getCopyBtn().getAttribute("title")).toBe("Copied");

      // After remaining 500ms (1500ms from second click), the new button reverts cleanly without errors
      vi.advanceTimersByTime(500);
      expect(getCopyBtn().classList.contains("is-copied")).toBe(false);
      expect(getCopyBtn().getAttribute("aria-label")).toBe("Copy pull request URL");
      expect(getCopyBtn().getAttribute("title")).toBe("Copy pull request URL");

      // Re-render removing the PR while timer is pending also completes cleanly without errors
      getCopyBtn().click();
      expect(getCopyBtn().classList.contains("is-copied")).toBe(true);
      vm.sendState({ signedIn: true, layout: "tree", groups: [] });
      expect(() => vi.advanceTimersByTime(1500)).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
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
          favorite: false,
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

  it("filters PRs strictly by PR title (ignoring GitHub PR #number, repo, and author) without recreating #search-input, auto-expands collapsed repos, and restores state on clear", () => {
    const multiRepoSnapshot: ISidebarSnapshot = {
      signedIn: true,
      layout: "tree",
      groups: [
        {
          repo: "org/alpha-service",
          favorite: true,
          prs: [
            {
              id: "PR_9",
              number: 9,
              title: "feat(combat): 打击反馈 (#4911)",
              repo: "org/alpha-service",
              author: "alice",
              isDraft: false,
              ciState: "SUCCESS",
              reviewGlyph: "✓",
              reviewTone: "approved",
              additions: 120,
              deletions: 15,
              meta: "alice · opened today",
              tooltip: "org/alpha-service\nfeat(combat): 打击反馈 (#4911)",
              expanded: false,
              filesState: { status: "idle" },
            },
            {
              id: "PR_26",
              number: 26,
              title: "fix(auth): refresh expired token",
              repo: "org/alpha-service",
              author: "bob",
              isDraft: false,
              ciState: "PENDING",
              reviewGlyph: null,
              reviewTone: null,
              additions: 12,
              deletions: 4,
              meta: "bob · opened yesterday",
              tooltip: "org/alpha-service\nfix(auth)",
              expanded: false,
              filesState: { status: "idle" },
            },
          ],
        },
        {
          repo: "org/beta-web",
          favorite: false,
          prs: [
            {
              id: "PR_5001",
              number: 5001,
              title: "chore(ui): polish dark theme",
              repo: "org/beta-web",
              author: "charlie",
              isDraft: true,
              ciState: "NONE",
              reviewGlyph: null,
              reviewTone: null,
              additions: 5,
              deletions: 2,
              meta: "charlie · opened today",
              tooltip: "org/beta-web\nchore(ui)",
              expanded: false,
              filesState: { status: "idle" },
            },
          ],
        },
      ],
    };

    // Start with org/alpha-service collapsed in persisted state
    const vm = bootSidebarVm(multiRepoSnapshot, { collapsedRepos: ["org/alpha-service"] });
    expect(vm.mockDocument.searchBar.classList.contains("is-hidden")).toBe(false);
    expect(vm.mockDocument.treeRoot.querySelectorAll(".pr-row")).toHaveLength(1); // only beta-web's PR visible

    const initialInput = vm.mockDocument.getElementById("search-input")!;
    const clearBtn = vm.mockDocument.getElementById("search-clear")!;
    expect(initialInput).not.toBeNull();
    expect(initialInput.getAttribute("placeholder")).toBe("Filter by PR title…");
    expect(initialInput.getAttribute("aria-label")).toBe("Filter by PR title…");
    expect(clearBtn.classList.contains("is-hidden")).toBe(true);

    // Ctrl+F focuses and selects the search input
    const ctrlF = vm.mockDocument.emitKeydown("f", { ctrlKey: true });
    expect(ctrlF.defaultPrevented).toBe(true);
    expect(vm.mockDocument.activeElement).toBe(initialInput);
    expect(initialInput.selected).toBe(true);

    // Typing #4911 matches PR_9 (title contains (#4911)), hides org/beta-web, temporarily auto-expands org/alpha-service, and updates badge count to 1
    initialInput.input("#4911");
    expect(vm.mockDocument.getElementById("search-input")).toBe(initialInput);
    expect(vm.mockDocument.activeElement).toBe(initialInput);
    expect(clearBtn.classList.contains("is-hidden")).toBe(false);
    const matchedRepos = vm.mockDocument.treeRoot.querySelectorAll(".repo-row");
    expect(matchedRepos).toHaveLength(1);
    expect(matchedRepos[0].getAttribute("data-repo")).toBe("org/alpha-service");
    expect(matchedRepos[0].findAll((el) => el.classList.contains("repo-count"))[0].textContent).toBe("1");
    const matchedPrs = vm.mockDocument.treeRoot.querySelectorAll(".pr-row");
    expect(matchedPrs).toHaveLength(1);
    expect(matchedPrs[0].getAttribute("data-pr-id")).toBe("PR_9");
    expect(vm.setState).toHaveBeenLastCalledWith(expect.objectContaining({ searchQuery: "#4911" }));

    // Host state update while typing must NOT recreate #search-input or steal focus
    vm.sendState(multiRepoSnapshot);
    expect(vm.mockDocument.getElementById("search-input")).toBe(initialInput);
    expect(vm.mockDocument.activeElement).toBe(initialInput);

    // Typing GitHub PR #number (#9, #26, #5001), repo name, or author name must NOT match (strictly pr.title only)
    for (const nonTitleQuery of ["#9", "#26", "#5001", "beta-web", "alice"]) {
      initialInput.input(nonTitleQuery);
      expect(vm.mockDocument.treeRoot.querySelectorAll(".pr-row"), nonTitleQuery).toHaveLength(0);
      expect(vm.mockDocument.treeRoot.textContent).toContain("No matching pull requests");
    }

    // Case-insensitive title substring match works
    initialInput.input("EXPIRED TOKEN");
    expect(vm.mockDocument.treeRoot.querySelectorAll(".pr-row").map((el) => el.getAttribute("data-pr-id"))).toEqual(["PR_26"]);

    // Escape clears search and restores original collapsedRepos state (org/alpha-service collapsed again)
    const esc = vm.mockDocument.emitKeydown("Escape");
    expect(esc.defaultPrevented).toBe(true);
    expect(initialInput.value).toBe("");
    expect(clearBtn.classList.contains("is-hidden")).toBe(true);
    expect(vm.mockDocument.treeRoot.querySelectorAll(".repo-row")).toHaveLength(2);
    expect(vm.mockDocument.treeRoot.querySelectorAll(".pr-row").map((el) => el.getAttribute("data-pr-id"))).toEqual(["PR_5001"]);

    // Clear button also clears search and keeps focus in #search-input
    initialInput.input("polish");
    expect(vm.mockDocument.treeRoot.querySelectorAll(".pr-row")).toHaveLength(1);
    clearBtn.click();
    expect(initialInput.value).toBe("");
    expect(vm.mockDocument.activeElement).toBe(initialInput);
    expect(vm.mockDocument.treeRoot.querySelectorAll(".repo-row")).toHaveLength(2);

    // Signed-out state hides #search-bar even if a query was entered, and Escape is NOT intercepted when hidden
    initialInput.input("#4911");
    vm.sendState({ signedIn: false, layout: "tree", groups: [] });
    expect(vm.mockDocument.searchBar.classList.contains("is-hidden")).toBe(true);
    const hiddenEsc = vm.mockDocument.emitKeydown("Escape");
    expect(hiddenEsc.defaultPrevented).toBe(false);
  });

  it("respects IME composition, keeps #search-clear keyboard-activatable, and does not hijack Ctrl/Cmd+Shift+F", () => {
    const snap: ISidebarSnapshot = {
      signedIn: true,
      layout: "tree",
      groups: [
        {
          repo: "org/alpha-service",
          favorite: false,
          prs: [
            {
              id: "PR_9",
              number: 9,
              title: "feat(combat): 打击反馈 (#4911)",
              repo: "org/alpha-service",
              author: "alice",
              isDraft: false,
              ciState: "SUCCESS",
              reviewGlyph: null,
              reviewTone: null,
              additions: 10,
              deletions: 2,
              meta: "alice · opened today",
              tooltip: "feat(combat)",
              expanded: false,
              filesState: { status: "idle" },
            },
            {
              id: "PR_26",
              number: 26,
              title: "fix(auth): token rotation",
              repo: "org/alpha-service",
              author: "bob",
              isDraft: false,
              ciState: "NONE",
              reviewGlyph: null,
              reviewTone: null,
              additions: 5,
              deletions: 1,
              meta: "bob · opened today",
              tooltip: "fix(auth)",
              expanded: false,
              filesState: { status: "idle" },
            },
          ],
        },
      ],
    };

    const vm = bootSidebarVm(snap);
    const searchInput = vm.mockDocument.getElementById("search-input")!;
    const clearBtn = vm.mockDocument.getElementById("search-clear")!;
    vm.setState.mockClear();
    vm.postMessage.mockClear();

    // Ctrl+Shift+F must NOT be hijacked (leaves VS Code global search shortcut intact)
    const ctrlShiftF = vm.mockDocument.emitKeydown("F", { ctrlKey: true, shiftKey: true });
    expect(ctrlShiftF.defaultPrevented).toBe(false);
    expect(vm.mockDocument.activeElement).not.toBe(searchInput);

    // During IME composition: input does not filter or persist, and ArrowDown/Escape are not intercepted
    searchInput.focus();
    searchInput.emitComposition("compositionstart");
    searchInput.input("daji", { isComposing: true });
    expect(vm.mockDocument.treeRoot.querySelectorAll(".pr-row")).toHaveLength(2);
    expect(vm.setState).not.toHaveBeenCalled();

    const imeDown = vm.mockDocument.emitKeydown("ArrowDown", { isComposing: true });
    expect(imeDown.defaultPrevented).toBe(false);
    expect(vm.mockDocument.activeElement).toBe(searchInput);

    const imeEsc = vm.mockDocument.emitKeydown("Escape", { keyCode: 229 });
    expect(imeEsc.defaultPrevented).toBe(false);
    expect(searchInput.value).toBe("daji");

    // compositionend commits the final text and immediately filters & persists
    searchInput.emitComposition("compositionend", "打击反馈");
    expect(vm.mockDocument.treeRoot.querySelectorAll(".pr-row").map((el) => el.getAttribute("data-pr-id"))).toEqual(["PR_9"]);
    expect(vm.setState).toHaveBeenLastCalledWith(expect.objectContaining({ searchQuery: "打击反馈" }));

    // Focusing #search-clear (e.g. via Tab) and pressing Enter or Space must NOT be intercepted by tree keyboard navigation
    clearBtn.focus();
    const clearEnter = vm.mockDocument.emitKeydown("Enter");
    expect(clearEnter.defaultPrevented).toBe(false);
    const clearSpace = vm.mockDocument.emitKeydown(" ");
    expect(clearSpace.defaultPrevented).toBe(false);
    expect(vm.mockDocument.activeElement).toBe(clearBtn);
    expect(vm.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ command: "openPrDetails" }));
  });

  it("renders favorite repo styling, repo context menu metadata, and star toggle button without collapsing the repo", () => {
    const snap: ISidebarSnapshot = {
      signedIn: true,
      layout: "tree",
      groups: [
        {
          repo: "org/starred-repo",
          favorite: true,
          prs: [sampleExpandedSnapshot("tree").groups[0].prs[0]],
        },
        {
          repo: "org/regular-repo",
          favorite: false,
          prs: [{ ...sampleExpandedSnapshot("tree").groups[0].prs[0], id: "PR_2", number: 43, repo: "org/regular-repo" }],
        },
      ],
    };

    const vm = bootSidebarVm(snap);
    expect(vm.html).not.toContain("--ghcc-favorite: var(--vscode-charts-yellow");
    expect(vm.html).toContain("--ghcc-favorite-fill: #ffd43b;");
    expect(vm.html).toContain("--ghcc-favorite-stroke: #c98a00;");
    expect(vm.html).toContain("--ghcc-favorite-page-fill: #fff9db;");
    expect(vm.html).toMatch(/body\.vscode-light,\s*body\.vscode-high-contrast-light\s*\{[^}]*--ghcc-favorite-fill:\s*#ffd43b;[^}]*--ghcc-favorite-stroke:\s*#c98a00;[^}]*--ghcc-favorite-page-fill:\s*#fff9db;/s);
    expect(vm.html).toMatch(/body\.vscode-dark,\s*body\.vscode-high-contrast\s*\{[^}]*--ghcc-favorite-fill:\s*#ffd43b;[^}]*--ghcc-favorite-stroke:\s*#eab308;[^}]*--ghcc-favorite-page-fill:\s*var\(--vscode-sideBar-background,\s*#181818\);/s);
    expect(vm.html).toMatch(/\.repo-row\.is-favorite\s+\.repo-icon\s+svg\s+path:first-child\s*\{[^}]*fill:\s*var\(--ghcc-favorite-fill\);[^}]*stroke:\s*var\(--ghcc-favorite-stroke\);/s);
    expect(vm.html).toMatch(/\.repo-row\.is-favorite\s+\.repo-icon\s+svg\s+path:last-child\s*\{[^}]*fill:\s*var\(--ghcc-favorite-page-fill\);[^}]*stroke:\s*var\(--ghcc-favorite-stroke\);/s);
    expect(vm.html).toMatch(/\.repo-action-btn\.is-favorite\s+svg\s+path,\s*\.repo-action-btn\.is-favorite:hover\s+svg\s+path\s*\{[^}]*fill:\s*var\(--ghcc-favorite-fill\);[^}]*stroke:\s*var\(--ghcc-favorite-stroke\);/s);

    const repoRows = vm.mockDocument.treeRoot.querySelectorAll(".repo-row");
    expect(repoRows).toHaveLength(2);
    expect(repoRows[0].classList.contains("is-favorite")).toBe(true);
    expect(repoRows[1].classList.contains("is-favorite")).toBe(false);

    expect(JSON.parse(repoRows[0].getAttribute("data-vscode-context")!)).toEqual({
      webviewSection: "repo",
      repo: "org/starred-repo",
      preventDefaultContextMenuItems: true,
    });

    const starredBtn = repoRows[0].findAll((el) => el.classList.contains("repo-action-btn"))[0];
    const regularBtn = repoRows[1].findAll((el) => el.classList.contains("repo-action-btn"))[0];
    expect(starredBtn.classList.contains("is-favorite")).toBe(true);
    expect(starredBtn.getAttribute("aria-label")).toBe("Unfavorite repository");
    expect(regularBtn.classList.contains("is-favorite")).toBe(false);
    expect(regularBtn.getAttribute("aria-label")).toBe("Favorite repository");

    // Clicking star button sends toggleFavoriteRepo and does NOT collapse the repo
    vm.postMessage.mockClear();
    starredBtn.click();
    expect(vm.postMessage).toHaveBeenCalledExactlyOnceWith({ command: "toggleFavoriteRepo", repo: "org/starred-repo" });
    expect(vm.mockDocument.treeRoot.querySelectorAll(".repo-row")[0].getAttribute("aria-expanded")).toBe("true");

    vm.postMessage.mockClear();
    regularBtn.click();
    expect(vm.postMessage).toHaveBeenCalledExactlyOnceWith({ command: "toggleFavoriteRepo", repo: "org/regular-repo" });
    expect(vm.mockDocument.treeRoot.querySelectorAll(".repo-row")[1].getAttribute("aria-expanded")).toBe("true");
  });
});
