import { SocketConn } from './connection';

let conn: SocketConn;

export interface InitConnectionProps {
  url: string;
  onOpen: () => void;
  onMessage: (type: string, payload: object) => void;
}

export const initConnection = ({
  url,
  onOpen,
  onMessage,
}: InitConnectionProps) => {
  conn = new SocketConn(url, onMessage, onOpen);
};

export const sendToServer = (command: string, payload?: object) => {
  if (!conn) {
    console.log(
      'Cannot send',
      command,
      '- no connection to server. Try again in a sec'
    );
    setTimeout(() => sendToServer(command, payload), 500);
    return;
  }
  conn.send(command, payload);
};

// New function for request-response pattern
export const requestFromServer = async (
  command: string,
  payload?: object
): Promise<any> => {
  if (!conn) {
    throw new Error('No connection to server');
  }
  if (!conn.isConnected()) {
    throw new Error('Not connected to server');
  }
  return await conn.request(command, payload);
};

// Utility functions
export const isConnected = (): boolean => {
  return conn?.isConnected() || false;
};

export const disconnect = () => {
  if (conn) {
    conn.disconnect();
  }
};

// Re-export everything from the connection modules
export { SocketConn, WSConn } from './connection';
export { api, apiRequest, withRetry, withTimeout, projectApi } from './api';
export * from './types';
