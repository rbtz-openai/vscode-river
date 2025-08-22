// VS Code extension entry for River formatting via `alloy fmt`.
const vscode = require('vscode');
const cp = require('child_process');

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
    const cwd = uri && uri.fsPath ? require('path').dirname(uri.fsPath) : undefined;

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
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
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
          const hint = 'Ensure `alloy` is installed and on PATH, or set `river.alloyPath`.';
          vscode.window.showErrorMessage(`River format failed: ${err.message} ${hint}`);
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
