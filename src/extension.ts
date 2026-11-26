import * as vscode from "vscode";
import {
  addPrComment,
  fetchFileBytes,
  fetchFileContent,
  fetchPrDetails,
  fetchPrFilePatches,
  fetchPrFiles,
  fetchPullRequests,
  getSession,
  addReviewThread,
  addReviewThreadReply,
  discardPendingReview,
  markPrReadyForReview,
  mergePr,
  resolveThread,
  searchRepositories,
  setFileViewed,
  submitPendingReview,
  submitPrReview,
  unresolveThread,
  updatePrBranch,
  type IFileBytes,
} from "./github/github";
import { ReviewController, type IPatchKey } from "./review/ReviewController";
import { detectAi, runAiPrompt } from "./brief/ai";
import { BriefStore, type PersistedBrief } from "./brief/briefState";
import { DetailsSession } from "./panel/DetailsSession";
import { LocalizedError, toDiagnosticMessage, toErrorMessage } from "./core/errors";
import { toThreadPosition } from "./review/reviewThreads";
import { ApprovalOverlay } from "./poll/ApprovalOverlay";
import { applyFilters, partitionReviewed } from "./poll/filters";
import { NewPrTracker } from "./poll/NewPrTracker";
import { AsyncOidCache } from "./core/OidCache";
import { BoundedAsyncCache } from "./core/BoundedAsyncCache";
import { PrContentProvider, fromPrUri, toPrUri } from "./review/PrContentProvider";
import { createImageViewerStrings, viewerLanguage } from "./core/imageViewerStrings";
import { imageMimeType, PrImagePreview } from "./review/PrImagePreview";
import { PrDetailsPanel } from "./panel/PrDetailsPanel";
import { PollScheduler } from "./poll/PollScheduler";
import { PrSidebarViewProvider, type FilesLayout, type IFileNode, type ISidebarActions } from "./tree/PrSidebarViewProvider";
import { PR_URI_SCHEME } from "./review/prUri";
import { ReviewDecisionTracker } from "./poll/ReviewDecisionTracker";
import { MAX_IMAGE_BYTES, type IPrFile, type IPrFilePatch, type IPullRequest } from "./core/types";

const BRIEF_CACHE_STATE_KEY = "githubControlCenter.briefCache";
const IMAGE_PIXELATED_STATE_KEY = "githubControlCenter.imageViewer.pixelated";
const IMAGE_CACHE_MAX_BYTES = 32 * 1024 * 1024;
const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/i;
const FOCUS_REFRESH_COOLDOWN_MS = 30_000;
// config sections that feed the poll pipeline: an event touching only ai.* keys skips the poll
const NON_AI_SECTIONS = ["badge", "notifications", "mutedRepos", "toReview", "updateBranch", "files"].map(
  (section) => `githubControlCenter.${section}`,
);
// the ai.claude.model enum (mirrors package.json); a value outside it is coerced to the default
const AI_MODELS = new Set(["sonnet", "haiku", "opus", ""]);

// minimal typed surface of the built-in vscode.git extension API
interface IGitRemote {
  name: string;
  fetchUrl?: string;
  pushUrl?: string;
}

interface IGitRepository {
  state: { remotes: IGitRemote[] };
  fetch(remote?: string, ref?: string): Promise<void>;
  checkout(treeish: string): Promise<void>;
}

interface IGitExtension {
  getAPI(version: 1): { repositories: IGitRepository[] };
}

function ghccConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("githubControlCenter");
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("GitHub Control Center");
  const fileListCache = new AsyncOidCache<IPrFile[]>();
  const patchCache = new AsyncOidCache<Map<string, IPrFilePatch>>();
  const imageBytesCache = new BoundedAsyncCache<IFileBytes>({
    maxBytes: IMAGE_CACHE_MAX_BYTES,
    maxEntryBytes: MAX_IMAGE_BYTES,
    sizeOf: (file) => file.bytes.byteLength,
  });
  let activeSessionKey: string | undefined;

  function toSessionKey(session: { accessToken: string; id?: string; account?: { id?: string } }): string {
    return `${session.id ?? session.account?.id ?? ""}\0${session.accessToken}`;
  }

  function clearSessionCaches(): void {
    imageBytesCache.clear();
    contentProvider.clear();
    fileListCache.clear();
    patchCache.clear();
    detailsSession.clearDetailsCache();
  }

  function syncAuthSession(session: vscode.AuthenticationSession | undefined): void {
    if (!session) {
      activeSessionKey = undefined;
      clearSessionCaches();
      return;
    }
    const nextKey = toSessionKey(session);
    if (activeSessionKey !== undefined && activeSessionKey !== nextKey) {
      clearSessionCaches();
    }
    activeSessionKey = nextKey;
  }

  function loadFileBytes(token: string, repo: string, path: string, ref: string): Promise<IFileBytes> {
    // Only commit-SHA refs are immutable; branch/tag refs deduplicate in-flight loads without persisting
    const persist = FULL_SHA_PATTERN.test(ref);
    // Scope the cache key by access token so account switches can never cross-serve cached images
    return imageBytesCache.load(`${token}\0${repo}\0${ref}\0${path}`, () => fetchFileBytes(token, repo, path, ref), { persist });
  }

  async function requireToken(): Promise<string> {
    const session = await getSession(false);
    syncAuthSession(session);
    if (!session) {
      throw new LocalizedError("Sign in to GitHub first", vscode.l10n.t("Sign in to GitHub first"));
    }
    return session.accessToken;
  }

  function loadPrFiles(pr: IPullRequest): Promise<IPrFile[]> {
    return fileListCache.load(pr.id, pr.headRefOid, async () => fetchPrFiles(await requireToken(), pr.id));
  }

  function ensurePatches(key: IPatchKey): Promise<Map<string, IPrFilePatch>> {
    return patchCache.load(key.id, key.headRefOid, async () => {
      const patches = await fetchPrFilePatches(await requireToken(), key.repo, key.number);
      return new Map(patches.map((patch) => [patch.path, patch]));
    });
  }

  async function findPatch(key: IPatchKey, path: string): Promise<IPrFilePatch | undefined> {
    const patches = await ensurePatches(key);
    // LEFT-side documents of renamed files carry the pre-rename path
    return patches.get(path) ?? [...patches.values()].find((patch) => patch.previousPath === path);
  }

  const contentProvider = new PrContentProvider(async (ref) => fetchFileContent(await requireToken(), ref.repo, ref.path, ref.sha));

  const pendingStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);

  function updatePendingStatusBar(pr: IPullRequest | undefined, count: number): void {
    if (!pr || count === 0) {
      pendingStatusBar.hide();
      return;
    }
    pendingStatusBar.text = `$(comment-draft) ${vscode.l10n.t("PR #{0}: {1} pending", pr.number, count)}`;
    pendingStatusBar.tooltip = vscode.l10n.t("Pending review on {0}#{1} — click to submit", pr.repo, pr.number);
    pendingStatusBar.command = "githubControlCenter.review.submit";
    pendingStatusBar.show();
  }

  interface IReviewEventItem extends vscode.QuickPickItem {
    event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES";
  }

  async function submitActiveReview(): Promise<void> {
    const pr = reviewController.getActivePr();
    if (!pr || reviewController.getPendingReviewId(pr.id) === null) {
      void vscode.window.showInformationMessage(vscode.l10n.t("No pending review to submit."));
      return;
    }
    const picked = await vscode.window.showQuickPick<IReviewEventItem>([
      { label: vscode.l10n.t("Comment"), event: "COMMENT" },
      { label: vscode.l10n.t("Approve"), event: "APPROVE" },
      { label: vscode.l10n.t("Request changes"), event: "REQUEST_CHANGES" },
    ], {
      placeHolder: vscode.l10n.t("Submit your review of {0}#{1}", pr.repo, pr.number),
    });
    if (!picked) {
      return;
    }
    const { event } = picked;
    const body = await vscode.window.showInputBox({
      prompt: event === "REQUEST_CHANGES" ? vscode.l10n.t("Review summary (required to request changes)") : vscode.l10n.t("Review summary (optional)"),
      placeHolder: vscode.l10n.t("Leave a summary comment…"),
    });
    if (body === undefined) {
      return;
    }
    // GitHub rule: a changes request must carry a body (same gate as the details panel composer)
    if (event === "REQUEST_CHANGES" && !body.trim()) {
      void vscode.window.showWarningMessage(vscode.l10n.t("Request changes requires a summary comment."));
      return;
    }
    try {
      await submitPendingReview(await requireToken(), pr.id, event, body.trim());
      if (event === "APPROVE") {
        approvalOverlay.record(pr.id, pr.headRefOid);
      }
      void vscode.window.showInformationMessage(vscode.l10n.t("Review submitted on {0}#{1}", pr.repo, pr.number));
      await reviewController.reload(pr);
      void refresh({ force: true });
    } catch (error) {
      void vscode.window.showErrorMessage(vscode.l10n.t("Submitting the review failed: {0}", toErrorMessage(error)));
    }
  }

  async function discardActiveReview(): Promise<void> {
    const pr = reviewController.getActivePr();
    const pendingReviewId = pr ? reviewController.getPendingReviewId(pr.id) : null;
    if (!pr || pendingReviewId === null) {
      void vscode.window.showInformationMessage(vscode.l10n.t("No pending review to discard."));
      return;
    }
    const discard = vscode.l10n.t("Discard");
    const confirmed = await vscode.window.showWarningMessage(
      vscode.l10n.t("Discard your pending review on {0}#{1}? All draft comments will be lost.", pr.repo, pr.number),
      { modal: true },
      discard,
    );
    if (confirmed !== discard) {
      return;
    }
    try {
      await discardPendingReview(await requireToken(), pendingReviewId);
      await reviewController.reload(pr);
      // the open details panel drops its pending-review banner without waiting a poll
      void detailsSession.refreshOpenDetails();
    } catch (error) {
      void vscode.window.showErrorMessage(vscode.l10n.t("Discarding the review failed: {0}", toErrorMessage(error)));
    }
  }

  const reviewController = new ReviewController({
    getToken: requireToken,
    getPatch: findPatch,
    onPendingChanged: (pr, count) => {
      void vscode.commands.executeCommand("setContext", "githubControlCenter.hasPendingReview", Boolean(pr));
      updatePendingStatusBar(pr, count);
    },
  });

  async function handleAddComment(reply: vscode.CommentReply, postImmediately: boolean): Promise<void> {
    const commentText = reply.text.trim();
    if (!commentText) {
      return;
    }
    const thread = reply.thread;
    const existingRef = reviewController.threadRef(thread);
    try {
      const token = await requireToken();
      if (existingRef) {
        // GitHub semantics: a reply joins the viewer's pending review when one exists
        const pr = reviewController.getPr(existingRef.prId);
        await addReviewThreadReply(token, existingRef.threadId, commentText);
        if (pr) {
          await reviewController.reload(pr);
        }
        return;
      }
      const fileRef = fromPrUri(thread.uri);
      const pr = reviewController.getPr(fileRef.prId);
      if (!pr) {
        return;
      }
      const hasPendingReview = reviewController.getPendingReviewId(pr.id) !== null;
      if (postImmediately && hasPendingReview) {
        void vscode.window.showWarningMessage(vscode.l10n.t("You have a pending review on this PR — submit or discard it before posting single comments."));
        return;
      }
      // renamed LEFT documents carry the old path; GitHub threads always address the head path
      const patch = await findPatch(pr, fileRef.path);
      const headPath = patch?.path ?? fileRef.path;
      const position = toThreadPosition(fileRef.side, thread.range?.start.line ?? 0, thread.range?.end.line ?? 0, thread.range === undefined);
      await addReviewThread(token, { prId: pr.id, body: commentText, path: headPath, ...position });
      if (postImmediately) {
        await submitPendingReview(token, pr.id, "COMMENT", "");
      }
      // drop the gutter placeholder: the server truth rematerializes on reload
      thread.dispose();
      await reviewController.reload(pr);
      // the open details panel learns about the (possibly new) pending review without waiting a poll
      void detailsSession.refreshOpenDetails();
    } catch (error) {
      void vscode.window.showErrorMessage(vscode.l10n.t("Adding the comment failed: {0}", toErrorMessage(error)));
    }
  }

  async function runThreadMutation(thread: vscode.CommentThread, actionLabel: string, mutate: (token: string, threadId: string) => Promise<void>): Promise<void> {
    const ref = reviewController.threadRef(thread);
    const pr = ref && reviewController.getPr(ref.prId);
    if (!ref || !pr) {
      return;
    }
    try {
      await mutate(await requireToken(), ref.threadId);
      await reviewController.reload(pr);
    } catch (error) {
      void vscode.window.showErrorMessage(vscode.l10n.t("{0} failed: {1}", actionLabel, toErrorMessage(error)));
    }
  }

  function getImagePixelated(): boolean {
    const raw = context.globalState.get<boolean>(IMAGE_PIXELATED_STATE_KEY, true);
    return typeof raw === "boolean" ? raw : true;
  }

  function setImagePixelated(value: boolean): void {
    void context.globalState.update(IMAGE_PIXELATED_STATE_KEY, value);
    imagePreview.syncPixelated(value);
    detailsPanel.syncPixelated(value);
  }

  const imagePreview = new PrImagePreview(
    async ({ repo, path, sha }) => loadFileBytes(await requireToken(), repo, path, sha),
    createImageViewerStrings,
    { get: getImagePixelated, set: setImagePixelated },
    viewerLanguage,
  );

  async function openFileDiff(node: IFileNode, forceText = false): Promise<void> {
    const { pr, file } = node;
    try {
      reviewController.registerPr(pr);
      // fire-and-forget: threads appear shortly after the diff opens; failures land in the output channel
      reviewController.ensureThreadsForPr(pr).catch((error: unknown) => {
        output.appendLine(`[${new Date().toISOString()}] Review threads load failed: ${toDiagnosticMessage(error)}`);
      });
      let previousPath: string | undefined;
      if (file.changeType === "RENAMED" || file.changeType === "COPIED" || node.stale) {
        // renames/copies (and stale file entries mid-refresh) need previous_filename for the LEFT path before building URIs
        const patches = await ensurePatches(pr);
        previousPath = patches.get(file.path)?.previousPath;
      } else {
        // warm patches in the background for commenting ranges without blocking the initial open
        ensurePatches(pr).catch((error: unknown) => {
          output.appendLine(`[${new Date().toISOString()}] PR patches load failed: ${toDiagnosticMessage(error)}`);
        });
      }
      const shared = { prId: pr.id, repo: pr.repo, prNumber: pr.number, headOid: pr.headRefOid };
      const left = {
        ...shared,
        path: previousPath ?? file.path,
        sha: pr.baseRefOid,
        side: "LEFT" as const,
        isEmpty: file.changeType === "ADDED",
      };
      const right = {
        ...shared,
        path: file.path,
        sha: pr.headRefOid,
        side: "RIGHT" as const,
        isEmpty: file.changeType === "DELETED",
      };
      const basename = file.path.slice(file.path.lastIndexOf("/") + 1);
      const title = vscode.l10n.t("{0} (PR #{1})", basename, pr.number);
      if (!forceText && [left, right].some((side) => !side.isEmpty && imageMimeType(side.path))) {
        const head = { ...right, repo: pr.headRepo ?? pr.repo };
        await imagePreview.open({ key: JSON.stringify([pr.id, file.path]), title, changeType: file.changeType, left, right: head });
        return;
      }
      await vscode.commands.executeCommand("vscode.diff", toPrUri(left), toPrUri(right), title, { preview: true });
    } catch (error) {
      void vscode.window.showErrorMessage(vscode.l10n.t("Failed to open the diff: {0}", toErrorMessage(error)));
    }
  }

  function getFilesLayout(): FilesLayout {
    return ghccConfig().get<FilesLayout>("files.layout", "tree");
  }

  function publishFilesLayoutContext(): void {
    void vscode.commands.executeCommand("setContext", "githubControlCenter.filesLayout", getFilesLayout());
  }

  interface IWebviewContextTarget {
    prId?: unknown;
    filePath?: unknown;
  }

  const sidebarActions: ISidebarActions = {
    loadFiles: loadPrFiles,
    getLayout: getFilesLayout,
    onSignIn: () => void vscode.commands.executeCommand("githubControlCenter.signIn"),
    onOpenPrDetails: (pr) => void detailsSession.openPrDetails(pr),
    onOpenPrExternal: (pr) => openPr(pr.url),
    onCheckoutPr: (pr) => void checkoutBranch(pr.repo, pr.headRefName),
    onOpenFileDiff: (node) => void openFileDiff(node),
    onToggleFileViewed: async (node, viewed) => {
      await setFileViewed(await requireToken(), node.pr.id, node.file.path, viewed);
    },
    onError: (message) => void vscode.window.showErrorMessage(message),
  };

  const toReviewProvider = new PrSidebarViewProvider("toReview", sidebarActions);
  const reviewedProvider = new PrSidebarViewProvider("reviewed", sidebarActions);
  const mineProvider = new PrSidebarViewProvider("mine", sidebarActions);
  const sidebarProviders = [toReviewProvider, reviewedProvider, mineProvider];
  const sidebarViewOptions = { webviewOptions: { retainContextWhenHidden: true } };

  function resolvePrTarget(target: unknown): IPullRequest | undefined {
    if (!target || typeof target !== "object") {
      return undefined;
    }
    if ("pr" in target && target.pr && typeof target.pr === "object" && "id" in target.pr) {
      return target.pr as IPullRequest;
    }
    const ctx = target as IWebviewContextTarget;
    if (typeof ctx.prId === "string") {
      for (const provider of sidebarProviders) {
        const found = provider.findPr(ctx.prId);
        if (found) {
          return found;
        }
      }
      return undefined;
    }
    if ("id" in target && "url" in target && "headRefName" in target) {
      return target as IPullRequest;
    }
    return undefined;
  }

  function resolveFileNodeTarget(target: unknown): IFileNode | undefined {
    if (!target || typeof target !== "object") {
      return undefined;
    }
    if ("pr" in target && "file" in target) {
      return target as IFileNode;
    }
    const ctx = target as IWebviewContextTarget;
    if (typeof ctx.prId === "string" && typeof ctx.filePath === "string") {
      for (const provider of sidebarProviders) {
        const found = provider.findFileNode(ctx.prId, ctx.filePath);
        if (found) {
          return found;
        }
      }
    }
    return undefined;
  }
  const newPrTracker = new NewPrTracker();
  const reviewDecisionTracker = new ReviewDecisionTracker();
  const approvalOverlay = new ApprovalOverlay();
  const detailsPanel = new PrDetailsPanel(context.extensionUri, getImagePixelated);
  // repos seen in the last raw snapshot (pre-filter, so muted ones stay unmutable from the picker)
  let knownRepos = new Set<string>();
  // results are pinned to the head oid — a push invalidates naturally. Hydrated from globalState
  // so a window reload keeps the briefs — local only (never setKeysForSync: PR content)
  const briefStore = new BriefStore(context.globalState.get<PersistedBrief[]>(BRIEF_CACHE_STATE_KEY, []));

  function persistBriefs(): void {
    void context.globalState.update(BRIEF_CACHE_STATE_KEY, briefStore.serialize());
  }

  function aiConfig(): { backend: string; command: string; model: string; language: string } {
    const config = ghccConfig();
    // model reaches `claude --model` on the (win32, shell:true) command line; keep it inside the
    // known enum so a stray value can never carry shell metacharacters into the spawn
    const rawModel = config.get<string>("ai.claude.model", "sonnet");
    const model = AI_MODELS.has(rawModel) ? rawModel : "sonnet";
    return {
      backend: config.get<string>("ai.backend", "claude-code"),
      command: config.get<string>("ai.claude.command", "claude"),
      model,
      language: config.get<string>("ai.language", "English"),
    };
  }

  function openPr(target: unknown): void {
    // string from webview/toast flows, IPullRequest or webview/context payload from sidebar commands
    const url = typeof target === "string" ? target : resolvePrTarget(target)?.url;
    if (url) {
      void vscode.env.openExternal(vscode.Uri.parse(url));
    }
  }

  async function addMutedEntry(entry: string): Promise<void> {
    const config = ghccConfig();
    const mutedEntries = config.get<string[]>("mutedRepos", []);
    const isAlreadyMuted = mutedEntries.some((existing) => existing.trim().toLowerCase() === entry.toLowerCase());
    if (!isAlreadyMuted) {
      // the config-change listener refreshes lists, badge and trackers
      await config.update("mutedRepos", [...mutedEntries, entry], vscode.ConfigurationTarget.Global);
    }
  }

  interface IMuteQuickPickItem extends vscode.QuickPickItem {
    entry: string;
    action: "mute" | "unmute";
  }

  function manageMutedRepos(): void {
    const quickPick = vscode.window.createQuickPick<IMuteQuickPickItem>();
    quickPick.placeholder = vscode.l10n.t("Type to search GitHub repositories — pick an item to mute or unmute");
    let searchResults: string[] = [];
    let searchTimer: ReturnType<typeof setTimeout> | undefined;

    function buildItems(typedText: string): IMuteQuickPickItem[] {
      const mutedEntries = ghccConfig().get<string[]>("mutedRepos", []);
      const listedEntries = new Set(mutedEntries.map((entry) => entry.trim().toLowerCase()));
      const items: IMuteQuickPickItem[] = mutedEntries.map((entry) => ({
        label: `$(mute) ${entry}`,
        description: vscode.l10n.t("muted — pick to unmute"),
        entry,
        action: "unmute",
      }));
      for (const repo of [...knownRepos, ...searchResults]) {
        if (!listedEntries.has(repo.toLowerCase())) {
          listedEntries.add(repo.toLowerCase());
          items.push({ label: `$(repo) ${repo}`, description: vscode.l10n.t("pick to mute"), entry: repo, action: "mute" });
        }
      }
      const trimmedText = typedText.trim();
      const looksLikeOwner = trimmedText.length > 0 && !trimmedText.includes("/");
      if (looksLikeOwner) {
        items.push({
          label: `$(organization) ${vscode.l10n.t("Mute everything from \"{0}\"", trimmedText)}`,
          description: vscode.l10n.t("mutes the whole organization"),
          entry: trimmedText,
          action: "mute",
          alwaysShow: true,
        });
      }
      return items;
    }

    quickPick.items = buildItems("");
    quickPick.onDidChangeValue((typedText) => {
      if (searchTimer) {
        clearTimeout(searchTimer);
      }
      quickPick.items = buildItems(typedText);
      if (typedText.trim().length < 3) {
        return;
      }
      searchTimer = setTimeout(async () => {
        const session = await getSession(false);
        if (!session) {
          return;
        }
        try {
          searchResults = await searchRepositories(session.accessToken, typedText.trim());
          quickPick.items = buildItems(quickPick.value);
        } catch {
          // search failures stay silent inside the picker: the org item and known repos still work
        }
      }, 250);
    });
    quickPick.onDidAccept(async () => {
      const [selected] = quickPick.selectedItems;
      if (!selected) {
        return;
      }
      quickPick.hide();
      if (selected.action === "mute") {
        await addMutedEntry(selected.entry);
        void vscode.window.showInformationMessage(vscode.l10n.t("Muted {0}", selected.entry));
        return;
      }
      const config = ghccConfig();
      const remainingEntries = config
        .get<string[]>("mutedRepos", [])
        .filter((entry) => entry.trim().toLowerCase() !== selected.entry.trim().toLowerCase());
      await config.update("mutedRepos", remainingEntries, vscode.ConfigurationTarget.Global);
      void vscode.window.showInformationMessage(vscode.l10n.t("Unmuted {0}", selected.entry));
    });
    quickPick.onDidHide(() => quickPick.dispose());
    quickPick.show();
  }

  async function checkoutBranch(repo: string, headRefName: string): Promise<void> {
    const repoNameLowercase = repo.toLowerCase();
    const matchesRepo = (remote: IGitRemote): boolean => (remote.fetchUrl ?? remote.pushUrl ?? "").toLowerCase().includes(repoNameLowercase);
    const gitApi = vscode.extensions.getExtension<IGitExtension>("vscode.git")?.exports.getAPI(1);
    const repository = gitApi?.repositories.find((candidate) => candidate.state.remotes.some(matchesRepo));
    if (!repository) {
      void vscode.window.showErrorMessage(vscode.l10n.t("No open workspace folder has a remote for {0}. Open the repository first.", repo));
      return;
    }
    try {
      const remoteName = repository.state.remotes.find(matchesRepo)?.name;
      await repository.fetch(remoteName);
      await repository.checkout(headRefName);
      void vscode.window.showInformationMessage(vscode.l10n.t("Checked out {0}", headRefName));
    } catch (error) {
      void vscode.window.showErrorMessage(vscode.l10n.t("Checkout failed: {0}", toErrorMessage(error)));
    }
  }

  const detailsSession = new DetailsSession({
    panel: detailsPanel,
    getSession,
    fetchPrDetails,
    fetchFileBytes: loadFileBytes,
    loadPrFiles,
    ensurePatches,
    briefStore,
    persistBriefs,
    aiConfig,
    detectAi,
    runAiPrompt,
    addPrComment,
    submitPrReview,
    submitPendingReview: async (token, prId, event, body) => {
      await submitPendingReview(token, prId, event, body);
      // resync the pending status bar / context key / thread labels; the review is already
      // submitted, so a reload failure must never fail the mutation
      const registered = reviewController.getPr(prId);
      if (registered) {
        reviewController.reload(registered).catch((error: unknown) => {
          output.appendLine(`[${new Date().toISOString()}] Review threads reload failed: ${toDiagnosticMessage(error)}`);
        });
      }
    },
    getPendingReviewId: (prId) => reviewController.getKnownPendingReviewId(prId),
    mergePr,
    markPrReadyForReview,
    updatePrBranch,
    checkout: checkoutBranch,
    recordApproval: (prId, headRefOid) => approvalOverlay.record(prId, headRefOid),
    refresh: () => refresh({ force: true }),
    notify: {
      info: (message) => void vscode.window.showInformationMessage(message),
      warning: (message) => void vscode.window.showWarningMessage(message),
      error: (message) => void vscode.window.showErrorMessage(message),
    },
    promptModal: async (message, action) => {
      const choice = await vscode.window.showWarningMessage(message, { modal: true }, action);
      return choice === action;
    },
    log: (message) => output.appendLine(message),
    setImagePixelated,
  });

  detailsPanel.onMessage((message) => detailsSession.handleMessage(message));

  function showPrToast(message: string, pr: IPullRequest): void {
    const open = vscode.l10n.t("Open");
    const settings = vscode.l10n.t("Settings");
    void vscode.window.showInformationMessage(message, open, settings).then((action) => {
      if (action === open) {
        openPr(pr.url);
      }
      if (action === settings) {
        void vscode.commands.executeCommand("githubControlCenter.openSettings");
      }
    });
  }

  // both trackers always track, even when notifications are off:
  // re-enabling must not replay the backlog as a toast storm
  function notifyNewPrs(toReview: IPullRequest[], notificationsEnabled: boolean): void {
    const newPrs = newPrTracker.track(toReview);
    if (!notificationsEnabled) {
      return;
    }
    for (const pr of newPrs) {
      showPrToast(vscode.l10n.t("New PR to review in {0}: \"{1}\" by {2}", pr.repo, pr.title, pr.author), pr);
    }
  }

  function notifyReviewDecisions(mine: IPullRequest[], notificationsEnabled: boolean): void {
    const changedPrs = reviewDecisionTracker.track(mine);
    if (!notificationsEnabled) {
      return;
    }
    for (const pr of changedPrs) {
      const message =
        pr.reviewDecision === "APPROVED"
          ? vscode.l10n.t("Your PR was approved: \"{0}\" ({1})", pr.title, pr.repo)
          : vscode.l10n.t("Changes requested on: \"{0}\" ({1})", pr.title, pr.repo);
      showPrToast(message, pr);
    }
  }

  let lastSuccessfulRefreshAt: number | undefined;
  let refreshInFlight: Promise<void> | undefined;
  let refreshQueued = false;

  async function runRefreshPass(): Promise<void> {
    let hasSession = false;
    try {
      const session = await getSession(false);
      syncAuthSession(session);
      await vscode.commands.executeCommand("setContext", "githubControlCenter.signedIn", Boolean(session));
      if (!session) {
        toReviewProvider.clear();
        reviewedProvider.clear();
        mineProvider.clear();
        toReviewProvider.setBadge(undefined);
        lastSuccessfulRefreshAt = undefined;
        return;
      }
      hasSession = true;
      // the overlay rewrites the raw snapshot, so panel re-pointing, filters, providers, badge
      // and trackers all see the same optimistic world until GitHub's search index catches up
      const snapshot = approvalOverlay.apply(await fetchPullRequests(session.accessToken));
      const allPrs = [...snapshot.toReview, ...snapshot.mine, ...snapshot.reviewed];
      knownRepos = new Set(allPrs.map((pr) => pr.repo));
      // re-points the open-panel PR at the fresh snapshot entry (raw, pre-filter) before silently
      // refreshing it: without this, headRefOid freezes at click time and a push would keep
      // serving the stale brief cache key
      detailsSession.onPollSnapshot(allPrs);
      const config = ghccConfig();
      // filters run before providers, badge and trackers: lists, badge and toasts must always agree
      const visibleSnapshot = applyFilters(snapshot, {
        mutedRepos: config.get("mutedRepos", []),
        hideDrafts: config.get("toReview.hideDrafts", false),
        hideReviewed: config.get("toReview.hideReviewed", false),
      });
      // fresh approvals live in the Reviewed view; requested rows first in To Review, rows still
      // needing attention (commented, changes requested, stale approvals) after — per repo group too
      const { freshlyApproved, needsAttention } = partitionReviewed(visibleSnapshot.reviewed);
      toReviewProvider.setPrs([...visibleSnapshot.toReview, ...needsAttention]);
      reviewedProvider.setPrs(freshlyApproved);
      mineProvider.setPrs(visibleSnapshot.mine);
      // each count mirrors its view's contents exactly: badge and views must always agree
      const badgeCount =
        (config.get("badge.countToReview", true) ? visibleSnapshot.toReview.length + needsAttention.length : 0) +
        (config.get("badge.countMine", false) ? visibleSnapshot.mine.length : 0) +
        (config.get("badge.countReviewed", false) ? freshlyApproved.length : 0);
      toReviewProvider.setBadge(
        badgeCount
          ? { value: badgeCount, tooltip: vscode.l10n.t("{0} pull requests", badgeCount) }
          : undefined,
      );
      const notificationsEnabled = config.get("notifications.enabled", true);
      notifyNewPrs(visibleSnapshot.toReview, notificationsEnabled);
      notifyReviewDecisions(visibleSnapshot.mine, notificationsEnabled);
      pollScheduler.recordSuccess();
      lastSuccessfulRefreshAt = Date.now();
    } catch (error) {
      // poll failures stay silent: keep the last good data, no error toast every 2.5 minutes
      output.appendLine(`[${new Date().toISOString()}] Poll failed: ${toDiagnosticMessage(error)}`);
      pollScheduler.recordFailure(); // next cycle backs off (e.g. GitHub secondary rate limit)
    }
    // independent of the poll's own success/failure: refreshOpenDetails runs its own fetch
    if (hasSession) {
      void detailsSession.refreshOpenDetails();
    }
  }

  function refresh(options?: { force?: boolean }): Promise<void> {
    if (refreshInFlight) {
      if (options?.force) {
        refreshQueued = true;
      }
      return refreshInFlight;
    }
    refreshInFlight = (async () => {
      try {
        let shouldRun = true;
        while (shouldRun) {
          await runRefreshPass();
          if (refreshQueued) {
            refreshQueued = false;
            shouldRun = true;
          } else {
            shouldRun = false;
          }
        }
      } finally {
        refreshInFlight = undefined;
        if (refreshQueued && !disposed) {
          refreshQueued = false;
          void refresh({ force: true });
        }
      }
    })();
    return refreshInFlight;
  }

  // cadence is dynamic (backoff + focus pause), so a self-rescheduling setTimeout replaces a fixed setInterval
  const pollScheduler = new PollScheduler();
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  // the window starts unfocused on some platforms/session-restore paths; the initial poll below
  // always runs once regardless, this only gates the recurring cadence
  let pollPaused = !vscode.window.state.focused;

  function scheduleNextPoll(): void {
    clearTimeout(pollTimer);
    if (pollPaused || disposed) {
      return;
    }
    pollTimer = setTimeout(() => void pollCycle(), pollScheduler.nextDelay());
  }

  async function pollCycle(): Promise<void> {
    clearTimeout(pollTimer);
    try {
      await refresh();
    } finally {
      scheduleNextPoll();
    }
  }

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("githubControlCenter.toReview", toReviewProvider, sidebarViewOptions),
    vscode.window.registerWebviewViewProvider("githubControlCenter.reviewed", reviewedProvider, sidebarViewOptions),
    vscode.window.registerWebviewViewProvider("githubControlCenter.mine", mineProvider, sidebarViewOptions),
    output,
    {
      dispose: () => {
        disposed = true;
        clearTimeout(pollTimer);
      },
    },
    { dispose: () => detailsSession.dispose() },
    vscode.window.onDidChangeWindowState((windowState) => {
      pollPaused = !windowState.focused;
      clearTimeout(pollTimer);
      if (!windowState.focused) {
        return;
      }
      const withinCooldown =
        lastSuccessfulRefreshAt !== undefined && Date.now() - lastSuccessfulRefreshAt < FOCUS_REFRESH_COOLDOWN_MS;
      if (withinCooldown) {
        scheduleNextPoll();
        return;
      }
      void pollCycle(); // catch-up refresh after cooldown (or if no refresh succeeded yet), then resumes normal cadence
    }),
    vscode.commands.registerCommand("githubControlCenter.refresh", () => void refresh({ force: true })),
    vscode.commands.registerCommand("githubControlCenter.signIn", async () => {
      await getSession(true);
      await refresh({ force: true });
    }),
    vscode.commands.registerCommand("githubControlCenter.openPr", openPr),
    vscode.commands.registerCommand("githubControlCenter.openSettings", () => void vscode.commands.executeCommand("workbench.action.openSettings", "@ext:mts88.github-control-center")),
    vscode.commands.registerCommand("githubControlCenter.copyPrUrl", (target: unknown) => {
      const pr = resolvePrTarget(target);
      if (pr) {
        void vscode.env.clipboard.writeText(pr.url);
      }
    }),
    vscode.commands.registerCommand("githubControlCenter.copyBranchName", (target: unknown) => {
      const pr = resolvePrTarget(target);
      if (pr) {
        void vscode.env.clipboard.writeText(pr.headRefName);
      }
    }),
    vscode.commands.registerCommand("githubControlCenter.checkoutPr", (target: unknown) => {
      const pr = resolvePrTarget(target);
      if (pr) {
        // fork PRs are not detectable from the row: the checkout simply fails with a clear git error
        void checkoutBranch(pr.repo, pr.headRefName);
      }
    }),
    vscode.commands.registerCommand("githubControlCenter.muteRepo", async (target: unknown) => {
      const pr = resolvePrTarget(target);
      if (!pr) {
        return;
      }
      await addMutedEntry(pr.repo);
      void vscode.window.showInformationMessage(vscode.l10n.t("Muted {0}", pr.repo));
    }),
    vscode.commands.registerCommand("githubControlCenter.muteOrg", async (target: unknown) => {
      const pr = resolvePrTarget(target);
      if (!pr) {
        return;
      }
      const organization = pr.repo.split("/")[0];
      await addMutedEntry(organization);
      void vscode.window.showInformationMessage(vscode.l10n.t("Muted everything from {0}", organization));
    }),
    vscode.commands.registerCommand("githubControlCenter.manageMutedRepos", manageMutedRepos),
    vscode.commands.registerCommand("githubControlCenter.clearBriefCache", () => {
      detailsSession.clearBriefCache();
      void vscode.window.showInformationMessage(vscode.l10n.t("AI brief cache cleared."));
    }),
    vscode.commands.registerCommand("githubControlCenter.openPrDetails", (target: unknown) => {
      const pr = resolvePrTarget(target);
      if (pr) {
        void detailsSession.openPrDetails(pr);
      }
    }),
    vscode.workspace.registerTextDocumentContentProvider(PR_URI_SCHEME, contentProvider),
    vscode.commands.registerCommand("githubControlCenter.openFileDiff", (target: unknown) => {
      const node = resolveFileNodeTarget(target);
      if (node) {
        void openFileDiff(node);
      }
    }),
    vscode.commands.registerCommand("githubControlCenter.openTextDiff", (target: unknown) => {
      const node = resolveFileNodeTarget(target);
      if (node) {
        void openFileDiff(node, true);
      }
    }),
    vscode.commands.registerCommand("githubControlCenter.review.resolveThread", (thread: vscode.CommentThread) => void runThreadMutation(thread, vscode.l10n.t("Resolve conversation"), resolveThread)),
    vscode.commands.registerCommand("githubControlCenter.review.unresolveThread", (thread: vscode.CommentThread) => void runThreadMutation(thread, vscode.l10n.t("Unresolve conversation"), unresolveThread)),
    vscode.commands.registerCommand("githubControlCenter.review.addComment", (reply: vscode.CommentReply) => void handleAddComment(reply, false)),
    vscode.commands.registerCommand("githubControlCenter.review.addSingleComment", (reply: vscode.CommentReply) => void handleAddComment(reply, true)),
    vscode.commands.registerCommand("githubControlCenter.review.submit", () => void submitActiveReview()),
    vscode.commands.registerCommand("githubControlCenter.review.discard", () => void discardActiveReview()),
    // VSCode ships no default entry point for file-level comments (enableFileComments only enables the capability)
    vscode.commands.registerCommand("githubControlCenter.review.addFileComment", () => {
      void vscode.commands.executeCommand("workbench.action.addComment", { fileComment: true });
    }),
    vscode.commands.registerCommand("githubControlCenter.viewFilesAsList", () => {
      void ghccConfig().update("files.layout", "flat", vscode.ConfigurationTarget.Global);
    }),
    vscode.commands.registerCommand("githubControlCenter.viewFilesAsTree", () => {
      void ghccConfig().update("files.layout", "tree", vscode.ConfigurationTarget.Global);
    }),
    reviewController,
    imagePreview,
    pendingStatusBar,
    { dispose: () => detailsPanel.dispose() },
    vscode.authentication.onDidChangeSessions((event) => {
      if (event.provider.id === "github") {
        activeSessionKey = undefined;
        clearSessionCaches();
        lastSuccessfulRefreshAt = undefined;
        void refresh({ force: true });
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration("githubControlCenter")) {
        return;
      }
      if (event.affectsConfiguration("githubControlCenter.ai")) {
        // only backend and the CLI path change availability; language/model never do, so they
        // must not trigger a wasted `claude --version` probe on every keystroke
        const affectsAvailability =
          event.affectsConfiguration("githubControlCenter.ai.backend") ||
          event.affectsConfiguration("githubControlCenter.ai.claude.command");
        if (affectsAvailability) {
          detailsSession.refreshAiAvailabilityIfStarted();
        }
        // ai keys cannot affect PR data: skip the GitHub poll unless the same event
        // also touched settings the poll pipeline actually reads
        const touchesPollSettings = NON_AI_SECTIONS.some((section) => event.affectsConfiguration(section));
        if (!touchesPollSettings) {
          return;
        }
      }
      publishFilesLayoutContext();
      for (const provider of sidebarProviders) {
        provider.refresh();
      }
      void refresh({ force: true });
    }),
  );

  publishFilesLayoutContext();
  // AI detection is lazy (first PR panel open): no CLI spawn in a window that never opens one

  // the initial poll always runs once (even in an unfocused window) so lists/badge populate on
  // startup; pollCycle's own reschedule then honors pollPaused for every cycle after this one
  void pollCycle();
}

export function deactivate(): void {}
