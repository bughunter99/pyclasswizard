import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { parsePythonSource, PySymbol } from './pythonParser';
import { ClwStore, ClwFolder } from './clwStore';

// ---------------------------------------------------------------------------
// Tree item types
// ---------------------------------------------------------------------------

export type NodeType =
  | 'root' | 'file' | 'class' | 'method' | 'variable'
  | 'global' | 'function' | 'folder';

const DRAG_MIME = 'application/pyclasswizard-dnd';
// VS Code automatically adds this built-in MIME for same-tree drags.
// The tree-id portion MUST be fully lower-cased to match what VS Code
// generates: application/vnd.code.tree.<treeidlowercase>.
// Tree view ID = "pyclasswizard.classView"  →  lower-case = "pyclasswizard.classview"
const TREE_MIME = 'application/vnd.code.tree.pyclasswizard.classview';

/** Stable key that identifies a top-level symbol for CLW persistence. */
function makeSymbolKey(filePath: string, kind: string, name: string): string {
  return `${filePath}::${kind}::${name}`;
}

// ---------------------------------------------------------------------------
// Tree item
// ---------------------------------------------------------------------------

export class PyClassNode extends vscode.TreeItem {
  /** Set on top-level symbol nodes; used as the CLW assignment key. */
  public symbolKey: string | undefined;
  /** Set on folder nodes: the persistent folder ID from the CLW store. */
  public folderId: string | null = null;

  constructor(
    public readonly symbol: PySymbol | null,
    public readonly nodeType: NodeType,
    public readonly label: string,
    public readonly filePath: string,
    public readonly children: PyClassNode[],
    collapsibleState: vscode.TreeItemCollapsibleState,
    detail?: string
  ) {
    super(label, collapsibleState);

    switch (nodeType) {
      case 'folder':
        this.iconPath = new vscode.ThemeIcon('folder');
        this.tooltip = label;
        this.contextValue = 'pyFolder';
        break;
      case 'file':
        this.iconPath = new vscode.ThemeIcon('file-code');
        this.description = '';
        this.tooltip = filePath;
        this.contextValue = 'pyFile';
        break;
      case 'class':
        this.iconPath = new vscode.ThemeIcon('symbol-class', new vscode.ThemeColor('charts.yellow'));
        this.description = detail ?? '';
        this.tooltip = `class ${label}${detail ? ' ' + detail : ''}`;
        this.contextValue = 'pyClass';
        break;
      case 'method':
        this.iconPath = new vscode.ThemeIcon('symbol-method', new vscode.ThemeColor('charts.purple'));
        this.description = '';
        this.tooltip = `def ${label}(...)`;
        this.contextValue = 'pyMethod';
        break;
      case 'variable':
        this.iconPath = new vscode.ThemeIcon('symbol-field', new vscode.ThemeColor('charts.blue'));
        this.description = detail ?? '';
        this.tooltip = detail ? `${label}: ${detail}` : label;
        this.contextValue = 'pyVariable';
        break;
      case 'global':
        this.iconPath = new vscode.ThemeIcon('symbol-variable', new vscode.ThemeColor('charts.blue'));
        this.description = detail ?? '';
        this.tooltip = detail ? `${label}: ${detail}` : label;
        this.contextValue = 'pyGlobal';
        break;
      case 'function':
        this.iconPath = new vscode.ThemeIcon('symbol-function', new vscode.ThemeColor('charts.green'));
        this.description = '';
        this.tooltip = `def ${label}(...)`;
        this.contextValue = 'pyFunction';
        break;
    }

    // Attach click command so that the double-click detection in extension.ts
    // receives each activation and can navigate on the second click within 400 ms.
    if (symbol && nodeType !== 'file') {
      this.command = {
        command: 'pyclasswizard.goToDefinition',
        title: 'Go to Definition',
        arguments: [this],
      };
    }
  }
}

// ---------------------------------------------------------------------------
// TreeDataProvider + TreeDragAndDropController
// ---------------------------------------------------------------------------

