/* eslint-disable sort-imports */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { parse } from "yaml";
import { getPrimaryWorkspaceFolder } from "../vscode-workspace";
import {
  type AliasTreeNode,
  type HelmingwayConfig,
  type HelmingwayTreeNode,
  parsePreviewResources,
  parseChartSource,
  type RawHelmingwayConfig,
  type ResourceTreeNode,
  toAliasTreeNodes,
  toChartTreeNode,
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
  private readonly selectedResourceKeysByAlias = new Map<string, Set<string>>();
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

      const aliasKey = toAliasSelectionKey(node);
      const selectedKeys = this.selectedResourceKeysByAlias.get(aliasKey) ?? new Set<string>();
      if (state === vscode.TreeItemCheckboxState.Checked) {
        selectedKeys.add(node.resource.resourceId);
      } else {
        selectedKeys.delete(node.resource.resourceId);
      }

      if (selectedKeys.size === 0) {
        this.selectedResourceKeysByAlias.delete(aliasKey);
      } else {
        this.selectedResourceKeysByAlias.set(aliasKey, selectedKeys);
      }
    }

    this.refresh();
  }

  getSelectedResources(node: AliasTreeNode): ResourceTreeNode[] {
    const selectedKeys = this.selectedResourceKeysByAlias.get(toAliasSelectionKey(node));
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
    } else if (element.type === "alias") {
      const resources = this.getResourceChildren(element);
      const collapsibleState =
        resources.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
      const item = new vscode.TreeItem(element.aliasName, collapsibleState);
      const entry = this.renderStore.getHelmTemplateCacheEntry(element.chartName, element.aliasName);
      const status = entry?.status ?? "idle";
      const selectedCount = this.getSelectedResources(element).length;
      item.contextValue = "alias";
      item.iconPath = helmTemplateStatusIcon[status];
      item.description = selectedCount > 0 ? `${selectedCount} selected` : status;
      if (entry?.helmTemplateErrorMessage) {
        item.tooltip = entry.helmTemplateErrorMessage;
      }
      item.command = {
        command: "helmingway.openAliasPreview",
        title: "Open Preview",
        arguments: [element],
      };
      return item;
    } else if (element.type === "resource") {
      const item = new vscode.TreeItem(element.resource.resourceLabel, vscode.TreeItemCollapsibleState.None);
      item.id = `${element.chartName}/${element.aliasName}/${element.resource.resourceId}`;
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
      return chart ? toAliasTreeNodes(chart) : [];
    }

    if (element.type === "alias") {
      return this.getResourceChildren(element);
    }

    return [];
  }

  private getResourceChildren(node: AliasTreeNode): ResourceTreeNode[] {
    const entry = this.renderStore.getHelmTemplateCacheEntry(node.chartName, node.aliasName);
    if (entry?.status !== "rendered" || entry.content === undefined) {
      return [];
    }

    return parsePreviewResources(entry.content).map((resource) => ({
      type: "resource",
      chartName: node.chartName,
      aliasName: node.aliasName,
      resource,
    }));
  }

  private isResourceSelected(node: ResourceTreeNode): boolean {
    return this.selectedResourceKeysByAlias.get(toAliasSelectionKey(node))?.has(node.resource.resourceId) ?? false;
  }
}

function toAliasSelectionKey(node: Pick<AliasTreeNode, "chartName" | "aliasName">): string {
  return `${node.chartName}/${node.aliasName}`;
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
          releaseName: chart.releaseName,
          namespace: chart.namespace,
          aliases: chart.aliases,
        })),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Helmingway: Failed to read config file: ${message}`);
    return {};
  }
}
