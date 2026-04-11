"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parsePythonSource = parsePythonSource;
// ---------------------------------------------------------------------------
// Tokenizer helpers
// ---------------------------------------------------------------------------
/** Remove single- and multi-line strings and comments from source so that
 *  regex patterns do not accidentally match inside them. */
function stripStringsAndComments(source) {
    // Replace triple-quoted strings first (both ''' and """)
    let result = source
        .replace(/"""[\s\S]*?"""/g, (m) => ' '.repeat(m.length))
        .replace(/'''[\s\S]*?'''/g, (m) => ' '.repeat(m.length))
        // Then single-line strings (handles escaped quotes)
        .replace(/"(?:[^"\\]|\\.)*"/g, (m) => ' '.repeat(m.length))
        .replace(/'(?:[^'\\]|\\.)*'/g, (m) => ' '.repeat(m.length))
        // Comments
        .replace(/#[^\n]*/g, (m) => ' '.repeat(m.length));
    return result;
}
/** Return the 0-based line number for a character offset inside `source`. */
function lineOf(source, offset) {
    let line = 0;
    for (let i = 0; i < offset; i++) {
        if (source[i] === '\n') {
            line++;
        }
    }
    return line;
}
/** Return the 0-based column number for a character offset inside `source`. */
function columnOf(source, offset) {
    let col = 0;
    for (let i = offset - 1; i >= 0; i--) {
        if (source[i] === '\n') {
            break;
        }
        col++;
    }
    return col;
}
// ---------------------------------------------------------------------------
// Class body parsing
// ---------------------------------------------------------------------------
/**
 * Given the full source and the starting offset just after the class header
 * colon, collect all member variables and method definitions that belong to
 * the class (respecting indentation).
 */
