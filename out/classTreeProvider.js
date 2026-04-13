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
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
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
            this.iconPath = new vscode.ThemeIcon('symbol-class', new vscode.ThemeColor('charts.yellow'));
            this.description = detail ?? '';
            this.tooltip = `class ${label}${detail ? ' ' + detail : ''}`;
            this.contextValue = 'pyClass';
        }
        else if (nodeType === 'method') {
            this.iconPath = new vscode.ThemeIcon('symbol-method', new vscode.ThemeColor('charts.purple'));
            this.description = '';
            this.tooltip = `def ${label}(...)`;
            this.contextValue = 'pyMethod';
        }
        else if (nodeType === 'variable') {
            this.iconPath = new vscode.ThemeIcon('symbol-field', new vscode.ThemeColor('charts.blue'));
            this.description = detail ?? '';
            this.tooltip = detail ? `${label}: ${detail}` : label;
            this.contextValue = 'pyVariable';
        }
        else if (nodeType === 'global') {
            this.iconPath = new vscode.ThemeIcon('symbol-variable', new vscode.ThemeColor('charts.blue'));
            this.description = detail ?? '';
            this.tooltip = detail ? `${label}: ${detail}` : label;
            this.contextValue = 'pyGlobal';
        }
        else if (nodeType === 'function') {
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
        // Collect raw symbol data from all files
        const allClassData = [];
        const allFunctionData = [];
        const allVarData = [];
        for (const fileUri of pyFiles) {
            try {
                const source = fs.readFileSync(fileUri.fsPath, 'utf8');
                const symbols = (0, pythonParser_1.parsePythonSource)(source, fileUri.fsPath, showMethods, showGlobals);
                if (symbols.length === 0) {
                    continue;
                }
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
                        }
                        else {
                            allVarData.push({ sym, filePath: fileUri.fsPath });
                        }
                    }
                }
            }
            catch (_err) {
                // Skip files that cannot be read
            }
        }
        // Sort each group alphabetically
        allClassData.sort((a, b) => a.sym.name.localeCompare(b.sym.name));
        allFunctionData.sort((a, b) => a.sym.name.localeCompare(b.sym.name));
        allVarData.sort((a, b) => a.sym.name.localeCompare(b.sym.name));
        // Count occurrences of each name within each group for duplicate detection
        const countNames = (data) => {
            const counts = new Map();
            for (const { sym } of data) {
                counts.set(sym.name, (counts.get(sym.name) ?? 0) + 1);
            }
            return counts;
        };
        const classCounts = countNames(allClassData);
        const functionCounts = countNames(allFunctionData);
        const varCounts = countNames(allVarData);
        // Build label: append (filename) for the 2nd and later occurrences of the same name
        const makeLabel = (name, filePath, seen, counts) => {
            const seenCount = seen.get(name) ?? 0;
            seen.set(name, seenCount + 1);
            return seenCount > 0 && (counts.get(name) ?? 0) > 1
                ? `${name} (${path.basename(filePath)})`
                : name;
        };
        // Build class nodes
        const seenClassNames = new Map();
        const classNodes = allClassData.map(({ sym, filePath }) => {
            const label = makeLabel(sym.name, filePath, seenClassNames, classCounts);
            const childNodes = this.symbolsToNodes(sym.children, filePath);
            const collapsible = childNodes.length > 0
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None;
            return new PyClassNode(sym, 'class', label, filePath, childNodes, collapsible, sym.detail);
        });
        // Build global function nodes
        const seenFunctionNames = new Map();
        const functionNodes = allFunctionData.map(({ sym, filePath }) => {
            const label = makeLabel(sym.name, filePath, seenFunctionNames, functionCounts);
            return new PyClassNode(sym, 'function', label, filePath, [], vscode.TreeItemCollapsibleState.None, sym.detail);
        });
        // Build global variable nodes
        const seenVarNames = new Map();
        const varNodes = allVarData.map(({ sym, filePath }) => {
            const label = makeLabel(sym.name, filePath, seenVarNames, varCounts);
            return new PyClassNode(sym, 'global', label, filePath, [], vscode.TreeItemCollapsibleState.None, sym.detail);
        });
        // Order: classes → global functions → global variables (each group sorted alphabetically)
        return [...classNodes, ...functionNodes, ...varNodes];
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