import * as vscode from "vscode";
import { renderHelmTemplate } from "./helm-template";
import type { AliasRenderStore } from "./alias-render-store";
import type { HelmingwayConfig } from "./types";

type RefreshableProvider = {
  refresh(): void;
};

type RefreshPreviewFailure = {
  chartName: string;
  aliasName: string;
  message: string;
};

type RefreshPreviewOptions = {
  provider: RefreshableProvider;
  workspacePath: string;
  config: HelmingwayConfig;
  cache: AliasRenderStore;
};

/**
 * Refresh the tree and rerun `helm template` for every alias in the config.
 */
export async function refreshPreview({
  provider,
  workspacePath,
  config,
  cache,
}: RefreshPreviewOptions): Promise<void> {
  cache.prune(config);
  provider.refresh();

  const renderTargets = (config.helm?.charts ?? []).flatMap((chart) =>
    (chart.aliases ?? []).map((alias) => ({
      chart,
      alias,
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

      const failures: Array<RefreshPreviewFailure | undefined> = await Promise.all(
        renderTargets.map(async (target) => {
          const version = cache.begin(target.chart.name, target.alias.name);
          provider.refresh();

          try {
            const content = await renderHelmTemplate({
              workspacePath,
              chart: target.chart,
              alias: target.alias,
            });
            cache.set(target.chart.name, target.alias.name, version, content);
            provider.refresh();
            return undefined;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            cache.fail(target.chart.name, target.alias.name, version, message);
            provider.refresh();
            return {
              chartName: target.chart.name,
              aliasName: target.alias.name,
              message,
            } satisfies RefreshPreviewFailure;
          } finally {
            completedCount += 1;
            progress.report({
              increment: 100 / renderTargets.length,
              message: `${completedCount}/${renderTargets.length}`,
            });
          }
        }),
      );

      const failedAliases = failures.filter(
        (failure): failure is RefreshPreviewFailure => failure !== undefined,
      );

      if (failedAliases.length === 0) {
        vscode.window.showInformationMessage(
          `Helmingway: Ran helm template for ${renderTargets.length} aliases.`,
        );
        return;
      }

      const failedSummary = failedAliases
        .slice(0, 3)
        .map((failure) => `${failure.chartName}/${failure.aliasName}: ${failure.message}`)
        .join(" / ");
      const omittedCount = failedAliases.length - 3;
      const omittedMessage = omittedCount > 0 ? ` / ${omittedCount} more` : "";
      vscode.window.showErrorMessage(
        `Helmingway: helm template failed for ${failedAliases.length} aliases: ${failedSummary}${omittedMessage}`,
      );
    },
  );
}
