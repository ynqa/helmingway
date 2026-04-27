import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  type ChartConfig,
  type HelmingwayConfig,
  type ReleaseConfig,
  findChartConfig,
  findReleaseConfig,
  parseHelmingwayConfig,
} from "../models";

type GitApi = {
  repositories: GitRepository[];
  getRepository(uri: vscode.Uri): GitRepository | null;
  toGitUri(uri: vscode.Uri, ref: string): vscode.Uri;
};

type GitExtension = {
  enabled: boolean;
  getAPI(version: 1): GitApi;
};

type GitCommit = {
  hash: string;
  message: string;
  authorDate?: Date;
  authorName?: string;
};

type GitRepository = {
  rootUri: vscode.Uri;
  log(options?: { maxEntries?: number }): Promise<GitCommit[]>;
  show(ref: string, path: string): Promise<string>;
};

export type GitCommitTreeNode = {
  type: "gitCommit";
  commit: GitCommit;
};

export type GitResolvedRelease = {
  chart: ChartConfig;
  release: ReleaseConfig;
  tempWorkspacePath: string;
  dispose: () => Promise<void>;
};

/**
 * Get the VS Code built-in Git API.
 */
export function getGitApi(): GitApi | undefined {
  const extension = vscode.extensions.getExtension<GitExtension>("vscode.git");
  if (!extension) {
    return undefined;
  }

  if (!extension.isActive) {
    void extension.activate();
  }

  if (!extension.exports?.enabled) {
    return undefined;
  }

  return extension.exports.getAPI(1);
}

/**
 * Resolve the Git repository for the current workspace folder.
 */
export function getWorkspaceRepository(workspaceFolder: vscode.WorkspaceFolder): GitRepository | undefined {
  const gitApi = getGitApi();
  if (!gitApi) {
    return undefined;
  }

  return gitApi.getRepository(workspaceFolder.uri) ?? gitApi.repositories[0];
}

/**
 * List recent commits from the repository HEAD.
 */
export async function listRecentCommits(
  repository: GitRepository,
  maxEntries = 50,
): Promise<GitCommitTreeNode[]> {
  const commits = await repository.log({ maxEntries });
  return commits.map((commit) => ({
    type: "gitCommit",
    commit,
  }));
}

/**
 * Read a text file from a Git ref. Returns undefined when the file does not exist.
 */
export async function getTextFileContentAtRef(
  repository: GitRepository,
  ref: string,
  relativePath: string,
): Promise<string | undefined> {
  try {
    return await repository.show(ref, toGitPath(relativePath));
  } catch {
    return undefined;
  }
}

/**
 * Load helmingway.yaml from a Git ref.
 */
export async function loadHelmingwayConfigAtRef(
  repository: GitRepository,
  ref: string,
): Promise<HelmingwayConfig | undefined> {
  const content = await getTextFileContentAtRef(repository, ref, "helmingway.yaml");
  if (content === undefined) {
    return undefined;
  }

  return parseHelmingwayConfig(content);
}

/**
 * Materialize the minimum file set needed to run helm template for a past ref.
 */
export async function resolveReleaseAtRef(
  repository: GitRepository,
  ref: string,
  chartName: string,
  releaseName: string,
): Promise<GitResolvedRelease | undefined> {
  const config = await loadHelmingwayConfigAtRef(repository, ref);
  if (!config) {
    return undefined;
  }

  const chart = findChartConfig(config, chartName);
  const release = findReleaseConfig(config, chartName, releaseName);
  if (!chart || !release) {
    return undefined;
  }

  const tempWorkspacePath = await fs.mkdtemp(path.join(os.tmpdir(), "helmingway-git-"));

  try {
    await materializeChartSource(repository, ref, tempWorkspacePath, chart);

    for (const valueFile of release.valueFiles ?? []) {
      await materializeFileAtRef(repository, ref, tempWorkspacePath, valueFile);
    }

    await fs.writeFile(
      path.join(tempWorkspacePath, "helmingway.yaml"),
      (await getTextFileContentAtRef(repository, ref, "helmingway.yaml")) ?? "",
      "utf8",
    );

    return {
      chart,
      release,
      tempWorkspacePath,
      dispose: async () => {
        await fs.rm(tempWorkspacePath, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await fs.rm(tempWorkspacePath, { recursive: true, force: true });
    throw error;
  }
}

async function materializeChartSource(
  repository: GitRepository,
  ref: string,
  tempWorkspacePath: string,
  chart: ChartConfig,
): Promise<void> {
  switch (chart.source.kind) {
    case "directory":
      await materializeDirectoryAtRef(repository, ref, tempWorkspacePath, chart.source.directoryPath);
      return;
    case "packaged":
      await materializeFileAtRef(repository, ref, tempWorkspacePath, chart.source.filePath);
      return;
    case "reference":
    case "url":
    case "oci":
      return;
  }
}

async function materializeDirectoryAtRef(
  repository: GitRepository,
  ref: string,
  tempWorkspacePath: string,
  relativeDirectoryPath: string,
): Promise<void> {
  const gitApi = getGitApi();
  if (!gitApi) {
    throw new Error("VS Code Git API is not available.");
  }

  const directoryUri = gitApi.toGitUri(
    vscode.Uri.joinPath(repository.rootUri, toGitPath(relativeDirectoryPath)),
    ref,
  );

  await copyGitDirectoryToTemp(directoryUri, tempWorkspacePath, relativeDirectoryPath);
}

async function copyGitDirectoryToTemp(
  sourceDirectoryUri: vscode.Uri,
  tempWorkspacePath: string,
  relativeDirectoryPath: string,
): Promise<void> {
  const entries = await vscode.workspace.fs.readDirectory(sourceDirectoryUri);
  if (entries.length === 0) {
    throw new Error(`Chart directory ${relativeDirectoryPath} was not found.`);
  }

  await Promise.all(
    entries.map(async ([name, fileType]) => {
      const childSourceUri = vscode.Uri.joinPath(sourceDirectoryUri, name);
      const childRelativePath = path.posix.join(toGitPath(relativeDirectoryPath), name);

      if (fileType === vscode.FileType.Directory) {
        await copyGitDirectoryToTemp(childSourceUri, tempWorkspacePath, childRelativePath);
        return;
      }

      const content = await vscode.workspace.fs.readFile(childSourceUri);
      const targetPath = path.join(tempWorkspacePath, childRelativePath);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, content);
    }),
  );
}

async function materializeFileAtRef(
  repository: GitRepository,
  ref: string,
  tempWorkspacePath: string,
  relativePath: string,
): Promise<void> {
  const gitApi = getGitApi();
  if (!gitApi) {
    throw new Error("VS Code Git API is not available.");
  }

  const sourceUri = gitApi.toGitUri(vscode.Uri.joinPath(repository.rootUri, toGitPath(relativePath)), ref);
  const content = await vscode.workspace.fs.readFile(sourceUri);
  const targetPath = path.join(tempWorkspacePath, relativePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, content);
}

function toGitPath(filePath: string): string {
  return filePath.split(path.sep).join(path.posix.sep).replace(/^\.\//, "");
}
