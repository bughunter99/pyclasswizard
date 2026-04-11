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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const classTreeProvider_1 = require("./classTreeProvider");
function activate(context) {
    const provider = new classTreeProvider_1.PyClassTreeProvider(context);
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
    const goToDefinitionCmd = vscode.commands.registerCommand('pyclasswizard.goToDefinition', async (node) => {
        // node may come from a command palette invocation (no arg) or tree click
        if (!node || !node.symbol) {
            return;
        }
        const uri = vscode.Uri.file(node.filePath);
        const position = new vscode.Position(node.symbol.line, node.symbol.column);
        const range = new vscode.Range(position, position);
        const editor = await vscode.window.showTextDocument(uri, {
            selection: range,
            preserveFocus: false,
        });
        editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    });
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
    context.subscriptions.push(treeView, provider, refreshCmd, collapseAllCmd, goToDefinitionCmd, configChangeListener, workspaceFolderListener);
}
function deactivate() {
    // Nothing to clean up beyond subscriptions
}
//# sourceMappingURL=extension.js.map