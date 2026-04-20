export type HelmingwayConfig = {
  helm?: {
    charts?: ChartConfig[];
  };
};

export type ChartConfig = {
  name: string;
  path: string;
  releaseName?: string;
  namespace?: string;
  aliases?: AliasConfig[];
};

export type AliasConfig = {
  name: string;
  valueFiles?: string[];
  values?: Record<string, unknown>;
};

export type HelmingwayTreeNode =
  | {
      type: "chart";
      chart: ChartConfig;
    }
  | {
      type: "alias";
      alias: AliasConfig;
    };
