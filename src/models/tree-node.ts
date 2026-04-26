/* eslint-disable sort-imports */
import type { ChartConfig } from "./config";
import type { PreviewResource } from "./preview-resource";
import { formatChartSource } from "./chart-source";

export type ChartTreeNode = {
  type: "chart";
  chartName: string;
  chartPath: string;
};

export type ReleaseTreeNode = {
  type: "release";
  chartName: string;
  releaseName: string;
};

export type ResourceTreeNode = {
  type: "resource";
  chartName: string;
  releaseName: string;
  resource: PreviewResource;
};

export type HelmingwayTreeNode = ChartTreeNode | ReleaseTreeNode | ResourceTreeNode;

export function isReleaseNode(node: HelmingwayTreeNode): node is ReleaseTreeNode {
  return node.type === "release";
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
 * Convert chart config releases into tree nodes for the sidebar.
 */
export function toReleaseTreeNodes(chart: ChartConfig): ReleaseTreeNode[] {
  return (chart.releases ?? []).map((release) => ({
    type: "release",
    chartName: chart.name,
    releaseName: release.name,
  }));
}
