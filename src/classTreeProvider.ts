import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
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
      this.iconPath = new vscode.ThemeIcon('symbol-class', new vscode.ThemeColor('charts.yellow'));
      this.description = detail ?? '';
      this.tooltip = `class ${label}${detail ? ' ' + detail : ''}`;
      this.contextValue = 'pyClass';
    } else if (nodeType === 'method') {
      this.iconPath = new vscode.ThemeIcon('symbol-method', new vscode.ThemeColor('charts.purple'));
      this.description = '';
      this.tooltip = `def ${label}(...)`;
      this.contextValue = 'pyMethod';
    } else if (nodeType === 'variable') {
      this.iconPath = new vscode.ThemeIcon('symbol-field', new vscode.ThemeColor('charts.blue'));
      this.description = detail ?? '';
      this.tooltip = detail ? `${label}: ${detail}` : label;
      this.contextValue = 'pyVariable';
    } else if (nodeType === 'global') {
      this.iconPath = new vscode.ThemeIcon('symbol-variable', new vscode.ThemeColor('charts.blue'));
      this.description = detail ?? '';
      this.tooltip = detail ? `${label}: ${detail}` : label;
      this.contextValue = 'pyGlobal';
    } else if (nodeType === 'function') {
      this.iconPath = new vscode.ThemeIcon('symbol-function', new vscode.ThemeColor('charts.green'));
      this.description = '';
      this.tooltip = `def ${label}(...)`;
      this.contextValue = 'pyFunction';
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

        // Files with no classes: expose their global functions/variables at root
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

    // Count occurrences of each name within each group for duplicate detection
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

    // Build label: append (filename) for the 2nd and later occurrences of the same name
    const makeLabel = (name: string, filePath: string, seen: Map<string, number>, counts: Map<string, number>): string => {
      const seenCount = seen.get(name) ?? 0;
      seen.set(name, seenCount + 1);
      return seenCount > 0 && (counts.get(name) ?? 0) > 1
        ? `${name} (${path.basename(filePath)})`
        : name;
    };

    // Build class nodes
    const seenClassNames = new Map<string, number>();
    const classNodes: PyClassNode[] = allClassData.map(({ sym, filePath }) => {
      const label = makeLabel(sym.name, filePath, seenClassNames, classCounts);
      const childNodes = this.symbolsToNodes(sym.children, filePath);
      const collapsible = childNodes.length > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None;
      return new PyClassNode(sym, 'class', label, filePath, childNodes, collapsible, sym.detail);
    });

    // Build global function nodes
    const seenFunctionNames = new Map<string, number>();
    const functionNodes: PyClassNode[] = allFunctionData.map(({ sym, filePath }) => {
      const label = makeLabel(sym.name, filePath, seenFunctionNames, functionCounts);
      return new PyClassNode(sym, 'function', label, filePath, [], vscode.TreeItemCollapsibleState.None, sym.detail);
    });

    // Build global variable nodes
    const seenVarNames = new Map<string, number>();
    const varNodes: PyClassNode[] = allVarData.map(({ sym, filePath }) => {
      const label = makeLabel(sym.name, filePath, seenVarNames, varCounts);
      return new PyClassNode(sym, 'global', label, filePath, [], vscode.TreeItemCollapsibleState.None, sym.detail);
    });

    // Order: classes → global functions → global variables (each group sorted alphabetically)
    return [...classNodes, ...functionNodes, ...varNodes];
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
