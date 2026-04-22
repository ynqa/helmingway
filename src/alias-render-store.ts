import type { AliasRenderStatus } from "./alias-render-status";
import type { HelmingwayConfig } from "./types";

export type AliasRenderEntry = {
  version: number;
  status: AliasRenderStatus;
  content?: string;
  errorMessage?: string;
};

/**
 * Store rendered YAML and render state by chart/alias pair.
 */
export class AliasRenderStore {
  private readonly entries = new Map<string, AliasRenderEntry>();

  begin(chartName: string, aliasName: string): number {
    const key = toPreviewCacheKey(chartName, aliasName);
    const nextVersion = (this.entries.get(key)?.version ?? 0) + 1;

    this.entries.set(key, {
      version: nextVersion,
      content: this.entries.get(key)?.content,
      status: "rendering",
    });

    return nextVersion;
  }

  set(chartName: string, aliasName: string, version: number, content: string): void {
    const key = toPreviewCacheKey(chartName, aliasName);
    const current = this.entries.get(key);
    if (!current || current.version !== version) {
      return;
    }

    this.entries.set(key, {
      version,
      status: "rendered",
      content,
    });
  }

  fail(chartName: string, aliasName: string, version: number, errorMessage: string): void {
    const key = toPreviewCacheKey(chartName, aliasName);
    const current = this.entries.get(key);
    if (!current || current.version !== version) {
      return;
    }

    this.entries.set(key, {
      version,
      status: "failed",
      content: current.content,
      errorMessage,
    });
  }

  get(chartName: string, aliasName: string): AliasRenderEntry | undefined {
    return this.entries.get(toPreviewCacheKey(chartName, aliasName));
  }

  prune(config: HelmingwayConfig): void {
    const activeKeys = new Set(
      (config.helm?.charts ?? []).flatMap((chart) =>
        (chart.aliases ?? []).map((alias) => toPreviewCacheKey(chart.name, alias.name)),
      ),
    );

    for (const key of this.entries.keys()) {
      if (!activeKeys.has(key)) {
        this.entries.delete(key);
      }
    }

    for (const key of activeKeys) {
      if (!this.entries.has(key)) {
        this.entries.set(key, {
          version: 0,
          status: "idle",
        });
      }
    }
  }
}

function toPreviewCacheKey(chartName: string, aliasName: string): string {
  return `${chartName}:${aliasName}`;
}
