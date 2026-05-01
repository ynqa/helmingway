import * as vscode from "vscode";
import type { ReleaseTreeNode } from "../models";

type ReleaseManifestContentProvider = (node: ReleaseTreeNode) => string | undefined;

/**
 * Provide rendered release manifests through `helmingway-preview` virtual document scheme.
 */
export class ManifestDocumentProvider implements vscode.TextDocumentContentProvider {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  private readonly releaseNodesByUri = new Map<string, ReleaseTreeNode>();

  constructor(private readonly getManifestContent: ReleaseManifestContentProvider) {}

  readonly onDidChange = this.onDidChangeEmitter.event;

  provideTextDocumentContent(uri: vscode.Uri): string {
    const node = this.releaseNodesByUri.get(uri.toString());
    return node ? (this.getManifestContent(node) ?? "") : "";
  }

  refreshOpenReleaseDocuments(): void {
    // NOTE: A VS Code diff editor opened by showReleaseComparison still has two
    // underlying TextDocuments, one for each side, so it is refreshed one URI at a time.
    for (const document of vscode.workspace.textDocuments) {
      if (document.uri.scheme !== "helmingway-preview") {
        continue;
      }

      if (!this.releaseNodesByUri.has(document.uri.toString())) {
        continue;
      }

      this.onDidChangeEmitter.fire(document.uri);
    }
  }

  /**
   * Open a manifest document for the given release and show it in the editor.
   */
  async showReleaseManifest(node: ReleaseTreeNode): Promise<void> {
    const uri = vscode.Uri.from({
      scheme: "helmingway-preview",
      path: `/${node.releaseName}.yaml`,
    });

    this.releaseNodesByUri.set(uri.toString(), node);
    this.onDidChangeEmitter.fire(uri);

    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.languages.setTextDocumentLanguage(document, "yaml");
    await vscode.window.showTextDocument(document, {
      preview: false,
      viewColumn: vscode.window.activeTextEditor?.viewColumn,
    });
  }

  /**
   * Open a side-by-side diff view comparing the manifests for two releases.
   */
  async showReleaseComparison(
    leftNode: ReleaseTreeNode,
    rightNode: ReleaseTreeNode,
  ): Promise<void> {
    const leftUri = vscode.Uri.from({
      scheme: "helmingway-preview",
      path: `/compare/${leftNode.chartName}-${leftNode.releaseName}.yaml`,
    });
    const rightUri = vscode.Uri.from({
      scheme: "helmingway-preview",
      path: `/compare/${rightNode.chartName}-${rightNode.releaseName}.yaml`,
    });

    this.releaseNodesByUri.set(leftUri.toString(), leftNode);
    this.releaseNodesByUri.set(rightUri.toString(), rightNode);
    this.onDidChangeEmitter.fire(leftUri);
    this.onDidChangeEmitter.fire(rightUri);

    await vscode.commands.executeCommand(
      "vscode.diff",
      leftUri,
      rightUri,
      `${leftNode.releaseName} ↔ ${rightNode.releaseName}`,
    );
  }
}
