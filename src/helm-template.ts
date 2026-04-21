import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { stringify } from "yaml";
import type { AliasConfig, ChartConfig } from "./types";

const execFile = promisify(execFileCallback);

type RenderHelmTemplateOptions = {
  workspacePath: string;
  chart: ChartConfig;
  alias: AliasConfig;
};

/**
 * Run `helm template` for the given chart and alias, then return the rendered YAML.
 */
export async function renderHelmTemplate({
  workspacePath,
  chart,
  alias,
}: RenderHelmTemplateOptions): Promise<string> {
  const chartPath = resolveChartTemplateArg(workspacePath, chart);
  const args = ["template", chart.releaseName ?? chart.name, chartPath];
  const temporaryPaths: string[] = [];

  try {
    if (chart.namespace) {
      args.push("--namespace", chart.namespace);
    }

    for (const valueFile of alias.valueFiles ?? []) {
      args.push("--values", resolveValuesFilePath(workspacePath, valueFile));
    }

    // If there are inline values, write them to a temporary file and add it to the arguments.
    if (alias.values && Object.keys(alias.values).length > 0) {
      const temporaryPath = path.join(
        os.tmpdir(),
        `helmingway-${chart.name}-${alias.name}-${Date.now()}.yaml`,
      );
      await fs.writeFile(temporaryPath, stringify(alias.values), "utf8");
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
        throw new Error("`helm` コマンドが見つかりません。");
      }

      throw new Error(
        `helm template の実行に失敗しました: ${maybeExecError.stderr?.trim() || error.message}`,
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
 * Resolve alias values file path from the workspace root.
 */
function resolveValuesFilePath(workspacePath: string, valueFile: string): string {
  return path.resolve(workspacePath, valueFile);
}
