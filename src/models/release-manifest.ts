import type { ReleaseTreeNode, ResourceTreeNode } from "./tree-node";
import type { HelmTemplateStatus } from "../helm/service";

export type ReleaseManifestView = {
  release: ReleaseTreeNode;
  status: HelmTemplateStatus;
  errorMessage?: string;
  resources: ResourceTreeNode[];
};
