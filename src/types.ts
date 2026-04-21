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
