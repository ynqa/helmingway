import type { AliasConfig, ChartConfig, HelmingwayConfig } from "./types";

/**
 * Find a chart config by chart name.
 */
export function findChartConfig(
  config: HelmingwayConfig,
  chartName: string,
): ChartConfig | undefined {
  return (config.helm?.charts ?? []).find((chart) => chart.name === chartName);
}

/**
 * Find an alias config by chart name and alias name.
 */
export function findAliasConfig(
  config: HelmingwayConfig,
  chartName: string,
  aliasName: string,
): AliasConfig | undefined {
  const chart = findChartConfig(config, chartName);
  return chart?.aliases?.find((alias) => alias.name === aliasName);
}
