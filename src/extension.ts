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
let wsConnections = [];

const sendToWebsocket = (data: any) => {
    if (wsConnections.length === 0) {
        console.log(
            'Error sending to websocket - not connected! Unsent msg:',
            data
        );
        return;
    }
    for (const conn of wsConnections) conn.send(JSON.stringify(data));
};

server.on('error', err => {
    console.log('server error:', err);
});

const listProjectFiles = async (include = includeMask, limit = 10000) => {
    let conf = vscode.workspace.getConfiguration('search', null);
    let excludeConf = conf.get('exclude');
    let excludeStr = `{${Object.keys(excludeConf)
        .filter(key => excludeConf[key])
        .join(',')}}`;
    const files = await vscode.workspace.findFiles(include, excludeStr, limit);
    return files;
};

function openFile(parts) {
    listProjectFiles().then(
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
        case 'project':
            contributeCommandsHandlers['codeai.projectMap']();
            break;
        default:
            vscode.window.showWarningMessage(
                'Could not recognize command: "' + command + '"'
            );
    }
}

const tokenizeProjectFilenames = async () => {
    const files = await listProjectFiles();
    const re = /[_-\s./]|(?=[A-Z])/;
    let filePieces = {};
    for (const file of files) {
        file.path.split(re).forEach(piece => {
            filePieces[piece.toLowerCase()] = true;
        });
    }
    delete filePieces[''];
    return Object.keys(filePieces).sort();
};

const openWebsocketServer = () => {
    server.listen(3789, (a, b) =>
        console.log('Example app listening on port 3789!', a, b)
    );
    wss.on('connection', function connection(ws) {
        wsConnections.push(ws);
        console.log('Webscoket connection established');
        ws.on('message', function incoming(message) {
            console.log('received:', message);
            let msg = JSON.parse(message);
            if (msg.command) {
                onCommand(msg.command);
            }
        });
        ws.on('close', () => {
            console.log('ws connection closed');
            wsConnections = wsConnections.filter(conn => conn !== ws);
        });

        tokenizeProjectFilenames().then(keywords => {
            sendToWebsocket({ type: 'keywords', payload: keywords });
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

// const startLanguageServer = context => {
//     let serverModule = context.asAbsolutePath(path.join('out', 'server.js'));
//     // The debug options for the server
//     let debugOptions = { execArgv: ['--nolazy', '--inspect=6019'] };

//     // If the extension is launched in debug mode then the debug server options are used
//     // Otherwise the run options are used
//     let serverOptions: ServerOptions = {
//         run: { module: serverModule, transport: TransportKind.ipc },
//         debug: {
//             module: serverModule,
//             transport: TransportKind.ipc,
//             options: debugOptions
//         }
//     };

//     // Options to control the language client
//     let clientOptions: LanguageClientOptions = {
//         // Register the server for plain text documents
//         documentSelector: [
//             { language: 'typescript' },
//             { language: 'typescriptreact' },
//             { language: 'javascript' },
//             { language: 'javascriptreact' }
//         ], // [{ scheme: 'file', language: 'plaintext' }],
//         synchronize: {
//             // Synchronize the setting section 'lspSample' to the server
//             configurationSection: 'code-ai',
//             // Notify the server about file changes to '.clientrc files contain in the workspace
//             // fileEvents: workspace.createFileSystemWatcher('**/.clientrc')
//             // fileEvents: vscode.workspace.createFileSystemWatcher(includeMask)
//             fileEvents: vscode.workspace.createFileSystemWatcher('**/.clientrc')
//         }
//     };

//     // Create the language client and start the client.
//     let client = new LanguageClient(
//         'code-ai',
//         'Code AI',
//         serverOptions,
//         clientOptions
//     );
//     return client.start();
// };

const mapIncludes = async () => {
    const files = await listProjectFiles(includeMask, 2000);
    // console.log('files', files);
    const includes = [];
    const re = /^import (.+) from ['"](\..+)['"]/gm;
    for (const file of files) {
        const doc = await vscode.workspace.openTextDocument(file.path);
        // console.log('doc text', doc.getText());
        const relativePath = file.path.replace(vscode.workspace.rootPath, '');
        // console.log('analyze', relativePath);
        let out;
        do {
            out = re.exec(doc.getText());
            if (!out) break;
            const [, what, whereFrom] = out;
            const whatSplit = what.split(/[,\s{}]+/).filter(t => !!t);
            // console.log([relativePath, out[1]]);
            // console.log(relativePath, out[1], out[2]);
            includes.push({
                items: whatSplit,
                to: relativePath,
                from: whereFrom
            });
        } while (1);
    }
    return includes;
};

const contributeCommandsHandlers = {
    'codeai.activateSpeechRecognition': () => {
        console.log('Hey code');
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ command: 'listen' }));
            }
        });
    },
    'codeai.projectMap': async () => {
        const data = await mapIncludes();
        console.log(data);
        sendToWebsocket({ type: 'projectMap', payload: data });
    }
};

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log('Your extension "code-ai" is now active!');
    openWebsocketServer();
    openChrome();

    // let statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 0);
    // statusBarItem.text = 'Listening';
    // statusBarItem.show()

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with  registerCommand
    // The commandId parameter must match the command field in package.json
    for (const command in contributeCommandsHandlers) {
        let disposable = vscode.commands.registerCommand(
            command,
            contributeCommandsHandlers[command]
        );
        context.subscriptions.push(disposable);
    }

    mapIncludes().then(data => {
        console.log(data);
        sendToWebsocket({ type: 'projectMap', payload: data });
    });

    // disposable = startLanguageServer(context);
    // context.subscriptions.push(disposable);

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
