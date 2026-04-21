import type { ChartConfig, ChartTreeNode, AliasTreeNode } from "./types";

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

function formatChartSource(chartSource: ChartConfig["source"]): string {
  switch (chartSource.kind) {
    case "reference":
      return chartSource.ref;
    case "packaged":
      return chartSource.filePath;
    case "directory":
      return chartSource.directoryPath;
    case "url":
      return chartSource.url;
    case "repo":
      return `${chartSource.repoUrl} (${chartSource.chart})`;
    case "oci":
      return chartSource.ref;
  }
}
