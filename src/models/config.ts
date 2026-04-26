import * as fs from "node:fs/promises";
import { type HelmChartSource, parseChartSource } from "./chart-source";
import { parse } from "yaml";

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
 * Load and normalize a Helmingway config file from disk.
 */
export async function loadHelmingwayConfig(configPath: string): Promise<HelmingwayConfig> {
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
}

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
