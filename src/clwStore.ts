import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

// ---------------------------------------------------------------------------
// Data shapes
// ---------------------------------------------------------------------------

export interface ClwFolder {
  id: string;
  name: string;
  parentId: string | null;
}

interface ClwData {
  version: number;
  folders: ClwFolder[];
  /** symbolKey → folderId */
  assignments: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

let folderIdCounter = 0;

export class ClwStore {
  private data: ClwData = { version: 1, folders: [], assignments: {} };

  constructor() {
    this.load();
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  private getClwPath(): string | undefined {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!ws) { return undefined; }
    return path.join(ws, '.pyclasswizard.clw');
  }

  load(): void {
    const p = this.getClwPath();
    if (!p) { return; }
    try {
      if (fs.existsSync(p)) {
        const raw = fs.readFileSync(p, 'utf8');
        const parsed = JSON.parse(raw) as Partial<ClwData>;
        this.data = {
          version: parsed.version ?? 1,
          folders: parsed.folders ?? [],
          assignments: parsed.assignments ?? {},
        };
      }
    } catch {
      this.data = { version: 1, folders: [], assignments: {} };
    }
  }

  save(): void {
    const p = this.getClwPath();
    if (!p) { return; }
    try {
      fs.writeFileSync(p, JSON.stringify(this.data, null, 2), 'utf8');
    } catch { /* ignore write errors in read-only environments */ }
  }

  // ---------------------------------------------------------------------------
  // Folder CRUD
  // ---------------------------------------------------------------------------

  getFolders(): ClwFolder[] {
    return this.data.folders;
  }

  getFolderById(id: string): ClwFolder | undefined {
    return this.data.folders.find(f => f.id === id);
  }

  createFolder(name: string, parentId: string | null = null): ClwFolder {
    const id = `f_${Date.now()}_${(folderIdCounter++).toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const folder: ClwFolder = { id, name, parentId };
    this.data.folders.push(folder);
    this.save();
    return folder;
  }

  renameFolder(id: string, newName: string): void {
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
  deleteFolder(id: string): void {
    const folder = this.data.folders.find(f => f.id === id);
    const parentId = folder?.parentId ?? null;

    // Re-home symbols that live directly in this folder
    for (const key of Object.keys(this.data.assignments)) {
      if (this.data.assignments[key] === id) {
        if (parentId) {
          this.data.assignments[key] = parentId;
        } else {
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

  moveFolderTo(folderId: string, newParentId: string | null): void {
    const folder = this.data.folders.find(f => f.id === folderId);
    if (folder) {
      folder.parentId = newParentId;
      this.save();
    }
  }

  // ---------------------------------------------------------------------------
  // Symbol assignments
  // ---------------------------------------------------------------------------

  assignToFolder(symbolKey: string, folderId: string): void {
    this.data.assignments[symbolKey] = folderId;
    this.save();
  }

  removeFromFolder(symbolKey: string): void {
    delete this.data.assignments[symbolKey];
    this.save();
  }

  getAssignment(symbolKey: string): string | undefined {
    return this.data.assignments[symbolKey];
  }

  getSymbolsInFolder(folderId: string): string[] {
    return Object.entries(this.data.assignments)
      .filter(([, v]) => v === folderId)
      .map(([k]) => k);
  }
}
