import * as vscode from "vscode";

/**
 * Provide read-only preview content through `helmingway-preview` virtual document scheme.
 */
export class HelmingwayPreviewDocumentProvider implements vscode.TextDocumentContentProvider {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  private readonly documents = new Map<string, string>();

  readonly onDidChange = this.onDidChangeEmitter.event;

  setContent(uri: vscode.Uri, content: string): void {
    this.documents.set(uri.toString(), content);
    this.onDidChangeEmitter.fire(uri);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.documents.get(uri.toString()) ?? "";
  }
}
