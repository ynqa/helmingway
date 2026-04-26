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
  namespace?: string;
  releases?: ReleaseConfig[];
};

export type RawChartConfig = Omit<ChartConfig, "source"> & {
  source: string;
};

export type ReleaseConfig = {
  name: string;
  namespace?: string;
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
 * Find a release config by chart name and release name.
 */
export function findReleaseConfig(
  config: HelmingwayConfig,
  chartName: string,
  releaseName: string,
): ReleaseConfig | undefined {
  const chart = findChartConfig(config, chartName);
  return chart?.releases?.find((release) => release.name === releaseName);
}