function parseClassBody(original, stripped, bodyStart, classIndent, filePath, showMethods) {
    const children = [];
    const seenMembers = new Set();
    const lines = original.split('\n');
    // Determine the class body indent: first non-empty line after bodyStart
    let bodyIndent = -1;
    const bodyLines = stripped.slice(bodyStart).split('\n');
    let currentOffset = bodyStart;
    for (let li = 0; li < bodyLines.length; li++) {
        const rawLine = bodyLines[li];
        const trimmed = rawLine.trim();
        if (li > 0) {
            // Check if we have returned to an indent <= classIndent (end of class)
            if (trimmed.length > 0) {
                const indent = rawLine.length - rawLine.trimStart().length;
                if (indent <= classIndent) {
                    break;
                }
                if (bodyIndent === -1) {
                    bodyIndent = indent;
                }
            }
        }
        // --- Method definitions ---
        if (showMethods) {
            const methodMatch = rawLine.match(/^(\s*)def\s+(\w+)\s*\(/);
            if (methodMatch) {
                const indent = methodMatch[1].length;
                if (bodyIndent === -1 && trimmed.length > 0) {
                    bodyIndent = indent;
                }
                if (bodyIndent !== -1 && indent === bodyIndent) {
                    const methodName = methodMatch[2];
                    const absOffset = currentOffset + methodMatch.index;
                    children.push({
                        name: methodName,
                        kind: 'method',
                        line: lineOf(original, absOffset),
                        column: columnOf(original, absOffset),
                        filePath,
                        children: [],
                    });
                }
            }
        }
        // --- self.xxx = ... (instance variables) ---
        const selfVarRegex = /\bself\.([A-Za-z_]\w*)\s*(?::[^=\n]+)?\s*=/g;
        let svMatch;
        while ((svMatch = selfVarRegex.exec(rawLine)) !== null) {
            const varName = svMatch[1];
            if (!seenMembers.has(varName)) {
                seenMembers.add(varName);
                const absOffset = currentOffset + svMatch.index;
                // Extract optional type hint or default snippet
                const detail = extractDetail(lines[lineOf(original, currentOffset + svMatch.index)], varName, 'self');
                children.push({
                    name: varName,
                    kind: 'variable',
                    line: lineOf(original, absOffset),
                    column: columnOf(original, absOffset),
                    filePath,
                    children: [],
                    detail,
                });
            }
        }
        // --- Class-level variable assignments (indent == bodyIndent, not def/class) ---
        if (bodyIndent !== -1) {
            const classVarMatch = rawLine.match(/^(\s*)([A-Za-z_]\w*)\s*(?::[^=\n]+)?\s*=/);
            if (classVarMatch) {
                const indent = classVarMatch[1].length;
                const varName = classVarMatch[2];
                if (indent === bodyIndent &&
                    varName !== 'self' &&
                    !trimmed.startsWith('def ') &&
                    !trimmed.startsWith('class ') &&
                    !seenMembers.has(varName)) {
                    seenMembers.add(varName);
                    const absOffset = currentOffset + classVarMatch.index;
                    const detail = extractDetail(lines[lineOf(original, currentOffset + classVarMatch.index)], varName, '');
                    children.push({
                        name: varName,
                        kind: 'variable',
                        line: lineOf(original, absOffset),
                        column: columnOf(original, absOffset),
                        filePath,
                        children: [],
                        detail,
                    });
                }
            }
        }
        currentOffset += rawLine.length + 1; // +1 for the newline
    }
    return children;
}
function extractDetail(line, varName, prefix) {
    // Try to extract type hint from "name: Type = ..." or "self.name: Type = ..."
    const fullName = prefix ? `${prefix}\\.${varName}` : varName;
    const typeHintMatch = line.match(new RegExp(`${fullName}\\s*:\\s*([^=\\n]+?)\\s*=`));
    if (typeHintMatch) {
        return typeHintMatch[1].trim();
    }
    return undefined;
}
// ---------------------------------------------------------------------------
// Module-level parsing
// ---------------------------------------------------------------------------
function parsePythonSource(source, filePath, showMethods, showGlobals) {
    const stripped = stripStringsAndComments(source);
    const symbols = [];
    const lines = source.split('\n');
    // --- Classes ---
    const classRegex = /^([ \t]*)class\s+([A-Za-z_]\w*)\s*(?:\([^)]*\))?\s*:/gm;
    let classMatch;
    while ((classMatch = classRegex.exec(stripped)) !== null) {
        const classIndent = classMatch[1].length;
        if (classIndent !== 0) {
            continue;
        } // only top-level classes
        const className = classMatch[2];
        const classOffset = classMatch.index;
        const lineNum = lineOf(source, classOffset);
        const colNum = columnOf(source, classOffset);
        // Find end of class header line (after the colon)
        const headerEnd = stripped.indexOf('\n', classOffset) + 1;
        const children = parseClassBody(source, stripped, headerEnd, classIndent, filePath, showMethods);
        // Build base classes detail
        const baseMatch = lines[lineNum]?.match(/class\s+\w+\s*\(([^)]*)\)/);
        const detail = baseMatch ? `(${baseMatch[1].trim()})` : undefined;
        symbols.push({
            name: className,
            kind: 'class',
            line: lineNum,
            column: colNum,
            filePath,
            children,
            detail,
        });
    }
    // --- Global / module-level functions ---
    {
        const globalDefRegex = /^([ \t]*)def\s+([A-Za-z_]\w*)\s*\(/gm;
        let gdMatch;
        // Reuse class ranges to avoid matching methods inside classes
        const classRangesForFuncs = [];
        const classRe0 = /^class\s+[A-Za-z_]\w*\s*(?:\([^)]*\))?\s*:/gm;
        let cr0;
        while ((cr0 = classRe0.exec(stripped)) !== null) {
            const bodyStart = stripped.indexOf('\n', cr0.index) + 1;
            let end = stripped.length;
            const afterLines = stripped.slice(bodyStart).split('\n');
            let offset = bodyStart;
            for (const al of afterLines) {
                if (al.trim().length > 0 && !/^\s/.test(al)) {
                    end = offset;
                    break;
                }
                offset += al.length + 1;
            }
            classRangesForFuncs.push({ start: cr0.index, end });
        }
        while ((gdMatch = globalDefRegex.exec(stripped)) !== null) {
            const indent = gdMatch[1].length;
            if (indent !== 0) {
                continue;
            } // only top-level functions
            const funcName = gdMatch[2];
            const offset = gdMatch.index;
            if (classRangesForFuncs.some((r) => offset >= r.start && offset < r.end)) {
                continue;
            }
            symbols.push({
                name: funcName,
                kind: 'function',
                line: lineOf(source, offset),
                column: columnOf(source, offset),
                filePath,
                children: [],
            });
        }
    }
    // --- Global / module-level variables ---
    if (showGlobals) {
        const globalVarRegex = /^([A-Za-z_]\w*)\s*(?::[^=\n]+)?\s*=/gm;
        let gvMatch;
        const classRanges = [];
        // Build class ranges to skip variables inside classes
        const classRe2 = /^class\s+[A-Za-z_]\w*\s*(?:\([^)]*\))?\s*:/gm;
        let cr;
        while ((cr = classRe2.exec(stripped)) !== null) {
            const bodyStart = stripped.indexOf('\n', cr.index) + 1;
            // Find where this class ends (next line at indent 0 that is non-empty)
            let end = stripped.length;
            const afterLines = stripped.slice(bodyStart).split('\n');
            let offset = bodyStart;
            for (const al of afterLines) {
                if (al.trim().length > 0 && !/^\s/.test(al)) {
                    end = offset;
                    break;
                }
                offset += al.length + 1;
            }
            classRanges.push({ start: cr.index, end });
        }
        const seenGlobals = new Set();
        while ((gvMatch = globalVarRegex.exec(stripped)) !== null) {
            const varName = gvMatch[1];
            const offset = gvMatch.index;
            // Skip if inside a class or function body
            if (classRanges.some((r) => offset >= r.start && offset < r.end)) {
                continue;
            }
            // Skip function definitions, class definitions, import lines, etc.
            const lineText = lines[lineOf(source, offset)] ?? '';
            if (lineText.trimStart().startsWith('def ') ||
                lineText.trimStart().startsWith('class ') ||
                lineText.trimStart().startsWith('import ') ||
                lineText.trimStart().startsWith('from ') ||
                lineText.trimStart().startsWith('#') ||
                varName === '_') {
                continue;
            }
            if (!seenGlobals.has(varName)) {
                seenGlobals.add(varName);
                const detail = extractDetail(lineText, varName, '');
                symbols.push({
                    name: varName,
                    kind: 'global',
                    line: lineOf(source, offset),
                    column: columnOf(source, offset),
                    filePath,
                    children: [],
                    detail,
                });
            }
        }
    }
    return symbols;
}
//# sourceMappingURL=pythonParser.js.map