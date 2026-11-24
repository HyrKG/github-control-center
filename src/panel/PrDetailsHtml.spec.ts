import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { renderPrDetailsHtml } from "./PrDetailsHtml";
import type { IBriefState, IPrDetails } from "../core/types";

const NONCE = "test-nonce-123";
const NOW = new Date("2026-07-08T12:00:00Z").getTime();

function buildDetails(overrides: Partial<IPrDetails> = {}): IPrDetails {
  return {
    number: 42,
    title: "A title",
    url: "https://github.com/acme/repo/pull/42",
    repo: "acme/repo",
    author: "jane",
    authorAvatarUrl: "https://avatars.example/jane",
    state: "OPEN",
    isDraft: false,
    createdAt: "2026-07-01T00:00:00Z",
    bodyHtml: "<p>Hello</p>",
    baseRefName: "main",
    headRefName: "feature/thing",
    headRepo: "acme/repo",
    headRefOid: "head-oid",
    isBehindBase: false,
    commitsCount: 3,
    changedFiles: 1,
    additions: 10,
    deletions: 4,
    labels: [{ name: "bug", color: "d73a4a" }],
    mergeable: "MERGEABLE",
    mergeMethods: ["SQUASH", "MERGE"],
    reviewDecision: "REVIEW_REQUIRED",
    viewerDidAuthor: false,
    canApprove: true,
    pendingReviewCommentCount: null,
    reviewers: [{ name: "luigi", state: "APPROVED" }],
    checks: [{ name: "build", status: "SUCCESS" }],
    checksTotal: 1,
    timeline: [
      { kind: "comment", author: "mario", avatarUrl: "https://avatars.example/mario", bodyHtml: "<p>Nice</p>", createdAt: "2026-07-02T00:00:00Z" },
      {
        kind: "review",
        author: "luigi",
        avatarUrl: "https://avatars.example/luigi",
        bodyHtml: "<p>LGTM</p>",
        createdAt: "2026-07-03T00:00:00Z",
        reviewState: "APPROVED",
        codeCommentsCount: 2,
      },
    ],
    timelineTruncated: false,
    ...overrides,
  };
}

function render(overrides: Partial<IPrDetails> = {}): string {
  return renderPrDetailsHtml(buildDetails(overrides), NONCE, NOW);
}

const MERMAID_URI = "vscode-resource://ext/dist/mermaid.min.js";

// real shape produced by GitHub's bodyHTML for a ```mermaid fence:
// the diagram source inside data-json is HTML-encoded TWICE (&amp;gt; → &gt; → >)
const MERMAID_SECTION =
  '<section class="js-render-needs-enrichment render-needs-enrichment" data-type="mermaid" data-host="https://viewscreen.githubusercontent.com">' +
  '<div class="js-render-enrichment-target" data-json="{&quot;data&quot;:&quot;flowchart TD\\n  A--&amp;gt;B&quot;}"></div>' +
  "<span>Loading</span></section>";

function renderWithMermaid(overrides: Partial<IPrDetails> = {}): string {
  return renderPrDetailsHtml(buildDetails(overrides), NONCE, NOW, MERMAID_URI);
}

