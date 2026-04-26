/* eslint-disable sort-imports */
import * as vscode from "vscode";
import { HelmTemplateCache } from "./template-cache";
import { runHelmTemplate } from "./template";
import type { HelmingwayConfig } from "../models";
import type { HelmTemplateEntry } from "./template-cache";

type RebuildHelmTemplateCacheFailure = {
  chartName: string;
  releaseName: string;
  message: string;
};

type RebuildHelmTemplateCacheOptions = {
  onCacheChanged: () => void;
  workspacePath: string;
  config: HelmingwayConfig;
};

export type { HelmTemplateEntry, HelmTemplateStatus } from "./template-cache";

/**
 * Orchestrate preview refresh and encapsulate helm template cache access.
 */
export class HelmService {
  private readonly cache = new HelmTemplateCache();

  async rebuildHelmTemplateCache({
    onCacheChanged,
    workspacePath,
    config,
  }: RebuildHelmTemplateCacheOptions): Promise<void> {
    this.cache.prune(config);
    onCacheChanged();

    const renderTargets = (config.helm?.charts ?? []).flatMap((chart) =>
      (chart.releases ?? []).map((release) => ({
        chart,
        release,
      })),
    );

    if (renderTargets.length === 0) {
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Running helm template",
        cancellable: false,
      },
      async (progress) => {
        let completedCount = 0;

        const failures: Array<RebuildHelmTemplateCacheFailure | undefined> = await Promise.all(
          renderTargets.map(async (target) => {
            const version = this.cache.begin(target.chart.name, target.release.name);
            onCacheChanged();

            try {
              const content = await runHelmTemplate({workspacePath, chart: target.chart, release: target.release});
              this.cache.set(target.chart.name, target.release.name, version, content);
              onCacheChanged();
              return undefined;
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              this.cache.fail(target.chart.name, target.release.name, version, message);
              onCacheChanged();
              return {
                chartName: target.chart.name,
                releaseName: target.release.name,
                message,
              } satisfies RebuildHelmTemplateCacheFailure;
            } finally {
              completedCount += 1;
              progress.report({
                increment: 100 / renderTargets.length,
                message: `${completedCount}/${renderTargets.length}`,
              });
            }
          }),
        );

        const failedReleases = failures.filter(
          (failure): failure is RebuildHelmTemplateCacheFailure => failure !== undefined,
        );

        if (failedReleases.length === 0) {
          vscode.window.showInformationMessage(
            `Helmingway: Ran helm template for ${renderTargets.length} releases.`,
          );
          return;
        }

        const failedSummary = failedReleases
          .slice(0, 3)
          .map((failure) => `${failure.chartName}/${failure.releaseName}: ${failure.message}`)
          .join(" / ");
        const omittedCount = failedReleases.length - 3;
        const omittedMessage = omittedCount > 0 ? ` / ${omittedCount} more` : "";
        vscode.window.showErrorMessage(
          `Helmingway: helm template failed for ${failedReleases.length} releases: ${failedSummary}${omittedMessage}`,
        );
      },
    );
  }

  getHelmTemplateCacheEntry(chartName: string, releaseName: string): HelmTemplateEntry | undefined {
    return this.cache.get(chartName, releaseName);
  }
}
