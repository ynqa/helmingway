import * as vscode from "vscode";

type PreviewDocumentProvider = {
  setContent(uri: vscode.Uri, content: string): void;
};

type ShowPreviewDocumentOptions = {
  previewDocumentProvider: PreviewDocumentProvider;
  content: string;
  path: string;
};

export async function showPreviewDocument({
  previewDocumentProvider,
  content,
  path,
}: ShowPreviewDocumentOptions): Promise<void> {
  const uri = vscode.Uri.from({
    scheme: "helmingway-preview",
    path,
  });

  previewDocumentProvider.setContent(uri, content);

  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.languages.setTextDocumentLanguage(document, "yaml");
  await vscode.window.showTextDocument(document, {
    preview: false,
    viewColumn: vscode.window.activeTextEditor?.viewColumn,
  });
}
