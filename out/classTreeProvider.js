"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PyClassTreeProvider = exports.PyClassNode = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const pythonParser_1 = require("./pythonParser");
class PyClassNode extends vscode.TreeItem {
    constructor(symbol, nodeType, label, filePath, children, collapsibleState, detail) {
        super(label, collapsibleState);
        this.symbol = symbol;
        this.nodeType = nodeType;
        this.label = label;
        this.filePath = filePath;
        this.children = children;
        if (nodeType === 'file') {
            this.iconPath = new vscode.ThemeIcon('file-code');
            this.description = '';
            this.tooltip = filePath;
            this.contextValue = 'pyFile';
        }
        else if (nodeType === 'class') {
            this.iconPath = new vscode.ThemeIcon('symbol-class');
            this.description = detail ?? '';
            this.tooltip = `class ${label}${detail ? ' ' + detail : ''}`;
            this.contextValue = 'pyClass';
        }
        else if (nodeType === 'method') {
            this.iconPath = new vscode.ThemeIcon('symbol-method');
            this.description = '';
            this.tooltip = `def ${label}(...)`;
            this.contextValue = 'pyMethod';
        }
        else if (nodeType === 'variable') {
            this.iconPath = new vscode.ThemeIcon('symbol-field');
            this.description = detail ?? '';
            this.tooltip = detail ? `${label}: ${detail}` : label;
            this.contextValue = 'pyVariable';
        }
        else if (nodeType === 'global') {
            this.iconPath = new vscode.ThemeIcon('symbol-variable');
            this.description = detail ?? '';
            this.tooltip = detail ? `${label}: ${detail}` : label;
            this.contextValue = 'pyGlobal';
        }
        // Attach go-to command for navigable items
        if (symbol && nodeType !== 'file') {
            this.command = {
                command: 'pyclasswizard.goToDefinition',
                title: 'Go to Definition',
                arguments: [this],
            };
        }
    }
}
exports.PyClassNode = PyClassNode;
// ---------------------------------------------------------------------------
// TreeDataProvider
// ---------------------------------------------------------------------------
class PyClassTreeProvider {
    constructor(context) {
        this.context = context;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.rootNodes = [];
        this.setupFileWatcher();
    }
    setupFileWatcher() {
        this.fileWatcher?.dispose();
        this.fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.py');
        this.fileWatcher.onDidChange(() => this.refresh());
        this.fileWatcher.onDidCreate(() => this.refresh());
        this.fileWatcher.onDidDelete(() => this.refresh());
    }
    refresh() {
        this.rootNodes = [];
        this._onDidChangeTreeData.fire();
    }
    dispose() {
        this.fileWatcher?.dispose();
    }
    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
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
    async buildTree() {
        const config = vscode.workspace.getConfiguration('pyclasswizard');
        const excludePatterns = config.get('excludePatterns') ?? [];
        const showMethods = config.get('showMethods') ?? true;
        const showGlobals = config.get('showGlobalVariables') ?? true;
        const excludeGlob = `{${excludePatterns.join(',')}}`;
        const pyFiles = await vscode.workspace.findFiles('**/*.py', excludePatterns.length ? excludeGlob : undefined);
        pyFiles.sort((a, b) => a.fsPath.localeCompare(b.fsPath));
        const fileNodes = [];
        for (const fileUri of pyFiles) {
            try {
                const source = fs.readFileSync(fileUri.fsPath, 'utf8');
                const symbols = (0, pythonParser_1.parsePythonSource)(source, fileUri.fsPath, showMethods, showGlobals);
                if (symbols.length === 0) {
                    continue;
                }
                const childNodes = this.symbolsToNodes(symbols, fileUri.fsPath);
                const relPath = vscode.workspace.asRelativePath(fileUri);
                const fileNode = new PyClassNode(null, 'file', path.basename(fileUri.fsPath), fileUri.fsPath, childNodes, vscode.TreeItemCollapsibleState.Expanded);
                fileNode.description = path.dirname(relPath) === '.' ? '' : path.dirname(relPath);
                fileNode.tooltip = relPath;
                fileNodes.push(fileNode);
            }
            catch (_err) {
                // Skip files that cannot be read
            }
        }
        return fileNodes;
    }
    symbolsToNodes(symbols, filePath) {
        return symbols.map((sym) => {
            const childNodes = this.symbolsToNodes(sym.children, filePath);
            const collapsible = childNodes.length > 0
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None;
            return new PyClassNode(sym, sym.kind === 'global' ? 'global' : sym.kind, sym.name, filePath, childNodes, collapsible, sym.detail);
        });
    }
    // ---------------------------------------------------------------------------
    // Reveal helper (used by goToDefinition)
    // ---------------------------------------------------------------------------
    findNodeForSymbol(filePath, line) {
        const search = (nodes) => {
            for (const n of nodes) {
                if (n.symbol && n.filePath === filePath && n.symbol.line === line) {
                    return n;
                }
                const found = search(n.children);
                if (found) {
                    return found;
                }
            }
            return undefined;
        };
        return search(this.rootNodes);
    }
}
exports.PyClassTreeProvider = PyClassTreeProvider;
//# sourceMappingURL=classTreeProvider.js.map