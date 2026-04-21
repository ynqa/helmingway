import type { HelmingwayConfig } from "./types";

export type AliasRenderEntry = {
  version: number;
  content?: string;
};

/**
 * Store rendered YAML by chart/alias pair.
 */
export class AliasRenderStore {
  private readonly entries = new Map<string, AliasRenderEntry>();

  begin(chartName: string, aliasName: string): number {
    const key = toPreviewCacheKey(chartName, aliasName);
    const nextVersion = (this.entries.get(key)?.version ?? 0) + 1;

    this.entries.set(key, {
      version: nextVersion,
      content: this.entries.get(key)?.content,
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
      content,
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
  }
}

function toPreviewCacheKey(chartName: string, aliasName: string): string {
  return `${chartName}:${aliasName}`;
}
