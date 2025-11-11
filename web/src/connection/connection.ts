import { io, Socket } from 'socket.io-client';

export interface SocketOptions {
  url: string;
  autoConnect?: boolean;
  reconnection?: boolean;
  reconnectionAttempts?: number;
  reconnectionDelay?: number;
}

export class SocketConnection {
  protected socket: Socket;
  private eventHandlers: Map<string, Set<(data: any) => void>> = new Map();

  constructor(private options: SocketOptions) {
    this.socket = this.createConnection();
  }

  private createConnection(): Socket {
    console.log('Connecting to Socket.IO server:', this.options.url);

    const socket = io(this.options.url, {
      transports: ['websocket', 'polling'],
      autoConnect: this.options.autoConnect !== false,
      reconnection: this.options.reconnection !== false,
      reconnectionAttempts: this.options.reconnectionAttempts ?? 5,
      reconnectionDelay: this.options.reconnectionDelay ?? 1000,
    });

    socket.on('connect', () => {
      console.log('Socket.IO connected:', socket.id);
      this.triggerEventHandlers('connect', {});
    });

    socket.on('disconnect', (reason) => {
      console.log('Socket.IO disconnected:', reason);
      this.triggerEventHandlers('disconnect', { reason });
    });

    socket.on('connect_error', (error) => {
      console.error('Socket.IO connection error:', error);
      this.triggerEventHandlers('error', { error });
    });

    return socket;
  }

  /**
   * Send event without expecting a response (fire-and-forget)
   */
  emit(event: string, data?: any): void {
    if (!this.isConnected()) {
      console.warn(`Cannot emit ${event}: not connected`);
      return;
    }
    this.socket.emit(event, data);
  }

  /**
   * Send event and wait for acknowledgment response
   */
  async request<T = any>(
    event: string,
    data?: any,
    timeoutMs = 30000
  ): Promise<T> {
    console.log('🟢 CLIENT: request() called', { event, data });
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        console.error('❌ CLIENT: request() failed - not connected');
        reject(new Error('Not connected to server'));
        return;
      }

      const timeout = setTimeout(() => {
        console.error('❌ CLIENT: request() timeout', { event, timeoutMs });
        reject(new Error(`Request timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      this.socket.emit(event, data, (response: any) => {
        clearTimeout(timeout);
        console.log('🟢 CLIENT: request() response received', { 
          event, 
          responseType: typeof response,
          hasSuccess: response?.hasOwnProperty('success'),
          success: response?.success,
          hasData: response?.hasOwnProperty('data'),
          dataType: response?.data ? typeof response.data : 'undefined'
        });

        if (response?.success === false) {
          console.error('❌ CLIENT: request() failed', { event, error: response.error });
          reject(new Error(response.error || 'Request failed'));
        } else if (response?.success === true) {
          console.log('🟢 CLIENT: request() success, resolving with data');
          resolve(response.data as T);
        } else {
          // Handle non-standard responses
          console.warn('⚠️ CLIENT: request() non-standard response, resolving as-is');
          resolve(response as T);
        }
      });
    });
  }

  /**
   * Register event handler
   */
  on(event: string, handler: (data: any) => void): () => void {
    // Register with socket.io
    this.socket.on(event, handler);

    // Track for internal management
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);

    // Return unsubscribe function
    return () => this.off(event, handler);
  }

  /**
   * Register one-time event handler
   */
  once(event: string, handler: (data: any) => void): void {
    this.socket.once(event, handler);
  }

  /**
   * Unregister event handler
   */
  off(event: string, handler?: (data: any) => void): void {
    if (handler) {
      this.socket.off(event, handler);
      this.eventHandlers.get(event)?.delete(handler);
    } else {
      this.socket.off(event);
      this.eventHandlers.delete(event);
    }
  }

  /**
   * Trigger all registered handlers for an event
   */
  private triggerEventHandlers(event: string, data: any): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(data);
        } catch (error) {
          console.error(`Error in event handler for ${event}:`, error);
        }
      });
    }
  }

  /**
   * Check connection status
   */
  isConnected(): boolean {
    return this.socket?.connected || false;
  }

  /**
   * Manually connect
   */
  reconnect(): void {
    if (!this.socket.connected) {
      this.socket.connect();
    }
  }

  /**
   * Disconnect
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
    }
  }

  /**
   * Get socket ID
   */
  getId(): string | undefined {
    return this.socket?.id;
  }
}

// Backward compatibility export
export class SocketConn extends SocketConnection {
  constructor(
    url: string,
    private onMessage: (type: string, payload: object) => void,
    private onOpen: () => void
  ) {
    super({ url });

    // Set up legacy message handling
    this.on('connect', () => this.onOpen());

    // Listen to all events and route through onMessage
    this.socket.onAny((event, data) => {
      if (!['connect', 'disconnect', 'connect_error'].includes(event)) {
        this.onMessage(event, data);
      }
    });
  }

  // Legacy send method
  send(command: string, payload?: object): void {
    this.emit(command, payload);
  }

  // Legacy request method
  async request(command: string, payload?: object): Promise<any> {
    return super.request(command, payload);
  }
}
