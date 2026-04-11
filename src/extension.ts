import * as path from 'path';
import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { parse } from 'yaml';

const execFileAsync = promisify(execFile);
const CONFIG_FILE_NAME = 'helmingway.config.yaml';
const PREVIEW_SCHEME = 'helmingway-preview';

type Scalar = string | number | boolean | null;

interface ChartConfig {
  path: string;
  releaseName?: string;
  namespace?: string;
}

interface AliasConfig {
  name: string;
  valueFiles?: string[];
  values?: Record<string, Scalar>;
}

interface HelmingwayConfig {
  chart: ChartConfig;
  aliases: AliasConfig[];
}

interface RenderRequest {
  aliasName: string;
  targetTemplate?: string;
}

class PreviewContentProvider implements vscode.TextDocumentContentProvider {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.onDidChangeEmitter.event;
  private readonly cache = new Map<string, string>();

  set(uri: vscode.Uri, content: string): void {
    this.cache.set(uri.toString(), content);
    this.onDidChangeEmitter.fire(uri);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.cache.get(uri.toString()) ?? 'No preview content.';
  }

  dispose(): void {
    this.onDidChangeEmitter.dispose();
    this.cache.clear();
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const provider = new PreviewContentProvider();

  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(PREVIEW_SCHEME, provider),
    vscode.commands.registerCommand('helmingway.previewFromEditor', async () => {
      await previewFromEditor(provider);
    }),
    vscode.commands.registerCommand('helmingway.diffFromEditor', async () => {
      await diffFromEditor(provider);
    }),
  );
}

async function previewFromEditor(provider: PreviewContentProvider): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('Helmingway: no active editor.');
    return;
  }

  try {
    const workspaceFolder = getWorkspaceFolder(editor.document.uri);
    const config = await loadConfig(workspaceFolder);
    const selection = selectAliasForDocument(config, editor.document.uri, workspaceFolder);
    const targetTemplate = resolveTemplateFromDocument(config, editor.document.uri, workspaceFolder);
    const content = await renderTemplate(config, workspaceFolder, {
      aliasName: selection.name,
      targetTemplate,
    });

    const uri = buildPreviewUri('preview', selection.name, targetTemplate);
    provider.set(uri, content);

    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, {
      preview: true,
      viewColumn: vscode.ViewColumn.Beside,
    });
  } catch (error) {
    showError('preview', error);
  }
}

async function diffFromEditor(provider: PreviewContentProvider): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('Helmingway: no active editor.');
    return;
  }

  try {
    const workspaceFolder = getWorkspaceFolder(editor.document.uri);
    const config = await loadConfig(workspaceFolder);
    if (config.aliases.length < 2) {
      throw new Error('Diff requires at least two aliases in helmingway.config.yaml.');
    }

    const leftAlias = selectAliasForDocument(config, editor.document.uri, workspaceFolder);
    const rightAlias = config.aliases.find((alias) => alias.name !== leftAlias.name) ?? config.aliases[1];
    const targetTemplate = resolveTemplateFromDocument(config, editor.document.uri, workspaceFolder);

    const leftContent = await renderTemplate(config, workspaceFolder, {
      aliasName: leftAlias.name,
      targetTemplate,
    });
    const rightContent = await renderTemplate(config, workspaceFolder, {
      aliasName: rightAlias.name,
      targetTemplate,
    });

    const leftUri = buildPreviewUri('diff-left', leftAlias.name, targetTemplate);
    const rightUri = buildPreviewUri('diff-right', rightAlias.name, targetTemplate);

    provider.set(leftUri, leftContent);
    provider.set(rightUri, rightContent);

    const label = targetTemplate
      ? `Helmingway Diff: ${leftAlias.name} ↔ ${rightAlias.name} (${targetTemplate})`
      : `Helmingway Diff: ${leftAlias.name} ↔ ${rightAlias.name}`;

    await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, label, {
      preview: true,
      viewColumn: vscode.ViewColumn.Beside,
    });
  } catch (error) {
    showError('diff', error);
  }
}

function getWorkspaceFolder(uri: vscode.Uri): vscode.WorkspaceFolder {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) {
    throw new Error('Open the file inside a workspace folder.');
  }
  return folder;
}

async function loadConfig(workspaceFolder: vscode.WorkspaceFolder): Promise<HelmingwayConfig> {
  const configUri = vscode.Uri.joinPath(workspaceFolder.uri, CONFIG_FILE_NAME);
  let rawText: string;

  try {
    rawText = Buffer.from(await vscode.workspace.fs.readFile(configUri)).toString('utf8');
  } catch {
    throw new Error(`Config file not found: ${CONFIG_FILE_NAME}`);
  }

  const parsed = parse(rawText) as Partial<HelmingwayConfig> | null;
  if (!parsed?.chart?.path) {
    throw new Error('Config error: chart.path is required.');
  }
  if (!Array.isArray(parsed.aliases) || parsed.aliases.length === 0) {
    throw new Error('Config error: aliases must contain at least one alias.');
  }

  return {
    chart: {
      path: parsed.chart.path,
      releaseName: parsed.chart.releaseName,
      namespace: parsed.chart.namespace,
    },
    aliases: parsed.aliases.map((alias) => {
      if (!alias?.name) {
        throw new Error('Config error: alias.name is required.');
      }
      return {
        name: alias.name,
        valueFiles: alias.valueFiles ?? [],
        values: alias.values ?? {},
      };
    }),
  };
}

