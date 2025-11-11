# Server Technical Documentation

## Overview

The server component is a Node.js/TypeScript application that analyzes JavaScript/TypeScript projects, provides file relationship mapping, and communicates with clients via Socket.IO WebSocket connections.

## Architecture

### Core Components

#### 1. Entry Point (`src/index.ts`)
- **Purpose**: Application bootstrap and initialization
- **Key Responsibilities**:
  - Parse command-line arguments to get project path
  - Load project configuration from `~/.code-ai/projects/{encoded-path}/config.json`
  - Initialize Project instance
  - Start Socket.IO WebSocket server on port 3789
  - Set up file watching for project changes
  - Register native event handlers (mapProject, mapFile, saveFile)
  - Broadcast project content changes to all clients

**Handler Registration**:
```typescript
const handlers = {
  mapProject: async (socket, payload, ack) => { ... },
  mapFile: async (socket, payload, ack) => { ... },
  saveFile: async (socket, payload, ack) => { ... },
};
startServer(3789, handlers);
```
Each handler receives the socket, payload, and optional acknowledgment callback.

#### 2. Project Manager (`src/project.ts`)
- **Purpose**: Core project analysis and management
- **Class**: `Project`
- **Key Responsibilities**:
  - File discovery using glob patterns
  - Project-wide relationship mapping (imports/exports)
  - File-specific code analysis
  - File save operations
  - File watching callbacks
  
**Public API Methods**:
- `processCommand(type: string, payload: any)` - Route and handle client commands
- `watch(callback)` - Register callback for file system changes
- `reloadProject()` - Refresh file list from disk
- `recreateProjectMap()` - Regenerate import/export hierarchy

**Supported Commands**:
- `mapProject` - Returns complete project file hierarchy
- `mapFile` - Returns detailed analysis of specific file (includes, function declarations, calls)
  - `filename: string` - Target file path
  - `includeRelated: boolean` - Include imported and importing files
- `saveFile` - Write content to file
  - `filename: string` - Target file path
  - `content: string` - New file content
  - `pos?: number` - Optional start position for partial update
  - `end?: number` - Optional end position for partial update

**Internal State**:
- `files: string[]` - List of discovered project files
- `projectMap: FileIncludeInfo[]` - Import/export relationships
- `config: ProjectConfig` - Project configuration (include/exclude masks)

#### 3. WebSocket Server (`src/wsserver.ts`)
- **Purpose**: Socket.IO communication layer
- **Technology**: Socket.IO v4.8.1 with CORS enabled
- **Port**: 3789

**Communication Patterns**:

Uses native Socket.IO named events instead of generic wrappers:

1. **Request-response events (with acknowledgment)**:
   ```typescript
   socket.on('mapProject', async (payload, ack) => {
     const result = await handler(socket, payload);
     ack({ success: true, data: result });
   })
   ```
   - Client sends named event and expects callback acknowledgment
   - Callback (ack) receives response with data or error

2. **Server → Client broadcast events**:
   ```typescript
   io.emit('projectContentChange', data)
   ```
   - Server broadcasts events to all connected clients
   - Events like `projectMap`, `fileMap`, `projectContentChange`

**API Functions**:
- `startServer(port, handlers: Record<string, Handler>)` - Initialize server with handler object
- `broadcast(event: string, data: any)` - Broadcast to all connected clients
- Handler signature: `async (socket: Socket, payload: any, ack?: Function) => void`

#### 4. File I/O (`src/io.ts`)
- **Purpose**: File system operations and configuration management

**Functions**:
- `getProjectFiles(projectPath, includeMask, excludeMask?)` - Glob-based file discovery
  - Returns relative paths from project root
- `openFile(filename, projectPath)` - Read file content as UTF-8 string
- `saveFile(filename, projectPath, content)` - Write file content
- `watchDirectory(path, onChange)` - Watch directory for changes using chokidar
- `loadConfiguration(projectPath)` - Load project config from `~/.code-ai/`
- `saveConfiguration(projectPath, conf)` - Save project config

**Default Configuration**:
```typescript
{
  includeMask: '**/*.{ts,tsx,js,jsx}',
  excludeMask: ['**/node_modules/**']
}
```

**Configuration Storage**:
- Location: `~/.code-ai/projects/{URL-encoded-absolute-path}/config.json`
- Creates directories recursively if needed

#### 5. Code Analyzers (`src/analyzers/`)

**Analyzer Registry** (`analyzers/index.ts`):
- `getAnalyzer(ext: string)` - Returns appropriate analyzer
- Currently only JavaScript/TypeScript analyzer available

**JavaScript/TypeScript Analyzer** (`analyzers/js.ts`):
- **Technology**: TypeScript Compiler API
- **Capabilities**:
  - Parse source files as TSX (handles all JS/TS variants)
  - Extract import declarations (ES6 and CommonJS require)
  - Extract function declarations
  - Extract function calls with arguments
  - Resolve relative import paths
  - Auto-complete incomplete imports with common extensions

**Key Functions**:
- `extractFilesHierarchy(filenames, getFileContent)` - Build project-wide import graph
  - Returns: `FileIncludeInfo[]` - Array of `{from, to, items}` relationships
  
- `extractFileMapping(filename, content, projectFiles)` - Analyze single file
  - Returns: `FileMapping` object with:
    - `includes: FileIncludeInfo[]` - Import statements
    - `functionDeclarations: FunctionDeclarationInfo[]` - Function definitions
    - `functionCalls: FunctionCallInfo[]` - Function invocations

