import http from 'http';
import * as WS from 'ws';

let server = http.createServer();
let wss = new WS.Server({ server });
let wsConnections: WebSocket[] = [];

export const sendToWebsocket = (data: any, connection?: any) => {
  if (wsConnections.length === 0) {
    console.log(
      'Error sending to websocket - not connected! Unsent msg:',
      data
    );
    return;
  }
  for (const conn of connection ? [connection] : wsConnections)
    conn.send(JSON.stringify(data));
};

export const startServer = (
  port: number,
  onCommand: (
    conn: WebSocket,
    type: string,
    payload: string | undefined
  ) => void
) => {
  server.on('error', (err) => {
    console.log('server error:', err);
  });

  server.listen(port, () => console.log('Example app listening on port', port));

  wss.on('connection', (ws: any) => {
    wsConnections.push(ws);
    console.log('Webscoket connection established');

    ws.on('message', (message: string) => {
      console.log('received:', message);
      const { type, payload } = JSON.parse(message.toString());
      if (type) {
        onCommand(ws, type, payload);
      }
    });

    ws.on('close', () => {
      console.log('ws connection closed');
      wsConnections = wsConnections.filter((conn) => conn !== ws);
    });
  });
};
