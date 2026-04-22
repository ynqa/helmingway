import * as vscode from "vscode";

/**
 * Return the primary workspace folder used by Helmingway.
 */
export function getPrimaryWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showInformationMessage("Helmingway: Open a workspace folder first.");
    return undefined;
  }

  return workspaceFolder;
}
