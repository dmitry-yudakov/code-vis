# WebSocket API

Socket.IO server on port 3789. All communication uses named events — no generic `command` wrapper.

## Client → Server (request-response with acknowledgment)

```typescript
socket.emit('mapProject', payload,
  (res: { success: boolean; data: FileIncludeInfo[] }) => {})

socket.emit('mapFile', { filename: string; includeRelated: boolean },
  (res: { success: boolean; data: FileMapDetailed[] }) => {})

socket.emit('mapFocusedReview', { source: ChangeSourceRequest },
  (res: { success: boolean; data: FocusedReviewMap }) => {})

socket.emit('saveFile', { filename: string; content: string; pos?: number; end?: number },
  (res: { success: boolean }) => {})
```

Via `projectApi` (high-level, preferred):

```typescript
const map   = await projectApi.getProjectMap()
const files = await projectApi.getFileMap(filename, true)
const review = await projectApi.getFocusedReview({ mode: 'diff' })
const branch = await projectApi.getFocusedReview({ mode: 'branch', baseRef: 'origin/main' })
await projectApi.saveFile(filename, content, pos?, end?)
```

`mapFocusedReview` accepts either `{ mode: 'diff' }` for local uncommitted changes or `{ mode: 'branch', baseRef?: string }` for branch-vs-base review scope. If `baseRef` is omitted, the server tries `origin/HEAD`, then `origin/main`, `origin/master`, `main`, `master`, and finally falls back to `master`.

## Server → Client (broadcasts to all clients)

| Event | Payload | When |
|-------|---------|------|
| `projectContentChange` | `{ type: 'add'\|'change'\|'remove', path: string }` | File system change detected |
| `projectMap` | `FileIncludeInfo[]` | Server sends updated project hierarchy |
| `fileMap` | `FileMapDetailed[]` | Server sends file analysis results |
| `focusedReviewMap` | `FocusedReviewMap` | Server sends change-focused review results when no ack callback is used |

Via `projectApi` subscriptions (each returns an unsubscribe function):

```typescript
projectApi.onProjectChange(handler)
projectApi.onProjectMap(handler)
projectApi.onFileMap(handler)
```

## Types

```typescript
interface FileMapDetailed {
  filename?: string;
  content: string;
  mapping: FileMapping;  // { includes, functionDeclarations, functionCalls }
}

interface ProjectChangeEvent {
  type: 'add' | 'change' | 'remove';
  path: string;
}

type ChangedFileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

type ChangeSource =
  | { mode: 'diff' }
  | { mode: 'branch'; baseRef: string };

type ChangeSourceRequest =
  | { mode: 'diff' }
  | { mode: 'branch'; baseRef?: string };

interface ChangedFileInfo {
  filename: string;
  status: ChangedFileStatus;
  addedLines?: Array<{ start: number; end: number }>;
  removedLines?: Array<{ start: number; end: number }>;
}

interface ChangeSet {
  source: ChangeSource;
  files: ChangedFileInfo[];
}

interface RelatedReason {
  type:
    | 'changed'
    | 'imports-changed'
    | 'imported-by-changed'
    | 'function-neighbor';
  via?: string;
}

interface FocusedFileInfo {
  filename: string;
  reasons: RelatedReason[];
  isChanged: boolean;
  changeStatus?: ChangedFileStatus;
}

interface FocusedDeclarationReason {
  type:
    | 'changed'
    | 'calls-changed'
    | 'called-by-changed'
    | 'bridge-between-changes';
  via?: string;
}

interface FocusedDeclarationInfo {
  id: string;
  name: string;
  filename: string;
  pos: number;
  end: number;
  args: string[];
  reasons: FocusedDeclarationReason[];
  isChanged: boolean;
  changeStatus?: ChangedFileStatus;
  startLine?: number;
  endLine?: number;
}

interface FocusedDeclarationCallInfo {
  id: string;
  from: string;
  to: string;
  name: string;
  filename: string;
  pos: number;
  end: number;
  reasons: FocusedDeclarationReason[];
  isHeuristic: boolean;
}

interface FocusedReviewMap {
  changeSet: ChangeSet;
  files: FocusedFileInfo[];
  includes: FileIncludeInfo[];
  declarations: FocusedDeclarationInfo[];
  declarationCalls: FocusedDeclarationCallInfo[];
}
```

See [analyzer.md](analyzer.md) for `FileMapping`, `FunctionCallInfo`, etc.

`FocusedReviewMap.includes` contains only dependency edges where both endpoints are in the focused file set. The focused file set starts with changed files and adds one-hop import neighbors.

`FocusedReviewMap.declarations` contains changed declarations plus direct caller/callee declaration context when the analyzer can map changed diff hunks to declaration ranges. It also includes short bridge declarations when changed declarations are connected by an explainable directed call chain. `declarationCalls` are heuristic call edges between those visible declarations.

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
