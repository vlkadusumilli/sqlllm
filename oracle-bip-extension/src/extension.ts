import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

interface Connection {
  name: string;
  url: string;
  username: string;
  password: string;
}

class ConnectionManager {
  private context: vscode.ExtensionContext;
  private connections: Connection[] = [];
  private filePath: string;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.filePath = path.join(context.globalStorageUri.fsPath, 'connections.json');
    if (!fs.existsSync(context.globalStorageUri.fsPath)) {
      fs.mkdirSync(context.globalStorageUri.fsPath, { recursive: true });
    }
    this.load();
  }

  private load() {
    if (fs.existsSync(this.filePath)) {
      this.connections = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    }
  }

  private save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.connections, null, 2));
  }

  getConnections() {
    return this.connections;
  }

  async manage() {
    const items = [
      { label: 'Add Connection' },
      ...this.connections.map(c => ({ label: c.name, description: c.url }))
    ];
    const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Select connection to edit/delete or Add Connection' });
    if (!pick) { return; }
    if (pick.label === 'Add Connection') {
      await this.addConnection();
    } else {
      const conn = this.connections.find(c => c.name === pick.label);
      if (conn) {
        await this.editOrDelete(conn);
      }
    }
  }

  private async addConnection() {
    const name = await vscode.window.showInputBox({ prompt: 'Connection name' });
    if (!name) { return; }
    const url = await vscode.window.showInputBox({ prompt: 'BIP URL' });
    const username = await vscode.window.showInputBox({ prompt: 'Username' });
    const password = await vscode.window.showInputBox({ prompt: 'Password', password: true });
    if (url && username && password) {
      this.connections.push({ name, url, username, password });
      this.save();
    }
  }

  private async editOrDelete(conn: Connection) {
    const action = await vscode.window.showQuickPick(['Edit', 'Delete', 'Cancel'], { placeHolder: `Modify connection ${conn.name}` });
    if (!action || action === 'Cancel') { return; }
    if (action === 'Delete') {
      this.connections = this.connections.filter(c => c !== conn);
      this.save();
      return;
    }
    const url = await vscode.window.showInputBox({ prompt: 'BIP URL', value: conn.url });
    const username = await vscode.window.showInputBox({ prompt: 'Username', value: conn.username });
    const password = await vscode.window.showInputBox({ prompt: 'Password', password: true, value: conn.password });
    if (url && username && password) {
      conn.url = url;
      conn.username = username;
      conn.password = password;
      this.save();
    }
  }
}

function encodeSql(sql: string): string {
  return Buffer.from(sql, 'utf8').toString('base64');
}

async function runReport(connection: Connection, sql: string): Promise<string> {
  const base64Sql = encodeSql(sql);
  return new Promise((resolve, reject) => {
    const req = https.request(connection.url, {
      method: 'POST',
      auth: `${connection.username}:${connection.password}`,
      headers: {
        'Content-Type': 'application/json'
      }
    }, res => {
      const chunks: Buffer[] = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', err => reject(err));
    req.write(JSON.stringify({ sql: base64Sql }));
    req.end();
  });
}

function parseCsv(text: string): string[][] {
  const lines = text.trim().split(/\r?\n/);
  return lines.map(l => l.split(','));
}

function createTablePage(rows: string[][], page: number, pageSize: number): string {
  const start = page * pageSize;
  const pageRows = rows.slice(start, start + pageSize);
  const header = pageRows[0];
  const body = pageRows.slice(1);
  const tableRows = [
    `<tr>${header.map(h => `<th>${h}</th>`).join('')}</tr>`,
    ...body.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`)
  ].join('\n');
  return `
  <table border="1">
    ${tableRows}
  </table>
  <div>
    <button onclick="prev()">Prev</button>
    <span id="page">${page + 1}</span> / ${Math.ceil(rows.length / pageSize)}</span>
    <button onclick="next()">Next</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    function prev() { vscode.postMessage({ command: 'prev' }); }
    function next() { vscode.postMessage({ command: 'next' }); }
  </script>
  `;
}

export function activate(context: vscode.ExtensionContext) {
  const manager = new ConnectionManager(context);
  let rows: string[][] = [];
  let page = 0;
  const pageSize = 10;

  context.subscriptions.push(vscode.commands.registerCommand('oracleBip.manageConnections', async () => {
    await manager.manage();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('oracleBip.runQuery', async () => {
    const connections = manager.getConnections();
    if (connections.length === 0) {
      vscode.window.showErrorMessage('No connections configured');
      return;
    }
    const pick = await vscode.window.showQuickPick(connections.map(c => c.name));
    if (!pick) { return; }
    const conn = connections.find(c => c.name === pick)!;
    const doc = await vscode.workspace.openTextDocument({ language: 'sql', content: '' });
    await vscode.window.showTextDocument(doc);
    const sql = await new Promise<string | undefined>(resolve => {
      const disposable = vscode.workspace.onDidSaveTextDocument(d => {
        if (d === doc) {
          resolve(d.getText());
          disposable.dispose();
        }
      });
    });
    if (!sql) { return; }
    if (!/^\s*select/i.test(sql.trim())) {
      vscode.window.showErrorMessage('Only SELECT statements are allowed.');
      return;
    }
    try {
      const csv = await runReport(conn, sql);
      rows = parseCsv(csv);
      page = 0;
      const panel = vscode.window.createWebviewPanel('bipResult', 'BIP Results', vscode.ViewColumn.Beside, { enableScripts: true });
      panel.webview.html = createTablePage(rows, page, pageSize);
      panel.webview.onDidReceiveMessage(msg => {
        if (msg.command === 'next') { page++; }
        if (msg.command === 'prev') { page--; }
        if (page < 0) { page = 0; }
        if (page > Math.floor(rows.length / pageSize)) { page = Math.floor(rows.length / pageSize); }
        panel.webview.html = createTablePage(rows, page, pageSize);
      });
    } catch (err: any) {
      vscode.window.showErrorMessage(err.message || String(err));
    }
  }));
}

export function deactivate() {}


