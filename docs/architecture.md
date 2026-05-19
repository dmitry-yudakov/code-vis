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
    ├── IncludesHierarchy    (/ route — project dependency graph and review scopes)
    ├── FilesMapping         (/f/:filename — file-level view)
    └── LogicMap             (/fine/:filename — function-level view)
```

## Overview Scopes

The homepage opens in `Overview`, which starts at a module/directory dependency scale. Users can expand a module into files, then expand a selected file into analyzer-visible declarations. File-to-declaration expansion is loaded on demand with `mapFile` and reuses the cached `filesMappings` data in the web app.

## Review Scopes

The root graph can switch from whole-project exploration to a change-focused review scope:

- `Diff` uses local git status to show uncommitted and untracked changes.
- `Branch / PR` compares the current branch to a base ref using a local git merge base. The UI name reflects the review workflow, but this path does not currently call a remote PR API.

Both review scopes return a `FocusedReviewMap`: changed files, one-hop import neighbors, dependency edges between the visible focused files, and a declaration-level projection when changed hunks overlap analyzer-visible functions/methods. Declaration review includes changed declarations, direct caller/callee context, and short bridge call paths between changed declarations when they can be explained by analyzer-visible calls.

## Shared Types

`FileIncludeInfo`, `FunctionCallInfo`, `FunctionDeclarationInfo`, `FileMapping`, and focused review types (`ChangeSet`, `FocusedReviewMap`, etc.) are defined in both `server/src/types.d.ts` and `web/src/types.d.ts`. Both copies must be kept identical.

## Configuration

Stored per-project at `~/.code-ai/projects/{url-encoded-absolute-path}/config.json`:
```json
{
  "includeMask": "**/*.{ts,tsx,js,jsx}",
  "excludeMask": ["**/node_modules/**"]
}
```
