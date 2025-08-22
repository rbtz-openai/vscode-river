# vscode-river

vscode-river is a `VS Code` extension for [River](https://github.com/grafana/river).

This extension is not currently published outside of this repository. You can install
it in `VS Code` using the `.vsix` in this repository.

## Formatting & Diagnostics

This extension provides document formatting for `.river` files by shelling out to `alloy fmt`.
It also surfaces syntax errors reported by `alloy fmt` as inline editor diagnostics
while you type (based on stderr output like `<stdin>:line:col: message`).

- Requirement: Install the `alloy` CLI and ensure it is available on your `PATH`.
- Optional: Configure a custom binary path via the `river.alloyPath` setting.

Formatting works with “Format Document” and with `editor.formatOnSave`.

## building

Building a `VS Code` extension from source requires [vsce](https://github.com/microsoft/vscode-vsce).

From the root directory of this repository:

```
vsce package
```
