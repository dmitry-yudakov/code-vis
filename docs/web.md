# Web Client

React 19 SPA. Connects to server via Socket.IO, renders interactive graph views.

**Dev port**: 3000  
**Entry**: `src/index.tsx` → `src/App.tsx`

## Routes

| Route | Component | Purpose |
|-------|-----------|---------|
| `/` | `IncludesHierarchy` | Project-wide file dependency graph |
| `/f/:filename` | `FilesMapping` | File-level code structure with CodeMirror editor |
| `/fine/:filename` | `LogicMap` | Function-level graph with Monaco editor |

## State (`App.tsx`)

```typescript
projectMap: FileIncludeInfo[]                      // project-wide import/export graph
filesMappings: Record<string, FileMapDetailed>     // cached file analyses
forceReloadDep: number                             // incremented on server-side changes
connectionStatus: 'connecting' | 'connected' | 'disconnected'
```

Exposed via `ProjectDataContext`. `FileScreen` sub-component holds local state for the current file and related files.

## Connection Layer (`src/connection/`)

- `connection.ts` — `SocketConnection` class wrapping Socket.IO client
- `index.ts` — `projectApi` high-level typed API

```typescript
projectApi.getProjectMap(): Promise<FileIncludeInfo[]>
projectApi.getFileMap(filename: string, includeRelated: boolean): Promise<FileMapDetailed[]>
projectApi.saveFile(filename, content, pos?, end?): Promise<any>
projectApi.onProjectChange(handler): () => void
projectApi.onProjectMap(handler): () => void
projectApi.onFileMap(handler): () => void
```

## Key Components

| Component | File | Notes |
|-----------|------|-------|
| `IncludesHierarchy` | `components/IncludesHierarchy.tsx` | react-flow graph of file deps |
| `FilesMapping` | `components/FilesMapping.tsx` | File view with CodeMirror + React Flow |
| `LogicMap` | `components/LogicMap.tsx` | Function-level React Flow graph |
| `CodeMirror` | `components/CodeMirror.tsx` | Lightweight editor (codemirror@5) |
| `MonacoEditor` | `components/MonacoEditor.tsx` | Full VS Code editor (for LogicMap) |

## Data Flows

**Init**: App mounts → Socket.IO connect → `getProjectMap()` → sets `projectMap` → `IncludesHierarchy` renders

**File nav**: click file → `/f/{filename}` → `getFileMap(filename, true)` → sets local state → `FilesMapping` renders

**Save**: editor save → `saveFile()` → server writes → chokidar detects → `projectContentChange` broadcast → client increments `forceReloadDep` → reload

## Component Hierarchy

```
App (Router + ProjectDataContext.Provider)
├── IncludesHierarchy  (/)
├── FileScreen  (/f/:filename, /fine/:filename)
│   ├── FilesMapping
│   └── LogicMap
└── History (sidebar)
```

## Tech Stack

- React 19, TypeScript 5.6, Vite 5.4 (build to `build/`, dev on port 3000)
- `react-flow-renderer@^11`, `@monaco-editor/react@^4.6`, `codemirror@^5.65`
- `dagre@^0.8.5` (graph layout), `socket.io-client@^4.8.1`, `react-router-dom@^6`
- Tests: Vitest (`yarn test`). Build: `yarn build`. Dev: `yarn dev`
- Vite proxies `/socket.io` to `http://localhost:3789` in dev
