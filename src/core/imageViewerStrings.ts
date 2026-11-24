import * as vscode from "vscode";
import type { IImageViewerStrings } from "./imageViewer";

export function viewerLanguage(): string {
  return vscode.l10n.bundle ? vscode.env.language : "en";
}

export function createImageViewerStrings(): IImageViewerStrings {
  return {
    statusAdded: vscode.l10n.t("Added"),
    statusModified: vscode.l10n.t("Modified"),
    statusDeleted: vscode.l10n.t("Deleted"),
    statusRenamed: vscode.l10n.t("Renamed"),
    statusCopied: vscode.l10n.t("Copied"),
    statusChanged: vscode.l10n.t("Changed"),
    modeSplit: vscode.l10n.t("Side by Side"),
    modeSwipe: vscode.l10n.t("Swipe"),
    modeToggle: vscode.l10n.t("Toggle"),
    base: vscode.l10n.t("Base"),
    head: vscode.l10n.t("Head"),
    bgChecker: vscode.l10n.t("Checkerboard"),
    bgLight: vscode.l10n.t("Light background"),
    bgDark: vscode.l10n.t("Dark background"),
    zoomOut: vscode.l10n.t("Zoom out (-)"),
    zoomIn: vscode.l10n.t("Zoom in (+)"),
    zoomToggle: vscode.l10n.t("Toggle Fit / 1:1 (0 / 1)"),
    zoomFit: vscode.l10n.t("Fit to view (0)"),
    pixelCrisp: vscode.l10n.t("Nearest-neighbor (P)"),
    openGitHub: vscode.l10n.t("Open on GitHub"),
    close: vscode.l10n.t("Close (Esc)"),
    previous: vscode.l10n.t("Previous"),
    next: vscode.l10n.t("Next"),
    swipeLabel: vscode.l10n.t("Swipe comparison"),
    diffViewMode: vscode.l10n.t("Diff view mode"),
    imageLightbox: vscode.l10n.t("Image preview"),
    loading: vscode.l10n.t("Loading image…"),
    tooLarge: vscode.l10n.t("The image exceeds the 10 MB preview limit."),
    unsupported: vscode.l10n.t("This file has no supported image preview."),
    loadFailed: vscode.l10n.t("Could not load this image."),
  };
}
