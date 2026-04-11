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

  // State for double-click detection (navigate only when the same node is
  // activated twice within 400 ms; triple-click resets the window so it does
  // not trigger another navigation immediately).
  let lastClickNode: PyClassNode | undefined;
  let lastClickTime = 0;

  const goToDefinitionCmd = vscode.commands.registerCommand(
    'pyclasswizard.goToDefinition',
    async (node: PyClassNode | undefined) => {
      // node may come from a command palette invocation (no arg) or tree click
      if (!node || !node.symbol) { return; }

      const now = Date.now();
      const isDoubleClick = lastClickNode === node && now - lastClickTime < 400;

      lastClickNode = node;
      // Reset the clock after a recognised double-click so that a third rapid
      // click starts a fresh window instead of immediately navigating again.
      lastClickTime = isDoubleClick ? 0 : now;

      if (!isDoubleClick) { return; }

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
  // Auto-refresh when workspace changes or active editor changes
  // ---------------------------------------------------------------------------
  const configChangeListener = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('pyclasswizard')) {
      provider.refresh();
    }
  });

  const workspaceFolderListener = vscode.workspace.onDidChangeWorkspaceFolders(() => {
    provider.refresh();
  });

  // Refresh when the user switches to a Python file so the outline stays current.
  // Debounced to avoid thrashing in large workspaces when switching quickly.
  let editorRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  const activeEditorListener = vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (editor && editor.document.languageId === 'python') {
      clearTimeout(editorRefreshTimer);
      editorRefreshTimer = setTimeout(() => provider.refresh(), 300);
    }
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
    activeEditorListener,
  );
}

export function deactivate(): void {
  // Nothing to clean up beyond subscriptions
}
