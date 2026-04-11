import * as vscode from 'vscode';
import { PyClassTreeProvider, PyClassNode } from './classTreeProvider';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new PyClassTreeProvider(context);

  // Register the TreeView
  const treeView = vscode.window.createTreeView('pyclasswizard.classView', {
    treeDataProvider: provider,
    showCollapseAll: true,
  });

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  const refreshCmd = vscode.commands.registerCommand('pyclasswizard.refresh', () => {
    provider.refresh();
  });

  const collapseAllCmd = vscode.commands.registerCommand('pyclasswizard.collapseAll', async () => {
    // Re-triggering the tree data change will reset expansion state
    provider.refresh();
  });

  const goToDefinitionCmd = vscode.commands.registerCommand(
    'pyclasswizard.goToDefinition',
    async (node: PyClassNode | undefined) => {
      // node may come from a command palette invocation (no arg) or tree click
      if (!node || !node.symbol) { return; }

      const uri = vscode.Uri.file(node.filePath);
      const position = new vscode.Position(node.symbol.line, node.symbol.column);
      const range = new vscode.Range(position, position);

      const editor = await vscode.window.showTextDocument(uri, {
        selection: range,
        preserveFocus: false,
      });

      editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }
  );

  // ---------------------------------------------------------------------------
  // Auto-refresh when workspace changes
  // ---------------------------------------------------------------------------
  const configChangeListener = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('pyclasswizard')) {
      provider.refresh();
    }
  });

  const workspaceFolderListener = vscode.workspace.onDidChangeWorkspaceFolders(() => {
    provider.refresh();
  });

  // ---------------------------------------------------------------------------
  // Initial refresh
  // ---------------------------------------------------------------------------
  provider.refresh();

  context.subscriptions.push(
    treeView,
    provider,
    refreshCmd,
    collapseAllCmd,
    goToDefinitionCmd,
    configChangeListener,
    workspaceFolderListener,
  );
}

export function deactivate(): void {
  // Nothing to clean up beyond subscriptions
}
