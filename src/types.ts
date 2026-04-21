export type HelmingwayConfig = {
  helm?: {
    charts?: ChartConfig[];
  };
};

export type RawHelmingwayConfig = Omit<HelmingwayConfig, "helm"> & {
  helm?: {
    charts?: RawChartConfig[];
  };
};

export type ChartConfig = {
  name: string;
  source: HelmChartSource;
  releaseName?: string;
  namespace?: string;
  aliases?: AliasConfig[];
};

export type RawChartConfig = Omit<ChartConfig, "source"> & {
  source: string;
};

export type AliasConfig = {
  name: string;
  valueFiles?: string[];
  values?: Record<string, unknown>;
};

/**
 * Helm chart source accepted by `helm template`.
 *
 * Based on Helm install/template chart argument forms:
 * 1. chart reference
 *    Example: `example/mariadb`
 * 2. path to a packaged chart
 *    Example: `./nginx-1.2.3.tgz`
 * 3. path to an unpacked chart directory
 *    Example: `./nginx`
 * 4. absolute URL
 *    Example: `https://example.com/charts/nginx-1.2.3.tgz`
 * 5. chart reference with `--repo`
 *    Example: `chart: nginx`, `repoUrl: https://example.com/charts/`
 * 6. OCI registry reference
 *    Example: `oci://ghcr.io/buildfarm/buildfarm`
 *
 * References:
 * - https://github.com/helm/helm/blob/v4.1.4/pkg/cmd/install.go#L111-L116
 */
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
      kind: "repo";
      repoUrl: string;
      chart: string;
    }
  | {
      kind: "oci";
      ref: string;
    };

export type ChartTreeNode = {
  type: "chart";
  chartName: string;
  chartPath: string;
};

export type AliasTreeNode = {
  type: "alias";
  chartName: string;
  aliasName: string;
};

export type HelmingwayTreeNode = ChartTreeNode | AliasTreeNode;
