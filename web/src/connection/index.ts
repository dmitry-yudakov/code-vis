import { SocketConnection } from './connection';

let connection: SocketConnection | null = null;

/**
 * Initialize the Socket.IO connection
 */
export const initConnection = (url: string, options = {}) => {
  connection = new SocketConnection({
    url,
    ...options,
  });
  return connection;
};

/**
 * Get the active connection instance
 */
export const getConnection = (): SocketConnection => {
  if (!connection) {
    throw new Error('Connection not initialized. Call initConnection first.');
  }
  return connection;
};

/**
 * Check if connected
 */
export const isConnected = (): boolean => {
  return connection?.isConnected() || false;
};

/**
 * Type-safe API for project operations
 */
export const projectApi = {
  /**
   * Get project map (file hierarchy)
   */
  async getProjectMap() {
    console.log('CLIENT: projectApi.getProjectMap() called');
    const result = await getConnection().request<any[]>('mapProject');
    console.log('CLIENT: projectApi.getProjectMap() received', {
      resultType: typeof result,
      isArray: Array.isArray(result),
      length: result ? result.length : 'null/undefined',
    });
    return result;
  },

  /**
   * Get detailed file mapping
   */
  async getFileMap(filename: string, includeRelated = false) {
    console.log('CLIENT: projectApi.getFileMap() called', {
      filename,
      includeRelated,
    });
    const result = await getConnection().request<any[]>('mapFile', {
      filename,
      includeRelated,
    });
    console.log('CLIENT: projectApi.getFileMap() received', {
      resultType: typeof result,
      isArray: Array.isArray(result),
      length: result ? result.length : 'null/undefined',
    });
    return result;
  },

  /**
   * Save file content
   */
  async saveFile(
    filename: string,
    content: string,
    pos?: number,
    end?: number
  ) {
    return getConnection().request('saveFile', {
      filename,
      content,
      pos,
      end,
    });
  },

  /**
   * Subscribe to project content changes
   */
  onProjectChange(handler: (event: any) => void) {
    console.log('CLIENT: projectApi.onProjectChange() subscribed');
    return getConnection().on('projectContentChange', (event) => {
      console.log('CLIENT: projectContentChange event received', event);
      handler(event);
    });
  },

  /**
   * Subscribe to project map updates
   */
  onProjectMap(handler: (data: any) => void) {
    console.log('CLIENT: projectApi.onProjectMap() subscribed');
    return getConnection().on('projectMap', (data) => {
      console.log('CLIENT: projectMap event received', {
        dataType: typeof data,
        isArray: Array.isArray(data),
        length: data ? data.length : 'null/undefined',
      });
      handler(data);
    });
  },

  /**
   * Subscribe to file map updates
   */
  onFileMap(handler: (data: any) => void) {
    console.log('CLIENT: projectApi.onFileMap() subscribed');
    return getConnection().on('fileMap', (data) => {
      console.log('CLIENT: fileMap event received', {
        dataType: typeof data,
        isArray: Array.isArray(data),
        length: data ? data.length : 'null/undefined',
      });
      handler(data);
    });
  },
};

/**
 * Legacy compatibility functions
 */
export const sendToServer = (command: string, payload?: any) => {
  if (!connection) {
    console.warn('Connection not initialized');
    return;
  }
  connection.emit(command, payload);
};

export const requestFromServer = async (command: string, payload?: any) => {
  return getConnection().request(command, payload);
};

export const disconnect = () => {
  connection?.disconnect();
  connection = null;
};

// Re-export types and classes
export { SocketConnection } from './connection';
export type { SocketOptions } from './connection';
