# Server

Node.js/TypeScript application. Analyzes project files, watches for changes, serves data over Socket.IO.

**Port**: 3789  
**Entry**: `src/index.ts`

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Bootstrap: parse CLI args, load config, init Project, start Socket.IO, file watching |
| `src/project.ts` | `Project` class: file discovery, analysis dispatch, file save |
| `src/wsserver.ts` | Socket.IO server setup, named event routing |
| `src/io.ts` | File system: glob, read, write, watch, config load/save |
| `src/analyzers/js.ts` | TypeScript Compiler API analyzer |
| `src/analyzers/index.ts` | Analyzer registry (`getAnalyzer(ext)`) |
| `src/types.d.ts` | Shared type definitions |

## Project Class (`src/project.ts`)

```typescript
class Project {
  processCommand(type: string, payload: any): Promise<any>
  watch(callback: (event: ProjectChangeEvent) => void): void
  reloadProject(): Promise<void>
  recreateProjectMap(): Promise<void>
}
```

**Commands**:
- `mapProject` → `FileIncludeInfo[]`
- `mapFile({ filename, includeRelated })` → `FileMapDetailed[]`
- `mapFocusedReview({ source })` → `FocusedReviewMap`
- `saveFile({ filename, content, pos?, end? })` → writes file

### Focused Review Mapping

`mapFocusedReview` builds a smaller graph for review workflows:

- `source: { mode: 'diff' }` uses `git status --porcelain` and includes local uncommitted and untracked files.
- `source: { mode: 'branch', baseRef?: string }` finds a merge base between `HEAD` and the base ref, then runs `git diff --name-status --find-renames <merge-base> HEAD`.
- If `baseRef` is omitted, the server tries `origin/HEAD`, `origin/main`, `origin/master`, `main`, `master`, then falls back to `master`.

The response includes changed files, their statuses (`added`, `modified`, `deleted`, `renamed`), parsed diff line ranges when available, one-hop dependency neighbors, and only dependency edges where both endpoints are in the focused file set. Related files are marked with reasons such as `imports-changed` or `imported-by-changed`.

When changed hunks overlap analyzer-visible declarations, the response also includes `declarations` and `declarationCalls`. Declaration nodes preserve file/range data, mark changed declarations, add direct caller/callee context with heuristic reasons such as `calls-changed` and `called-by-changed`, and include short bridge paths with `bridge-between-changes` when changed declarations are connected by a small directed call chain.

## WebSocket Server (`src/wsserver.ts`)

```typescript
startServer(port: number, handlers: Record<string, Handler>): void
broadcast(event: string, data: any): void
// Handler: async (socket, payload, ack?) => void
```

Named event routing — no generic `command` wrapper. Handlers receive optional `ack` callback for request-response. See [websocket-api.md](websocket-api.md) for the full protocol.

## File I/O (`src/io.ts`)

- `getProjectFiles(projectPath, includeMask, excludeMask?)` → `string[]` (project-relative paths)
- `openFile(filename, projectPath)` → `string`
- `saveFile(filename, projectPath, content)` → writes UTF-8
- `watchDirectory(path, onChange)` → chokidar watcher
- `loadConfiguration(projectPath)` / `saveConfiguration(projectPath, conf)`

Config location: `~/.code-ai/projects/{url-encoded-path}/config.json`  
Default: `{ includeMask: "**/*.{ts,tsx,js,jsx}", excludeMask: ["**/node_modules/**"] }`

## Security

- File paths validated against `..` traversal
- CORS open (dev tool, localhost-only intent)
- No auth on WebSocket connections

## Tech Stack

- Node.js, TypeScript (CommonJS, ES5 target)
- `socket.io@^4.8.1`, `typescript@^4.1.2`, `chokidar@^3.4.3`, `glob@^7.1.6`
- Tests: Jest + ts-jest (`yarn test`)
- Dev: `yarn start path/to/project` (ts-node-dev)