export class PyClassTreeProvider
  implements
    vscode.TreeDataProvider<PyClassNode>,
    vscode.TreeDragAndDropController<PyClassNode>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<PyClassNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private rootNodes: PyClassNode[] = [];
  private fileWatcher: vscode.FileSystemWatcher | undefined;
  /**
   * Maps node `id` → PyClassNode for every node in the current tree.
   * Used in handleDrop to look up dragged nodes by the IDs stored in DataTransfer.
   * Rebuilt on every buildTree() call.
   */
  private _nodeById = new Map<string, PyClassNode>();
  /**
   * Maps each node's `id` to its parent node.
   * Root-level nodes are NOT present in this map (getParent returns undefined for them).
   * VS Code requires getParent() to be implemented for TreeDragAndDropController to work.
   */
  private _parentMap = new Map<string, PyClassNode>();

  // TreeDragAndDropController ------------------------------------------------
  // DRAG_MIME carries our node payload; TREE_MIME is VS Code's built-in
  // same-tree type and MUST appear in dropMimeTypes so that VS Code actually
  // triggers the drop when items from this tree are released on a target.
  readonly dragMimeTypes: readonly string[] = [DRAG_MIME];
  readonly dropMimeTypes: readonly string[] = [DRAG_MIME, TREE_MIME];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly clwStore: ClwStore
  ) {
    this.setupFileWatcher();
  }

  private setupFileWatcher(): void {
    this.fileWatcher?.dispose();
    this.fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.py');
    this.fileWatcher.onDidChange(() => this.refresh());
    this.fileWatcher.onDidCreate(() => this.refresh());
    this.fileWatcher.onDidDelete(() => this.refresh());
  }

  refresh(): void {
    this.rootNodes = [];
    this._onDidChangeTreeData.fire();
  }

  dispose(): void {
    this.fileWatcher?.dispose();
  }

  getTreeItem(element: PyClassNode): vscode.TreeItem {
    return element;
  }

  /**
   * Required by VS Code for drag-and-drop to work.
   * Returns the parent of a node, or undefined for root-level nodes.
   */
  getParent(element: PyClassNode): PyClassNode | undefined {
    if (!element.id) { return undefined; }
    return this._parentMap.get(element.id);
  }

  async getChildren(element?: PyClassNode): Promise<PyClassNode[]> {
    if (!element) {
      this.rootNodes = await this.buildTree();
      return this.rootNodes;
    }
    return element.children;
  }

  // ---------------------------------------------------------------------------
  // Drag and Drop
  // ---------------------------------------------------------------------------

  handleDrag(
    source: readonly PyClassNode[],
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken
  ): void {
    // Only top-level items (not methods / member variables inside a class) may be dragged.
    const movable = source.filter(
      n =>
        n.id !== undefined &&
        (n.nodeType === 'folder' ||
          n.nodeType === 'class' ||
          n.nodeType === 'function' ||
          n.nodeType === 'global')
    );
    if (movable.length === 0) { return; }

    // Store node IDs as a plain JSON string.  Plain strings always survive the
    // DataTransfer serialization that VS Code performs between the drag-start
    // (handleDrag) and drop (handleDrop) phases — unlike raw object references.
    const ids = movable.map(n => n.id!);
    dataTransfer.set(DRAG_MIME, new vscode.DataTransferItem(JSON.stringify(ids)));
  }

  async handleDrop(
    target: PyClassNode | undefined,
    dataTransfer: vscode.DataTransfer,
    _token: vscode.CancellationToken
  ): Promise<void> {
    // Retrieve the node IDs we stored in handleDrag.
    const dragItem = dataTransfer.get(DRAG_MIME);
    if (!dragItem) { return; }

    let ids: string[] = [];
    const raw = dragItem.value;
    if (typeof raw === 'string') {
      try { ids = JSON.parse(raw) as string[]; } catch { return; }
    } else if (Array.isArray(raw)) {
      // Value survived as a live array — extract the id strings.
      ids = (raw as Array<unknown>)
        .map(v => (typeof v === 'string' ? v : (v as PyClassNode)?.id))
        .filter((v): v is string => typeof v === 'string');
    }
    if (ids.length === 0) { return; }

    // Look up the actual PyClassNode instances from our ID map.
    const isMovable = (n: PyClassNode) =>
      n.nodeType === 'folder' ||
      n.nodeType === 'class' ||
      n.nodeType === 'function' ||
      n.nodeType === 'global';

    const droppedNodes = ids
      .map(id => this._nodeById.get(id))
      .filter((n): n is PyClassNode => n !== undefined && isMovable(n));

    if (droppedNodes.length === 0) { return; }

    // Determine target folder ID (null → root / unassigned)
    let targetFolderId: string | null = null;
    if (target) {
      if (target.nodeType === 'folder') {
        targetFolderId = target.folderId;
      } else if (target.symbolKey !== undefined) {
        // Drop onto a symbol → place alongside it (same folder or root)
        targetFolderId = this.clwStore.getAssignment(target.symbolKey) ?? null;
      }
    }

    let changed = false;
    for (const node of droppedNodes) {
      if (node.nodeType === 'folder' && node.folderId !== null) {
        if (node.folderId === targetFolderId) { continue; }
        if (targetFolderId && this.isFolderDescendant(targetFolderId, node.folderId)) {
          vscode.window.showInformationMessage(
            `Cannot move folder "${node.label as string}" into one of its own sub-folders.`
          );
          continue;
        }
        this.clwStore.moveFolderTo(node.folderId, targetFolderId);
        changed = true;
      } else if (node.symbolKey !== undefined) {
        if (targetFolderId !== null) {
          this.clwStore.assignToFolder(node.symbolKey, targetFolderId);
        } else {
          this.clwStore.removeFromFolder(node.symbolKey);
        }
        changed = true;
      }
    }

    if (changed) { this.refresh(); }
  }

  /** Returns true if `folderId` is a descendant of `ancestorId` (max 100 levels deep). */
  private isFolderDescendant(folderId: string, ancestorId: string, depth = 0): boolean {
    if (depth > 100) { return false; } // guard against corrupt cycles
    const folder = this.clwStore.getFolderById(folderId);
    if (!folder || folder.parentId === null) { return false; }
    if (folder.parentId === ancestorId) { return true; }
    return this.isFolderDescendant(folder.parentId, ancestorId, depth + 1);
  }

  // ---------------------------------------------------------------------------
  // Build the full tree
  // ---------------------------------------------------------------------------

  private async buildTree(): Promise<PyClassNode[]> {
    const config = vscode.workspace.getConfiguration('pyclasswizard');
    const excludePatterns: string[] = config.get('excludePatterns') ?? [];
    const showMethods: boolean = config.get('showMethods') ?? true;
    const showGlobals: boolean = config.get('showGlobalVariables') ?? true;

    const excludeGlob = `{${excludePatterns.join(',')}}`;

    const pyFiles = await vscode.workspace.findFiles(
      '**/*.py',
      excludePatterns.length ? excludeGlob : undefined
    );
    pyFiles.sort((a, b) => a.fsPath.localeCompare(b.fsPath));

    // Collect raw symbol data from all files
    const allClassData: Array<{ sym: PySymbol; filePath: string }> = [];
    const allFunctionData: Array<{ sym: PySymbol; filePath: string }> = [];
    const allVarData: Array<{ sym: PySymbol; filePath: string }> = [];

    for (const fileUri of pyFiles) {
      try {
        const source = fs.readFileSync(fileUri.fsPath, 'utf8');
        const symbols = parsePythonSource(source, fileUri.fsPath, showMethods, showGlobals);

        if (symbols.length === 0) { continue; }

        const fileClasses = symbols.filter((s) => s.kind === 'class');
        const fileNonClasses = symbols.filter((s) => s.kind !== 'class');

        for (const sym of fileClasses) {
          allClassData.push({ sym, filePath: fileUri.fsPath });
        }

        if (fileClasses.length === 0) {
          for (const sym of fileNonClasses) {
            if (sym.kind === 'function') {
              allFunctionData.push({ sym, filePath: fileUri.fsPath });
            } else {
              allVarData.push({ sym, filePath: fileUri.fsPath });
            }
          }
        }
      } catch (_err) {
        // Skip files that cannot be read
      }
    }

    // Sort each group alphabetically
    allClassData.sort((a, b) => a.sym.name.localeCompare(b.sym.name));
    allFunctionData.sort((a, b) => a.sym.name.localeCompare(b.sym.name));
    allVarData.sort((a, b) => a.sym.name.localeCompare(b.sym.name));

    // Duplicate name detection helpers
    const countNames = (data: Array<{ sym: PySymbol }>): Map<string, number> => {
      const counts = new Map<string, number>();
      for (const { sym } of data) {
        counts.set(sym.name, (counts.get(sym.name) ?? 0) + 1);
      }
      return counts;
    };

    const classCounts = countNames(allClassData);
    const functionCounts = countNames(allFunctionData);
    const varCounts = countNames(allVarData);

    const makeLabel = (
      name: string,
      filePath: string,
      seen: Map<string, number>,
      counts: Map<string, number>
    ): string => {
      const seenCount = seen.get(name) ?? 0;
      seen.set(name, seenCount + 1);
      return seenCount > 0 && (counts.get(name) ?? 0) > 1
        ? `${name} (${path.basename(filePath)})`
        : name;
    };

    const seenClassNames = new Map<string, number>();
    const seenFunctionNames = new Map<string, number>();
    const seenVarNames = new Map<string, number>();

    // Build class nodes
    const classNodes: PyClassNode[] = allClassData.map(({ sym, filePath }) => {
      const key = makeSymbolKey(filePath, sym.kind, sym.name);
      const label = makeLabel(sym.name, filePath, seenClassNames, classCounts);
      const childNodes = this.symbolsToNodes(sym.children, filePath);
      const collapsible =
        childNodes.length > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None;
      const node = new PyClassNode(sym, 'class', label, filePath, childNodes, collapsible, sym.detail);
      node.symbolKey = key;
      node.id = `sym::${key}`;
      return node;
    });

    // Build global function nodes
    const functionNodes: PyClassNode[] = allFunctionData.map(({ sym, filePath }) => {
      const key = makeSymbolKey(filePath, sym.kind, sym.name);
      const label = makeLabel(sym.name, filePath, seenFunctionNames, functionCounts);
      const node = new PyClassNode(
        sym, 'function', label, filePath, [], vscode.TreeItemCollapsibleState.None, sym.detail
      );
      node.symbolKey = key;
      node.id = `sym::${key}`;
      return node;
    });

    // Build global variable nodes
    const varNodes: PyClassNode[] = allVarData.map(({ sym, filePath }) => {
      const key = makeSymbolKey(filePath, sym.kind, sym.name);
      const label = makeLabel(sym.name, filePath, seenVarNames, varCounts);
      const node = new PyClassNode(
        sym, 'global', label, filePath, [], vscode.TreeItemCollapsibleState.None, sym.detail
      );
      node.symbolKey = key;
      node.id = `sym::${key}`;
      return node;
    });

    // Map from symbolKey → node for quick folder lookup
    const symbolNodeMap = new Map<string, PyClassNode>();
    for (const n of [...classNodes, ...functionNodes, ...varNodes]) {
      if (n.symbolKey) { symbolNodeMap.set(n.symbolKey, n); }
    }

    // Collect all keys that have a folder assignment
    const allFolderData = this.clwStore.getFolders();
    const allAssignedKeys = new Set<string>();
    for (const folder of allFolderData) {
      for (const key of this.clwStore.getSymbolsInFolder(folder.id)) {
        allAssignedKeys.add(key);
      }
    }

    // Build folder nodes recursively (folders first, then symbols, each A-Z)
    const buildFolderNode = (folder: ClwFolder): PyClassNode => {
      const symbolKeys = this.clwStore.getSymbolsInFolder(folder.id);
      const symbolChildren = symbolKeys
        .map(k => symbolNodeMap.get(k))
        .filter((n): n is PyClassNode => n !== undefined);

      symbolChildren.sort((a, b) => {
        const rank: Record<string, number> = { class: 0, function: 1, global: 2 };
        const ra = rank[a.nodeType] ?? 3;
        const rb = rank[b.nodeType] ?? 3;
        if (ra !== rb) { return ra - rb; }
        return (a.label as string).localeCompare(b.label as string);
      });

      const childFolders = allFolderData
        .filter(f => f.parentId === folder.id)
        .map(buildFolderNode)
        .sort((a, b) => (a.label as string).localeCompare(b.label as string));

      const children = [...childFolders, ...symbolChildren];
      const collapsible =
        children.length > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None;

      const node = new PyClassNode(null, 'folder', folder.name, '', children, collapsible);
      node.folderId = folder.id;
      node.id = `folder::${folder.id}`;
      return node;
    };

    const topFolderNodes = allFolderData
      .filter(f => f.parentId === null)
      .map(buildFolderNode)
      .sort((a, b) => (a.label as string).localeCompare(b.label as string));

    // Unassigned symbol nodes (not placed in any folder)
    const unassignedClasses = classNodes.filter(n => !allAssignedKeys.has(n.symbolKey ?? ''));
    const unassignedFunctions = functionNodes.filter(n => !allAssignedKeys.has(n.symbolKey ?? ''));
    const unassignedVars = varNodes.filter(n => !allAssignedKeys.has(n.symbolKey ?? ''));

    // Order: folders (A-Z) → classes (A-Z) → functions (A-Z) → globals (A-Z)
    const result = [...topFolderNodes, ...unassignedClasses, ...unassignedFunctions, ...unassignedVars];

    // Rebuild node maps: _parentMap (for getParent) and _nodeById (for DnD).
    this._parentMap.clear();
    this._nodeById.clear();
    this.registerNodes(result, undefined);
    return result;
  }

  private symbolsToNodes(symbols: PySymbol[], filePath: string): PyClassNode[] {
    // Sort: methods first (A→Z), then variables/globals (A→Z)
    const sorted = [...symbols].sort((a, b) => {
      const rankA = a.kind === 'method' ? 0 : 1;
      const rankB = b.kind === 'method' ? 0 : 1;
      if (rankA !== rankB) { return rankA - rankB; }
      return a.name.localeCompare(b.name);
    });

    return sorted.map((sym) => {
      const childNodes = this.symbolsToNodes(sym.children, filePath);
      const collapsible =
        childNodes.length > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None;

      return new PyClassNode(
        sym,
        sym.kind === 'global' ? 'global' : sym.kind,
        sym.name,
        filePath,
        childNodes,
        collapsible,
        sym.detail,
      );
    });
  }

  // ---------------------------------------------------------------------------
  // Node maps — required for drag-and-drop (getParent + nodeById)
  // ---------------------------------------------------------------------------

  /**
   * Recursively registers every node into:
   *  - _parentMap: node.id → parent (for getParent())
   *  - _nodeById:  node.id → node   (for handleDrop() ID-based lookup)
   * Root-level nodes are absent from _parentMap; getParent() correctly
   * returns undefined for them (Map.get returns undefined for missing keys).
   */
  private registerNodes(nodes: PyClassNode[], parent: PyClassNode | undefined): void {
    for (const node of nodes) {
      if (node.id) {
        if (parent !== undefined) {
          this._parentMap.set(node.id, parent);
        }
        this._nodeById.set(node.id, node);
      }
      if (node.children.length > 0) {
        this.registerNodes(node.children, node);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Reveal helper (used by goToDefinition)
  // ---------------------------------------------------------------------------

  findNodeForSymbol(filePath: string, line: number): PyClassNode | undefined {
    const search = (nodes: PyClassNode[]): PyClassNode | undefined => {
      for (const n of nodes) {
        if (n.symbol && n.filePath === filePath && n.symbol.line === line) {
          return n;
        }
        const found = search(n.children);
        if (found) { return found; }
      }
      return undefined;
    };
    return search(this.rootNodes);
  }
}
