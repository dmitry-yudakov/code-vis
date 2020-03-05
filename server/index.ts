import * as http from 'http';
import * as WS from 'ws';

let server = http.createServer();
let wss = new WS.Server({ server });
let wsConnections = [];

const hideFilesMasks: { [k: string]: RegExp } = {};

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

server.listen(3789, () => console.log('Example app listening on port 3789!'));
wss.on('connection', function connection(ws) {
    wsConnections.push(ws);
    console.log('Webscoket connection established');

    ws.on('message', function incoming(message) {
        console.log('received:', message);
        let msg = JSON.parse(message.toString());
        if (msg.command) {
            // onCommand(msg.command);
        }
    });

    ws.on('close', () => {
        console.log('ws connection closed');
        wsConnections = wsConnections.filter(conn => conn !== ws);
    });

    // tokenizeProjectFilenames().then(keywords => {
    //     sendToWebsocket({ type: 'keywords', payload: keywords });
    // });
});
