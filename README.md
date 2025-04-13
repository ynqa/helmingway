# Helmingway

Helm Template Preview for Visual Studio Code - Preview your Helm chart's rendered manifests in real-time.

## Features

- Preview Helm template output directly in VS Code
- Auto-refresh preview when values.yaml changes
- Error feedback for template rendering issues
- Side-by-side view of values and rendered output

## Requirements

- [Helm](https://helm.sh/docs/intro/install/) must be installed and available in your PATH
- Visual Studio Code version 1.98.0 or higher

## Installation from Source

1. Clone the repository:
   ```bash
   git clone https://github.com/ynqa/helmingway.git
   cd helmingway
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the extension:
   ```bash
   npm run compile
   ```

4. Create VSIX package:
   ```bash
   npm install -g @vscode/vsce
   vsce package
   ```

5. Install the extension:

   Using VS Code GUI:
   - Press `Cmd+Shift+P` (macOS) or `Ctrl+Shift+P` (Windows/Linux)
   - Type `Extensions: Install from VSIX...`
   - Select the generated `.vsix` file

   Using VS Code CLI:
   ```bash
   code --install-extension helmingway-0.0.1.vsix
   ```

Alternatively, you can run the extension in development mode:
1. Open the project in VS Code
2. Press `F5` to start debugging
3. A new VS Code window will open with the extension loaded

## Extension Settings

This extension contributes the following settings:

* `helmingway.chartPath`: Path to the Helm chart directory
* `helmingway.valuesPath`: Path to the values.yaml file (default: "values.yaml")

## Usage

1. Open your Helm chart project in VS Code
2. Configure the chart path in settings
3. Press `Cmd+Shift+P` (macOS) or `Ctrl+Shift+P` (Windows/Linux)
4. Run the "Helm: Preview Template" command
5. The rendered template will appear in a new editor tab

The preview will automatically update when you save changes to your values file.
