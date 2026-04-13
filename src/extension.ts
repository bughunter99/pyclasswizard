import * as vscode from 'vscode';
import { PyClassTreeProvider, PyClassNode } from './classTreeProvider';
import { ClwStore } from './clwStore';

export function activate(context: vscode.ExtensionContext): void {
  const clwStore = new ClwStore();
  const provider = new PyClassTreeProvider(context, clwStore);

  // Register the TreeView with multi-select and drag-and-drop support
  const treeView = vscode.window.createTreeView('pyclasswizard.classView', {
    treeDataProvider: provider,
    showCollapseAll: true,
    canSelectMany: true,
    dragAndDropController: provider,
  });

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  const refreshCmd = vscode.commands.registerCommand('pyclasswizard.refresh', () => {
    provider.refresh();
  });

  const collapseAllCmd = vscode.commands.registerCommand('pyclasswizard.collapseAll', async () => {
    provider.refresh();
  });

  // Shared navigation helper: open file and move cursor to the symbol.
  async function navigateToNode(node: PyClassNode): Promise<void> {
    if (!node.symbol) { return; }
    const uri = vscode.Uri.file(node.filePath);
    const position = new vscode.Position(node.symbol.line, node.symbol.column);
    const range = new vscode.Range(position, position);

    const editor = await vscode.window.showTextDocument(uri, {
      selection: range,
      preserveFocus: false,
    });
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  // Track the currently selected tree node so that keyboard commands can use it.
  let selectedNode: PyClassNode | undefined;
  treeView.onDidChangeSelection((e) => {
    selectedNode = e.selection[0];
  });

  // State for double-click detection (navigate only when the same node is
  // activated twice within 400 ms).
  let lastClickNode: PyClassNode | undefined;
  let lastClickTime = 0;

  const goToDefinitionCmd = vscode.commands.registerCommand(
    'pyclasswizard.goToDefinition',
    async (node: PyClassNode | undefined) => {
      if (!node || !node.symbol) { return; }

      const now = Date.now();
      const isDoubleClick = lastClickNode === node && now - lastClickTime < 400;

      lastClickNode = node;
      lastClickTime = isDoubleClick ? 0 : now;

      if (!isDoubleClick) { return; }

      await navigateToNode(node);
    }
  );

  // Keyboard navigation: Enter key navigates directly to the selected symbol.
  const navigateToSourceCmd = vscode.commands.registerCommand(
    'pyclasswizard.navigateToSource',
    async () => {
      if (selectedNode) {
        await navigateToNode(selectedNode);
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Folder management commands
  // ---------------------------------------------------------------------------

  const newFolderCmd = vscode.commands.registerCommand(
    'pyclasswizard.newFolder',
    async (node?: PyClassNode) => {
      const name = await vscode.window.showInputBox({
        prompt: 'Enter folder name',
        placeHolder: 'New Folder',
        validateInput: v => v.trim() ? undefined : 'Folder name cannot be empty',
      });
      if (!name) { return; }
      // If invoked from a folder node, create a sub-folder; otherwise create at root.
      const parentId = node?.nodeType === 'folder' ? node.folderId : null;
      clwStore.createFolder(name.trim(), parentId);
      provider.refresh();
    }
  );

  const renameFolderCmd = vscode.commands.registerCommand(
    'pyclasswizard.renameFolder',
    async (node?: PyClassNode) => {
      if (!node || node.nodeType !== 'folder' || !node.folderId) { return; }
      const name = await vscode.window.showInputBox({
        prompt: 'Enter new folder name',
        value: node.label as string,
        validateInput: v => v.trim() ? undefined : 'Folder name cannot be empty',
      });
      if (!name) { return; }
      clwStore.renameFolder(node.folderId, name.trim());
      provider.refresh();
    }
  );

  const deleteFolderCmd = vscode.commands.registerCommand(
    'pyclasswizard.deleteFolder',
    async (node?: PyClassNode) => {
      if (!node || node.nodeType !== 'folder' || !node.folderId) { return; }
      const answer = await vscode.window.showWarningMessage(
        `Delete folder "${node.label as string}"? Items inside will be moved to root.`,
        { modal: true },
        'Delete'
      );
      if (answer !== 'Delete') { return; }
      clwStore.deleteFolder(node.folderId);
      provider.refresh();
    }
  );

  const moveToFolderCmd = vscode.commands.registerCommand(
    'pyclasswizard.moveToFolder',
    async (clickedNode?: PyClassNode, allSelectedNodes?: PyClassNode[]) => {
      // Gather the nodes to move: multi-select gives allSelectedNodes as the
      // second argument; fall back to just the right-clicked node.
      const candidates = (allSelectedNodes && allSelectedNodes.length > 0)
        ? allSelectedNodes
        : clickedNode ? [clickedNode] : [];

      const movable = candidates.filter(
        n =>
          (n.nodeType === 'class' || n.nodeType === 'function' || n.nodeType === 'global') &&
          n.symbolKey !== undefined
      );
      if (movable.length === 0) { return; }

      const folders = clwStore.getFolders();
      if (folders.length === 0) {
        vscode.window.showInformationMessage(
          'No folders exist yet. Use the "New Folder" button to create one first.'
        );
        return;
      }

      // Build a flat, indented list of folders ordered depth-first
      const items: Array<{ label: string; folderId: string | null }> = [];
      const addFolder = (folderId: string | null, indent: string) => {
        const children = folders
          .filter(f => f.parentId === folderId)
          .sort((a, b) => a.name.localeCompare(b.name));
        for (const f of children) {
          items.push({ label: `${indent}$(folder) ${f.name}`, folderId: f.id });
          addFolder(f.id, indent + '    ');
        }
      };
      addFolder(null, '');
      items.push({ label: '$(close) Move to Root (no folder)', folderId: null });

      const picked = await vscode.window.showQuickPick(
        items.map(i => i.label),
        {
          placeHolder: `Move ${movable.length === 1 ? `"${movable[0].label as string}"` : `${movable.length} items`} to…`,
          canPickMany: false,
        }
      );
      if (picked === undefined) { return; }

      const chosenItem = items.find(i => i.label === picked)!;
      for (const node of movable) {
        if (chosenItem.folderId !== null) {
          clwStore.assignToFolder(node.symbolKey!, chosenItem.folderId);
        } else {
          clwStore.removeFromFolder(node.symbolKey!);
        }
      }
      provider.refresh();
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
    clwStore.load();
    provider.refresh();
  });

  // Debounced refresh on Python file save
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
    navigateToSourceCmd,
    newFolderCmd,
    renameFolderCmd,
    deleteFolderCmd,
    moveToFolderCmd,
    configChangeListener,
    workspaceFolderListener,
    activeEditorListener,
  );
}

export function deactivate(): void {
  // Nothing to clean up beyond subscriptions
}
