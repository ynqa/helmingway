import type { ChartConfig, ChartTreeNode, AliasTreeNode } from "./types";

/**
 * Convert chart config into a tree node for the sidebar.
 */
export function toChartTreeNode(chart: ChartConfig): ChartTreeNode {
  return {
    type: "chart",
    chartName: chart.name,
    chartPath: chart.path,
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
