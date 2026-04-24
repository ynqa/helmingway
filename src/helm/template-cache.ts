import * as vscode from "vscode";
import type { HelmingwayConfig } from "../models";

export type HelmTemplateStatus = "idle" | "rendering" | "rendered" | "failed";

/**
 * Presentation details for each render status, used in the tree view.
 *
 * ThemeIcon reference:
 * - https://code.visualstudio.com/api/references/icons-in-labels
 */
export const helmTemplateStatusPresentation = {
  idle: {
    icon: new vscode.ThemeIcon("circle-outline"),
    description: "idle",
  },
  rendering: {
    icon: new vscode.ThemeIcon("sync"),
    description: "rendering",
  },
  rendered: {
    icon: new vscode.ThemeIcon("check"),
    description: "rendered",
  },
  failed: {
    icon: new vscode.ThemeIcon("error"),
    description: "failed",
  },
} satisfies Record<
  HelmTemplateStatus,
  {
    icon: vscode.ThemeIcon;
    description: string;
  }
>;

export type HelmTemplateEntry = {
  version: number;
  status: HelmTemplateStatus;
  content?: string;
  helmTemplateErrorMessage?: string;
};

/**
 * Store rendered YAML and render state by chart/alias pair.
 */
export class HelmTemplateCache {
  private readonly entries = new Map<string, HelmTemplateEntry>();

  begin(chartName: string, aliasName: string): number {
    const key = this.toCacheKey(chartName, aliasName);
    const nextVersion = (this.entries.get(key)?.version ?? 0) + 1;

    this.entries.set(key, {
      version: nextVersion,
      content: this.entries.get(key)?.content,
      status: "rendering",
    });

    return nextVersion;
  }

  set(chartName: string, aliasName: string, version: number, content: string): void {
    const key = this.toCacheKey(chartName, aliasName);
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

  fail(chartName: string, aliasName: string, version: number, helmTemplateErrorMessage: string): void {
    const key = this.toCacheKey(chartName, aliasName);
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

  get(chartName: string, aliasName: string): HelmTemplateEntry | undefined {
    return this.entries.get(this.toCacheKey(chartName, aliasName));
  }

  prune(config: HelmingwayConfig): void {
    const activeKeys = new Set(
      (config.helm?.charts ?? []).flatMap((chart) =>
        (chart.aliases ?? []).map((alias) => this.toCacheKey(chart.name, alias.name)),
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

  private toCacheKey(chartName: string, aliasName: string): string {
    return `${chartName}:${aliasName}`;
  }
}
