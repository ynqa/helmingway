import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ChartConfig, ReleaseConfig } from "../models";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { stringify } from "yaml";

const execFile = promisify(execFileCallback);

type RunHelmTemplateOptions = {
  workspacePath: string;
  chart: ChartConfig;
  release: ReleaseConfig;
};

/**
 * Run `helm template` for the given chart and release, then return the rendered YAML.
 */
export async function runHelmTemplate({
  workspacePath,
  chart,
  release,
}: RunHelmTemplateOptions): Promise<string> {
  const chartPath = resolveChartTemplateArg(workspacePath, chart);
  const args = ["template", release.name, chartPath];
  const temporaryPaths: string[] = [];

  try {
    const namespace = release.namespace ?? chart.namespace;
    if (namespace) {
      args.push("--namespace", namespace);
    }

    for (const valueFile of release.valueFiles ?? []) {
      args.push("--values", resolveValuesFilePath(workspacePath, valueFile));
    }

    // If there are inline values, write them to a temporary file and add it to the arguments.
    if (release.values && Object.keys(release.values).length > 0) {
      const temporaryPath = path.join(
        os.tmpdir(),
        `helmingway-${chart.name}-${release.name}-${Date.now()}.yaml`,
      );
      await fs.writeFile(temporaryPath, stringify(release.values), "utf8");
      temporaryPaths.push(temporaryPath);
      args.push("--values", temporaryPath);
    }

    const { stdout } = await execFile("helm", args, {
      cwd: workspacePath,
      maxBuffer: 16 * 1024 * 1024,
    });

    return stdout;
  } catch (error) {
    if (error instanceof Error) {
      const maybeExecError = error as Error & {
        code?: string | number;
        stderr?: string;
      };

      if (maybeExecError.code === "ENOENT") {
        throw new Error("`helm` command was not found.");
      }

      throw new Error(
        `Failed to run helm template: ${maybeExecError.stderr?.trim() || error.message}`,
      );
    }

    throw error;
  } finally {
    await Promise.all(
      temporaryPaths.map(async (temporaryPath) => fs.rm(temporaryPath, { force: true })),
    );
  }
}

/**
 * Resolve chart source into the chart argument passed to `helm template`.
 */
function resolveChartTemplateArg(workspacePath: string, chart: ChartConfig): string {
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

/**
 * Resolve release values file path from the workspace root.
 */
function resolveValuesFilePath(workspacePath: string, valueFile: string): string {
  return path.resolve(workspacePath, valueFile);
}
