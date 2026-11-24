import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function manifestKeys(value: unknown): string[] {
  if (typeof value === "string") {
    const match = /^%([^%]+)%$/.exec(value);
    return match ? [match[1]] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap(manifestKeys);
  }
  return value && typeof value === "object" ? Object.values(value).flatMap(manifestKeys) : [];
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return path.endsWith(".ts") && !path.endsWith(".spec.ts") ? [path] : [];
  });
}

function readMessage(node: ts.Expression | undefined): string {
  if (!node || !ts.isStringLiteralLike(node)) {
    throw new Error("Localization messages and comments must be string literals");
  }
  return node.text;
}

function messageKey(node: ts.Expression): [key: string, message: string] {
  if (ts.isObjectLiteralExpression(node)) {
    const message = node.properties.find((property) => property.name?.getText() === "message");
    const comment = node.properties.find((property) => property.name?.getText() === "comment");
    if (!message || !ts.isPropertyAssignment(message) || !comment || !ts.isPropertyAssignment(comment)) {
      throw new Error("Expected a localization message with a translator comment");
    }
    const text = readMessage(message.initializer);
    const notes = ts.isArrayLiteralExpression(comment.initializer)
      ? comment.initializer.elements.map(readMessage).join("")
      : readMessage(comment.initializer);
    return [`${text}/${notes}`, text];
  }
  const text = readMessage(node);
  return [text, text];
}

function runtimeMessages(path: string): Array<[key: string, message: string]> {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const entries: Array<[key: string, message: string]> = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && node.expression.getText() === "vscode.l10n.t") {
      entries.push(messageKey(node.arguments[0]));
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return entries;
}

function placeholders(message: string): string[] {
  return [...new Set(message.match(/\{\d+\}/g) ?? [])].sort();
}

describe("localization catalogs", () => {
  it("provides exactly the manifest keys in both languages", () => {
    const keys = [...new Set(manifestKeys(readJson("package.json")))].sort();
    expect(keys.length).toBeGreaterThan(0);
    for (const path of ["package.nls.json", "package.nls.zh-cn.json"]) {
      const catalog = readJson<Record<string, string>>(path);
      expect(Object.keys(catalog).sort()).toEqual(keys);
      expect(Object.values(catalog).every((message) => message.trim().length > 0)).toBe(true);
    }
  });

  it("covers every native runtime message with matching placeholders", () => {
    const entries = new Map(sourceFiles("src").flatMap(runtimeMessages));
    const catalog = readJson<Record<string, string>>("l10n/bundle.l10n.zh-cn.json");
    expect(entries.size).toBeGreaterThan(0);
    expect(Object.keys(catalog).sort()).toEqual([...entries.keys()].sort());
    for (const [key, message] of entries) {
      expect(catalog[key].trim(), key).not.toBe("");
      expect(placeholders(catalog[key]), key).toEqual(placeholders(message));
    }
  });
});
