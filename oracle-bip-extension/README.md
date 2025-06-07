# Oracle BIP SQL Runner VS Code Extension

This extension allows you to store connections to Oracle ERP Cloud BIP reports and run SQL queries against them. SQL is encoded in Base64 and sent to the BIP service. Results are returned as CSV and displayed in a paginated table.

## Features
* Manage connections (add/edit/delete)
* SQL editor with highlighting
* Validation for SELECT statements
* Results shown in a webview with pagination

## Usage
1. Open the command palette and run **Manage BIP Connections** to create a connection.
2. Run **Run SQL on BIP**. Choose a connection and enter your SQL in the new editor tab. Save the document to execute.
3. Results appear in a side panel.

**Note:** Actual network requests require a reachable Oracle ERP Cloud instance and proper credentials. The extension sends a POST request containing `{ sql: "<base64 SQL>" }` to the provided URL using basic authentication.
