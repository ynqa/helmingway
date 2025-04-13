import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Content provider for the preview document
class HelmTemplateContentProvider implements vscode.TextDocumentContentProvider {
    // Emitter and its event
    private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    onDidChange = this._onDidChange.event;

    // Store the last used values file path
    private _currentValuesPath: string = '';
    private _fileWatcher: vscode.FileSystemWatcher | undefined;

    // Get extension configuration
    private _getConfiguration() {
        const config = vscode.workspace.getConfiguration('helmingway');
        return {
            chartPath: config.get<string>('chartPath', ''),
            valuesPath: config.get<string>('valuesPath', 'values.yaml'),
        };
    }

    // Setup file watcher for values.yaml
    public setupFileWatcher(valuesPath: string) {
        // Remove existing watcher if any
        this._fileWatcher?.dispose();
        this._currentValuesPath = valuesPath;

        // Create new watcher
        this._fileWatcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(
                vscode.workspace.workspaceFolders?.[0] || '',
                valuesPath
            )
        );

        // Update preview when values file changes
        this._fileWatcher.onDidChange(() => {
            const previewUri = this._getPreviewUri();
            this._onDidChange.fire(previewUri);
        });
    }

    // Generate preview URI
    private _getPreviewUri(): vscode.Uri {
        return vscode.Uri.parse('helm-preview://preview/template.yaml');
    }

    // Provide content for preview
    async provideTextDocumentContent(): Promise<string> {
        const config = this._getConfiguration();

        if (!config.chartPath) {
            return 'Error: Chart path is not configured. Please set helmingway.chartPath in settings.';
        }

        try {
            const { stdout, stderr } = await execAsync(
                `helm template . -f ${config.valuesPath}`,
                { cwd: config.chartPath }
            );

            if (stderr) {
                return `Error executing helm template:\n${stderr}`;
            }

            return stdout;
        } catch (error) {
            return `Failed to execute helm template:\n${error}`;
        }
    }

    // Dispose of resources
    dispose() {
        this._fileWatcher?.dispose();
        this._onDidChange.dispose();
    }
}

// Activate the extension
export function activate(context: vscode.ExtensionContext) {
    console.log('Helmingway extension is now active');

    // Register content provider
    const provider = new HelmTemplateContentProvider();
    const registration = vscode.workspace.registerTextDocumentContentProvider(
        'helm-preview',
        provider
    );

    // Register command
    const commandDisposable = vscode.commands.registerCommand(
        'helmingway.previewTemplate',
        async () => {
            const config = vscode.workspace.getConfiguration('helmingway');
            const valuesPath = config.get<string>('valuesPath', 'values.yaml');
            
            // Setup file watcher
            provider.setupFileWatcher(valuesPath);

            // Show preview
            const previewUri = vscode.Uri.parse('helm-preview://preview/template.yaml');
            const doc = await vscode.workspace.openTextDocument(previewUri);
            await vscode.window.showTextDocument(doc, {
                preview: true,
                viewColumn: vscode.ViewColumn.Beside
            });
        }
    );

    context.subscriptions.push(registration, commandDisposable);
}

// Deactivate the extension
export function deactivate() {}
