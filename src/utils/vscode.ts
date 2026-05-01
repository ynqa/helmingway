import * as vscode from "vscode";
import { type ReleaseTreeNode, joinPreviewResourceManifests } from "../models";
import type { ReleaseExplorerProvider } from "../providers/release-explorer";

/**
 * Return the primary workspace folder used by Helmingway.
 */
export function getPrimaryWorkspaceFolder(
  options: { silently?: boolean } = {},
): vscode.WorkspaceFolder | undefined {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder && !options.silently) {
    vscode.window.showInformationMessage("Helmingway: Open a workspace folder first.");
    return undefined;
  }

  return workspaceFolder;
}

/**
 * Get display manifest YAML for a release and show VS Code messages for non-rendered states.
 */
export function getReleaseManifestContent(
  releaseExplorerProvider: ReleaseExplorerProvider,
  node: ReleaseTreeNode,
): string | undefined {
  const manifestView = releaseExplorerProvider.getReleaseManifestView(node);

  if (manifestView.status === "idle") {
    vscode.window.showInformationMessage(
      `Helmingway: ${node.chartName}/${node.releaseName} is not rendered yet. Run Sync Helm Template Cache first.`,
    );
    return undefined;
  }

  if (manifestView.status === "rendering") {
    vscode.window.showInformationMessage(
      `Helmingway: ${node.chartName}/${node.releaseName} is still rendering.`,
    );
    return undefined;
  }

  if (manifestView.status === "failed") {
    vscode.window.showErrorMessage(
      `Helmingway: Failed to render ${node.chartName}/${node.releaseName}: ${manifestView.errorMessage ?? "unknown error"}`,
    );
    return undefined;
  }

  return joinPreviewResourceManifests(
    manifestView.resources.map((resourceNode) => resourceNode.resource),
  );
}
