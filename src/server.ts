// 'use strict';

// import {
//     IPCMessageReader,
//     IPCMessageWriter,
//     createConnection,
//     IConnection,
//     TextDocuments,
//     TextDocument,
//     Diagnostic,
//     DiagnosticSeverity,
//     InitializeResult,
//     TextDocumentPositionParams,
//     CompletionItem,
//     CompletionItemKind
// } from 'vscode-languageserver';

// console.log('Server root!!');

// // Create a connection for the server. The connection uses Node's IPC as a transport
// let connection: IConnection = createConnection(
//     new IPCMessageReader(process),
//     new IPCMessageWriter(process)
// );

// // Create a simple text document manager. The text document manager
// // supports full document sync only
// let documents: TextDocuments = new TextDocuments();
// // Make the text document manager listen on the connection
// // for open, change and close text document events
// documents.listen(connection);

// // After the server has started the client sends an initilize request. The server receives
// // in the passed params the rootPath of the workspace plus the client capabilites.
// let workspaceRoot: string;
// connection.onInitialize(
//     (params): InitializeResult => {
//         console.log('!! Server connection.onInitialize', params);
//         workspaceRoot = params.rootPath;
//         params.workspaceFolders;

//         console.log('Documents', documents.all());
//         return {
//             capabilities: {
//                 // Tell the client that the server works in FULL text document sync mode
//                 textDocumentSync: documents.syncKind,
//                 // Tell the client that the server support code complete
//                 completionProvider: {
//                     resolveProvider: true
//                 }
//             }
//         };
//     }
// );

// // The content of a text document has changed. This event is emitted
// // when the text document first opened or when its content has changed.
// documents.onDidChangeContent(change => {
//     console.log('Server documents.onDidChangeContent', change);
//     validateTextDocument(change.document);
// });

// // The settings interface describe the server relevant settings part
// interface Settings {
//     lspSample: ExampleSettings;
// }

// // These are the example settings we defined in the client's package.json
// // file
// interface ExampleSettings {
//     maxNumberOfProblems: number;
// }

// // hold the maxNumberOfProblems setting
// let maxNumberOfProblems: number;
// // The settings have changed. Is send on server activation
// // as well.
// connection.onDidChangeConfiguration(change => {
//     console.log('Server connection.onDidChangeConfiguration');
//     let settings = <Settings>change.settings;
//     // maxNumberOfProblems = settings.lspSample.maxNumberOfProblems || 100;
//     maxNumberOfProblems = 100;
//     // Revalidate any open text documents
//     documents.all().forEach(validateTextDocument);
// });

// function validateTextDocument(textDocument: TextDocument): void {
//     console.log('validateTextDocument', textDocument.uri);
//     let diagnostics: Diagnostic[] = [];
//     let lines = textDocument.getText().split(/\r?\n/g);
//     let problems = 0;
//     for (var i = 0; i < lines.length && problems < maxNumberOfProblems; i++) {
//         let line = lines[i];
//         console.log('analize line', line);
//         let index = line.indexOf('gaga');
//         if (index >= 0) {
//             console.log('GAGA!!');
//             problems++;
//             diagnostics.push({
//                 severity: DiagnosticSeverity.Warning,
//                 range: {
//                     start: { line: i, character: index },
//                     end: { line: i, character: index + 10 }
//                 },
//                 message: `${line.substr(
//                     index,
//                     10
//                 )} should be spelled TypeScript`,
//                 source: 'ex'
//             });
//         }
//     }
//     // Send the computed diagnostics to VSCode.
//     connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
// }

// connection.onDidChangeWatchedFiles(_change => {
//     console.log('Server connection.onDidChangeWatchedFiles', _change);
//     // Monitored files have change in VSCode
//     connection.console.log('We recevied an file change event');
// });

// // This handler provides the initial list of the completion items.
// connection.onCompletion(
//     (_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
//         // The pass parameter contains the position of the text document in
//         // which code complete got requested. For the example we ignore this
//         // info and always provide the same completion items.
//         return [
//             {
//                 label: 'TypeScript',
//                 kind: CompletionItemKind.Text,
//                 data: 1
//             },
//             {
//                 label: 'JavaScript',
//                 kind: CompletionItemKind.Text,
//                 data: 2
//             }
//         ];
//     }
// );

// // This handler resolve additional information for the item selected in
// // the completion list.
// connection.onCompletionResolve(
//     (item: CompletionItem): CompletionItem => {
//         if (item.data === 1) {
//             (item.detail = 'TypeScript details'),
//                 (item.documentation = 'TypeScript documentation');
//         } else if (item.data === 2) {
//             (item.detail = 'JavaScript details'),
//                 (item.documentation = 'JavaScript documentation');
//         }
//         return item;
//     }
// );

// connection.onDidOpenTextDocument(params => {
//     // A text document got opened in VSCode.
//     // params.uri uniquely identifies the document. For documents store on disk this is a file URI.
//     // params.text the initial full content of the document.
//     connection.console.log(`${params.textDocument.uri} opened.`);
//     console.log('Documents count', documents.all().length);
// });
// connection.onDidChangeTextDocument(params => {
//     // The content of a text document did change in VSCode.
//     // params.uri uniquely identifies the document.
//     // params.contentChanges describe the content changes to the document.
//     connection.console.log(
//         `${params.textDocument.uri} changed: ${JSON.stringify(
//             params.contentChanges
//         )}`
//     );
//     console.log('documents', documents.all());
//     // validateTextDocument(params.contentChanges)
// });
// connection.onDidCloseTextDocument(params => {
//     // A text document got closed in VSCode.
//     // params.uri uniquely identifies the document.
//     connection.console.log(`${params.textDocument.uri} closed.`);
// });

// // Listen on the connection
// connection.listen();
