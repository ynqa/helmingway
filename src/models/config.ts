import * as fs from "node:fs/promises";
import * as z from "@zod/mini";
import { parse } from "yaml";
import { parseChartSource } from "./chart-source";

const releaseConfigSchema = z.object({
  name: z.string(),
  namespace: z.optional(z.string()),
  valueFiles: z.optional(z.array(z.string())),
  values: z.optional(z.record(z.string(), z.unknown())),
});

export type ReleaseConfig = z.infer<typeof releaseConfigSchema>;

export const chartConfigSchema = z.object({
  name: z.string(),
  source: z.pipe(z.string(), z.transform(parseChartSource)),
  releases: z.array(releaseConfigSchema),
});

export type ChartConfig = z.infer<typeof chartConfigSchema>;

export const helmingwayConfigSchema = z.object({
  helm: z.optional(
    z.object({
      charts: z.optional(z.array(chartConfigSchema)),
    }),
  ),
});

export type HelmingwayConfig = z.infer<typeof helmingwayConfigSchema>;

/**
 * Load and normalize a Helmingway config file from disk.
 */
export async function loadHelmingwayConfig(configPath: string): Promise<HelmingwayConfig> {
  const content = await fs.readFile(configPath, "utf8");
  const result = z.safeParse(helmingwayConfigSchema, parse(content));
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue?.path?.join(".");
    const message = issue?.message ?? "Invalid config file.";
    throw new Error(path ? `${path}: ${message}` : message);
  }

  return result.data;
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
