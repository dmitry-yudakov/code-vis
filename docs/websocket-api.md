# WebSocket API

Socket.IO server on port 3789. All communication uses named events — no generic `command` wrapper.

## Client → Server (request-response with acknowledgment)

```typescript
socket.emit('mapProject', payload,
  (res: { success: boolean; data: FileIncludeInfo[] }) => {})

socket.emit('mapFile', { filename: string; includeRelated: boolean },
  (res: { success: boolean; data: FileMapDetailed[] }) => {})

socket.emit('saveFile', { filename: string; content: string; pos?: number; end?: number },
  (res: { success: boolean }) => {})
```

Via `projectApi` (high-level, preferred):

```typescript
const map   = await projectApi.getProjectMap()
const files = await projectApi.getFileMap(filename, true)
await projectApi.saveFile(filename, content, pos?, end?)
```

## Server → Client (broadcasts to all clients)

| Event | Payload | When |
|-------|---------|------|
| `projectContentChange` | `{ type: 'add'\|'change'\|'remove', path: string }` | File system change detected |
| `projectMap` | `FileIncludeInfo[]` | Server sends updated project hierarchy |
| `fileMap` | `FileMapDetailed[]` | Server sends file analysis results |

Via `projectApi` subscriptions (each returns an unsubscribe function):

```typescript
projectApi.onProjectChange(handler)
projectApi.onProjectMap(handler)
projectApi.onFileMap(handler)
```

## Types

```typescript
interface FileMapDetailed {
  content: string;
  mapping: FileMapping;  // { includes, functionDeclarations, functionCalls }
}

interface ProjectChangeEvent {
  type: 'add' | 'change' | 'remove';
  path: string;
}
```

See [analyzer.md](analyzer.md) for `FileMapping`, `FunctionCallInfo`, etc.

## SocketConnection (`web/src/connection/connection.ts`)

```typescript
class SocketConnection {
  request<T>(event: string, data?: any): Promise<T>  // ack-based
  emit(event: string, data?: any): void              // fire-and-forget
  on(event: string, handler: (data: any) => void): () => void  // subscribe
  disconnect(): void
  isConnected(): boolean
}
```

URL: `ws://localhost:3789`. Auto-reconnection and HTTP polling fallback built in.
