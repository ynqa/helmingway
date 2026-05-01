import * as path from "node:path";
import * as vscode from "vscode";
import type { HelmingwayConfig } from "./models";
import { resolveWorkspacePath } from "./utils/path";
import { getPrimaryWorkspaceFolder } from "./utils/vscode";

const syncDebounceMs = 500;

/**
 * Watch Helmingway inputs and coalesce file changes into cache syncs.
 */
export class HelmingwaySyncScheduler implements vscode.Disposable {
  // Watcher for `helmingway.yaml` config file.
  private configWatcher: vscode.Disposable | undefined;
  // Watchers for chart sources and value files
  // like `source: "./charts/my-chart"` or `valueFiles: ["./values/dev.yaml"]`.
  //
  // They are can be replaced on each sync based on the latest config,
  // so we keep track of them separately from the config watcher.
  private readonly templateSourceWatchers: vscode.Disposable[] = [];
  private debounceTimer: NodeJS.Timeout | undefined;
  private isSyncing = false;
  private hasPendingSync = false;

  constructor(private readonly sync: () => Promise<HelmingwayConfig | undefined>) {
    const workspaceFolder = getPrimaryWorkspaceFolder({ silently: true });
    if (!workspaceFolder) {
      return;
    }

    this.configWatcher = this.createWatcher(
      new vscode.RelativePattern(workspaceFolder, "helmingway.yaml"),
    );
  }

  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }

    for (const disposable of this.templateSourceWatchers.splice(0)) {
      disposable.dispose();
    }

    this.configWatcher?.dispose();
    this.configWatcher = undefined;
  }

  syncNow(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }

    return this.runSync();
  }

  private scheduleSync(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      void this.runSync();
    }, syncDebounceMs);
  }

  private async runSync(): Promise<void> {
    if (this.isSyncing) {
      this.hasPendingSync = true;
      return;
    }

    this.isSyncing = true;

    try {
      const currentConfig = await this.sync();
      if (currentConfig) {
      this.replaceTemplateSourceWatchers(currentConfig);
      }
    } finally {
      this.isSyncing = false;
    }

    if (this.hasPendingSync) {
      this.hasPendingSync = false;
      this.scheduleSync();
    }
  }

  /** Replace file system watchers for chart sources and value files based on the given config. */
  private replaceTemplateSourceWatchers(config: HelmingwayConfig): void {
    for (const disposable of this.templateSourceWatchers.splice(0)) {
      disposable.dispose();
    }

    const workspaceFolder = getPrimaryWorkspaceFolder({ silently: true });
    if (!workspaceFolder) {
      return;
    }

    const workspacePath = workspaceFolder.uri.fsPath;
    const watchedFiles = new Set<string>();
    const watchedDirectories = new Set<string>();

    for (const chart of config.helm?.charts ?? []) {
      // If the chart source is a packaged chart, watch the chart file itself.
      if (chart.source.kind === "packaged") {
        watchedFiles.add(resolveWorkspacePath(workspacePath, chart.source.filePath));
      // Or the chart source is a directory, watch the entire directory.
      } else if (chart.source.kind === "directory") {
        watchedDirectories.add(resolveWorkspacePath(workspacePath, chart.source.directoryPath));
      }

      for (const release of chart.releases ?? []) {
        for (const valueFile of release.valueFiles ?? []) {
          watchedFiles.add(resolveWorkspacePath(workspacePath, valueFile));
        }
      }
    }

    for (const filePath of watchedFiles) {
      this.templateSourceWatchers.push(
        this.createWatcher(
          new vscode.RelativePattern(path.dirname(filePath), path.basename(filePath)),
        ),
      );
    }

    for (const directoryPath of watchedDirectories) {
      this.templateSourceWatchers.push(
        this.createWatcher(new vscode.RelativePattern(directoryPath, "**/*")),
      );
    }
  }

  /** Create a file system watcher for the given glob pattern and schedule sync on changes. */
  private createWatcher(pattern: vscode.GlobPattern): vscode.Disposable {
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    return vscode.Disposable.from(
      watcher,
      watcher.onDidChange(() => this.scheduleSync()), // OnDidChange
      watcher.onDidCreate(() => this.scheduleSync()), // OnDidCreate
      watcher.onDidDelete(() => this.scheduleSync()), // OnDidDelete
    );
  }
}
