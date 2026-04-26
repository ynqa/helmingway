/* eslint-disable sort-imports */
import * as path from "node:path";
import * as vscode from "vscode";
import { getPrimaryWorkspaceFolder } from "../vscode-workspace";
import {
  type HelmingwayConfig,
  type HelmingwayTreeNode,
  loadHelmingwayConfig,
  parsePreviewResources,
  type ReleaseTreeNode,
  type ResourceTreeNode,
  toChartTreeNode,
  toReleaseTreeNodes,
} from "../models";
import { HelmService, type HelmTemplateStatus } from "../helm/service";

/**
 * Theme icon for each render status, used in the tree view.
 *
 * ThemeIcon reference:
 * - https://code.visualstudio.com/api/references/icons-in-labels
 */
const helmTemplateStatusIcon = {
  idle: new vscode.ThemeIcon("circle-outline"),
  rendering: new vscode.ThemeIcon("sync"),
  rendered: new vscode.ThemeIcon("check"),
  failed: new vscode.ThemeIcon("error"),
} satisfies Record<HelmTemplateStatus, vscode.ThemeIcon>;

/**
 * Provide Helmingway sidebar tree shown in VS Code Side View.
 */
export class HelmingwayTreeDataProvider implements vscode.TreeDataProvider<HelmingwayTreeNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<
    HelmingwayTreeNode | undefined
  >();
  private readonly resourceExclusions = new ResourceExclusionStore();
  private currentConfig: HelmingwayConfig = {};

  constructor(private readonly renderStore: HelmService) {}

  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  /**
   * Load helmingway.yaml from the current workspace and update the cached config.
   */
  async loadConfig(): Promise<HelmingwayConfig> {
    const workspaceFolder = getPrimaryWorkspaceFolder();
    if (!workspaceFolder) {
      this.currentConfig = {};
      return this.currentConfig;
    }

    const configPath = path.join(workspaceFolder.uri.fsPath, "helmingway.yaml");

    try {
      this.currentConfig = await loadHelmingwayConfig(configPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Helmingway: Failed to read config file: ${message}`);
      this.currentConfig = {};
    }

    return this.currentConfig;
  }

  /**
   * Apply VS Code checkbox changes to the resource filter state.
   */
  updateResourceCheckboxes(event: vscode.TreeCheckboxChangeEvent<HelmingwayTreeNode>): void {
    for (const [node, state] of event.items) {
      if (node.type !== "resource") {
        continue;
      }

      this.resourceExclusions.updateResourceCheckbox(node, state);
    }

    this.refresh();
  }

  /**
   * Get resources whose tree checkboxes are currently checked for a release.
   */
  getCheckedResources(node: ReleaseTreeNode): ResourceTreeNode[] {
    return this.getResourceChildren(node).filter((resourceNode) =>
      this.resourceExclusions.isChecked(resourceNode),
    );
  }

  getTreeItem(element: HelmingwayTreeNode): vscode.TreeItem {
    if (element.type === "chart") {
      const item = new vscode.TreeItem(
        element.chartName,
        vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.description = element.chartPath;
      item.iconPath = new vscode.ThemeIcon("package");
      return item;
    } else if (element.type === "release") {
      const resources = this.getResourceChildren(element);
      const collapsibleState =
        resources.length > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None;
      const item = new vscode.TreeItem(element.releaseName, collapsibleState);
      const entry = this.renderStore.getHelmTemplateCacheEntry(
        element.chartName,
        element.releaseName,
      );
      const status = entry?.status ?? "idle";
      const checkedCount = this.getCheckedResources(element).length;
      item.contextValue = "release";
      item.iconPath = helmTemplateStatusIcon[status];
      item.description = checkedCount > 0 ? `${checkedCount} checked` : status;
      if (entry?.helmTemplateErrorMessage) {
        item.tooltip = entry.helmTemplateErrorMessage;
      }
      item.command = {
        command: "helmingway.openReleasePreview",
        title: "Open Preview",
        arguments: [element],
      };
      return item;
    } else if (element.type === "resource") {
      const item = new vscode.TreeItem(
        element.resource.resourceLabel,
        vscode.TreeItemCollapsibleState.None,
      );
      item.id = `${element.chartName}/${element.releaseName}/${element.resource.resourceId}`;
      item.contextValue = "resource";
      item.iconPath = new vscode.ThemeIcon("symbol-object");
      item.checkboxState = this.resourceExclusions.isChecked(element)
        ? vscode.TreeItemCheckboxState.Checked
        : vscode.TreeItemCheckboxState.Unchecked;
      return item;
    }

    throw new Error(`Unhandled tree node type: ${JSON.stringify(element)}`);
  }

  async getChildren(element?: HelmingwayTreeNode): Promise<HelmingwayTreeNode[]> {
    if (!element) {
      const currentConfig = await this.loadConfig();
      return (currentConfig.helm?.charts ?? []).map(toChartTreeNode);
    }

    if (element.type === "chart") {
      const chart = (this.currentConfig.helm?.charts ?? []).find(
        (chart) => chart.name === element.chartName,
      );
      return chart ? toReleaseTreeNodes(chart) : [];
    }

    if (element.type === "release") {
      return this.getResourceChildren(element);
    }

    return [];
  }

  private getResourceChildren(node: ReleaseTreeNode): ResourceTreeNode[] {
    const entry = this.renderStore.getHelmTemplateCacheEntry(node.chartName, node.releaseName);
    if (entry?.status !== "rendered" || entry.content === undefined) {
      return [];
    }

    return parsePreviewResources(entry.content).map((resource) => ({
      type: "resource",
      chartName: node.chartName,
      releaseName: node.releaseName,
      resource,
    }));
  }
}

class ResourceExclusionStore {
  private readonly excludedResourceKeysByRelease = new Map<string, Set<string>>();

  updateResourceCheckbox(node: ResourceTreeNode, state: vscode.TreeItemCheckboxState): void {
    const releaseKey = this.getReleaseKey(node);
    const excludedKeys = this.excludedResourceKeysByRelease.get(releaseKey) ?? new Set<string>();

    if (state === vscode.TreeItemCheckboxState.Checked) {
      excludedKeys.delete(node.resource.resourceId);
    } else {
      excludedKeys.add(node.resource.resourceId);
    }

    if (excludedKeys.size === 0) {
      this.excludedResourceKeysByRelease.delete(releaseKey);
    } else {
      this.excludedResourceKeysByRelease.set(releaseKey, excludedKeys);
    }
  }

  isChecked(node: ResourceTreeNode): boolean {
    return !this.excludedResourceKeysByRelease
      .get(this.getReleaseKey(node))
      ?.has(node.resource.resourceId);
  }

  private getReleaseKey(node: Pick<ReleaseTreeNode, "chartName" | "releaseName">): string {
    return `${node.chartName}/${node.releaseName}`;
  }
}
