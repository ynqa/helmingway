/* eslint-disable sort-imports */
import type { ChartConfig } from "./config";
import type { PreviewResource } from "./preview-resource";
import { formatChartSource } from "./chart-source";

export type ChartTreeNode = {
  type: "chart";
  chartName: string;
  chartPath: string;
};

export type AliasTreeNode = {
  type: "alias";
  chartName: string;
  aliasName: string;
};

export type ResourceTreeNode = {
  type: "resource";
  chartName: string;
  aliasName: string;
  resource: PreviewResource;
};

export type HelmingwayTreeNode = ChartTreeNode | AliasTreeNode | ResourceTreeNode;

export function isAliasNode(node: HelmingwayTreeNode): node is AliasTreeNode {
  return node.type === "alias";
}

/**
 * Convert chart config into a tree node for the sidebar.
 */
export function toChartTreeNode(chart: ChartConfig): ChartTreeNode {
  return {
    type: "chart",
    chartName: chart.name,
    chartPath: formatChartSource(chart.source),
  };
}

/**
 * Convert chart config aliases into tree nodes for the sidebar.
 */
export function toAliasTreeNodes(chart: ChartConfig): AliasTreeNode[] {
  return (chart.aliases ?? []).map((alias) => ({
    type: "alias",
    chartName: chart.name,
    aliasName: alias.name,
  }));
}
