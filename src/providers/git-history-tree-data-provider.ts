import * as vscode from "vscode";
import {
  type GitCommitTreeNode,
  getWorkspaceRepository,
  listRecentCommits,
} from "../git/service";
import { getPrimaryWorkspaceFolder } from "../vscode-helpers";

/**
 * Provide the Git commit history tree used for release comparison.
 */
export class HelmingwayGitHistoryTreeDataProvider
  implements vscode.TreeDataProvider<GitCommitTreeNode>
{
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<
    GitCommitTreeNode | undefined
  >();

  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  async getChildren(element?: GitCommitTreeNode): Promise<GitCommitTreeNode[]> {
    if (element) {
      return [];
    }

    const workspaceFolder = getPrimaryWorkspaceFolder();
    if (!workspaceFolder) {
      return [];
    }

    const repository = getWorkspaceRepository(workspaceFolder);
    if (!repository) {
      return [];
    }

    return listRecentCommits(repository);
  }

  getTreeItem(element: GitCommitTreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.commit.hash.slice(0, 7),
      vscode.TreeItemCollapsibleState.None,
    );
    item.contextValue = "gitCommit";
    item.description = formatCommitDescription(element);
    item.tooltip = `${element.commit.hash}\n${element.commit.message}`;
    item.iconPath = new vscode.ThemeIcon("git-commit");
    return item;
  }
}

function formatCommitDescription(node: GitCommitTreeNode): string {
  const date = node.commit.authorDate?.toISOString().slice(0, 10) ?? "unknown date";
  const author = node.commit.authorName ?? "unknown author";
  const subject = node.commit.message.split("\n")[0] ?? "";
  return `${date} ${author} ${subject}`;
}
