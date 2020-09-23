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

const hideFilesMasks: { [k: string]: RegExp } = {};

const shouldIgnoreFile = filePath => {
    for (const key in hideFilesMasks) {
        const re = hideFilesMasks[key];
        if (re.test(filePath)) {
            console.log('ignore', filePath, key, re);
            return true;
        }
    }
    return false;
};

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

const toRelativePath = (fullPath: string) =>
    fullPath.replace(vscode.workspace.rootPath, '');

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

    const unrecognized = () => {
        vscode.window.showWarningMessage(
            'Could not recognize command: "' + command + '"'
        );
        sendToWebsocket({
            type: 'info',
            payload: 'Unrecognized command: ' + command
        });
    };

    let op = tokens.shift();
    switch (op) {
        case 'open':
            if (tokens.length) openFile(tokens);
            break;
        case 'map': {
            const what = tokens.shift();
            if (what === 'project') {
                contributeCommandsHandlers['codeai.projectMap']();
            } else {
                unrecognized();
            }
            break;
        }
        case 'hide': {
            const maskName = tokens.join('|');
            const what = tokens.shift();
            let reString;
            if (what === 'directory') {
                reString = `^.*${tokens.join('.*')}\/`;
            } else if (what === 'file') {
                reString = `^.*${['/', ...tokens].join('.*')}[^/]`;
            } else {
                return unrecognized();
            }
            console.log('Ignore regex', reString);
            hideFilesMasks[maskName] = new RegExp(reString, 'i');

            contributeCommandsHandlers['codeai.projectMap']();
            break;
        }
        default:
            unrecognized();
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

type TScanFileCallback = (relativePath: string, content: string) => void;

const scanProjectFiles = async ({
    forEveryFile
}: {
    forEveryFile: TScanFileCallback;
}) => {
    const files = await listProjectFiles(includeMask, 2000);

    for (const file of files) {
        if (shouldIgnoreFile(file.path)) {
            console.log('ignoring', file, 'because of path');
            continue;
        }
        const doc = await vscode.workspace.openTextDocument(file.path);
        const relativePath = file.path.replace(vscode.workspace.rootPath, '');

        await forEveryFile(relativePath, doc.getText());
    }
};

interface IFileIncludeInfo {
    to: string;
    from: string;
    items: string[];
}
interface IFunctionCallInfo {
    name: string;
    from: string;
    args: string[];
}

const autoAppendJSextensionInPlace = (
    info: IFileIncludeInfo,
    projectFiles: string[]
) => {
    const { from } = info;
    for (let filename of projectFiles) {
        if (
            filename.indexOf(from) === 0 &&
            filename.length !== from.length &&
            filename[from.length] === '.'
        ) {
            info.from = filename;
            break;
        }
    }
};

const resolveRelativeIncludePathInPlace = (info: IFileIncludeInfo) => {
    const re = /\//;
    const { to, from } = info;
    const pathTokens = to.split(re).filter(t => !!t);
    pathTokens.pop(); // remove filename and leave only path

    const fromTokens = from.split(re).filter(t => !!t);

    for (const token of fromTokens) {
        if (token === '.') {
            // noop
        } else if (token === '..') {
            pathTokens.pop();
        } else {
            pathTokens.push(token);
        }
    }
    info.from = '/' + pathTokens.join('/');
    // console.log(info.from, info.to);
};

const mapIncludes = async () => {
    let includes: IFileIncludeInfo[] = [];
    let funcCalls: IFunctionCallInfo[] = [];
    const parseAndStoreIncludes: TScanFileCallback = (
        relativePath,
        content
    ) => {
        const re = /^import (.+) from ['"](\..+)['"]/gm;
        const re2 = /^(const|let|var) (.+) = require\(['"](\..+)['"]\)/gm;
        // console.log('doc text', doc.getText());
        // console.log('analyze', relativePath);
        do {
            let out = re.exec(content);
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
        do {
            let out = re2.exec(content);
            if (!out) break;
            const [, , what, whereFrom] = out;
            const whatSplit = what.split(/[,\s{}]+/).filter(t => !!t);
            // console.log([relativePath, out[1]]);
            // console.log(relativePath, out[1], out[2]);
            includes.push({
                items: whatSplit,
                to: relativePath,
                from: whereFrom
            });
        } while (1);

        console.log('in file', relativePath, 'check func call');
        const reFuncCall = /(.*[\s()])([a-zA-Z0-9_^(]+)\((.*)\)/gm;
        let max = 1000;
        do {
            let out = reFuncCall.exec(content);
            if (!out) break;
            const [, pre, name, args] = out;
            console.log('func call detected', name, pre);
            // console.log([relativePath, out[1]]);
            // console.log(relativePath, out[1], out[2]);
            funcCalls.push({
                args: [args],
                name: name,
                from: relativePath
            });
        } while (--max);
    };

    await scanProjectFiles({
        forEveryFile: parseAndStoreIncludes
    });

    includes = includes.filter(({ from, ...rest }) => {
        const ignore = shouldIgnoreFile(from);
        if (ignore) console.log('ignoring "from"', from, rest);
        return !ignore;
    });

    includes.forEach(resolveRelativeIncludePathInPlace);

    const projectFilesRelative = (await listProjectFiles())
        .map(file => file.path)
        .map(toRelativePath);
    console.log(projectFilesRelative);
    includes.forEach(info =>
        autoAppendJSextensionInPlace(info, projectFilesRelative)
    );

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
    // openChrome();

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

    // mapIncludes().then(data => {
    //     console.log(data);
    //     sendToWebsocket({ type: 'projectMap', payload: data });
    // });

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
