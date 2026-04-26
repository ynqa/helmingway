import * as vscode from "vscode";
import type { ReleaseTreeNode } from "../models";

/**
 * Provide read-only preview content through `helmingway-preview` virtual document scheme.
 */
export class HelmingwayPreviewDocumentProvider implements vscode.TextDocumentContentProvider {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  private readonly documents = new Map<string, string>();

  readonly onDidChange = this.onDidChangeEmitter.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.documents.get(uri.toString()) ?? "";
  }

  private setContent(uri: vscode.Uri, content: string): void {
    this.documents.set(uri.toString(), content);
    this.onDidChangeEmitter.fire(uri);
  }

  /**
   * Open a new preview document for the given release node and content, and show it in the editor.
   */
  async showReleasePreview(node: ReleaseTreeNode, content: string): Promise<void> {
    const uri = vscode.Uri.from({
      scheme: "helmingway-preview",
      path: `/${node.releaseName}.yaml`,
    });

    this.setContent(uri, content);

    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.languages.setTextDocumentLanguage(document, "yaml");
    await vscode.window.showTextDocument(document, {
      preview: false,
      viewColumn: vscode.window.activeTextEditor?.viewColumn,
    });
  }

  /**
   * Open a side-by-side diff view comparing the two given release nodes and their contents.
   */
  async showReleaseComparison(
    leftNode: ReleaseTreeNode,
    leftContent: string,
    rightNode: ReleaseTreeNode,
    rightContent: string,
  ): Promise<void> {
    const leftUri = vscode.Uri.from({
      scheme: "helmingway-preview",
      path: `/compare/${leftNode.chartName}-${leftNode.releaseName}.yaml`,
    });
    const rightUri = vscode.Uri.from({
      scheme: "helmingway-preview",
      path: `/compare/${rightNode.chartName}-${rightNode.releaseName}.yaml`,
    });

    this.setContent(leftUri, leftContent);
    this.setContent(rightUri, rightContent);

    await vscode.commands.executeCommand(
      "vscode.diff",
      leftUri,
      rightUri,
      `${leftNode.releaseName} ↔ ${rightNode.releaseName}`,
    );
  }
}