- `tryAutoResolveProjectModule(incompleteFilename, projectFiles)` - Resolve imports
  - Attempts to match incomplete paths against project files
  - Tests suffixes: `.js`, `.ts`, `.jsx`, `.tsx`, `.d.ts`, `/index.*`

**Data Extraction**:
- Walks TypeScript AST using visitor pattern
- Handles both import/export and require/module.exports patterns
- Extracts position information (pos, end) for all elements
- Resolves relative paths to project-relative paths

### Type Definitions (`src/types.d.ts`)

```typescript
interface FileIncludeInfo {
  to: string;      // File doing the import
  from: string;    // File being imported
  items: string[]; // Imported symbols
}

interface FunctionDeclarationInfo {
  name: string;
  filename: string;
  pos: number;     // Character offset start
  end: number;     // Character offset end
  args: string[];
}

interface FunctionCallInfo {
  name: string;
  filename: string;
  pos: number;
  end: number;
  args: string[];
}

interface FileMapping {
  includes: FileIncludeInfo[];
  functionDeclarations: FunctionDeclarationInfo[];
  functionCalls: FunctionCallInfo[];
}

interface ProjectConfig {
  includeMask: string;
  excludeMask?: string | string[];
}

interface ProjectChangeEvent {
  type: 'add' | 'change' | 'remove';
  path: string;
}
```

## Technology Stack

- **Runtime**: Node.js
- **Language**: TypeScript 4.1.2
- **Module System**: CommonJS (target: ES5)
- **Key Dependencies**:
  - `socket.io@^4.8.1` - WebSocket communication
  - `typescript@^4.1.2` - TypeScript compiler API for code analysis
  - `chokidar@^3.4.3` - File system watching
  - `glob@^7.1.6` - File pattern matching
  - `ts-node-dev@^1.0.0` - Development server with auto-reload

## Build & Development

**Scripts**:
- `yarn start` - Start development server with auto-reload
- `yarn test` - Run Jest tests

**Configuration**:
- `tsconfig.json`: Strict mode enabled, CommonJS modules
- `jest.config.js`: Test configuration

## Communication Protocol

### Client → Server

**Native Event Format** (named events with acknowledgment):
```javascript
// Map project (full hierarchy)
socket.emit('mapProject', payload, (response) => {
  // response: { success: true, data: [...] }
})

// Map file (detailed analysis)
socket.emit('mapFile', { filename, includeRelated }, (response) => {
  // response: { success: true, data: [...] }
})

// Save file
socket.emit('saveFile', { filename, content, pos?, end? }, (response) => {
  // response: { success: true }
})
```

### Server → Client

**Broadcast Events** (fire-and-forget):
```javascript
// Project map update
io.emit('projectMap', data)

// File map update  
io.emit('fileMap', data)

// File system change notification
io.emit('projectContentChange', { type, path })
```

**Event Types**:
- `mapProject` (request) - Returns: `FileIncludeInfo[]` - Complete import/export hierarchy
- `mapFile` (request) - Returns: `FileMapDetailed[]` - File analysis with related files
- `saveFile` (request) - Returns: `{ success: boolean }` - File write confirmation
- `projectMap` (broadcast) - Sends: Complete project hierarchy to all clients
- `fileMap` (broadcast) - Sends: File map data to all clients
- `projectContentChange` (broadcast) - Sends: `{ type, path }` on file system changes

## File System Watching

- **Library**: Chokidar
- **Events**: add, change, remove (unlink)
- **Behavior**: Any change triggers project reload and map regeneration
- **Change Propagation**: Server broadcasts `projectContentChange` to all clients

## Configuration Management

- **Storage**: `~/.code-ai/projects/{encoded-project-path}/config.json`
- **Encoding**: Project path is URL-encoded for file system safety
- **Auto-creation**: Directories created recursively on first save
- **Default Config**: Applied if no custom config exists

## Error Handling

- Unrecognized commands throw error
- File not found errors propagated to client
- Path traversal prevented (filename cannot contain `..`)
- Socket errors logged but don't crash server
- Configuration errors logged, defaults used as fallback

## Extension Points

**Adding New Analyzers**:
1. Create new analyzer in `src/analyzers/`
2. Implement interface matching `js.ts` pattern
3. Register in `analyzers/index.ts` `getAnalyzer()` function
4. Return `FileMapping` structure from analysis

**Adding New Commands**:
1. Add case to `Project.processCommand()` switch statement
2. Implement handler method `handleCommand{Name}()`
3. Return structured response for client
4. Update type definitions if needed

## Testing

- **Framework**: Jest with ts-jest
- **Test Files**: `src/analyzers/js.test.ts`
- **Snapshots**: Stored in `__snapshots__/`

## Performance Considerations

- File watching triggers full project reload (could be optimized for single-file changes)
- TypeScript AST parsing is synchronous and memory-intensive for large files
- No caching of parsed ASTs (reparsed on every request)
- Glob operations scan entire directory tree
- Multiple clients share same Project instance

## Security Considerations

- CORS enabled for all origins (development-focused)
- No authentication on WebSocket connections
- File paths validated to prevent directory traversal
- Configuration stored in user home directory
- Server binds to localhost only (not explicitly configured)

## Known Limitations

- Only supports JavaScript/TypeScript files
- No incremental parsing (full reparse on changes)
- Single project per server instance
- No multi-language project support
- File watching may miss rapid successive changes
- Large projects may have slow initial load times
