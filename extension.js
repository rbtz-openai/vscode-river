// VS Code extension entry for River formatting via `alloy fmt`.
const vscode = require('vscode');
const cp = require('child_process');
const path = require('path');

/**
 * Spawn `alloy fmt` and feed the given text via stdin.
 * @param {string} text - Document content to format.
 * @param {vscode.Uri} uri - Document URI for context.
 * @param {vscode.WorkspaceConfiguration} config - Extension configuration.
 * @returns {Promise<string>} - Formatted text from stdout.
 */
function runAlloyFmt(text, uri, config) {
  return new Promise((resolve, reject) => {
    const alloyPath = config.get('alloyPath', 'alloy');
    const args = ['fmt', '-'];
    const cwd = uri && uri.fsPath ? path.dirname(uri.fsPath) : undefined;

    const child = cp.spawn(alloyPath, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => (stdout += chunk));
    child.stderr.on('data', chunk => (stderr += chunk));

    child.on('error', (err) => {
      reject(new Error(`Failed to start formatter: ${err.message}`));
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        const msg = stderr || `alloy fmt exited with code ${code}`;
        reject(new Error(msg));
      }
    });

    // Write the document to stdin and close.
    try {
      child.stdin.write(text);
      child.stdin.end();
    } catch (e) {
      reject(new Error(`Failed to write to formatter: ${e.message}`));
    }
  });
}

/**
 * Parse stderr from `alloy fmt` into a list of errors.
 * Expected shape examples:
 *   <stdin>:360:37: missing ',' in expression list
 * Multiple errors may be space- or newline-separated.
 * @param {string} stderr
 * @returns {{ line: number, col: number, message: string }[]}
 */
function parseAlloyErrors(stderr) {
  const errors = [];
  if (!stderr) return errors;
  const normalized = stderr.replace(/\s+/g, ' ').trim();
  const re = /<stdin>:(\d+):(\d+):\s*([^<]+)/g;
  let m;
  while ((m = re.exec(normalized))) {
    const line = Math.max(0, parseInt(m[1], 10) - 1);
    const col = Math.max(0, parseInt(m[2], 10) - 1);
    const message = m[3].trim();
    errors.push({ line, col, message });
  }
  return errors;
}

/**
 * Create a background validator that runs `alloy fmt` and surfaces syntax errors.
 * @param {vscode.ExtensionContext} context
 */
function setupDiagnostics(context) {
  const collection = vscode.languages.createDiagnosticCollection('river');
  context.subscriptions.push(collection);

  /** @type {Map<string, NodeJS.Timeout>} */
  const timers = new Map();

  /**
   * @param {vscode.TextDocument} document
   */
  function validate(document) {
    if (document.languageId !== 'river') {
      return;
    }
    const config = vscode.workspace.getConfiguration('river');
    const text = document.getText();

    // Spawn `alloy fmt` in background. We do not apply output; only parse errors.
    const alloyPath = config.get('alloyPath', 'alloy');
    const args = ['fmt', '-'];
    const cwd = document.uri && document.uri.fsPath ? path.dirname(document.uri.fsPath) : undefined;
    const child = cp.spawn(alloyPath, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });

    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c) => (stderr += c));

    child.on('close', (code) => {
      if (code === 0) {
        // No errors; clear diagnostics for this document.
        collection.set(document.uri, []);
        return;
      }
      const parsed = parseAlloyErrors(stderr);
      if (!parsed.length) {
        // Unknown error shape; avoid noisy popups. Clear diagnostics.
        collection.set(document.uri, []);
        return;
      }
      const diags = parsed.map(({ line, col, message }) => {
        const start = new vscode.Position(line, col);
        let end;
        try {
          const lineInfo = document.lineAt(Math.min(line, document.lineCount - 1));
          end = lineInfo.range.end;
        } catch {
          end = start;
        }
        const range = new vscode.Range(start, end);
        const d = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
        d.source = 'alloy fmt';
        return d;
      });
      collection.set(document.uri, diags);
    });

    try {
      child.stdin.write(text);
      child.stdin.end();
    } catch {
      // If we can't write to the process, clear diagnostics and bail.
      collection.set(document.uri, []);
    }
  }

  function scheduleValidate(document, delay = 300) {
    const key = document.uri.toString();
    const existing = timers.get(key);
    if (existing) clearTimeout(existing);
    const to = setTimeout(() => {
      timers.delete(key);
      validate(document);
    }, delay);
    timers.set(key, to);
  }

  // Validate currently active editor on activation.
  if (vscode.window.activeTextEditor) {
    scheduleValidate(vscode.window.activeTextEditor.document, 50);
  }

  // Keep diagnostics updated on open/change/save and editor switches.
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => scheduleValidate(doc, 50)),
    vscode.workspace.onDidChangeTextDocument((e) => scheduleValidate(e.document, 250)),
    vscode.workspace.onDidSaveTextDocument((doc) => scheduleValidate(doc, 50)),
    vscode.window.onDidChangeActiveTextEditor((ed) => {
      if (ed) scheduleValidate(ed.document, 50);
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      collection.delete(doc.uri);
      const key = doc.uri.toString();
      const t = timers.get(key);
      if (t) clearTimeout(t);
      timers.delete(key);
    })
  );
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  // Set up background diagnostics using alloy fmt stderr.
  setupDiagnostics(context);
  const provider = {
    /**
     * @param {vscode.TextDocument} document
     * @returns {Thenable<vscode.TextEdit[]>}
     */
    provideDocumentFormattingEdits(document) {
      const config = vscode.workspace.getConfiguration('river');
      const original = document.getText();
      return runAlloyFmt(original, document.uri, config)
        .then((formatted) => {
          if (formatted === original) {
            return [];
          }
          const firstLine = document.lineAt(0);
          const lastLine = document.lineAt(document.lineCount - 1);
          const fullRange = new vscode.Range(firstLine.range.start, lastLine.range.end);
          return [vscode.TextEdit.replace(fullRange, formatted)];
        })
        .catch((err) => {
          // If the error includes positional info, diagnostics will already surface it.
          // Avoid noisy popups; only show when the formatter failed to start or similar.
          const msg = String(err && err.message || '');
          const hasPositions = /<stdin>:\d+:\d+:/.test(msg);
          if (!hasPositions) {
            const hint = 'Ensure `alloy` is installed and on PATH, or set `river.alloyPath`.';
            vscode.window.showErrorMessage(`River format failed: ${msg} ${hint}`);
          }
          return [];
        });
    }
  };

  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider({ language: 'river', scheme: 'file' }, provider),
    vscode.languages.registerDocumentFormattingEditProvider({ language: 'river', scheme: 'untitled' }, provider)
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
