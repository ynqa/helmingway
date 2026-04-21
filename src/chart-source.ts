import * as path from "node:path";
import type { ChartConfig, HelmChartSource } from "./types";

/**
 * Parse raw config value into a normalized helm chart source.
 */
export function parseChartSource(source: string): HelmChartSource {
  if (source.startsWith("oci://")) {
    return {
      kind: "oci",
      ref: source,
    };
  }

  if (source.startsWith("http://") || source.startsWith("https://")) {
    return {
      kind: "url",
      url: source,
    };
  }

  if (source.endsWith(".tgz")) {
    return {
      kind: "packaged",
      filePath: source,
    };
  }

  if (source.includes("/") || source.startsWith(".")) {
    return {
      kind: "directory",
      directoryPath: source,
    };
  }

  return {
    kind: "reference",
    ref: source,
  };
}

/**
 * Format helm chart source for display in the sidebar.
 */
export function formatChartSource(chartSource: ChartConfig["source"]): string {
  switch (chartSource.kind) {
    case "reference":
      return chartSource.ref;
    case "packaged":
      return chartSource.filePath;
    case "directory":
      return chartSource.directoryPath;
    case "url":
      return chartSource.url;
    case "oci":
      return chartSource.ref;
  }
}

/**
 * Resolve helm chart source into the chart argument passed to `helm template`.
 */
export function resolveChartTemplateArg(workspacePath: string, chart: ChartConfig): string {
  switch (chart.source.kind) {
    case "reference":
      return chart.source.ref;
    case "packaged":
      return path.resolve(workspacePath, chart.source.filePath);
    case "directory":
      return path.resolve(workspacePath, chart.source.directoryPath);
    case "url":
      return chart.source.url;
    case "oci":
      return chart.source.ref;
  }
}
