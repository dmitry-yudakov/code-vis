/**
 * TypeScript definitions for Socket.IO communication patterns
 */

// Base message types
export interface BaseMessage {
  type: string;
  payload?: any;
}

export interface CommandMessage extends BaseMessage {
  type: string;
  payload?: any;
}

export interface RequestMessage extends BaseMessage {
  type: string;
  payload?: any;
  requestId?: string;
}

export interface ResponseMessage {
  success: boolean;
  data?: any;
  error?: string;
  requestId?: string;
}

// Connection event types
export type ConnectionEventType =
  | 'connect'
  | 'disconnect'
  | 'connect_error'
  | 'reconnect'
  | 'reconnect_error';

export interface ConnectionEvent {
  type: ConnectionEventType;
  data?: any;
}

// Server-to-client event types (what the server can emit)
export interface ServerToClientEvents {
  message: (data: BaseMessage) => void;
  response: (data: ResponseMessage) => void;
  projectContentChange: (data: any) => void;
  keywords: (data: any) => void;
  projectMap: (data: any) => void;
  info: (data: string) => void;
  error: (data: { message: string; code?: string }) => void;
  // Add more server events as needed
}

// Client-to-server event types (what the client can emit)
export interface ClientToServerEvents {
  command: (data: CommandMessage) => void;
  request: (
    data: RequestMessage,
    callback: (response: ResponseMessage) => void
  ) => void;
  // Add more client commands as needed
}

// Command types that your application supports
export type CommandType =
  | 'map_project'
  | 'get_keywords'
  | 'analyze_file'
  | 'update_file'
  | 'get_project_info'
  | 'watch_changes'
  | string; // Allow custom commands

// Request types for the HTTP-like API
export type RequestType =
  | 'get_project_map'
  | 'get_keywords'
  | 'post_analyze'
  | 'post_update_file'
  | 'put_file_content'
  | 'delete_file'
  | string; // Allow custom requests

// Payload types for common operations
export interface ProjectMapPayload {
  includeTests?: boolean;
  includeNodeModules?: boolean;
}

export interface FileUpdatePayload {
  filePath: string;
  content: string;
  encoding?: string;
}

export interface AnalyzePayload {
  code: string;
  language: string;
  filePath?: string;
}

export interface ProjectInfoPayload {
  includeDependencies?: boolean;
  includeStats?: boolean;
}

// Response data types
export interface ProjectMapResponse {
  files: Array<{
    path: string;
    type: 'file' | 'directory';
    size?: number;
    lastModified?: string;
  }>;
  dependencies?: Record<string, string>;
}

export interface KeywordsResponse {
  keywords: string[];
  language: string;
  context?: string;
}

export interface AnalysisResponse {
  errors: Array<{
    line: number;
    column: number;
    message: string;
    severity: 'error' | 'warning' | 'info';
  }>;
  suggestions?: string[];
  complexity?: number;
}

// Connection configuration
export interface ConnectionConfig {
  url: string;
  options?: {
    transports?: ('websocket' | 'polling')[];
    timeout?: number;
    autoConnect?: boolean;
    reconnection?: boolean;
    reconnectionDelay?: number;
    reconnectionAttempts?: number;
  };
}

// API configuration
export interface ApiConfig {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

// Error types
export class ConnectionError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'ConnectionError';
  }
}

export class RequestError extends Error {
  constructor(
    message: string,
    public code?: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'RequestError';
  }
}

export class TimeoutError extends Error {
  constructor(message: string = 'Request timed out') {
    super(message);
    this.name = 'TimeoutError';
  }
}

// Utility types for type-safe API calls
export type ApiEndpoint<T = any, P = any> = {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'COMMAND';
  endpoint: string;
  requestType: RequestType;
  requestPayload?: P;
  responseType?: T;
};

// Type helpers for the API
export type ApiMethod<T = any, P = any> = (
  payload?: P,
  options?: ApiConfig
) => Promise<T>;

// Project-specific API interface
export interface ProjectApi {
  getProjectMap: ApiMethod<ProjectMapResponse, ProjectMapPayload>;
  getKeywords: ApiMethod<KeywordsResponse>;
  analyzeCode: ApiMethod<AnalysisResponse, AnalyzePayload>;
  updateFile: ApiMethod<{ success: boolean }, FileUpdatePayload>;
  getProjectInfo: ApiMethod<any, ProjectInfoPayload>;
}

const connectionTypes = {
  ConnectionError,
  RequestError,
  TimeoutError,
};

export default connectionTypes;
