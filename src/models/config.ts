import type { HelmChartSource } from "./chart-source";

export type HelmingwayConfig = {
  helm?: {
    charts?: ChartConfig[];
  };
};

export type RawHelmingwayConfig = Omit<HelmingwayConfig, "helm"> & {
  helm?: {
    charts?: RawChartConfig[];
  };
};

export type ChartConfig = {
  name: string;
  source: HelmChartSource;
  releaseName?: string;
  namespace?: string;
  aliases?: AliasConfig[];
};

export type RawChartConfig = Omit<ChartConfig, "source"> & {
  source: string;
};

export type AliasConfig = {
  name: string;
  valueFiles?: string[];
  values?: Record<string, unknown>;
};

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
