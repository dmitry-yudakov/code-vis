import { io, Socket } from 'socket.io-client';

export class SocketConn {
  socket: Socket;

  constructor(
    public url: string,
    public onMessage: (type: string, payload: object) => void,
    public onOpen: () => void
  ) {
    this.socket = this.connect();
  }

  // Send command using event-based pattern (fire and forget)
  send(command: string, payload?: object) {
    this.socket.emit('command', { type: command, payload });
  }

  // Send request using request-response pattern (with callback)
  async request(command: string, payload?: object): Promise<any> {
    return new Promise((resolve, reject) => {
      this.socket.emit(
        'request',
        { type: command, payload },
        (response: any) => {
          if (response.success) {
            resolve(response.data);
          } else {
            reject(new Error(response.error || 'Request failed'));
          }
        }
      );
    });
  }

  connect() {
    console.log('connect socket.io');
    const socket = io(this.url, {
      transports: ['websocket', 'polling'], // Allow fallback to polling
      autoConnect: true,
    });

    socket.on('connect', () => {
      console.log('Socket.IO connected');
      this.onOpen();
    });

    socket.on('disconnect', () => {
      console.log('Socket.IO disconnected, will auto-reconnect');
    });

    socket.on('connect_error', (error) => {
      console.error('Socket.IO connection error:', error);
    });

    // Handle traditional message events
    socket.on('message', (data: any) => {
      console.log('socket message received', data);
      this.onMessage(data.type, data.payload);
    });

    // Handle other custom events that might be sent from server
    socket.onAny((eventName, ...args) => {
      if (
        eventName !== 'connect' &&
        eventName !== 'disconnect' &&
        eventName !== 'message'
      ) {
        console.log('socket event received:', eventName, args);
        // Treat custom events as messages
        this.onMessage(eventName, args[0]);
      }
    });

    return socket;
  }

  // Disconnect the socket
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
    }
  }

  // Check if connected
  isConnected(): boolean {
    return this.socket?.connected || false;
  }
}

// Keep the old class for backward compatibility during transition
export class WSConn extends SocketConn {
  constructor(
    public url: string,
    public onMessage: (type: string, payload: object) => void,
    public onOpen: () => void
  ) {
    console.warn('WSConn is deprecated, use SocketConn instead');
    super(url, onMessage, onOpen);
  }
}

// }
// let ws;
// export const ;
// ws = reconnectws();