describe("renderPrDetailsHtml", () => {
  it("should escape HTML in interpolated fields so injected markup stays inert", () => {
    const html = render({ title: '<script>alert("boom")</script>' });

    expect(html).toContain("&lt;script&gt;alert(&quot;boom&quot;)&lt;/script&gt;");
    expect(html).not.toContain('<script>alert("boom")</script>');
  });

  it("should inject GitHub-rendered bodies as raw HTML", () => {
    const html = render({ bodyHtml: "<p>Hello <strong>world</strong></p>" });

    expect(html).toContain("<p>Hello <strong>world</strong></p>");
    expect(html).toContain("<p>Nice</p>");
  });

  it("should put the nonce in both the CSP meta tag and the script tag", () => {
    const html = render();

    expect(html).toContain(`script-src 'nonce-${NONCE}'`);
    expect(html).toContain(`<script nonce="${NONCE}">`);
  });

  describe("mermaid rendering", () => {
    it("should load the local mermaid bundle with the nonce when the description contains a diagram", () => {
      const html = renderWithMermaid({ bodyHtml: MERMAID_SECTION });

      expect(html).toContain(`<script nonce="${NONCE}" src="${MERMAID_URI}"></script>`);
      expect(html).toContain("mermaid.initialize");
    });

    it("should load the mermaid bundle when only a timeline body contains a diagram", () => {
      const html = renderWithMermaid({
        bodyHtml: "<p>plain</p>",
        timeline: [{ kind: "comment", author: "mario", avatarUrl: "", bodyHtml: MERMAID_SECTION, createdAt: "2026-07-02T00:00:00Z" }],
      });

      expect(html).toContain(`src="${MERMAID_URI}"`);
    });

    it("should not load the mermaid bundle when no body contains a diagram", () => {
      const html = renderWithMermaid();

      expect(html).not.toContain(MERMAID_URI);
      expect(html).not.toContain("mermaid.initialize");
    });

    it("should not load the mermaid bundle when no script uri is available", () => {
      const html = render({ bodyHtml: MERMAID_SECTION });

      expect(html).not.toContain("mermaid.initialize");
    });

    it("should replace GitHub's mermaid section with the fully decoded source", () => {
      const html = renderWithMermaid({ bodyHtml: MERMAID_SECTION });

      expect(html).toContain('<div class="gcc-mermaid"><pre>flowchart TD\n  A--&gt;B</pre></div>');
      expect(html).not.toContain("js-render-enrichment-target");
      expect(html).not.toContain("A--&amp;gt;B");
    });

    it("should keep the decoded source visible even without the mermaid bundle", () => {
      const html = render({ bodyHtml: MERMAID_SECTION });

      expect(html).toContain('<div class="gcc-mermaid"><pre>flowchart TD\n  A--&gt;B</pre></div>');
    });

    it("should leave a section with malformed data-json untouched", () => {
      const brokenSection = '<section data-type="mermaid"><div class="js-render-enrichment-target" data-json="not json"></div></section>';

      const html = renderWithMermaid({ bodyHtml: brokenSection });

      expect(html).toContain(brokenSection);
    });
  });

  describe("header", () => {
    it("should link the repository name and Open on GitHub above the title", () => {
      const html = render();
      expect(html).toContain('<a href="https://github.com/acme/repo">acme/repo</a>');
      expect(html).toContain('<a href="https://github.com/acme/repo/pull/42">Open on GitHub</a>');
    });

    it("should render a copy button right after the head branch name", () => {
      const html = render();
      expect(html).toContain('<span class="branch" id="head-branch">feature/thing</span><button id="copy-branch"');
    });

    it("should copy inside the webview without posting a message", () => {
      const html = render();
      expect(html).toContain("navigator.clipboard.writeText");
      expect(html).not.toContain('command: "copyBranch"');
    });

    it("should render a checkout icon next to the copy button only on open PRs", () => {
      expect(render()).toContain('<button id="checkout-branch"');
      expect(render({ state: "MERGED" })).not.toContain('<button id="checkout-branch"');
      expect(render({ state: "CLOSED" })).not.toContain('<button id="checkout-branch"');
    });
  });

  describe("state pill", () => {
    it.each([
      [{ state: "OPEN" as const }, ">Open<"],
      [{ state: "OPEN" as const, isDraft: true }, ">Draft<"],
      [{ state: "MERGED" as const }, ">Merged<"],
      [{ state: "CLOSED" as const }, ">Closed<"],
    ])("should render %o as pill %s", (overrides, expectedPill) => {
      expect(render(overrides)).toContain(expectedPill);
    });
  });

  describe("timeline", () => {
    it("should render authors, avatars and relative dates", () => {
      const html = render();

      expect(html).toContain("mario");
      expect(html).toContain('src="https://avatars.example/mario"');
      expect(html).toContain("commented 6 days ago");
      expect(html).toContain("approved these changes 5 days ago");
    });

    it("should prefix entries with a review-state icon", () => {
      const html = render();

      expect(html).toContain('<span class="review-icon">💬</span> <span class="author">mario</span>');
      expect(html).toContain('<span class="review-icon APPROVED">✓</span> <span class="author">luigi</span>');
    });

    it("should use the circular-arrow icon for requested changes", () => {
      const html = render({
        timeline: [{ kind: "review", author: "luigi", avatarUrl: "", bodyHtml: "", createdAt: "2026-07-03T00:00:00Z", reviewState: "CHANGES_REQUESTED" }],
      });

      expect(html).toContain('<span class="review-icon CHANGES_REQUESTED">↻</span>');
    });

    it("should group consecutive commits under a single avatar", () => {
      const html = render({
        timeline: [
          { kind: "commit", author: "mario", avatarUrl: "https://avatars.example/mario", bodyHtml: "", createdAt: "2026-07-02T00:00:00Z", commitMessage: "fix: one", commitSha: "abc1234", commitUrl: "https://github.com/acme/repo/commit/abc1234" },
          { kind: "commit", author: "mario", avatarUrl: "https://avatars.example/mario", bodyHtml: "", createdAt: "2026-07-02T01:00:00Z", commitMessage: "feat: two", commitSha: "def5678", commitUrl: "https://github.com/acme/repo/commit/def5678" },
        ],
      });

      expect(html.match(/class="commit-group"/g)).toHaveLength(1);
      expect(html).toContain("added 2 commits");
      expect(html).toContain(">fix: one</span>");
      expect(html).toContain('<a class="commit-sha" href="https://github.com/acme/repo/commit/abc1234">abc1234</a>');
      expect(html).toContain(">feat: two</span>");
    });

    it("should split commit groups around other timeline items", () => {
      const commit = (sha: string, createdAt: string) => ({
        kind: "commit" as const,
        author: "mario",
        avatarUrl: "",
        bodyHtml: "",
        createdAt,
        commitMessage: "fix: one",
        commitSha: sha,
        commitUrl: `https://github.com/acme/repo/commit/${sha}`,
      });
      const html = render({
        timeline: [
          commit("abc1234", "2026-07-02T00:00:00Z"),
          { kind: "comment", author: "luigi", avatarUrl: "", bodyHtml: "<p>Hi</p>", createdAt: "2026-07-02T01:00:00Z" },
          commit("def5678", "2026-07-02T02:00:00Z"),
        ],
      });

      expect(html.match(/class="commit-group"/g)).toHaveLength(2);
      expect(html.match(/added a commit/g)).toHaveLength(2);
    });

    it("should split commit groups when the author changes so each run keeps its own attribution", () => {
      const commit = (author: string, sha: string, createdAt: string) => ({
        kind: "commit" as const,
        author,
        avatarUrl: "",
        bodyHtml: "",
        createdAt,
        commitMessage: "fix: one",
        commitSha: sha,
        commitUrl: `https://github.com/acme/repo/commit/${sha}`,
      });
      const html = render({
        timeline: [
          commit("mario", "aaa1111", "2026-07-02T00:00:00Z"),
          commit("mario", "bbb2222", "2026-07-02T01:00:00Z"),
          commit("mario", "ccc3333", "2026-07-02T02:00:00Z"),
          commit("luigi", "ddd4444", "2026-07-02T03:00:00Z"),
          commit("mario", "eee5555", "2026-07-02T04:00:00Z"),
        ],
      });

      expect(html.match(/class="commit-group"/g)).toHaveLength(3);
      const groupHeaders = [...html.matchAll(/<span class="author">(\w+)<\/span> (added (?:a commit|\d+ commits))/g)].map(
        (headerMatch) => `${headerMatch[1]} ${headerMatch[2]}`,
      );
      expect(groupHeaders).toEqual(["mario added 3 commits", "luigi added a commit", "mario added a commit"]);
    });

    it("should escape commit messages", () => {
      const html = render({
        timeline: [
          { kind: "commit", author: "mario", avatarUrl: "", bodyHtml: "", createdAt: "2026-07-02T00:00:00Z", commitMessage: "fix: <script>alert(1)</script>", commitSha: "abc1234", commitUrl: "" },
        ],
      });

      expect(html).not.toContain("<script>alert(1)</script>");
      expect(html).toContain("fix: &lt;script&gt;");
    });

    it("should link review code comments to the files tab", () => {
      const html = render();

      expect(html).toContain('href="https://github.com/acme/repo/pull/42/files">2 comments on files</a>');
    });

    it("should show the older-conversation link only when truncated", () => {
      expect(render({ timelineTruncated: true })).toContain("View older conversation on GitHub");
      expect(render()).not.toContain("View older conversation on GitHub");
    });
  });

  describe("merge box", () => {
    it("should offer only the repo-allowed merge methods", () => {
      const html = render();

      expect(html).toContain('<option value="SQUASH">Squash and merge</option>');
      expect(html).toContain('<option value="MERGE">Create a merge commit</option>');
      expect(html).not.toContain('value="REBASE"');
    });

    it.each([
      ["draft", { isDraft: true }],
      ["merged", { state: "MERGED" as const }],
      ["closed", { state: "CLOSED" as const }],
      ["no allowed method", { mergeMethods: [] as IPrDetails["mergeMethods"] }],
    ])("should hide the merge button when %s", (_label, overrides) => {
      expect(render(overrides)).not.toContain('id="merge"');
    });

    it("should link check names to their run when a URL is present", () => {
      const html = render({
        checks: [
          { name: "build", status: "FAILURE", url: "https://ci.example/run/1" },
          { name: "no-link", status: "SUCCESS" },
        ],
        checksTotal: 2,
      });

      expect(html).toContain('<a href="https://ci.example/run/1">build</a>');
      expect(html).toContain(">no-link<");
      expect(html).not.toContain(">no-link</a>");
    });

    it("should show Ready for review only on the viewer's own open drafts", () => {
      const ownDraft = render({ isDraft: true, viewerDidAuthor: true });
      const colleagueDraft = render({ isDraft: true, viewerDidAuthor: false });
      const ownNonDraft = render({ viewerDidAuthor: true });
      const mergedDraft = render({ isDraft: true, viewerDidAuthor: true, state: "MERGED" });

      expect(ownDraft).toContain('id="ready"');
      expect(ownDraft).not.toContain('id="merge"');
      expect(colleagueDraft).not.toContain('id="ready"');
      expect(ownNonDraft).not.toContain('id="ready"');
      expect(mergedDraft).not.toContain('id="ready"');
    });

    it("should offer Update branch only when the PR is open and behind base", () => {
      expect(render({ isBehindBase: true })).toContain('id="update-branch"');
      expect(render()).not.toContain('id="update-branch"');
      expect(render({ isBehindBase: true, state: "MERGED" })).not.toContain('id="update-branch"');
    });

    it("should offer both update methods with rebase as the default", () => {
      const html = render({ isBehindBase: true });

      const rebaseIndex = html.indexOf('<option value="REBASE">Update with rebase</option>');
      const mergeIndex = html.indexOf('<option value="MERGE">Update with merge commit</option>');
      expect(rebaseIndex).toBeGreaterThan(-1);
      expect(mergeIndex).toBeGreaterThan(-1);
      expect(rebaseIndex).toBeLessThan(mergeIndex);
    });

    it("should put the configured default update method first", () => {
      const html = renderPrDetailsHtml(buildDetails({ isBehindBase: true }), NONCE, NOW, undefined, "MERGE");

      const rebaseIndex = html.indexOf('<option value="REBASE">');
      const mergeIndex = html.indexOf('<option value="MERGE">');
      expect(mergeIndex).toBeGreaterThan(-1);
      expect(mergeIndex).toBeLessThan(rebaseIndex);
    });

    it("should offer Checkout branch on open PRs only", () => {
      expect(render()).toContain('id="checkout"');
      expect(render({ isDraft: true, viewerDidAuthor: true })).toContain('id="checkout"');
      expect(render({ state: "MERGED" })).not.toContain('id="checkout"');
      expect(render({ state: "CLOSED" })).not.toContain('id="checkout"');
    });

    it("should summarize failing checks", () => {
      const html = render({
        checks: [
          { name: "build", status: "SUCCESS" },
          { name: "lint", status: "FAILURE" },
        ],
        checksTotal: 5,
      });

      expect(html).toContain("1 failing check");
      expect(html).toContain("+3 more on GitHub");
    });

    it("should summarize in-progress checks instead of reporting them as passed", () => {
      const html = render({
        checks: [
          { name: "build", status: "PENDING" },
          { name: "lint", status: "SUCCESS" },
        ],
        checksTotal: 2,
      });

      expect(html).toContain("1 check in progress");
      expect(html).toContain('class="row pending"');
      expect(html).not.toContain("All checks passed");
    });

    it("should count EXPECTED and STALE checks as in progress", () => {
      const html = render({
        checks: [
          { name: "deploy", status: "EXPECTED" },
          { name: "outdated", status: "STALE" },
        ],
        checksTotal: 2,
      });

      expect(html).toContain("2 checks in progress");
    });

    it("should treat unknown check states as in progress, never as passed", () => {
      const html = render({ checks: [{ name: "future", status: "SOME_NEW_STATE" }], checksTotal: 1 });

      expect(html).toContain("1 check in progress");
      expect(html).not.toContain("All checks passed");
    });

    it("should prioritize failing checks over in-progress ones", () => {
      const html = render({
        checks: [
          { name: "build", status: "FAILURE" },
          { name: "lint", status: "PENDING" },
        ],
        checksTotal: 2,
      });

      expect(html).toContain("1 failing check");
      expect(html).not.toContain("in progress");
    });

    it("should count TIMED_OUT and STARTUP_FAILURE checks as failing", () => {
      const html = render({
        checks: [
          { name: "build", status: "TIMED_OUT" },
          { name: "lint", status: "STARTUP_FAILURE" },
        ],
        checksTotal: 2,
      });

      expect(html).toContain("2 failing checks");
    });

    it("should count CANCELLED and ACTION_REQUIRED checks as failing, like GitHub's own rollup", () => {
      const html = render({
        checks: [
          { name: "build", status: "CANCELLED" },
          { name: "approval", status: "ACTION_REQUIRED" },
        ],
        checksTotal: 2,
      });

      expect(html).toContain("2 failing checks");
      expect(html).not.toContain("All checks passed");
    });

    it("should keep the all-passed summary when every check succeeded", () => {
      const html = render({ checks: [{ name: "build", status: "SUCCESS" }], checksTotal: 1 });

      expect(html).toContain("All checks passed");
    });

    it("should keep the all-passed summary for neutral and skipped checks", () => {
      const html = render({
        checks: [
          { name: "optional", status: "NEUTRAL" },
          { name: "docs-only", status: "SKIPPED" },
        ],
        checksTotal: 2,
      });

      expect(html).toContain("All checks passed");
    });

    it("should show a neutral summary when there are no checks", () => {
      const html = render({ checks: [], checksTotal: 0 });

      expect(html).toContain("No checks");
      expect(html).not.toContain("All checks passed");
    });
  });

  describe("webview script", () => {
    it("should post composer empty/non-empty transitions to the extension", () => {
      const html = render();

      expect(html).toContain('command: "composerState"');
    });

    it("should persist and restore the scroll position keyed by PR", () => {
      const html = render();

      expect(html).toContain('"acme/repo#42"');
      expect(html).toContain("vscodeApi.setState({ prKey, scrollY: window.scrollY, briefCollapsed:");
      expect(html).toContain("vscodeApi.getState()");
    });

    it("should re-enable only the buttons the send freeze disabled, never designed-disabled ones", () => {
      const html = render();

      // send() records the buttons it disables; reenable restores exactly that set, so a
      // brief button rendered disabled (pending/done) stays disabled after a cancelled action
      expect(html).toContain("frozenButtons = allButtons.filter((button) => !button.disabled)");
      expect(html).toContain("frozenButtons.forEach((button) => { button.disabled = false; })");
      expect(html).not.toContain("allButtons.forEach((button) => { button.disabled = false; })");
    });
  });

  describe("composer", () => {
    it("should hide review buttons on the viewer's own PRs but keep the comment button", () => {
      const html = render({ viewerDidAuthor: true });

      expect(html).not.toContain('id="approve"');
      expect(html).not.toContain('id="request-changes"');
      expect(html).toContain('id="comment"');
    });

    it("should hide review buttons on non-open PRs", () => {
      expect(render({ state: "MERGED" })).not.toContain('id="approve"');
    });

    it("should show Approve and Request changes on a colleague's open PR", () => {
      const html = render();

      expect(html).toContain('id="approve"');
      expect(html).toContain('id="request-changes"');
    });

    it("should disable Approve with a tooltip when the viewer's approval is still current", () => {
      const html = render({ canApprove: false });

      expect(html).toMatch(/<button id="approve"[^>]*\bdisabled\b[^>]*>/);
      expect(html).toContain('title="You already approved this Pull Request"');
    });

    it("should keep Approve enabled when the viewer can approve", () => {
      const html = render({ canApprove: true });

      expect(html).not.toMatch(/<button id="approve"[^>]*\bdisabled\b/);
    });

    it("should show the pending review hint with the draft comment count", () => {
      const html = render({ pendingReviewCommentCount: 2 });

      expect(html).toContain("You have a pending review with 2 draft comments — Comment, Approve or Request changes will submit it.");
    });

    it("should use the singular form for one draft comment", () => {
      const html = render({ pendingReviewCommentCount: 1 });

      expect(html).toContain("1 draft comment —");
    });

    it("should only mention Comment in the hint on the viewer's own PR", () => {
      const html = render({ pendingReviewCommentCount: 1, viewerDidAuthor: true });

      expect(html).toContain("— Comment will submit it.");
    });

    it("should omit the draft count when the pending review has no drafts left", () => {
      const html = render({ pendingReviewCommentCount: 0 });

      expect(html).toContain("You have a pending review — Comment, Approve or Request changes will submit it.");
    });

    it("should not show the pending review hint when no pending review exists", () => {
      expect(render()).not.toContain("pending review with");
    });

    it("should keep the Comment button clickable on an empty composer while a pending review exists", () => {
      expect(render({ pendingReviewCommentCount: 0 })).toContain("commentButton.disabled = !hasText && false;");
    });

    it("should disable the Comment button on an empty composer when no pending review exists", () => {
      expect(render()).toContain("commentButton.disabled = !hasText && true;");
    });
  });

  describe("sidebar", () => {
    it("should show the aggregate diffstat linking to the files tab", () => {
      const html = render();

      expect(html).toContain('href="https://github.com/acme/repo/pull/42/files">1 file</a>');
      expect(html).toContain(">+10</span>");
      expect(html).toContain(">−4</span>");
      expect(html).not.toContain("src/index.ts");
    });

    it.each([
      ["APPROVED", "✓ approved"],
      ["CHANGES_REQUESTED", "↻ changes requested"],
      ["COMMENTED", "💬 commented"],
      ["REQUESTED", "● requested"],
    ])("should show the %s reviewer with its state icon", (state, expectedState) => {
      const html = render({ reviewers: [{ name: "luigi", state }] });

      expect(html).toContain(`<span class="reviewer-state ${state}">${expectedState}</span>`);
    });

    it("should flag a stale approval with the stale suffix and class", () => {
      const html = render({ reviewers: [{ name: "luigi", state: "APPROVED", isStale: true }] });

      expect(html).toContain('<span class="reviewer-state APPROVED stale">✓ approved · stale</span>');
    });

    it("should color label pills with the GitHub label color", () => {
      const html = render();

      expect(html).toContain("#d73a4a");
      expect(html).toContain(">bug</span>");
    });

    it("should fall back to a neutral color for invalid label colors", () => {
      const html = render({ labels: [{ name: "odd", color: "not-a-color" }] });

      expect(html).not.toContain("#not-a-color");
      expect(html).toContain(">odd</span>");
    });
  });

  describe("brief section", () => {
    function renderWithBrief(brief: IBriefState): string {
      return renderPrDetailsHtml(buildDetails(), NONCE, NOW, undefined, "REBASE", brief);
    }

    it("should render neither button nor section when no brief state is passed", () => {
      const html = render();

      expect(html).not.toContain('id="brief"');
      expect(html).not.toContain("Summary</summary>");
    });

    it("should render the button but no section when idle", () => {
      const html = renderWithBrief({ status: "idle" });

      expect(html).toContain('id="brief"');
      expect(html).not.toContain("Summary</summary>");
    });

    it("should render neither button nor section when unavailable", () => {
      const html = renderWithBrief({ status: "unavailable" });

      expect(html).not.toContain('id="brief"');
    });

    it("should show a progress message and a disabled button while pending", () => {
      const html = renderWithBrief({ status: "pending" });

      expect(html).toContain("Summarizing");
      expect(html).toMatch(/id="brief"[^>]*disabled/);
    });

    it("should disable the button once a brief exists for the current head commit", () => {
      const html = renderWithBrief({ status: "done", text: "Summary" });

      expect(html).toMatch(/id="brief"[^>]*disabled/);
    });

    it("should keep the button enabled after an error so the user can retry", () => {
      const html = renderWithBrief({ status: "error", text: "boom" });

      expect(html).not.toMatch(/id="brief"[^>]*disabled/);
    });

    it("should keep a stale summary visible with a warning banner, header tag, and an enabled button", () => {
      const html = renderWithBrief({ status: "done", text: "Summary", stale: true });

      expect(html).toContain('<div class="brief-stale">');
      expect(html).toContain('<span class="brief-stale-tag">outdated</span>');
      expect(html).toContain("Summary");
      expect(html).not.toMatch(/id="brief"[^>]*disabled/);
    });

    it("should render neither banner nor tag for a fresh summary", () => {
      const html = renderWithBrief({ status: "done", text: "Summary" });

      expect(html).not.toContain('<div class="brief-stale">');
      expect(html).not.toContain('<span class="brief-stale-tag">');
    });

    it("should render the summary as escaped plain text so model output stays inert", () => {
      const html = renderWithBrief({ status: "done", text: 'Summary <script>alert("x")</script>' });

      expect(html).toContain("brief-section");
      expect(html).toContain("Summary &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
      expect(html).not.toContain('<script>alert("x")</script>');
    });

    it("should format '## ' lines as headings and '- ' lines as list items", () => {
      const html = renderWithBrief({ status: "done", text: "## What changed\n- added a thing\n- removed a thing\n## Risk areas\n- none" });

      expect(html).toContain('<div class="brief-heading">What changed</div>');
      expect(html).toContain("<li>added a thing</li>");
      expect(html).toContain("<ul><li>added a thing</li><li>removed a thing</li></ul>");
      expect(html).toContain('<div class="brief-heading">Risk areas</div>');
    });

    it("should escape model output inside headings and bullets", () => {
      const html = renderWithBrief({ status: "done", text: '## <b>bold</b>\n- <script>alert("x")</script>' });

      expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
      expect(html).toContain("<li>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</li>");
      expect(html).not.toContain('<script>alert("x")</script>');
    });

    it("should render lines without a marker as paragraphs", () => {
      const html = renderWithBrief({ status: "done", text: "plain intro line" });

      expect(html).toContain("<p>plain intro line</p>");
    });

    it("should treat '*' and '+' bullets like '-' bullets", () => {
      const html = renderWithBrief({ status: "done", text: "* first\n+ second" });

      expect(html).toContain("<ul><li>first</li><li>second</li></ul>");
    });

    it("should format headings of any depth, not just '## '", () => {
      const html = renderWithBrief({ status: "done", text: "# Top\n### Nested" });

      expect(html).toContain('<div class="brief-heading">Top</div>');
      expect(html).toContain('<div class="brief-heading">Nested</div>');
    });

    it("should keep a '**bold**' line as bold text, not mistake it for a '*' bullet", () => {
      const html = renderWithBrief({ status: "done", text: "**Heads up**: read this" });

      // a paragraph, not a list item — the '**' is bold, not a bullet marker
      expect(html).toContain("<p><strong>Heads up</strong>: read this</p>");
    });

    it("should format numbered lines as an ordered list", () => {
      const html = renderWithBrief({ status: "done", text: "## Suggested reading order\n1. read this\n2. then that" });

      expect(html).toContain("<ol><li>read this</li><li>then that</li></ol>");
    });

    it("should render backtick spans as inline code", () => {
      const html = renderWithBrief({ status: "done", text: "- `listenWhen` now skips `deeplink` sources" });

      expect(html).toContain("<li><code>listenWhen</code> now skips <code>deeplink</code> sources</li>");
    });

    it("should keep escaping markup inside backtick spans", () => {
      const html = renderWithBrief({ status: "done", text: "- run `<script>alert(1)</script>` now" });

      expect(html).toContain("<code>&lt;script&gt;alert(1)&lt;/script&gt;</code>");
      expect(html).not.toContain("<script>alert(1)</script>");
    });

    it("should leave an unpaired backtick as literal text", () => {
      const html = renderWithBrief({ status: "done", text: "- a stray ` backtick" });

      expect(html).toContain("<li>a stray ` backtick</li>");
    });

    it("should render ** bold ** spans as strong, a common slip past the prompt contract", () => {
      const html = renderWithBrief({ status: "done", text: "- **Risk**: a race in the poll loop" });

      expect(html).toContain("<li><strong>Risk</strong>: a race in the poll loop</li>");
    });

    it("should keep escaping markup inside bold spans", () => {
      const html = renderWithBrief({ status: "done", text: "- **<img src=x>** danger" });

      expect(html).toContain("<strong>&lt;img src=x&gt;</strong>");
      expect(html).not.toContain("<img src=x>");
    });

    it("should render the summary as a collapsible section, open by default", () => {
      const html = renderWithBrief({ status: "done", text: "Summary" });

      expect(html).toContain("<details open");
      expect(html).toContain("Summary</summary>");
    });

    it("should show the provider avatar in the gutter like the timeline boxes", () => {
      const html = renderWithBrief({ status: "done", text: "Summary" });

      expect(html).toContain('class="avatar brief-avatar"');
      expect(html).toContain("<svg");
    });

    it("should place the button in its own actions row below the state pill", () => {
      const html = renderWithBrief({ status: "idle" });

      expect(html).toContain('class="header-actions"');
      expect(html.indexOf('class="header-actions"')).toBeGreaterThan(html.indexOf('class="merge-sentence"'));
      expect(html.indexOf('id="brief"')).toBeLessThan(html.indexOf('class="layout"'));
    });

    it("should render no actions row when there is no brief state", () => {
      const html = render();

      expect(html).not.toContain('class="header-actions"');
    });

    it("should render errors inside the section", () => {
      const html = renderWithBrief({ status: "error", text: "Claude CLI failed: run /login" });

      expect(html).toContain("brief-error");
      expect(html).toContain("Claude CLI failed: run /login");
    });
  });
});

describe("conversation images", () => {
  it("normalizes relative and root paths in PR descriptions, comments, and review summaries", () => {
    const details = buildDetails({ headRepo: "contributor/fork" });
    details.bodyHtml = '<img src="./assets/画 %231.png"><img src="/user-attachments/assets/123">';
    details.timeline[0].bodyHtml = "<IMG SRC='docs/picture.png'>";
    details.timeline[1].bodyHtml = '<img src="/acme/repo/raw/main/images/screenshot.jpg">';
    const html = renderPrDetailsHtml(details, NONCE, NOW);

    expect(html).toContain('src="https://github.com/contributor/fork/raw/head-oid/assets/%E7%94%BB%20%231.png"');
    expect(html).toContain('src="https://github.com/user-attachments/assets/123"');
    expect(html).toContain('SRC="https://github.com/contributor/fork/raw/head-oid/docs/picture.png"');
    expect(html).toContain('src="https://github.com/acme/repo/raw/main/images/screenshot.jpg"');
  });

  it("preserves HTTPS and data URLs, signed query strings, and unrelated attributes", () => {
    const html = render({
      bodyHtml: '<!-- <img src="ignored.png"> --><img src="https://host/image?sig=a%2F%2Bb&amp;x=1" alt=\'it says src="ignore.png"\'><img src=data:image/png;base64,AA==>',
    });

    expect(html).toContain('<!-- <img src="ignored.png"> -->');
    expect(html).toContain('src="https://host/image?sig=a%2F%2Bb&amp;x=1"');
    expect(html).toContain('alt=\'it says src="ignore.png"\'');
    expect(html).toContain('src="data:image/png;base64,AA=="');
    expect(html).toContain("img-src https: data:");
  });

  it("normalizes srcset candidates for picture sources and images, keeping data URL commas and descriptors", () => {
    const html = render({
      bodyHtml: '<picture><source srcset="a.png 1x, /user-attachments/assets/b 2x, https://cdn/c.png 3x"><img src="a.png" srcset="data:image/png;base64,AA== 1x, //cdn/d.png 2x"></picture>',
    });

    expect(html).toContain('srcset="https://github.com/acme/repo/raw/head-oid/a.png 1x, https://github.com/user-attachments/assets/b 2x, https://cdn/c.png 3x"');
    expect(html).toContain('srcset="data:image/png;base64,AA== 1x, https://cdn/d.png 2x"');
  });

  it("strips oversized inline images before sending HTML to the webview", () => {
    const oversized = 'A'.repeat(Math.ceil((10 * 1024 * 1024 + 1) * 4 / 3));
    const html = render({ bodyHtml: `<img src="data:image/png;base64,${oversized}">` });

    expect(html).toContain('<img src="data:,">');
    expect(html).not.toContain("data:image/png;base64,AAAA");
  });
});

it("requests only failed images once and replaces them with the resolved data or a GitHub link", () => {
  class Image {
    readonly isConnected = true;
    src: string;
    removeAttribute = vi.fn();
    replaceWith = vi.fn();
    addEventListener = vi.fn();

    constructor(readonly currentSrc: string) {
      this.src = currentSrc;
    }

    closest(selector: string) {
      return selector === ".timeline .box-body" ? {} : null;
    }
  }
  const script = render().split(`<script nonce="${NONCE}">`)[1].split("</script>")[0];
  const error = vi.fn();
  const message = vi.fn();
  const postMessage = vi.fn();
  const link = { href: "", textContent: "" };
  const placeholder = { append: vi.fn() };
  const composer = { value: "", addEventListener: vi.fn() };
  let sequence = 0;
  runInNewContext(script, {
    acquireVsCodeApi: () => ({ getState: () => undefined, postMessage }),
    crypto: { randomUUID: () => `image-${++sequence}` },
    HTMLImageElement: Image,
    document: {
      getElementById: (id: string) => ["composer-text", "comment"].includes(id) ? composer : null,
      querySelectorAll: () => [],
      querySelector: () => null,
      addEventListener: error,
      createElement: (name: string) => name === "a" ? link : placeholder,
    },
    window: { addEventListener: message },
  });

  const captureError = error.mock.calls[0][1];
  const receive = message.mock.calls.find(([event]) => event === "message")?.[1];
  const privateImage = new Image("https://github.com/acme/repo/raw/main/image.png");
  const attachment = new Image("https://github.com/user-attachments/assets/123");
  expect(error).toHaveBeenCalledWith("error", expect.any(Function), true);
  expect(postMessage).not.toHaveBeenCalled();

  captureError({ target: privateImage });
  captureError({ target: privateImage });
  captureError({ target: attachment });
  expect(postMessage.mock.calls.map(([payload]) => payload)).toEqual([
    { command: "resolveImage", src: privateImage.currentSrc, requestId: "image-1" },
    { command: "resolveImage", src: attachment.currentSrc, requestId: "image-2" },
  ]);

  receive({ data: { command: "imageResolved", requestId: "image-1", dataUri: "data:image/png;base64,AA==" } });
  expect(privateImage.src).toBe("data:image/png;base64,AA==");
  expect(privateImage.removeAttribute).toHaveBeenCalledWith("srcset");
  expect(privateImage.addEventListener).toHaveBeenCalledWith("error", expect.any(Function), { once: true });

  receive({ data: { command: "imageResolved", requestId: "image-2", url: attachment.currentSrc } });
  expect(attachment.replaceWith).toHaveBeenCalledExactlyOnceWith(placeholder);
  expect(link).toEqual({ href: attachment.currentSrc, textContent: "Open on GitHub" });
  expect(placeholder.append).toHaveBeenCalledWith("Could not load this image. ", link);
});

describe("inline image lightbox", () => {
  it("renders the lightbox markup with high-specificity button overrides and excludes lightbox buttons from send() freeze", () => {
    const html = render();

    expect(html).toContain('id="ghcc-lightbox"');
    expect(html).toContain(".ghcc-lightbox .ghcc-btn");
    expect(html).toContain(".ghcc-lightbox .ghcc-swatch");
    expect(html).toContain(".ghcc-lightbox .lb-nav");
    expect(html).toContain('!button.closest?.(".ghcc-lightbox")');
    expect(html).toContain("Nearest-neighbor (P)");
    expect(html).toContain("cursor: grab;");
    expect(html).toContain("cursor: pointer;");
    expect(html).not.toContain("cursor: zoom-in");
    expect(html).not.toContain("crisp-edges");
    expect(html).toContain('class="lb-stage ghcc-surface pixelated"');
    expect(html).toMatch(/id="lb-pixel"[^>]*aria-pressed="true"/);

    const smoothHtml = renderPrDetailsHtml(buildDetails(), NONCE, NOW, undefined, "REBASE", undefined, false);
    expect(smoothHtml).toContain('class="lb-stage ghcc-surface"');
    expect(smoothHtml).toMatch(/id="lb-pixel"[^>]*aria-pressed="false"/);
  });

  it("skips small badges, intercepts plain click on linked images, keeps modifier clicks, and guards lightbox close", () => {
    class MockEl {
      className = "";
      textContent = "";
      value = "";
      disabled = false;
      href = "";
      src = "";
      alt = "";
      innerHTML = "";
      hidden = false;
      width = 0;
      height = 0;
      complete = true;
      isConnected = true;
      dataset: Record<string, string> = {};
      parentNode: MockEl | null = null;
      parentElement: MockEl | null = null;
      children: MockEl[] = [];
      attrs = new Map<string, string>();
      listeners = new Map<string, Array<(e: Record<string, unknown>) => void>>();
      classes = new Set<string>();
      rect = { left: 100, top: 100, right: 500, bottom: 400, width: 400, height: 300 };
      style = { transform: "", setProperty: vi.fn() };
      onload: (() => void) | null = null;

      constructor(
        public readonly tagName: string,
        public naturalWidth = 0,
        public naturalHeight = 0,
      ) {}

      get classList() {
        return {
          add: (c: string) => this.classes.add(c),
          remove: (c: string) => this.classes.delete(c),
          toggle: (c: string, force?: boolean) => {
            if (force === undefined) {
              if (this.classes.has(c)) {
                this.classes.delete(c);
              } else {
                this.classes.add(c);
              }
            } else if (force) {
              this.classes.add(c);
            } else {
              this.classes.delete(c);
            }
          },
          contains: (c: string) => this.classes.has(c),
        };
      }

      setAttribute(name: string, value: string) {
        this.attrs.set(name, value);
      }

      getAttribute(name: string) {
        return this.attrs.get(name) ?? (name === "href" ? this.href : name === "src" ? this.src : null);
      }

      addEventListener(event: string, fn: (e: Record<string, unknown>) => void) {
        const list = this.listeners.get(event) ?? [];
        list.push(fn);
        this.listeners.set(event, list);
      }

      emit(event: string, payload: Record<string, unknown> = {}) {
        for (const fn of this.listeners.get(event) ?? []) {
          fn(payload);
        }
      }

      insertBefore(node: MockEl, ref: MockEl) {
        node.parentNode = this;
        node.parentElement = this;
        const idx = this.children.indexOf(ref);
        if (idx >= 0) {
          this.children.splice(idx, 0, node);
        } else {
          this.children.push(node);
        }
      }

      appendChild(node: MockEl) {
        if (node.parentNode) {
          const oldIdx = node.parentNode.children.indexOf(node);
          if (oldIdx >= 0) {
            node.parentNode.children.splice(oldIdx, 1);
          }
        }
        node.parentNode = this;
        node.parentElement = this;
        this.children.push(node);
      }

      closest(selector: string): MockEl | null {
        if (selector === ".timeline .box-body" && this.className.includes("box-body")) {
          return this;
        }
        if (selector === ".ghcc-inline-img-wrap" && this.className.includes("ghcc-inline-img-wrap")) {
          return this;
        }
        if (selector === "a" && this.tagName === "A") {
          return this;
        }
        if (selector === "picture" && this.tagName === "PICTURE") {
          return this;
        }
        return this.parentNode?.closest(selector) ?? null;
      }

      getBoundingClientRect() {
        return this.rect;
      }

      setPointerCapture = vi.fn();
    }

    class MockImage extends MockEl {
      get currentSrc() {
        return this.src;
      }
      constructor(src: string, w: number, h: number, alt = "") {
        super("IMG", w, h);
        this.src = src;
        this.alt = alt;
      }
    }

    const boxBody = new MockEl("DIV");
    boxBody.className = "box-body";

    const badge = new MockImage("https://img.shields.io/badge/ci-pass-green.svg", 112, 20, "CI passing");
    boxBody.appendChild(badge);

    const anchor = new MockEl("A");
    anchor.href = "https://github.com/acme/repo/blob/main/shot.png";
    const linkedImg = new MockImage("https://github.com/acme/repo/raw/main/shot.png", 1200, 800, "Screenshot");
    anchor.appendChild(linkedImg);
    boxBody.appendChild(anchor);

    const unsafeAnchor = new MockEl("A");
    unsafeAnchor.href = "javascript:alert(1)";
    const dataImg = new MockImage("data:image/png;base64,AA==", 400, 300, "Inline Data");
    unsafeAnchor.appendChild(dataImg);
    boxBody.appendChild(unsafeAnchor);

    const lbEl = new MockEl("DIV");
    const lbStage = new MockEl("DIV");
    lbStage.rect = { left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800 };
    const lbImg = new MockImage("", 1200, 800);
    lbImg.rect = { left: 200, top: 150, right: 800, bottom: 650, width: 600, height: 500 };
    const lbCounter = new MockEl("SPAN");
    const lbCaption = new MockEl("SPAN");
    const lbDim = new MockEl("SPAN");
    const lbZoomVal = new MockEl("BUTTON");
    const lbGithub = new MockEl("A");
    const lbPrev = new MockEl("BUTTON");
    const lbNext = new MockEl("BUTTON");
    const lbPixel = new MockEl("BUTTON");
    const lbClose = new MockEl("BUTTON");
    const lbZoomIn = new MockEl("BUTTON");
    const lbZoomOut = new MockEl("BUTTON");
    const lbFit = new MockEl("BUTTON");
    const composer = new MockEl("TEXTAREA");
    const commentBtn = new MockEl("BUTTON");

    const byId: Record<string, MockEl> = {
      "ghcc-lightbox": lbEl,
      "lb-stage": lbStage,
      "lb-img": lbImg,
      "lb-counter": lbCounter,
      "lb-caption": lbCaption,
      "lb-dim": lbDim,
      "lb-zoom-val": lbZoomVal,
      "lb-github": lbGithub,
      "lb-prev": lbPrev,
      "lb-next": lbNext,
      "lb-pixel": lbPixel,
      "lb-close": lbClose,
      "lb-zoom-in": lbZoomIn,
      "lb-zoom-out": lbZoomOut,
      "lb-fit": lbFit,
      "composer-text": composer,
      comment: commentBtn,
    };

    const postMessage = vi.fn();
    const docListeners = new Map<string, Array<(e: Record<string, unknown>) => void>>();
    const script = render().split(`<script nonce="${NONCE}">`)[1].split("</script>")[0];

    runInNewContext(script, {
      acquireVsCodeApi: () => ({ getState: () => undefined, setState: vi.fn(), postMessage }),
      crypto: { randomUUID: () => "req-1" },
      setTimeout,
      clearTimeout,
      HTMLImageElement: MockImage,
      document: {
        getElementById: (id: string) => byId[id] ?? null,
        querySelector: () => null,
        querySelectorAll: (selector: string) => {
          if (selector === ".timeline .box-body img") {
            return [badge, linkedImg, dataImg];
          }
          if (selector === ".timeline .box-body .ghcc-inline-img-wrap img") {
            return [linkedImg, dataImg].filter((img) => Boolean(img.closest(".ghcc-inline-img-wrap")));
          }
          return [];
        },
        addEventListener: (event: string, fn: (e: Record<string, unknown>) => void) => {
          const list = docListeners.get(event) ?? [];
          list.push(fn);
          docListeners.set(event, list);
        },
        createElement: (tag: string) => new MockEl(tag.toUpperCase()),
      },
      window: { addEventListener: vi.fn(), scrollTo: vi.fn(), scrollY: 0 },
    });

    // Badge skipped; content images wrapped
    expect(badge.closest(".ghcc-inline-img-wrap")).toBeNull();
    const linkedWrap = linkedImg.closest(".ghcc-inline-img-wrap")!;
    const dataWrap = dataImg.closest(".ghcc-inline-img-wrap")!;
    expect(linkedWrap).not.toBeNull();
    expect(dataWrap).not.toBeNull();

    // Cmd+Click preserves native link navigation without opening lightbox
    const cmdClick = { metaKey: true, ctrlKey: false, shiftKey: false, button: 0, preventDefault: vi.fn() };
    linkedWrap.emit("click", cmdClick);
    expect(cmdClick.preventDefault).not.toHaveBeenCalled();
    expect(lbEl.classList.contains("open")).toBe(false);

    // Normal left click opens lightbox & uses safe outer <a href>
    const plainClick = { metaKey: false, ctrlKey: false, shiftKey: false, button: 0, preventDefault: vi.fn() };
    linkedWrap.emit("click", plainClick);
    expect(plainClick.preventDefault).toHaveBeenCalledOnce();
    expect(lbEl.classList.contains("open")).toBe(true);
    expect(lbCounter.textContent).toBe("1 / 2");
    expect(lbGithub.href).toBe("https://github.com/acme/repo/blob/main/shot.png");

    // Clicking inside the image bounds must NOT close the lightbox
    lbStage.emit("click", { target: lbStage, clientX: 400, clientY: 300 });
    expect(lbEl.classList.contains("open")).toBe(true);

    // Even in fitted state, dragging and releasing outside the image must pan without closing the lightbox
    lbStage.emit("pointerdown", { button: 0, clientX: 400, clientY: 300, pointerId: 1 });
    lbStage.emit("pointermove", { clientX: 450, clientY: 340 });
    lbStage.emit("pointerup", {});
    lbStage.emit("click", { target: lbStage, clientX: 10, clientY: 10 });
    expect(lbEl.classList.contains("open")).toBe(true);

    // Default is nearest-neighbor; toggling off persists via setPixelated and stays off across lbNext & reopen
    expect(lbStage.classList.contains("pixelated")).toBe(true);
    expect(lbPixel.getAttribute("aria-pressed")).toBe("true");
    lbPixel.emit("click", {});
    expect(lbStage.classList.contains("pixelated")).toBe(false);
    expect(lbPixel.getAttribute("aria-pressed")).toBe("false");
    expect(postMessage).toHaveBeenCalledWith({ command: "setPixelated", value: false });

    // Next image (>64px) with unsafe javascript: anchor + data: src keeps pixelated=false and falls back to prUrl
    lbNext.emit("click", {});
    expect(lbCounter.textContent).toBe("2 / 2");
    expect(lbGithub.href).toBe("https://github.com/acme/repo/pull/42");
    expect(lbStage.classList.contains("pixelated")).toBe(false);
    expect(lbPixel.getAttribute("aria-pressed")).toBe("false");

    // Plain click on empty backdrop outside image bounds closes lightbox
    lbStage.emit("pointerdown", { button: 0, clientX: 20, clientY: 20, pointerId: 2 });
    lbStage.emit("pointerup", {});
    lbStage.emit("click", { target: lbStage, clientX: 20, clientY: 20 });
    expect(lbEl.classList.contains("open")).toBe(false);

    // Reopening another image still keeps pixelated=false
    dataWrap.emit("click", { metaKey: false, ctrlKey: false, shiftKey: false, button: 0, preventDefault: vi.fn() });
    expect(lbStage.classList.contains("pixelated")).toBe(false);
    expect(lbPixel.getAttribute("aria-pressed")).toBe("false");
  });
});
