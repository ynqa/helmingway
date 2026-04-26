import { Range, parseAllDocuments } from "yaml";

/**
 * Preview-specific representation of a rendered Kubernetes manifest document.
 *
 * This is derived data for Helmingway's tree view and preview tabs, not a
 * faithful copy of the original Kubernetes manifest schema.
 *
 * Field examples:
 * - `resourceId`: `apps/v1/Deployment/default/nginx`
 * - `resourceLabel`: `Deployment nginx`
 * - `manifestYaml`:
 *   ```yaml
 *   apiVersion: apps/v1
 *   kind: Deployment
 *   metadata:
 *     name: nginx
 *     namespace: default
 *   ```
 */
export type PreviewResource = {
  resourceId: string;
  resourceLabel: string;
  manifestYaml: string;
};

type KubernetesResourceDocument = {
  apiVersion?: unknown;
  kind?: unknown;
  metadata?: {
    name?: unknown;
    namespace?: unknown;
  };
};

/**
 * Split rendered Kubernetes YAML into addressable resource documents.
 */
export function parsePreviewResources(content: string): PreviewResource[] {
  const resources = parseAllDocuments(content)
    .map((document) => {
      const value = document.toJSON() as KubernetesResourceDocument | null;
      if (!value || typeof value !== "object") {
        return undefined;
      }

      const kind = getStringValue(value.kind);
      const name = getStringValue(value.metadata?.name);
      if (!kind || !name) {
        return undefined;
      }

      const apiVersion = getStringValue(value.apiVersion) ?? "unknown";
      const namespace = getStringValue(value.metadata?.namespace);
      const resourceId = [apiVersion, kind, namespace ?? "", name].join("/");

      return {
        resourceId,
        resourceLabel: `${kind} ${name}`,
        manifestYaml: toManifestYaml(content, document.range),
      } satisfies PreviewResource;
    })
    .filter((resource): resource is PreviewResource => resource !== undefined);

  const keyCounts = new Map<string, number>();
  return resources.map((resource) => {
    const count = keyCounts.get(resource.resourceId) ?? 0;
    keyCounts.set(resource.resourceId, count + 1);

    if (count === 0) {
      return resource;
    }

    return {
      ...resource,
      resourceId: `${resource.resourceId}#${count + 1}`,
    };
  });
}

export function joinPreviewResourceManifests(resources: PreviewResource[]): string {
  return `${resources.map((resource) => `---\n${resource.manifestYaml}`).join("\n")}\n`;
}

function getStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toManifestYaml(content: string, range: Range | undefined): string {
  if (!range) {
    return "";
  }

  return content.slice(range[0], range[1]).replace(/^(?:---\r?\n)+/, "").trimEnd();
}
