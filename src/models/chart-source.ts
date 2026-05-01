export type HelmChartSource =
  | {
      kind: "reference";
      ref: string;
    }
  | {
      kind: "packaged";
      filePath: string;
    }
  | {
      kind: "directory";
      directoryPath: string;
    }
  | {
      kind: "url";
      url: string;
    }
  | {
      kind: "oci";
      ref: string;
    };

/**
 * Parse raw config value into a normalized helm chart source.
 */
export function parseChartSource(source: string): HelmChartSource {
  if (source.startsWith("oci://")) {
    return {
      kind: "oci",
      ref: source,
    };
  }

  if (source.startsWith("http://") || source.startsWith("https://")) {
    return {
      kind: "url",
      url: source,
    };
  }

  if (source.endsWith(".tgz")) {
    return {
      kind: "packaged",
      filePath: source,
    };
  }

  if (source.includes("/") || source.startsWith(".")) {
    return {
      kind: "directory",
      directoryPath: source,
    };
  }

  return {
    kind: "reference",
    ref: source,
  };
}

/**
 * Format helm chart source for display in the Release Explorer.
 */
export function formatChartSource(chartSource: HelmChartSource): string {
  switch (chartSource.kind) {
    case "reference":
      return chartSource.ref;
    case "packaged":
      return chartSource.filePath;
    case "directory":
      return chartSource.directoryPath;
    case "url":
      return chartSource.url;
    case "oci":
      return chartSource.ref;
  }
}
