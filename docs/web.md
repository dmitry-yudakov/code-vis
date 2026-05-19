# Web Client

React 19 SPA. Connects to server via Socket.IO, renders interactive graph views.

**Dev port**: 3000  
**Entry**: `src/index.tsx` → `src/App.tsx`

## Routes

| Route | Component | Purpose |
|-------|-----------|---------|
| `/` | `IncludesHierarchy` | Lens-based code map workbench (overview/review) |
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
projectApi.getFocusedReview(source: ChangeSourceRequest): Promise<FocusedReviewMap>
projectApi.saveFile(filename, content, pos?, end?): Promise<any>
projectApi.onProjectChange(handler): () => void
projectApi.onProjectMap(handler): () => void
projectApi.onFileMap(handler): () => void
```

## Key Components

| Component | File | Notes |
|-----------|------|-------|
| `IncludesHierarchy` | `components/IncludesHierarchy.tsx` | Homepage code map workbench with lens shell, summary, and details panels |
| `FilesMapping` | `components/FilesMapping.tsx` | File view with CodeMirror + React Flow |
| `LogicMap` | `components/LogicMap.tsx` | Function-level React Flow graph |
| `CodeMirror` | `components/CodeMirror.tsx` | Lightweight editor (codemirror@5) |
| `MonacoEditor` | `components/MonacoEditor.tsx` | Full VS Code editor (for LogicMap) |

## Project Graph Views

`IncludesHierarchy` is organized around homepage lenses:

| Lens | Purpose |
|------|---------|
| `Overview` | Architecture-first graph, defaulting to module/directory dependencies with drill-down |
| `Review current changes` | Changed files (Diff or Branch / PR) as seeds, with explainable context |
| `Feature focus` | Placeholder for future seed-based exploration |
| `Impact investigation` | Placeholder for future caller/importer impact tracing |

Inside `Overview`, users can switch between:

| Scope | Purpose |
|-------|---------|
| `Modules` | Dependency graph collapsed to parent directories |
| `Entry points` | Entry-point summary graph with configurable dependency depth |
| `All files` | Full project dependency graph (kept as alternate navigation view) |

Inside `Review current changes`, users can switch between:

| Scope | Purpose |
|-------|---------|
| `Diff` | Local uncommitted git changes from `git status --porcelain` |
| `Branch / PR` | Files changed on the current branch compared with a base ref |

`Review` scopes call `projectApi.getFocusedReview()` and render changed files with reason chips. By default they include one-hop dependency context; `Changed only` hides context for a tighter view. The review lens can also switch from file nodes to declaration nodes when changed hunks map to analyzer-visible functions, methods, or arrow declarations. Declaration context includes direct callers/callees plus short bridge call paths between changed declarations.

`Branch / PR` is branch-diff based rather than GitHub API based. The server resolves the base ref, computes a merge base, and compares `merge-base..HEAD`.

## Data Flows

**Init**: App mounts → Socket.IO connect → `getProjectMap()` → sets `projectMap` → `IncludesHierarchy` renders

**File nav**: click file → `/f/{filename}` → `getFileMap(filename, true)` → sets local state → `FilesMapping` renders

**Change-focused review**: click `Diff` or `Branch / PR` → `getFocusedReview({ mode })` → server returns `FocusedReviewMap` → `IncludesHierarchy` renders changed files or changed declarations with optional one-hop/direct-call/bridge context

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
