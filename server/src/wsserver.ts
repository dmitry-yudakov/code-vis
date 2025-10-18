import http from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';

let server = http.createServer();
let io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});
let socketConnections: Socket[] = [];

export const sendToWebsocket = (data: any, connection?: Socket) => {
  if (socketConnections.length === 0) {
    console.log('Error sending to socket - not connected! Unsent msg:', data);
    return;
  }
  for (const conn of connection ? [connection] : socketConnections)
    conn.emit('message', data);
};

// New helper for sending responses to specific requests
export const sendResponse = (socket: Socket, requestId: string, data: any) => {
  socket.emit('response', { requestId, data });
};

// Broadcast to all connected clients
export const broadcast = (event: string, data: any) => {
  io.emit(event, data);
};

// Define command handler types
type EventCommandHandler = (
  conn: Socket,
  type: string,
  payload: string | undefined
) => void | Promise<void>;

type RequestCommandHandler = (
  conn: Socket,
  type: string,
  payload: string | undefined
) => Promise<any>;

export const startServer = (
  port: number,
  onCommand: EventCommandHandler,
  onRequest?: RequestCommandHandler
) => {
  server.on('error', (err) => {
    console.log('server error:', err);
  });

  server.listen(port, () => console.log('Example app listening on port', port));

  io.on('connection', (socket: Socket) => {
    socketConnections.push(socket);
    console.log('Socket.IO connection established');

    // Handle traditional event-based messages
    socket.on('command', (data: { type: string; payload?: any }) => {
      console.log('received command:', data);
      if (data.type) {
        onCommand(socket, data.type, data.payload);
      }
    });

    // Handle request-response pattern
    socket.on(
      'request',
      async (data: { type: string; payload?: any }, callback) => {
        console.log('received request:', data);
        try {
          if (data.type && callback) {
            if (onRequest) {
              // Use dedicated request handler if provided
              const result = await onRequest(socket, data.type, data.payload);
              callback({ success: true, data: result });
            } else {
              // Fallback to regular command handler
              await onCommand(socket, data.type, data.payload);
              callback({ success: true });
            }
          }
        } catch (error) {
          if (callback)
            callback({
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
      }
    );

    socket.on('disconnect', () => {
      console.log('Socket.IO connection closed');
      socketConnections = socketConnections.filter(
        (conn: Socket) => conn !== socket
      );
    });
  });
};
