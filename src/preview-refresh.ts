import * as vscode from "vscode";
import { renderHelmTemplate } from "./helm-template";
import type { HelmingwayConfig } from "./types";

type RefreshableProvider = {
  refresh(): void;
};

type RefreshPreviewOptions = {
  provider: RefreshableProvider;
  workspacePath: string;
  config: HelmingwayConfig;
};

/**
 * Refresh the tree and rerun `helm template` for every alias in the config.
 */
export async function refreshPreview({
  provider,
  workspacePath,
  config,
}: RefreshPreviewOptions): Promise<void> {
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
      title: "Helmingway: helm template を再実行しています",
      cancellable: false,
    },
    async (progress) => {
      const failedAliases: string[] = [];

      for (const target of renderTargets) {
        progress.report({
          increment: 100 / renderTargets.length,
          message: `${target.chart.name}/${target.alias.name}`,
        });

        try {
          await renderHelmTemplate({
            workspacePath,
            chart: target.chart,
            alias: target.alias,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          failedAliases.push(`${target.chart.name}/${target.alias.name}: ${message}`);
        }
      }

      if (failedAliases.length === 0) {
        vscode.window.showInformationMessage(
          `Helmingway: ${renderTargets.length} 件の alias で helm template を再実行しました。`,
        );
        return;
      }

      const failedSummary = failedAliases.slice(0, 3).join(" / ");
      const omittedCount = failedAliases.length - 3;
      const omittedMessage = omittedCount > 0 ? ` / ほか ${omittedCount} 件` : "";
      vscode.window.showErrorMessage(
        `Helmingway: ${failedAliases.length} 件の alias で helm template に失敗しました: ${failedSummary}${omittedMessage}`,
      );
    },
  );
}