function selectAliasForDocument(
  config: HelmingwayConfig,
  documentUri: vscode.Uri,
  workspaceFolder: vscode.WorkspaceFolder,
): AliasConfig {
  const activePath = normalizePath(documentUri.fsPath);

  for (const alias of config.aliases) {
    for (const file of alias.valueFiles ?? []) {
      const absolutePath = normalizePath(resolveWorkspacePath(workspaceFolder, file));
      if (absolutePath === activePath) {
        return alias;
      }
    }
  }

  return config.aliases[0];
}

function resolveTemplateFromDocument(
  config: HelmingwayConfig,
  documentUri: vscode.Uri,
  workspaceFolder: vscode.WorkspaceFolder,
): string | undefined {
  const chartPath = resolveChartPath(config.chart.path, workspaceFolder);
  const templatesRoot = normalizePath(path.join(chartPath, 'templates'));
  const activePath = normalizePath(documentUri.fsPath);

  if (!activePath.startsWith(templatesRoot + path.sep) && activePath !== templatesRoot) {
    return undefined;
  }

  const relativePath = path.relative(chartPath, activePath);
  return normalizeSourcePath(relativePath);
}

async function renderTemplate(
  config: HelmingwayConfig,
  workspaceFolder: vscode.WorkspaceFolder,
  request: RenderRequest,
): Promise<string> {
  const alias = config.aliases.find((candidate) => candidate.name === request.aliasName);
  if (!alias) {
    throw new Error(`Unknown alias: ${request.aliasName}`);
  }

  const chartPath = resolveChartPath(config.chart.path, workspaceFolder);
  const args = ['template'];

  if (config.chart.releaseName) {
    args.push(config.chart.releaseName);
  }

  args.push(config.chart.path);

  if (config.chart.namespace) {
    args.push('--namespace', config.chart.namespace);
  }

  for (const file of alias.valueFiles ?? []) {
    args.push('-f', resolveWorkspacePath(workspaceFolder, file));
  }

  for (const [key, value] of Object.entries(alias.values ?? {})) {
    args.push('--set', `${key}=${String(value)}`);
  }

  const result = await execFileAsync('helm', args, {
    cwd: workspaceFolder.uri.fsPath,
    maxBuffer: 10 * 1024 * 1024,
  });

  const output = result.stdout || '';
  if (!request.targetTemplate) {
    return output;
  }

  return extractTemplateOutput(output, request.targetTemplate) ?? `No rendered output for ${request.targetTemplate}\n`;
}

function extractTemplateOutput(output: string, targetTemplate: string): string | undefined {
  const normalizedTarget = normalizeSourcePath(targetTemplate);
  const docs = output.split(/^---\s*$/m);
  const matches = docs.filter((doc) => {
    const match = doc.match(/# Source:\s+(.+)\s*$/m);
    if (!match) {
      return false;
    }
    return normalizeSourcePath(match[1]) === normalizedTarget;
  });

  if (matches.length === 0) {
    return undefined;
  }

  return matches
    .map((doc) => doc.trim())
    .filter(Boolean)
    .join('\n---\n') + '\n';
}

function resolveChartPath(chartPath: string, workspaceFolder: vscode.WorkspaceFolder): string {
  if (isRemoteChartReference(chartPath)) {
    return workspaceFolder.uri.fsPath;
  }

  return resolveWorkspacePath(workspaceFolder, chartPath);
}

function resolveWorkspacePath(workspaceFolder: vscode.WorkspaceFolder, targetPath: string): string {
  if (path.isAbsolute(targetPath)) {
    return targetPath;
  }
  return path.resolve(workspaceFolder.uri.fsPath, targetPath);
}

function isRemoteChartReference(chartPath: string): boolean {
  return /^(oci|https?):\/\//.test(chartPath);
}

function buildPreviewUri(kind: string, aliasName: string, targetTemplate?: string): vscode.Uri {
  const name = targetTemplate ? `${aliasName}/${targetTemplate}` : `${aliasName}/all`;
  return vscode.Uri.parse(`${PREVIEW_SCHEME}:/${kind}/${encodeURIComponent(name)}.yaml`);
}

function normalizeSourcePath(value: string): string {
  return value.replace(/\\/g, '/');
}

function normalizePath(value: string): string {
  return path.normalize(value);
}

function showError(action: 'preview' | 'diff', error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  void vscode.window.showErrorMessage(`Helmingway ${action} failed: ${message}`);
}

export function deactivate(): void {}
