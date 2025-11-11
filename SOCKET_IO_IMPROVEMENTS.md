# Socket.IO Communication Improvements

## Overview of Issues and Solutions

### Problems with Current Implementation

1. **Custom Message Wrapper Anti-Pattern**
   - Current: Everything sent as `{ type, payload }` through generic `command`/`message` events
   - Problem: Defeats Socket.IO's native event system, requires manual type parsing
   - Solution: Use Socket.IO's native event names (mapProject, mapFile, etc.)

2. **Mixed Communication Patterns**
   - Current: Both `command` (event) and `request` (callback) patterns exist
   - Problem: Inconsistent, confusing to use, harder to maintain
   - Solution: Unify on Socket.IO acknowledgments for request-response

3. **Manual Connection Management**
   - Current: Server maintains `socketConnections[]` array
   - Problem: Socket.IO already manages this internally
   - Solution: Use `io.emit()` for broadcasts, socket.emit() for individual

4. **Unused API Layer**
   - Current: `api.ts` with HTTP-like methods (get, post, put, delete) not used
   - Problem: Adds complexity without benefit
   - Solution: Replace with domain-specific API (`projectApi`)

5. **No Type Safety**
   - Current: Generic `any` types everywhere
   - Problem: No autocomplete, no compile-time validation
   - Solution: Define typed interfaces for each operation

## Improved Architecture

### Server-Side Changes

**Before:**
```typescript
// Generic command/request handlers
socket.on('command', (data: { type, payload }) => { ... })
socket.on('request', (data: { type, payload }, callback) => { ... })
```

**After:**
```typescript
// Named event handlers with acknowledgments
const handlers = {
  mapProject: async (socket, payload, ack?) => {
    const result = await project.mapProject();
    if (ack) ack({ success: true, data: result });
    else socket.emit('projectMap', result);
  },
  mapFile: async (socket, payload, ack?) => { ... },
  saveFile: async (socket, payload, ack?) => { ... },
};
```

**Benefits:**
- Each operation has its own event name
- Built-in acknowledgments for responses
- Server can emit results as events OR respond via callback
- Cleaner error handling

### Client-Side Changes

**Before:**
```typescript
// Mixed patterns
sendToServer('mapProject');  // Fire-and-forget
const result = await requestFromServer('mapFile', {...});  // Request-response
```

**After:**
```typescript
// Unified API with domain methods
await projectApi.getProjectMap();
await projectApi.getFileMap(filename, true);
await projectApi.saveFile(filename, content);

// Subscribe to server events
projectApi.onProjectChange((event) => { ... });
```

**Benefits:**
- Type-safe methods
- Consistent async/await pattern
- Domain-specific API is self-documenting
- Easy to add new operations

## Migration Guide

### Step 1: Update Server

Replace `wsserver.ts` with `wsserver.improved.ts`:

```typescript
// Old
startServer(3789, onCommand, onRequest);

// New
startServer(3789, {
  mapProject: async (socket, payload, ack?) => { ... },
  mapFile: async (socket, payload, ack?) => { ... },
  saveFile: async (socket, payload, ack?) => { ... },
});
```

### Step 2: Update Client Connection

Replace connection setup in `App.tsx`:

```typescript
// Old
import { initConnection, sendToServer } from './connection';

useEffect(() => {
  initConnection({ url, onOpen, onMessage });
}, []);

// New
import { initConnection, projectApi } from './connection/index.improved';

useEffect(() => {
  const conn = initConnection(url);
  
  conn.on('connect', () => {
    projectApi.getProjectMap().then(setProjectMap);
  });
  
  const unsubscribe = projectApi.onProjectChange((event) => {
    setForceReloadDep(i => i + 1);
  });
  
  projectApi.onProjectMap(setProjectMap);
  projectApi.onFileMap((data) => {
    const mappingsObj = lodash.keyBy(data, 'filename');
    setFilesMappings(prev => ({ ...prev, ...mappingsObj }));
  });
  
  return () => unsubscribe();
}, []);
```

### Step 3: Update Component Usage

```typescript
// Old
sendToServer('mapFile', { filename, includeRelated: true });

// New
projectApi.getFileMap(filename, true);

// Old
sendToServer('saveFile', { filename, content });

// New
await projectApi.saveFile(filename, content);
```

## Advanced Features You Can Now Add

### 1. Typed Events

```typescript
// Define event types
interface ProjectChangeEvent {
  type: 'add' | 'change' | 'remove';
  path: string;
  timestamp: number;
}

// Use in server
broadcast('projectContentChange', event as ProjectChangeEvent);

// Use in client with type safety
projectApi.onProjectChange((event: ProjectChangeEvent) => {
  console.log(`File ${event.path} was ${event.type}d`);
});
```

### 2. Request Timeouts

```typescript
// Already built into improved connection
await projectApi.getFileMap(filename, true);  // 30s default timeout

// Custom timeout
await connection.request('mapFile', { filename }, 5000);
```

### 3. Rooms for Multi-Project Support

```typescript
// Server: Join project-specific room
socket.on('joinProject', (projectPath) => {
  socket.join(`project:${projectPath}`);
});

// Broadcast to specific project
io.to(`project:${projectPath}`).emit('projectContentChange', event);
```

### 4. Binary Data Support

```typescript
// Socket.IO supports binary data natively
socket.emit('uploadFile', {
  filename: 'image.png',
  buffer: imageBuffer  // Automatically handled as binary
});
```

### 5. Middleware for Auth/Logging

```typescript
io.use((socket, next) => {
  // Authenticate
  const token = socket.handshake.auth.token;
  if (isValid(token)) {
    next();
  } else {
    next(new Error('Authentication failed'));
  }
});
```

## Performance Improvements

### Before:
- Every message wrapped in extra object
- Client parses type string manually
- Server iterates socketConnections array
- No connection pooling

### After:
- Native Socket.IO events (faster parsing)
- Direct event routing (O(1) lookup)
- Built-in broadcast (optimized)
- Connection multiplexing built-in

## Testing

### Mock Socket.IO in Tests

```typescript
import { io } from 'socket.io-client';
import { Server } from 'socket.io';

// Create test server and client
const server = new Server();
const clientSocket = io(`http://localhost:${port}`);

// Test event
await new Promise((resolve) => {
  clientSocket.emit('mapProject', {}, (response) => {
    expect(response.success).toBe(true);
    resolve();
  });
});
```

## Next Steps

1. **Immediate**: Replace `wsserver.ts` → `wsserver.improved.ts`
2. **Phase 2**: Update client connection layer
3. **Phase 3**: Migrate App.tsx to use projectApi
4. **Phase 4**: Add TypeScript interfaces for all events
5. **Phase 5**: Add tests for socket communication

## Backward Compatibility

The improved files maintain backward compatibility through:
- Legacy `sendToServer()` function still available
- `SocketConn` class extends new `SocketConnection`
- Gradual migration path (both patterns can coexist)

## Additional Resources

- [Socket.IO Emit Cheatsheet](https://socket.io/docs/v4/emit-cheatsheet/)
- [Socket.IO Server API](https://socket.io/docs/v4/server-api/)
- [Socket.IO Client API](https://socket.io/docs/v4/client-api/)
