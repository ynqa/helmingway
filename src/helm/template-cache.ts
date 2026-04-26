import type { HelmingwayConfig } from "../models";

export type HelmTemplateStatus = "idle" | "rendering" | "rendered" | "failed";

export type HelmTemplateEntry = {
  version: number;
  status: HelmTemplateStatus;
  content?: string;
  helmTemplateErrorMessage?: string;
};

/**
 * Store rendered YAML and render state by chart/release pair.
 */
export class HelmTemplateCache {
  private readonly entries = new Map<string, HelmTemplateEntry>();

  begin(chartName: string, releaseName: string): number {
    const key = this.toCacheKey(chartName, releaseName);
    const nextVersion = (this.entries.get(key)?.version ?? 0) + 1;

    this.entries.set(key, {
      version: nextVersion,
      content: this.entries.get(key)?.content,
      status: "rendering",
    });

    return nextVersion;
  }

  set(chartName: string, releaseName: string, version: number, content: string): void {
    const key = this.toCacheKey(chartName, releaseName);
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

  fail(chartName: string, releaseName: string, version: number, helmTemplateErrorMessage: string): void {
    const key = this.toCacheKey(chartName, releaseName);
    const current = this.entries.get(key);
    if (!current || current.version !== version) {
      return;
    }

    this.entries.set(key, {
      version,
      status: "failed",
      content: current.content,
      helmTemplateErrorMessage,
    });
  }

  get(chartName: string, releaseName: string): HelmTemplateEntry | undefined {
    return this.entries.get(this.toCacheKey(chartName, releaseName));
  }

  prune(config: HelmingwayConfig): void {
    const activeKeys = new Set(
      (config.helm?.charts ?? []).flatMap((chart) =>
        (chart.releases ?? []).map((release) => this.toCacheKey(chart.name, release.name)),
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

  private toCacheKey(chartName: string, releaseName: string): string {
    return `${chartName}:${releaseName}`;
  }
}
