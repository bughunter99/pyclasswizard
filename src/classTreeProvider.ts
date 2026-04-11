import * as vscode from 'vscode';
import * as fs from 'fs';
import { parsePythonSource, PySymbol } from './pythonParser';

// ---------------------------------------------------------------------------
// Tree item
// ---------------------------------------------------------------------------

export type NodeType = 'root' | 'file' | 'class' | 'method' | 'variable' | 'global' | 'function';

export class PyClassNode extends vscode.TreeItem {
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

    if (nodeType === 'file') {
      this.iconPath = new vscode.ThemeIcon('file-code');
      this.description = '';
      this.tooltip = filePath;
      this.contextValue = 'pyFile';
    } else if (nodeType === 'class') {
      this.iconPath = new vscode.ThemeIcon('symbol-class');
      this.description = detail ?? '';
      this.tooltip = `class ${label}${detail ? ' ' + detail : ''}`;
      this.contextValue = 'pyClass';
    } else if (nodeType === 'method') {
      this.iconPath = new vscode.ThemeIcon('symbol-method');
      this.description = '';
      this.tooltip = `def ${label}(...)`;
      this.contextValue = 'pyMethod';
    } else if (nodeType === 'variable') {
      this.iconPath = new vscode.ThemeIcon('symbol-field');
      this.description = detail ?? '';
      this.tooltip = detail ? `${label}: ${detail}` : label;
      this.contextValue = 'pyVariable';
    } else if (nodeType === 'global') {
      this.iconPath = new vscode.ThemeIcon('symbol-variable');
      this.description = detail ?? '';
      this.tooltip = detail ? `${label}: ${detail}` : label;
      this.contextValue = 'pyGlobal';
    } else if (nodeType === 'function') {
      this.iconPath = new vscode.ThemeIcon('symbol-function');
      this.description = '';
      this.tooltip = `def ${label}(...)`;
      this.contextValue = 'pyFunction';
    }

    // Attach command so every click (including double-click detection) is captured
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
// TreeDataProvider
// ---------------------------------------------------------------------------

export class PyClassTreeProvider implements vscode.TreeDataProvider<PyClassNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<PyClassNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private rootNodes: PyClassNode[] = [];
  private fileWatcher: vscode.FileSystemWatcher | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {
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

  async getChildren(element?: PyClassNode): Promise<PyClassNode[]> {
    if (!element) {
      // Root: scan workspace for Python files
      this.rootNodes = await this.buildTree();
      return this.rootNodes;
    }
    return element.children;
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

    const pyFiles = await vscode.workspace.findFiles('**/*.py', excludePatterns.length ? excludeGlob : undefined);
    pyFiles.sort((a, b) => a.fsPath.localeCompare(b.fsPath));

    // Class nodes come first; globals from classless files are appended after
    const classNodes: PyClassNode[] = [];
    const globalNodes: PyClassNode[] = [];

    for (const fileUri of pyFiles) {
      try {
        const source = fs.readFileSync(fileUri.fsPath, 'utf8');
        const symbols = parsePythonSource(source, fileUri.fsPath, showMethods, showGlobals);

        if (symbols.length === 0) { continue; }

        const fileClasses = symbols.filter((s) => s.kind === 'class');
        const fileNonClasses = symbols.filter((s) => s.kind !== 'class');

        // Each class becomes a root node directly (no file wrapper)
        for (const sym of fileClasses) {
          const childNodes = this.symbolsToNodes(sym.children, fileUri.fsPath);
          const collapsible = childNodes.length > 0
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None;
          classNodes.push(new PyClassNode(sym, 'class', sym.name, fileUri.fsPath, childNodes, collapsible, sym.detail));
        }

        // Files with no classes: expose their global functions/variables at root
        if (fileClasses.length === 0) {
          for (const sym of fileNonClasses) {
            globalNodes.push(new PyClassNode(
              sym,
              sym.kind === 'global' ? 'global' : sym.kind,
              sym.name,
              fileUri.fsPath,
              [],
              vscode.TreeItemCollapsibleState.None,
              sym.detail,
            ));
          }
        }
      } catch (_err) {
        // Skip files that cannot be read
      }
    }

    return [...classNodes, ...globalNodes];
  }

  private symbolsToNodes(symbols: PySymbol[], filePath: string): PyClassNode[] {
    return symbols.map((sym) => {
      const childNodes = this.symbolsToNodes(sym.children, filePath);
      const collapsible = childNodes.length > 0
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
