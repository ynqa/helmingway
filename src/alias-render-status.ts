import * as vscode from "vscode";

export type AliasRenderStatus = "idle" | "rendering" | "rendered" | "failed";

/**
 * Presentation details for each render status, used in the tree view.
 * 
 * ThemeIcon reference:
 * - https://code.visualstudio.com/api/references/icons-in-labels
 */
export const aliasRenderStatusPresentation = {
  idle: {
    icon: new vscode.ThemeIcon("circle-outline"),
    description: "idle",
  },
  rendering: {
    icon: new vscode.ThemeIcon("sync"),
    description: "rendering",
  },
  rendered: {
    icon: new vscode.ThemeIcon("check"),
    description: "rendered",
  },
  failed: {
    icon: new vscode.ThemeIcon("error"),
    description: "failed",
  },
} satisfies Record<
  AliasRenderStatus,
  {
    icon: vscode.ThemeIcon;
    description: string;
  }
>;
