import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand('helloWorldExtension.helloWorld', () => {
    vscode.window.showInformationMessage('Hello World from your extension!');
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {}
