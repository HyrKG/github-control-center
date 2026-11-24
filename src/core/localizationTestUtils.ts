import { readFileSync } from "node:fs";
import * as vscode from "vscode";

interface ITestLocalization {
  setTestLocale(language: string, bundle: Readonly<Record<string, string>>): void;
}

export function setTestLocale(language = "en", bundle: Readonly<Record<string, string>> = {}): void {
  const localization = vscode.l10n as typeof vscode.l10n & ITestLocalization;
  localization.setTestLocale(language, bundle);
}

export function chineseBundle(): Record<string, string> {
  return JSON.parse(readFileSync("l10n/bundle.l10n.zh-cn.json", "utf8")) as Record<string, string>;
}
