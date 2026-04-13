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
const DRAG_MIME = 'application/pyclasswizard-dnd';
// VS Code automatically adds this built-in MIME for same-tree drags.
// The tree-id portion MUST be fully lower-cased to match what VS Code
// generates: application/vnd.code.tree.<treeidlowercase>.
// Tree view ID = "pyclasswizard.classView"  →  lower-case = "pyclasswizard.classview"
const TREE_MIME = 'application/vnd.code.tree.pyclasswizard.classview';
/** Stable key that identifies a top-level symbol for CLW persistence. */
function makeSymbolKey(filePath, kind, name) {
    return `${filePath}::${kind}::${name}`;
}
// ---------------------------------------------------------------------------
// Tree item
// ---------------------------------------------------------------------------
class PyClassNode extends vscode.TreeItem {
    constructor(symbol, nodeType, label, filePath, children, collapsibleState, detail) {
        super(label, collapsibleState);
        this.symbol = symbol;
        this.nodeType = nodeType;
        this.label = label;
        this.filePath = filePath;
        this.children = children;
        /** Set on folder nodes: the persistent folder ID from the CLW store. */
        this.folderId = null;
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
exports.PyClassNode = PyClassNode;
// ---------------------------------------------------------------------------
// TreeDataProvider + TreeDragAndDropController
// ---------------------------------------------------------------------------
class PyClassTreeProvider {
    constructor(context, clwStore) {
        this.context = context;
        this.clwStore = clwStore;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.rootNodes = [];
        /**
         * Maps node `id` → PyClassNode for every node in the current tree.
         * Used in handleDrop to look up dragged nodes by the IDs stored in DataTransfer.
         * Rebuilt on every buildTree() call.
         */
        this._nodeById = new Map();
        /**
         * Maps each node's `id` to its parent node.
         * Root-level nodes are NOT present in this map (getParent returns undefined for them).
         * VS Code requires getParent() to be implemented for TreeDragAndDropController to work.
         */
        this._parentMap = new Map();
        // TreeDragAndDropController ------------------------------------------------
        // DRAG_MIME carries our node payload; TREE_MIME is VS Code's built-in
        // same-tree type and MUST appear in dropMimeTypes so that VS Code actually
        // triggers the drop when items from this tree are released on a target.
        this.dragMimeTypes = [DRAG_MIME];
        this.dropMimeTypes = [DRAG_MIME, TREE_MIME];
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
    /**
     * Required by VS Code for drag-and-drop to work.
     * Returns the parent of a node, or undefined for root-level nodes.
     */
    getParent(element) {
        if (!element.id) {
            return undefined;
        }
        return this._parentMap.get(element.id);
    }
    async getChildren(element) {
        if (!element) {
            this.rootNodes = await this.buildTree();
            return this.rootNodes;
        }
        return element.children;
    }
    // ---------------------------------------------------------------------------
    // Drag and Drop
    // ---------------------------------------------------------------------------
    handleDrag(source, dataTransfer, _token) {
        // Only top-level items (not methods / member variables inside a class) may be dragged.
        const movable = source.filter(n => n.id !== undefined &&
            (n.nodeType === 'folder' ||
                n.nodeType === 'class' ||
                n.nodeType === 'function' ||
                n.nodeType === 'global'));
        if (movable.length === 0) {
            return;
        }
        // Store node IDs as a plain JSON string.  Plain strings always survive the
        // DataTransfer serialization that VS Code performs between the drag-start
        // (handleDrag) and drop (handleDrop) phases — unlike raw object references.
        const ids = movable.map(n => n.id);
        dataTransfer.set(DRAG_MIME, new vscode.DataTransferItem(JSON.stringify(ids)));
    }
    async handleDrop(target, dataTransfer, _token) {
        // Retrieve the node IDs we stored in handleDrag.
        const dragItem = dataTransfer.get(DRAG_MIME);
        if (!dragItem) {
            return;
        }
        let ids = [];
        const raw = dragItem.value;
        if (typeof raw === 'string') {
            try {
                ids = JSON.parse(raw);
            }
            catch {
                return;
            }
        }
        else if (Array.isArray(raw)) {
            // Value survived as a live array — extract the id strings.
            ids = raw
                .map(v => (typeof v === 'string' ? v : v?.id))
                .filter((v) => typeof v === 'string');
        }
        if (ids.length === 0) {
            return;
        }
        // Look up the actual PyClassNode instances from our ID map.
        const isMovable = (n) => n.nodeType === 'folder' ||
            n.nodeType === 'class' ||
            n.nodeType === 'function' ||
            n.nodeType === 'global';
        const droppedNodes = ids
            .map(id => this._nodeById.get(id))
            .filter((n) => n !== undefined && isMovable(n));
        if (droppedNodes.length === 0) {
            return;
        }
        // Determine target folder ID (null → root / unassigned)
        let targetFolderId = null;
        if (target) {
            if (target.nodeType === 'folder') {
                targetFolderId = target.folderId;
            }
            else if (target.symbolKey !== undefined) {
                // Drop onto a symbol → place alongside it (same folder or root)
                targetFolderId = this.clwStore.getAssignment(target.symbolKey) ?? null;
            }
        }
        let changed = false;
        for (const node of droppedNodes) {
            if (node.nodeType === 'folder' && node.folderId !== null) {
                if (node.folderId === targetFolderId) {
                    continue;
                }
                if (targetFolderId && this.isFolderDescendant(targetFolderId, node.folderId)) {
                    vscode.window.showInformationMessage(`Cannot move folder "${node.label}" into one of its own sub-folders.`);
                    continue;
                }
                this.clwStore.moveFolderTo(node.folderId, targetFolderId);
                changed = true;
            }
            else if (node.symbolKey !== undefined) {
                if (targetFolderId !== null) {
                    this.clwStore.assignToFolder(node.symbolKey, targetFolderId);
                }
                else {
                    this.clwStore.removeFromFolder(node.symbolKey);
                }
                changed = true;
            }
        }
        if (changed) {
            this.refresh();
        }
    }
    /** Returns true if `folderId` is a descendant of `ancestorId` (max 100 levels deep). */
    isFolderDescendant(folderId, ancestorId, depth = 0) {
        if (depth > 100) {
            return false;
        } // guard against corrupt cycles
        const folder = this.clwStore.getFolderById(folderId);
        if (!folder || folder.parentId === null) {
            return false;
        }
        if (folder.parentId === ancestorId) {
            return true;
        }
        return this.isFolderDescendant(folder.parentId, ancestorId, depth + 1);
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
        // Duplicate name detection helpers
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
        const makeLabel = (name, filePath, seen, counts) => {
            const seenCount = seen.get(name) ?? 0;
            seen.set(name, seenCount + 1);
            return seenCount > 0 && (counts.get(name) ?? 0) > 1
                ? `${name} (${path.basename(filePath)})`
                : name;
        };
        const seenClassNames = new Map();
        const seenFunctionNames = new Map();
        const seenVarNames = new Map();
        // Build class nodes
        const classNodes = allClassData.map(({ sym, filePath }) => {
            const key = makeSymbolKey(filePath, sym.kind, sym.name);
            const label = makeLabel(sym.name, filePath, seenClassNames, classCounts);
            const childNodes = this.symbolsToNodes(sym.children, filePath);
            const collapsible = childNodes.length > 0
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None;
            const node = new PyClassNode(sym, 'class', label, filePath, childNodes, collapsible, sym.detail);
            node.symbolKey = key;
            node.id = `sym::${key}`;
            return node;
        });
        // Build global function nodes
        const functionNodes = allFunctionData.map(({ sym, filePath }) => {
            const key = makeSymbolKey(filePath, sym.kind, sym.name);
            const label = makeLabel(sym.name, filePath, seenFunctionNames, functionCounts);
            const node = new PyClassNode(sym, 'function', label, filePath, [], vscode.TreeItemCollapsibleState.None, sym.detail);
            node.symbolKey = key;
            node.id = `sym::${key}`;
            return node;
        });
        // Build global variable nodes
        const varNodes = allVarData.map(({ sym, filePath }) => {
            const key = makeSymbolKey(filePath, sym.kind, sym.name);
            const label = makeLabel(sym.name, filePath, seenVarNames, varCounts);
            const node = new PyClassNode(sym, 'global', label, filePath, [], vscode.TreeItemCollapsibleState.None, sym.detail);
            node.symbolKey = key;
            node.id = `sym::${key}`;
            return node;
        });
        // Map from symbolKey → node for quick folder lookup
        const symbolNodeMap = new Map();
        for (const n of [...classNodes, ...functionNodes, ...varNodes]) {
            if (n.symbolKey) {
                symbolNodeMap.set(n.symbolKey, n);
            }
        }
        // Collect all keys that have a folder assignment
        const allFolderData = this.clwStore.getFolders();
        const allAssignedKeys = new Set();
        for (const folder of allFolderData) {
            for (const key of this.clwStore.getSymbolsInFolder(folder.id)) {
                allAssignedKeys.add(key);
            }
        }
        // Build folder nodes recursively (folders first, then symbols, each A-Z)
        const buildFolderNode = (folder) => {
            const symbolKeys = this.clwStore.getSymbolsInFolder(folder.id);
            const symbolChildren = symbolKeys
                .map(k => symbolNodeMap.get(k))
                .filter((n) => n !== undefined);
            symbolChildren.sort((a, b) => {
                const rank = { class: 0, function: 1, global: 2 };
                const ra = rank[a.nodeType] ?? 3;
                const rb = rank[b.nodeType] ?? 3;
                if (ra !== rb) {
                    return ra - rb;
                }
                return a.label.localeCompare(b.label);
            });
            const childFolders = allFolderData
                .filter(f => f.parentId === folder.id)
                .map(buildFolderNode)
                .sort((a, b) => a.label.localeCompare(b.label));
            const children = [...childFolders, ...symbolChildren];
            const collapsible = children.length > 0
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
            .sort((a, b) => a.label.localeCompare(b.label));
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
    symbolsToNodes(symbols, filePath) {
        // Sort: methods first (A→Z), then variables/globals (A→Z)
        const sorted = [...symbols].sort((a, b) => {
            const rankA = a.kind === 'method' ? 0 : 1;
            const rankB = b.kind === 'method' ? 0 : 1;
            if (rankA !== rankB) {
                return rankA - rankB;
            }
            return a.name.localeCompare(b.name);
        });
        return sorted.map((sym) => {
            const childNodes = this.symbolsToNodes(sym.children, filePath);
            const collapsible = childNodes.length > 0
                ? vscode.TreeItemCollapsibleState.Collapsed
                : vscode.TreeItemCollapsibleState.None;
            return new PyClassNode(sym, sym.kind === 'global' ? 'global' : sym.kind, sym.name, filePath, childNodes, collapsible, sym.detail);
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
    registerNodes(nodes, parent) {
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