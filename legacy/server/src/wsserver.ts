import http from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';

let server = http.createServer();
let io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// Use Socket.IO's native event system instead of custom message wrapper
export const broadcast = (event: string, data: any) => {
  io.emit(event, data);
};

// Send to specific socket
export const sendToSocket = (socket: Socket, event: string, data: any) => {
  socket.emit(event, data);
};

// Handler types using Socket.IO acknowledgments
type CommandHandler = (
  socket: Socket,
  payload: any,
  ack?: (response: any) => void
) => void | Promise<void>;

interface CommandHandlers {
  [command: string]: CommandHandler;
}

export const startServer = (port: number, handlers: CommandHandlers) => {
  server.on('error', (err) => {
    console.log('Server error:', err);
  });

  server.listen(port, () => console.log('Server listening on port', port));

  io.on('connection', (socket: Socket) => {
    console.log('Socket.IO connection established', socket.id);

    // Register handlers for each command as separate events
    Object.entries(handlers).forEach(([eventName, handler]) => {
      socket.on(
        eventName,
        async (payload: any, ack?: (response: any) => void) => {
          console.log(`Received event: ${eventName}`, payload);

          try {
            await handler(socket, payload, ack);
          } catch (error) {
            console.error(`Error handling ${eventName}:`, error);

            // If acknowledgment expected, send error response
            if (ack && typeof ack === 'function') {
              ack({
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              });
            }
          }
        }
      );
    });

    socket.on('disconnect', (reason) => {
      console.log('Socket.IO disconnected:', socket.id, reason);
    });

    socket.on('error', (error) => {
      console.error('Socket error:', error);
    });
  });

  return io;
};

// Helper to send error responses
export const sendError = (socket: Socket, event: string, error: string) => {
  socket.emit(event, { success: false, error });
};

// Get number of connected clients
export const getConnectionCount = (): number => {
  return io.engine.clientsCount;
};
