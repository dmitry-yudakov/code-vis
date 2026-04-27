# Architecture

## Overview

code-vis analyzes JavaScript/TypeScript projects statically and renders the results as interactive graphs. Users point the server at a project directory; the web client connects and displays file dependency graphs and function call maps.

## Components

### Server (`server/`)
Node.js + TypeScript. Reads project files from disk, analyzes them with the TypeScript Compiler API, and serves results via Socket.IO.

- Entry: `src/index.ts`
- Analyzer: `src/analyzers/js.ts`
- Communication: `src/wsserver.ts` (Socket.IO, port 3789)
- File I/O: `src/io.ts`
- Project state: `src/project.ts`
- Types: `src/types.d.ts`

### Web (`web/`)
React 19 SPA. Connects to server via Socket.IO, renders views using react-flow-renderer.

- Entry: `src/index.tsx` → `src/App.tsx`
- Connection: `src/connection/`
- Components: `src/components/`
- Types: `src/types.d.ts` (must match server copy)

### Extension (`extension/`)
VS Code extension. Was functionally equivalent to the server but embedded in the editor. Not actively maintained.

## Data Flow

```
Disk files
    │
    ▼
server/src/analyzers/js.ts   (TypeScript Compiler API: parse → extract)
    │
    ▼
server/src/project.ts        (Project state, file watching)
    │
    ▼  Socket.IO port 3789
web/src/connection/          (SocketConnection, projectApi)
    │
    ▼
web/src/App.tsx              (state: projectMap, filesMappings)
    │
    ├── IncludesHierarchy    (/ route — project dependency graph)
    ├── FilesMapping         (/f/:filename — file-level view)
    └── LogicMap             (/fine/:filename — function-level view)
```

## Shared Types

`FileIncludeInfo`, `FunctionCallInfo`, `FunctionDeclarationInfo`, `FileMapping` are defined in both `server/src/types.d.ts` and `web/src/types.d.ts`. Both copies must be kept identical.

## Configuration

Stored per-project at `~/.code-ai/projects/{url-encoded-absolute-path}/config.json`:
```json
{
  "includeMask": "**/*.{ts,tsx,js,jsx}",
  "excludeMask": ["**/node_modules/**"]
}
```
