interface IGitHubFile {
  repo: string;
  ref: string;
  path: string;
}

const GITHUB_ORIGIN = "https://github.com";
const RAW_ORIGIN = "https://raw.githubusercontent.com";

export function gitHubFileRoot(repo: string, ref: string, mode: "blob" | "raw"): string {
  return `${GITHUB_ORIGIN}/${repo}/${mode}/${encodeURIComponent(ref)}/`;
}

export function gitHubFileUrl({ repo, ref, path }: IGitHubFile): string {
  return gitHubFileRoot(repo, ref, "blob") + path.split("/").map(encodeURIComponent).join("/");
}

export function parseGitHubFileUrl(src: string, knownRefs: readonly string[] = []): IGitHubFile | undefined {
  const url = parseHttpsUrl(src);
  if (!url || url.username || url.password || ![GITHUB_ORIGIN, RAW_ORIGIN].includes(url.origin)) {
    return undefined;
  }
  const [, owner, repo, ...tail] = url.pathname.split("/");
  if (!/^[\w-]+$/.test(owner ?? "") || !/^[\w.-]+$/.test(repo ?? "") || repo === "." || repo === "..") {
    return undefined;
  }
  if (url.origin === GITHUB_ORIGIN && !["blob", "raw"].includes(tail.shift() ?? "")) {
    return undefined;
  }
  try {
    const segments = tail.map(decodeURIComponent);
    const namespace = segments[0] === "refs" && ["heads", "tags"].includes(segments[1])
      ? segments.splice(0, 2).join("/") + "/"
      : "";
    const unencodedRef = knownRefs
      .filter((ref) => ref.includes("/") && ref.split("/").every((part, index) => part === segments[index]))
      .sort((a, b) => b.length - a.length)[0];
    const ref = unencodedRef ?? segments[0];
    const path = segments.slice(unencodedRef ? unencodedRef.split("/").length : 1);
    if (!ref || !path.length || path.some((part) => !part || part === "." || part === ".." || /[/\\]/.test(part) || part.includes("\0"))) {
      return undefined;
    }
    return { repo: `${owner}/${repo}`, ref: namespace + ref, path: path.join("/") };
  } catch {
    return undefined;
  }
}

export function isGitHubImageLink(src: string): boolean {
  const url = parseHttpsUrl(src);
  return url?.origin === GITHUB_ORIGIN && !url.username && !url.password;
}

function parseHttpsUrl(src: string): URL | undefined {
  try {
    const url = new URL(src);
    return url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}
