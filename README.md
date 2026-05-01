# Helmingway

[![Visual Studio Marketplace](https://img.shields.io/badge/VS%20Code%20Marketplace-helmingway-blue)](https://marketplace.visualstudio.com/items?itemName=ynqa.helmingway-dev)

<p align="center">
  <img alt="Helmingway logo" src="assets/helmingway.logo.png" width="30%">
</p>

*Helmingway* is a VS Code extension for previewing the Kubernetes manifests
generated from a Helm chart while you edit it.

Define values for environments such as `dev`, `staging`, and `prod`, then open
rendered manifests from VS Code sidebar, filter Kubernetes resources you
want to inspect, and compare the differences between releases.

## Demo

![demo](assets/demo.gif)

## Features

- Preview `helm template` output directly in VS Code
- Compare manifests generated from different environments or values
- Automatically refresh previews when local charts or `valueFiles` change
- Toggle individual Kubernetes resources such as Deployments, Services, and ConfigMaps
- Compare two releases in VS Code's side-by-side diff editor
- See releases with failed Helm rendering in the sidebar

## Requirements

- VS Code `^1.115.0`
- A `helm` CLI available on your `PATH`
- A `helmingway.yaml` file in the workspace root

## Basic Usage

1. Open a workspace that contains your Helm chart in VS Code
2. Create `helmingway.yaml` in the workspace root
3. Open Helmingway from the Activity Bar on the left
4. Click the reload button in the upper-right corner of the view
5. Select a release in the sidebar to open the rendered manifest preview

Expand a release to see the rendered Kubernetes resources. Toggle checkboxes to
choose which resources are included in the preview.

To compare releases, select two release nodes and run **Compare** from the
context menu.

## Configuration

[helmingway.yaml](./helmingway.yaml)
defines the charts and releases you want to inspect. Local chart paths and
values file paths are resolved relative to the workspace root.

```yaml
helm:
  charts:
    - name: example
      source: ./charts/example
      releases:
        - name: dev
          valueFiles:
            - ./env/dev.yaml
          values:
            image:
              tag: dev

        - name: prod
          namespace: production
          valueFiles:
            - ./env/prod.yaml
```

### Chart Sources

Each `chart.source` defines a Helm chart input. You can use a local directory,
packaged chart, repository reference, URL, or OCI reference.

| Source format         | Example                                 |
| --------------------- | --------------------------------------- |
| repository reference  | `bitnami/nginx`                         |
| local chart directory | `./charts/example`                      |
| packaged chart        | `./dist/example-0.1.0.tgz`              |
| HTTP(S) URL           | `https://example.com/chart.tgz`         |
| OCI reference         | `oci://registry.example.com/charts/app` |

### Releases

Each `release` defines the values and namespace used to render a chart.

| Field        | Required | Description                                                 |
| ------------ | -------- | ----------------------------------------------------------- |
| `name`       | yes      | Release name passed to `helm template`                      |
| `namespace`  | no       | Namespace passed to `helm template`; defaults to `default`  |
| `valueFiles` | no       | Values files passed in order as `--values`                  |
| `values`     | no       | Inline values written to a temporary file before rendering  |
