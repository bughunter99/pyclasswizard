# PyClassWizard

VS Code extension that provides a Visual Studio 6.0-style **ClassWizard** outline for Python projects.

## Features

- **Scans all `.py` files** in the workspace, including subfolders.
- **Tree view** in the Explorer sidebar showing:
  - 📄 Source files
  - 🔷 Classes (with optional base-class hint)
  - 🔧 Class methods
  - 🔶 Instance / class-level member variables
  - 🔸 Module-level (global) variables
- **Double-click** any symbol to jump to its definition.
- **Auto-refreshes** when Python files are created, changed, or deleted.
- Configurable via `pyclasswizard.*` settings.

## Installation

### From `.vsix`

1. Open VS Code.
2. Open the Command Palette (`Ctrl+Shift+P`) → **Extensions: Install from VSIX…**
3. Select `pyclasswizard-0.1.0.vsix`.

### Building from source

```bash
npm install
npm run package   # produces pyclasswizard-0.1.0.vsix
```

## Settings

| Setting | Default | Description |
|---|---|---|
| `pyclasswizard.showMethods` | `true` | Show class methods in the outline. |
| `pyclasswizard.showGlobalVariables` | `true` | Show module-level variables. |
| `pyclasswizard.excludePatterns` | `["**/__pycache__/**", ...]` | Glob patterns to exclude from scanning. |

## Commands

| Command | Description |
|---|---|
| `PyClassWizard: Refresh` | Re-scan all Python files. |
| `PyClassWizard: Collapse All` | Collapse the entire tree. |

## Changelog

| Date (UTC) | Change |
|---|---|
| 2026-04-13T09:57:40.784Z | Fix drag-and-drop: add required `getParent()`, fix `TREE_MIME` case |
| 2026-04-13T10:11:34.394Z | Fix drag-and-drop: replace `_pendingDrag` with ID-based `DataTransfer` + `_nodeById` map to survive VS Code's DataTransfer serialization |
