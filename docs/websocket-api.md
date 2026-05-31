# WebSocket API

Socket.IO server on port 3789. All communication uses named events — no generic `command` wrapper.

## Client → Server (request-response with acknowledgment)

```typescript
socket.emit('listProjects', undefined,
  (res: { success: boolean; data: ProjectListResponse }) => {})

socket.emit('openProject', { projectId: string },
  (res: { success: boolean; data: OpenProjectResponse }) => {})

socket.emit('mapProject', payload,
  (res: { success: boolean; data: FileIncludeInfo[] }) => {})

socket.emit('mapFile', { filename: string; includeRelated: boolean },
  (res: { success: boolean; data: FileMapDetailed[] }) => {})

socket.emit('mapFocusedReview', { source: ChangeSourceRequest, options?: FocusedReviewOptions },
  (res: { success: boolean; data: FocusedReviewMap }) => {})

socket.emit('listCommits', { limit?: number; skip?: number },
  (res: { success: boolean; data: CommitSummary[] }) => {})

socket.emit('saveFile', { filename: string; content: string; pos?: number; end?: number },
  (res: { success: boolean }) => {})
```

Via `projectApi` (high-level, preferred):

```typescript
const projects = await projectApi.listProjects()
const opened = await projectApi.openProject(projectId)
const map   = await projectApi.getProjectMap()
const files = await projectApi.getFileMap(filename, true)
const review = await projectApi.getFocusedReview({ mode: 'diff' })
const branch = await projectApi.getFocusedReview({ mode: 'branch', baseRef: 'origin/main' })
const commit = await projectApi.getFocusedReview({ mode: 'commit', ref: 'abc1234' })
const recentCommits = await projectApi.listCommits({ limit: 5 })
const reviewWithoutTests = await projectApi.getFocusedReview({ mode: 'diff' }, { includeTests: false })
await projectApi.saveFile(filename, content, pos?, end?)
```

`mapFocusedReview` accepts `{ mode: 'diff' }` for local uncommitted changes, `{ mode: 'branch', baseRef?: string }` for branch-vs-base review scope, or `{ mode: 'commit', ref: string, parentRef?: string }` for the patch introduced by a specific commit. If `baseRef` is omitted, the server tries `origin/HEAD`, then `origin/main`, `origin/master`, `main`, `master`, and finally falls back to `master`. If `parentRef` is omitted for a commit, the server compares against the commit's first parent.

`listCommits` reads recent commits from the current branch in newest-first order. `limit` defaults to 5 and is clamped to 1-50; `skip` defaults to 0. `timestamp` is the git commit time in Unix seconds.

`options.includeTests` controls unchanged related test files. It defaults to `true`, marks detected test files with `isTest`, and adds a `related-test` reason when a test imports changed code or matches a changed source filename.

## Server → Client (broadcasts to all clients)

| Event | Payload | When |
|-------|---------|------|
| `projectsList` | `ProjectListResponse` | Server sends available projects |
| `activeProjectChanged` | `OpenProjectResponse` | Active project changed |
| `projectContentChange` | `{ type: 'add'\|'change'\|'remove', path: string, projectId?: string, projectName?: string, projectPath?: string }` | File system change detected in active project |
| `projectMap` | `FileIncludeInfo[]` | Server sends updated project hierarchy |
| `fileMap` | `FileMapDetailed[]` | Server sends file analysis results |
| `focusedReviewMap` | `FocusedReviewMap` | Server sends change-focused review results when no ack callback is used |
| `commitList` | `CommitSummary[]` | Server sends recent commits when no ack callback is used |

Via `projectApi` subscriptions (each returns an unsubscribe function):

```typescript
projectApi.onProjectsList(handler)
projectApi.onActiveProjectChanged(handler)
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
  projectId?: string;
  projectName?: string;
  projectPath?: string;
}

interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  relativePath: string;
  rootPath: string;
  mtimeMs: number;
  mtime: string;
  lastOpenedAt?: string;
  isActive?: boolean;
}

interface ProjectListResponse {
  rootPath: string;
  projects: ProjectInfo[];
  activeProjectId?: string;
}

interface OpenProjectResponse extends ProjectListResponse {
  project: ProjectInfo;
  projectMap: FileIncludeInfo[];
}

type ChangedFileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

type ChangeSource =
  | { mode: 'diff' }
  | { mode: 'branch'; baseRef: string }
  | { mode: 'commit'; ref: string; parentRef: string };

type ChangeSourceRequest =
  | { mode: 'diff' }
  | { mode: 'branch'; baseRef?: string }
  | { mode: 'commit'; ref: string; parentRef?: string };

interface CommitSummary {
  hash: string;
  shortHash: string;
  subject: string;
  authorName: string;
  timestamp: number;
}

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

interface FocusedReviewOptions {
  includeTests?: boolean;
}

interface RelatedReason {
  type:
    | 'changed'
    | 'imports-changed'
    | 'imported-by-changed'
    | 'function-neighbor'
    | 'related-test';
  via?: string;
}

interface FocusedFileInfo {
  filename: string;
  reasons: RelatedReason[];
  isChanged: boolean;
  isTest: boolean;
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

`FocusedReviewMap.includes` contains only dependency edges where both endpoints are in the focused file set. The focused file set starts with changed files and adds one-hop import neighbors. Related test files are included when `includeTests` is not `false`.

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

Default dev URL: current page origin via Vite's `/socket.io` proxy. Direct server
URL: `http://localhost:3789` or a custom `VITE_SOCKET_URL`. Auto-reconnection
and HTTP polling fallback built in.
