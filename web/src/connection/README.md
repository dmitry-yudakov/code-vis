# Socket.IO Connection Module

This module provides a mixed WebSocket + HTTP-like request/response communication layer using Socket.IO.

## Features

- **Event-based communication**: Traditional WebSocket-style messaging (fire and forget)
- **Request/Response pattern**: HTTP-like request/response with promises and callbacks
- **Automatic reconnection**: Built-in reconnection with exponential backoff
- **Transport fallback**: Automatically falls back to HTTP polling if WebSocket fails
- **Type safety**: Full TypeScript support with comprehensive type definitions
- **Utility functions**: Timeout handling, retry logic, and error management

## Migration from WebSocket

### Before (WebSocket)

```typescript
import { sendToServer } from './connection';

// Fire and forget
sendToServer('map_project', { includeTests: true });
```

### After (Socket.IO - Event Pattern)

```typescript
import { sendToServer } from './connection';

// Fire and forget (same API)
sendToServer('map_project', { includeTests: true });
```

### After (Socket.IO - Request Pattern)

```typescript
import { requestFromServer, api } from './connection';

// Request/response with promises
try {
  const result = await requestFromServer('map_project', { includeTests: true });
  console.log('Project map:', result);
} catch (error) {
  console.error('Failed to get project map:', error);
}

// HTTP-like API
try {
  const projectMap = await api.get('project_map', { includeTests: true });
  const analysis = await api.post('analyze', {
    code: 'const x = 1;',
    language: 'javascript',
  });
} catch (error) {
  console.error('API error:', error);
}
```

## Usage Examples

### 1. Basic Connection Setup

```typescript
import { initConnection } from './connection';

initConnection({
  url: 'http://localhost:3789',
  onOpen: () => console.log('Connected'),
  onMessage: (type, payload) => {
    console.log('Received:', type, payload);
  },
});
```

### 2. Event-Based Communication (Fire and Forget)

```typescript
import { sendToServer } from './connection';

// Send commands without waiting for response
sendToServer('watch_changes', { enabled: true });
sendToServer('update_settings', { theme: 'dark' });
```

### 3. Request/Response Communication

```typescript
import { requestFromServer, api, projectApi } from './connection';

// Raw request
const data = await requestFromServer('get_project_info');

// HTTP-like API
const projectMap = await api.get('project_map');
const result = await api.post('analyze_file', { filePath: 'src/index.ts' });

// Typed project API
const map = await projectApi.getProjectMap({ includeTests: false });
const keywords = await projectApi.getKeywords();
```

### 4. Advanced Features

```typescript
import { api, withRetry, withTimeout } from './connection';

// With timeout and retries
const result = await api.command('heavy_operation', data, {
  timeout: 60000, // 60 seconds
  retries: 3, // Try 3 times
});

// Custom retry logic
const resilientRequest = withRetry(
  (command: string, payload: any) => requestFromServer(command, payload),
  5, // 5 retries
  2000 // 2 second delay
);

const data = await resilientRequest('unreliable_command', { test: true });

// With timeout wrapper
const quickRequest = withTimeout(
  (command: string) => requestFromServer(command),
  5000 // 5 second timeout
);
```

### 5. Error Handling

```typescript
import { ConnectionError, RequestError, TimeoutError } from './connection';

try {
  const result = await api.get('some_endpoint');
} catch (error) {
  if (error instanceof ConnectionError) {
    console.error('Connection failed:', error.message);
  } else if (error instanceof RequestError) {
    console.error('Request failed:', error.message, 'Code:', error.code);
  } else if (error instanceof TimeoutError) {
    console.error('Request timed out');
  }
}
```

## Server-Side Changes

The server now supports both communication patterns:

### Event Handler (existing behavior)

```typescript
socket.on('command', (data) => {
  // Handle command and emit response via 'message' event
  // Used for fire-and-forget operations
});
```

### Request Handler (new)

```typescript
socket.on('request', async (data, callback) => {
  try {
    const result = await handleRequest(data.type, data.payload);
    callback({ success: true, data: result });
  } catch (error) {
    callback({ success: false, error: error.message });
  }
});
```

## Benefits

1. **Backward Compatibility**: Existing WebSocket code continues to work
2. **Progressive Enhancement**: Add request/response where needed
3. **Better Error Handling**: Structured error responses and timeout handling
4. **Reliability**: Automatic reconnection and fallback transports
5. **Developer Experience**: Type-safe API with IntelliSense support
6. **Flexible**: Choose the right pattern for each use case

## When to Use Each Pattern

### Use Event Pattern For:

- Real-time updates (file changes, status updates)
- Fire-and-forget operations
- Broadcasting to multiple clients
- Streaming data

### Use Request Pattern For:

- Data fetching operations
- Operations that need confirmation
- Error handling is important
- Timeout management is needed
- Sequential operations

## Migration Strategy

1. **Keep existing WebSocket calls unchanged** - they'll work with the event pattern
2. **Gradually convert critical operations** to use the request pattern for better reliability
3. **Add new features** using the request pattern by default
4. **Use the HTTP-like API** for operations that map well to REST patterns
