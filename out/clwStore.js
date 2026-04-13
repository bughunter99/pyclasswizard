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
exports.ClwStore = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------
let folderIdCounter = 0;
class ClwStore {
    constructor() {
        this.data = { version: 1, folders: [], assignments: {} };
        this.load();
    }
    // ---------------------------------------------------------------------------
    // Persistence
    // ---------------------------------------------------------------------------
    getClwPath() {
        const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!ws) {
            return undefined;
        }
        return path.join(ws, '.pyclasswizard.clw');
    }
    load() {
        const p = this.getClwPath();
        if (!p) {
            return;
        }
        try {
            if (fs.existsSync(p)) {
                const raw = fs.readFileSync(p, 'utf8');
                const parsed = JSON.parse(raw);
                this.data = {
                    version: parsed.version ?? 1,
                    folders: parsed.folders ?? [],
                    assignments: parsed.assignments ?? {},
                };
            }
        }
        catch {
            this.data = { version: 1, folders: [], assignments: {} };
        }
    }
    save() {
        const p = this.getClwPath();
        if (!p) {
            return;
        }
        try {
            fs.writeFileSync(p, JSON.stringify(this.data, null, 2), 'utf8');
        }
        catch { /* ignore write errors in read-only environments */ }
    }
    // ---------------------------------------------------------------------------
    // Folder CRUD
    // ---------------------------------------------------------------------------
    getFolders() {
        return this.data.folders;
    }
    getFolderById(id) {
        return this.data.folders.find(f => f.id === id);
    }
    createFolder(name, parentId = null) {
        const id = `f_${Date.now()}_${(folderIdCounter++).toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        const folder = { id, name, parentId };
        this.data.folders.push(folder);
        this.save();
        return folder;
    }
    renameFolder(id, newName) {
        const folder = this.data.folders.find(f => f.id === id);
        if (folder) {
            folder.name = newName;
            this.save();
        }
    }
    /**
     * Delete a folder.  Symbols directly inside it are promoted to its parent
     * folder (or root).  Child folders are deleted recursively.
     */
    deleteFolder(id) {
        const folder = this.data.folders.find(f => f.id === id);
        const parentId = folder?.parentId ?? null;
        // Re-home symbols that live directly in this folder
        for (const key of Object.keys(this.data.assignments)) {
            if (this.data.assignments[key] === id) {
                if (parentId) {
                    this.data.assignments[key] = parentId;
                }
                else {
                    delete this.data.assignments[key];
                }
            }
        }
        // Recursively delete child folders
        const childFolders = this.data.folders.filter(f => f.parentId === id);
        for (const child of childFolders) {
            this.deleteFolder(child.id);
        }
        this.data.folders = this.data.folders.filter(f => f.id !== id);
        this.save();
    }
    moveFolderTo(folderId, newParentId) {
        const folder = this.data.folders.find(f => f.id === folderId);
        if (folder) {
            folder.parentId = newParentId;
            this.save();
        }
    }
    // ---------------------------------------------------------------------------
    // Symbol assignments
    // ---------------------------------------------------------------------------
    assignToFolder(symbolKey, folderId) {
        this.data.assignments[symbolKey] = folderId;
        this.save();
    }
    removeFromFolder(symbolKey) {
        delete this.data.assignments[symbolKey];
        this.save();
    }
    getAssignment(symbolKey) {
        return this.data.assignments[symbolKey];
    }
    getSymbolsInFolder(folderId) {
        return Object.entries(this.data.assignments)
            .filter(([, v]) => v === folderId)
            .map(([k]) => k);
    }
}
exports.ClwStore = ClwStore;
//# sourceMappingURL=clwStore.js.map