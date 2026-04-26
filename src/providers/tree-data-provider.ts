/* eslint-disable sort-imports */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { parse } from "yaml";
import { getPrimaryWorkspaceFolder } from "../vscode-workspace";
import {
  type HelmingwayConfig,
  type HelmingwayTreeNode,
  parsePreviewResources,
  parseChartSource,
  type RawHelmingwayConfig,
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
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<HelmingwayTreeNode | undefined>();
  private readonly selectedResourceKeysByRelease = new Map<string, Set<string>>();
  private currentConfig: HelmingwayConfig = {};

  constructor(private readonly renderStore: HelmService) {}

  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  updateResourceCheckboxes(event: vscode.TreeCheckboxChangeEvent<HelmingwayTreeNode>): void {
    for (const [node, state] of event.items) {
      if (node.type !== "resource") {
        continue;
      }

      const releaseKey = toReleaseSelectionKey(node);
      const selectedKeys = this.selectedResourceKeysByRelease.get(releaseKey) ?? new Set<string>();
      if (state === vscode.TreeItemCheckboxState.Checked) {
        selectedKeys.add(node.resource.resourceId);
      } else {
        selectedKeys.delete(node.resource.resourceId);
      }

      if (selectedKeys.size === 0) {
        this.selectedResourceKeysByRelease.delete(releaseKey);
      } else {
        this.selectedResourceKeysByRelease.set(releaseKey, selectedKeys);
      }
    }

    this.refresh();
  }

  getSelectedResources(node: ReleaseTreeNode): ResourceTreeNode[] {
    const selectedKeys = this.selectedResourceKeysByRelease.get(toReleaseSelectionKey(node));
    if (!selectedKeys || selectedKeys.size === 0) {
      return [];
    }

    return this.getResourceChildren(node).filter((resourceNode) => selectedKeys.has(resourceNode.resource.resourceId));
  }

  async refreshConfig(): Promise<HelmingwayConfig> {
    this.currentConfig = await readHelmingwayConfig();
    return this.currentConfig;
  }

  getTreeItem(element: HelmingwayTreeNode): vscode.TreeItem {
    if (element.type === "chart") {
      const item = new vscode.TreeItem(element.chartName, vscode.TreeItemCollapsibleState.Collapsed);
      item.description = element.chartPath;
      item.iconPath = new vscode.ThemeIcon("package");
      return item;
    } else if (element.type === "release") {
      const resources = this.getResourceChildren(element);
      const collapsibleState =
        resources.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
      const item = new vscode.TreeItem(element.releaseName, collapsibleState);
      const entry = this.renderStore.getHelmTemplateCacheEntry(element.chartName, element.releaseName);
      const status = entry?.status ?? "idle";
      const selectedCount = this.getSelectedResources(element).length;
      item.contextValue = "release";
      item.iconPath = helmTemplateStatusIcon[status];
      item.description = selectedCount > 0 ? `${selectedCount} selected` : status;
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
      const item = new vscode.TreeItem(element.resource.resourceLabel, vscode.TreeItemCollapsibleState.None);
      item.id = `${element.chartName}/${element.releaseName}/${element.resource.resourceId}`;
      item.contextValue = "resource";
      item.iconPath = new vscode.ThemeIcon("symbol-object");
      item.checkboxState = this.isResourceSelected(element)
        ? vscode.TreeItemCheckboxState.Checked
        : vscode.TreeItemCheckboxState.Unchecked;
      return item;
    }

    throw new Error(`Unhandled tree node type: ${JSON.stringify(element)}`);
  }

  async getChildren(element?: HelmingwayTreeNode): Promise<HelmingwayTreeNode[]> {
    if (!element) {
      const currentConfig = await this.refreshConfig();
      return (currentConfig.helm?.charts ?? []).map(toChartTreeNode);
    }

    if (element.type === "chart") {
      const chart = (this.currentConfig.helm?.charts ?? []).find((chart) => chart.name === element.chartName);
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

  private isResourceSelected(node: ResourceTreeNode): boolean {
    return this.selectedResourceKeysByRelease.get(toReleaseSelectionKey(node))?.has(node.resource.resourceId) ?? false;
  }
}

function toReleaseSelectionKey(node: Pick<ReleaseTreeNode, "chartName" | "releaseName">): string {
  return `${node.chartName}/${node.releaseName}`;
}

/**
 * Read and parse helmingway.yaml from workspace folder.
 * If the file is missing or invalid, show an error message and return an empty config.
 */
async function readHelmingwayConfig(): Promise<HelmingwayConfig> {
  const workspaceFolder = getPrimaryWorkspaceFolder();
  if (!workspaceFolder) {
    return {};
  }

  const configPath = path.join(workspaceFolder.uri.fsPath, "helmingway.yaml");

  try {
    const content = await fs.readFile(configPath, "utf8");
    const raw = parse(content) as RawHelmingwayConfig;

    return {
      helm: {
        charts: (raw.helm?.charts ?? []).map((chart) => ({
          name: chart.name,
          source: parseChartSource(chart.source),
          namespace: chart.namespace,
          releases: chart.releases,
        })),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Helmingway: Failed to read config file: ${message}`);
    return {};
  }
}
