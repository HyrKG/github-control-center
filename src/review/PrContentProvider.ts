import * as vscode from "vscode";
import { BoundedAsyncCache } from "../core/BoundedAsyncCache";
import { decodePrUriParts, encodePrUriParts, PR_URI_SCHEME, type IPrFileRef } from "./prUri";

// ponytail: memory ceiling — sha-pinned content is immutable so small files cache within the
// LRU byte budget; bodies above the per-entry cap stay uncached and re-fetch on each render
const MAX_CACHED_BODY_BYTES = 1_048_576;
const MAX_CONTENT_CACHE_BYTES = 32 * 1024 * 1024;

export function toPrUri(ref: IPrFileRef): vscode.Uri {
  const { path, query } = encodePrUriParts(ref);
  return vscode.Uri.from({ scheme: PR_URI_SCHEME, path, query });
}

export function fromPrUri(uri: vscode.Uri): IPrFileRef {
  return decodePrUriParts(uri.path, uri.query);
}

export class PrContentProvider implements vscode.TextDocumentContentProvider {
  private readonly cache: BoundedAsyncCache<string>;

  constructor(
    private readonly fetchContent: (ref: IPrFileRef) => Promise<string>,
    maxCacheBytes = MAX_CONTENT_CACHE_BYTES,
  ) {
    this.cache = new BoundedAsyncCache<string>({
      maxBytes: maxCacheBytes,
      maxEntryBytes: MAX_CACHED_BODY_BYTES,
      sizeOf: (content) => Buffer.byteLength(content, "utf8"),
    });
  }

  // fetch errors intentionally propagate: opening a diff is user-initiated,
  // so the editor surfaces the failure (unlike the silent poll loop)
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const ref = fromPrUri(uri);
    if (ref.isEmpty) {
      return "";
    }
    return this.cache.load(uri.toString(), () => this.fetchContent(ref));
  }
}
