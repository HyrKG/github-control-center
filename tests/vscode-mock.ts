interface IListener<TEvent> {
  (event: TEvent): void;
}

export class EventEmitter<TEvent> {
  private readonly listeners: Array<IListener<TEvent>> = [];

  event = (listener: IListener<TEvent>) => {
    this.listeners.push(listener);
    return { dispose: (): void => undefined };
  };

  fire(event: TEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

interface IUriParts {
  scheme: string;
  path: string;
  query?: string;
}

export class Uri {
  private constructor(
    public readonly scheme: string,
    public readonly path: string,
    public readonly query: string,
  ) {}

  static parse(value: string): Uri {
    const url = new URL(value);
    return Uri.from({ scheme: url.protocol.slice(0, -1), path: url.pathname, query: url.search.slice(1) });
  }

  static from(parts: IUriParts): Uri {
    return new Uri(parts.scheme, parts.path, parts.query ?? "");
  }

  toString(): string {
    return `${this.scheme}:${this.path}${this.query ? `?${this.query}` : ""}`;
  }
}

export const authentication = {
  getSession: async (): Promise<undefined> => undefined,
  onDidChangeSessions: (): { dispose(): void } => ({ dispose: (): void => undefined }),
};
export const env = { language: "en" };

let messages: Readonly<Record<string, string>> | undefined;

function setTestLocale(language = "en", bundle: Readonly<Record<string, string>> = {}): void {
  env.language = language;
  messages = Object.keys(bundle).length > 0 ? bundle : undefined;
}

export const l10n = {
  setTestLocale,
  get bundle() { return messages; },
  t(message: string | { message: string; comment: string[] }, ...args: Array<string | number | boolean>): string {
    const fallback = typeof message === "string" ? message : message.message;
    const key = typeof message === "string" ? message : `${message.message}/${message.comment.join("")}`;
    return (messages?.[key] ?? fallback).replace(/\{(\d+)\}/g, (match, index: string) => {
      const value = args[Number(index)];
      return value === undefined ? match : String(value);
    });
  },
};


export enum CommentMode {
  Preview,
}

export enum CommentThreadState {
  Unresolved,
  Resolved,
}

export enum CommentThreadCollapsibleState {
  Collapsed,
  Expanded,
}

export class MarkdownString {
  constructor(public readonly value: string) {}
}
