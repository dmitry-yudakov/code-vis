'use strict';
import * as vscode from 'vscode';
import * as path from 'path';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
    RequestType
} from 'vscode-languageclient';

const includeMask = '**/*.{ts,tsx,js,jsx}';
const excludeMask = '**/node_modules/**';

var childProc = require('child_process');
var opn = require('opn');
var OSX_CHROME = 'google chrome';
var execSync = require('child_process').execSync;

const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
app.use('/', express.static(path.join(__dirname, 'public')));

let server = http.createServer(app);
let wss = new WebSocket.Server({ server });

server.on('error', err => {
    console.log('server error:', err);
});

function openFile(parts) {
    vscode.workspace.findFiles(includeMask, excludeMask, 250).then(
        files => {
            const test = filename => {
                for (let pp of parts) {
                    if (filename.indexOf(pp) === -1) {
                        return false;
                    }
                }
                return true;
            };
            // console.log('files', files.map(ff => ff.path).join('\n'))
            console.log('find file matching', JSON.stringify(parts));
            let fileToOpen = files.find(file => test(file.path.toLowerCase()));
            if (fileToOpen) {
                console.log('Open matching file:', fileToOpen.path, fileToOpen);
                vscode.workspace
                    .openTextDocument(fileToOpen.fsPath) //vscode.Uri.file(fileToOpen.external))
                    .then(
                        doc => vscode.window.showTextDocument(doc),
                        err => console.log('error opening:', err)
                    );
            } else {
                vscode.window.showErrorMessage(
                    `File matching ${parts.join('|')} is not found`
                );
            }
        },
        err => {
            console.error(err);
        }
    );
}

function onCommand(command) {
    let tokens = command
        .split(' ')
        .filter(word => word)
        .map(word => word.toLowerCase());
    console.log('tokens', tokens);
    let op = tokens.shift();
    switch (op) {
        case 'open':
            if (tokens.length) openFile(tokens);
            break;
        default:
            vscode.window.showWarningMessage(
                'Could not recognize command: "' + command + '"'
            );
    }
}

const openWebsocketServer = () => {
    server.listen(3789, (a, b) =>
        console.log('Example app listening on port 3789!', a, b)
    );
    let conf = vscode.workspace.getConfiguration();
    console.log('workspace conf:', conf);
    wss.on('connection', function connection(ws) {
        ws.on('message', function incoming(message) {
            console.log('received:', message);
            let msg = JSON.parse(message);
            if (msg.command) {
                onCommand(msg.command);
            }
        });

        let excludeConf = conf.get('search.exclude');
        console.log('excludeConf', excludeConf);
        let excludeStr = `{${Object.keys(excludeConf)
            .filter(key => excludeConf[key])
            .join(',')}}`;
        // vscode.workspace.findFiles('**/*.{js,jsx}', '**/node_modules/**', 250)
        vscode.workspace
            .findFiles('**/*.{ts,tsx,js,jsx}', excludeStr, 2000)
            .then(files => {
                const re = /[_-\s./]|(?=[A-Z])/;
                let filePieces = {};
                files.forEach(file => {
                    file.path.split(re).forEach(piece => {
                        filePieces[piece.toLowerCase()] = true;
                    });
                });
                delete filePieces[''];

                ws.send(
                    JSON.stringify({ keywords: Object.keys(filePieces).sort() })
                );
            });
    });
};

const openChrome = () => {
    // console.log(__filename)
    // childProc.exec('open -a "Google Chrome" ' + __filename + '.html', () => { console.log('chrome opened') });
    // childProc.exec('open -a "Google Chrome" ' + 'http://localhost:3789', () => { console.log('chrome opened') });
    let url = 'http://localhost:3789?id=123';
    // let userDataDir = '/var/folders/74/qjsl_qln1rv0945c0svhh_z00000gp/T/karma-42279817'
    let userDataDir = '/var/folders/gaga42';
    opn(url, {
        app: [
            'google chrome',
            '--user-data-dir=' + userDataDir,
            '--no-default-browser-check',
            '--no-first-run'
            // '--disable-default-apps',
            // '--disable-popup-blocking',
            // '--disable-translate',
            // '--disable-background-timer-throttling',
            // // on macOS, disable-background-timer-throttling is not enough
            // // and we need disable-renderer-backgrounding too
            // // see https://github.com/karma-runner/karma-chrome-launcher/issues/123
            // '--disable-renderer-backgrounding',
            // '--disable-device-discovery-notifications'
        ]
    });
    // try {
    //     // Try our best to reuse existing tab
    //     // on OS X Google Chrome with AppleScript
    //     execSync('ps cax | grep "Google Chrome"');
    //     execSync('osascript openChrome.applescript "' + encodeURI(url) + '"', {
    //         cwd: __dirname,
    //         stdio: 'ignore',
    //     });

    //     // return true;
    // } catch (err) {
    //     // Ignore errors.
    //     console.log('Error', err)
    // }
};

const startLanguageServer = context => {
    let serverModule = context.asAbsolutePath(path.join('out', 'server.js'));
    // The debug options for the server
    let debugOptions = { execArgv: ['--nolazy', '--inspect=6019'] };

    // If the extension is launched in debug mode then the debug server options are used
    // Otherwise the run options are used
    let serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
            options: debugOptions
        }
    };

    // Options to control the language client
    let clientOptions: LanguageClientOptions = {
        // Register the server for plain text documents
        documentSelector: [
            { language: 'typescript' },
            { language: 'typescriptreact' },
            { language: 'javascript' },
            { language: 'javascriptreact' }
        ], // [{ scheme: 'file', language: 'plaintext' }],
        synchronize: {
            // Synchronize the setting section 'lspSample' to the server
            configurationSection: 'code-ai',
            // Notify the server about file changes to '.clientrc files contain in the workspace
            // fileEvents: workspace.createFileSystemWatcher('**/.clientrc')
            // fileEvents: vscode.workspace.createFileSystemWatcher(includeMask)
            fileEvents: vscode.workspace.createFileSystemWatcher('**/.clientrc')
        }
    };

    // Create the language client and start the client.
    let client = new LanguageClient(
        'code-ai',
        'Code AI',
        serverOptions,
        clientOptions
    );
    return client.start();
};

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Your extension "code-ai" is now active!');
    // openWebsocketServer();
    // openChrome();

    // let statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 0);
    // statusBarItem.text = 'Listening';
    // statusBarItem.show()

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with  registerCommand
    // The commandId parameter must match the command field in package.json
    let disposable = vscode.commands.registerCommand(
        'codeai.activateSpeechRecognition',
        () => {
            // The code you place here will be executed every time your command is executed

            console.log('Hey code');

            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ command: 'listen' }));
                }
            });
        }
    );

    context.subscriptions.push(disposable);

    disposable = startLanguageServer(context);

    // Push the disposable to the context's subscriptions so that the
    // client can be deactivated on extension deactivation
    context.subscriptions.push(disposable);

    // disposable = commands.registerCommand('extension.sayHello', () => {
    //     console.log('hello');
    //     childProc.exec('open -a "Google Chrome" http://www.nba.com', () => {
    //         console.log('chrome opened');
    //     });
    //     //Or could be: childProc.exec('open -a firefox http://your_url', callback);
    //     // client.sendRequest(RequestType.)
    // });
    // context.subscriptions.push(disposable);

    //     let statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 0);
    //     statusBarItem.text = 'Gaga';
    //     statusBarItem.show()
}
