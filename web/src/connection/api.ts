import { requestFromServer } from './index';

/**
 * HTTP-like API helpers for Socket.IO communication
 * These functions provide a familiar REST API pattern over Socket.IO
 */

export interface ApiResponse<T = any> {
  data?: T;
  error?: string;
  success: boolean;
}

export interface RequestOptions {
  timeout?: number; // milliseconds
  retries?: number;
}

// Generic request wrapper with timeout and retry logic
export const apiRequest = async <T = any>(
  command: string,
  payload?: any,
  options: RequestOptions = {}
): Promise<T> => {
  const { timeout = 30000, retries = 0 } = options;

  let lastError: Error = new Error('Unknown error');

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const promise = requestFromServer(command, payload);

      if (timeout > 0) {
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Request timeout')), timeout)
        );

        return (await Promise.race([promise, timeoutPromise])) as T;
      }

      return await promise;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < retries) {
        console.warn(
          `Request attempt ${attempt + 1} failed, retrying...`,
          lastError.message
        );
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * (attempt + 1))
        ); // Exponential backoff
      }
    }
  }

  throw lastError;
};

// HTTP-like method helpers
export const api = {
  /**
   * GET-like operation (fetch data)
   */
  get: async <T = any>(
    endpoint: string,
    params?: any,
    options?: RequestOptions
  ): Promise<T> => {
    return apiRequest<T>(`get_${endpoint}`, params, options);
  },

  /**
   * POST-like operation (create/send data)
   */
  post: async <T = any>(
    endpoint: string,
    data?: any,
    options?: RequestOptions
  ): Promise<T> => {
    return apiRequest<T>(`post_${endpoint}`, data, options);
  },

  /**
   * PUT-like operation (update data)
   */
  put: async <T = any>(
    endpoint: string,
    data?: any,
    options?: RequestOptions
  ): Promise<T> => {
    return apiRequest<T>(`put_${endpoint}`, data, options);
  },

  /**
   * DELETE-like operation
   */
  delete: async <T = any>(
    endpoint: string,
    params?: any,
    options?: RequestOptions
  ): Promise<T> => {
    return apiRequest<T>(`delete_${endpoint}`, params, options);
  },

  /**
   * Custom command (for non-HTTP-like operations)
   */
  command: async <T = any>(
    command: string,
    payload?: any,
    options?: RequestOptions
  ): Promise<T> => {
    return apiRequest<T>(command, payload, options);
  },
};

// Utility functions for common patterns
export const withRetry = <T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  retries: number = 3,
  delay: number = 1000
) => {
  return async (...args: T): Promise<R> => {
    let lastError: Error = new Error('Unknown error');

    for (let i = 0; i <= retries; i++) {
      try {
        return await fn(...args);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (i < retries) {
          await new Promise((resolve) => setTimeout(resolve, delay * (i + 1)));
        }
      }
    }

    throw lastError;
  };
};

export const withTimeout = <T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  timeoutMs: number = 30000
) => {
  return async (...args: T): Promise<R> => {
    const promise = fn(...args);
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Operation timed out')), timeoutMs)
    );

    return Promise.race([promise, timeout]);
  };
};

// Example usage helpers for your specific app
export const projectApi = {
  getProjectMap: () => api.get('project_map'),
  getKeywords: () => api.get('keywords'),
  updateFile: (filePath: string, content: string) =>
    api.post('update_file', { filePath, content }),
  analyzeCode: (code: string, language: string) =>
    api.post('analyze', { code, language }),
};

export default api;
