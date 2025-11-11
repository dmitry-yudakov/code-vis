# Web Client Technical Documentation

## Overview

The web component is a React-based single-page application (SPA) that provides an interactive interface for visualizing project structure, file relationships, and code dependencies. It communicates with the server via Socket.IO WebSocket connections.

## Architecture

### Core Structure

#### 1. Entry Point (`src/index.tsx`)
- **Purpose**: Application bootstrap
- **Responsibilities**:
  - Mount React app to DOM element `#root`
  - Initialize service worker (disabled by default)
- **Technology**: React 17 with ReactDOM

#### 2. Main Application (`src/App.tsx`)
- **Purpose**: Root component with routing and state management
- **State Management**: React hooks (useState, useEffect, useCallback)
- **Key State**:
  - `projectMap: FileIncludeInfo[]` - Project-wide import/export relationships
  - `filesMappings: Record<string, FileMapDetailed>` - Cached file analysis results
  - `forceReloadDep: number` - Trigger for refreshing data on file changes
  - `connectionStatus: 'connecting'|'connected'|'disconnected'` - WebSocket status
  - `history: any[][]` - Event log for debugging

**Routing Structure**:
- `/` - Project overview (IncludesHierarchy component)
- `/f/:filename` - File-level view (FilesMapping component)
- `/fine/:filename` - Fine-grained function-level view (LogicMap component)

**Context Provider**:
```typescript
ProjectDataContext = {
  projectMap: FileIncludeInfo[],
  filesMappings: Record<string, FileMapDetailed>,
  forceReloadToken: number
}
```

**Connection Initialization**:
- On mount: `initConnection()` creates Socket.IO connection
- Subscribes to: `connect`, `disconnect`, `error` events
- On connect: Loads initial project map via `projectApi.getProjectMap()`
- Subscribes to: `projectChange`, `projectMap`, `fileMap` events
- Cleanup: Unsubscribes and disconnects on unmount

**FileScreen Sub-Component**:
- Local state for current file data and related files
- `useEffect` fetches file map when filename changes
- `useCallback` for memoized `getRelatedFile()` function
- Returns related files from local state or context cache
- Component key forces re-render when related files count changes

### Connection Layer (`src/connection/`)

#### Socket.IO Connection (`connection.ts`)

**Class**: `SocketConnection`
- **Purpose**: WebSocket abstraction layer over Socket.IO
- **URL Format**: `ws://localhost:3789`

**Key Methods**:
- `request<T>(event: string, data?: any): Promise<T>` - Send request with acknowledgment callback
  - Returns Promise that resolves to server response
  - Used for request-response patterns (mapProject, mapFile, saveFile)
  
- `emit(event: string, data?: any): void` - Fire-and-forget event sending
  - No response expected
  - Used for one-way notifications

- `on(event: string, handler: (data: any) => void): () => void` - Subscribe to server events
  - Returns unsubscribe function
  - Used for broadcast events (projectContentChange, projectMap, fileMap)

- `disconnect(): void` - Close Socket.IO connection
- `isConnected(): boolean` - Check connection state

**Connection Features**:
- Auto-reconnection on disconnect
- Fallback to polling if WebSocket unavailable
- Event listener for all custom events
- Error handling and logging
- Debug logging with CLIENT markers

#### Project API (`index.ts`)

**Purpose**: High-level typed API for project operations wrapping SocketConnection

**API Methods**:
```typescript
projectApi = {
  getProjectMap(): Promise<FileIncludeInfo[]>
  getFileMap(filename: string, includeRelated: boolean): Promise<FileMapDetailed[]>
  saveFile(filename: string, content: string, pos?: number, end?: number): Promise<any>
  onProjectChange(handler): () => void
  onProjectMap(handler): () => void
  onFileMap(handler): () => void
}
```

**Request Methods** (use acknowledgment):
- `getProjectMap()` - Fetch complete project hierarchy
- `getFileMap(filename, includeRelated)` - Fetch file analysis and related files
- `saveFile(...)` - Save file content to disk

**Event Subscriptions** (listen for broadcasts):
- `onProjectChange(handler)` - Listen for file system changes
- `onProjectMap(handler)` - Listen for project map updates
- `onFileMap(handler)` - Listen for file map broadcasts

**Legacy Compatibility**:
- `sendToServer(command, payload)` - Fire-and-forget event
- `requestFromServer(command, payload)` - Promise-based request

### Visualization Components

#### 1. Includes Hierarchy (`components/IncludesHierarchy.tsx`)
- **Purpose**: Project-level file dependency graph
- **Technology**: react-flow-renderer
- **Features**:
  - Node: Each file in project
  - Edge: Import/export relationships
  - Interactive graph navigation
  - Click file to open detailed view

**Data Flow**:
1. Receives `projectMap` from context
2. Transforms to nodes and edges
3. Applies automatic layout
4. Renders interactive graph

#### 2. Files Mapping (`components/FilesMapping.tsx`)
- **Purpose**: File-level code structure visualization
- **Technology**: react-flow-renderer + CodeMirror
- **Features**:
  - Shows file content with syntax highlighting
  - Displays function declarations and calls
  - Visualizes function call relationships
  - Shows imported and importing files
  - Inline editing with save capability

**Node Types**:
- `LogicNodeType.file` - File nodes
- `LogicNodeType.decl` - Function declarations
- `LogicNodeType.call` - Function calls
- `LogicNodeType.code` - Code blocks

**Handles** (connection points):
- Function declarations: Target handles (left side)
- Function calls: Source handles (right side)
- Enables visual connection between caller and callee

**Editor Integration**:
- Uses CodeMirror for code display/editing
- Supports syntax highlighting
- Real-time editing with save button
- Positioned handles at function locations

#### 3. Logic Map (`components/LogicMap.tsx`)
- **Purpose**: Fine-grained function-level code flow
- **Technology**: react-flow-renderer + Monaco Editor
- **Features**:
  - Function-to-function call graph
  - Expanded code view with nested functions
  - Inline Monaco editor integration
  - More detailed than FilesMapping

**Unique Features**:
- Nested function declarations visible
- Parent-child function relationships
- More granular code navigation
- Better for understanding complex logic flow

**Connection Generation**:
```typescript
generateConnections(
  fd: FunctionDeclarationInfo,
  functionCalls: FunctionCallInfo[],
  mapping: FileMapping,
  uniqIdx: number
)
```
- Creates edges between function declarations and calls
- Resolves imported function targets
- Handles local and external function references

### UI Components (`src/atoms/`)

**Reusable Components**:
- `CloseButton.tsx` - Modal/view close button
- `FilenamePrettyView.tsx` - Formatted file path display
- `Menu.tsx` - Navigation menu component
- `StandoutBar.tsx` - Header/toolbar component

### Code Editors

#### CodeMirror Editor (`components/CodeMirror.tsx`)
- **Purpose**: Lightweight code viewer/editor
- **Library**: codemirror@5.58.3, react-codemirror2@7.2.1
- **Features**:
  - Syntax highlighting
  - Function highlight on hover
  - Custom handles for function declarations/calls
  - Less resource-intensive than Monaco

**Custom Hooks**:
- `useFuncDecl(func)` - Register function declaration handle
- `useFuncCall(func)` - Register function call handle

#### Monaco Editor (`components/MonacoEditor.tsx`)
- **Purpose**: Full-featured code editor
- **Library**: @monaco-editor/react@3.7.2
- **Features**:
  - VS Code editing experience
  - IntelliSense support
  - Better for complex editing
  - More resource-intensive

**Provider Pattern**:
- `MonacoEditorProvider` context wraps editor
- Custom hooks integrate with React Flow handles

### Utility Functions (`src/utils.ts`)

**Key Functions**:
- `buildNodesTree()` - Convert flat function list to tree structure
- `applyGraphLayout()` - Dagre-based automatic graph layout
- `findRelatedFiles()` - Find files that import/export target file
- `funcDeclSlug(func)` - Generate unique ID for function declaration
- `funcCallSlug(func)` - Generate unique ID for function call
- `funcDeclSlugFromPieces(filename, name)` - Create function slug from parts

**Graph Layout**:
- Uses Dagre algorithm for hierarchical layout
- Top-to-bottom or left-to-right orientation
- Automatic spacing and positioning

### Type Definitions (`src/types.d.ts`)

```typescript
interface FileIncludeInfo {
  to: string;      // Importing file
  from: string;    // Imported file
  items: string[]; // Imported symbols
}

interface FunctionCallInfo {
  name: string;
  filename: string;
  pos: number;     // Character offset
  end: number;
  args: string[];
}

interface FunctionDeclarationInfo {
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

interface FileMapDetailed {
  content: string;
  mapping: FileMapping;
}

// Graph types
interface Node {
  id: string;
  label: string;
}

interface Edge {
  source: string;
  target: string;
}

interface PositionedNode extends Node {
  x: number;
  y: number;
}
```

## Technology Stack

- **Framework**: React 17.0.1
- **Language**: TypeScript 4.1.2
- **Build Tool**: Create React App (react-scripts 4.0.1)
- **Module System**: ESNext with JSX support
- **Key Dependencies**:
  - `socket.io-client@^4.8.1` - WebSocket client
  - `react-flow-renderer@^8.0.0` - Graph visualization
  - `@monaco-editor/react@^3.7.2` - Code editor (VS Code engine)
  - `codemirror@^5.58.3` - Alternative lightweight editor
  - `dagre@^0.8.5` - Graph layout algorithm
  - `@material-ui/core@^4.11.2` - UI components
  - `react-router-dom@^5.2.0` - Client-side routing
  - `lodash@^4.17.20` - Utility functions
  - `use-debounce@^5.2.0` - Debounce hooks

## Build & Development

**Scripts**:
- `yarn start` - Development server on port 3000
- `yarn build` - Production build to `build/`
- `yarn test` - Run tests with React Testing Library
- `yarn eject` - Eject from CRA (irreversible)

**Configuration**:
- `tsconfig.json`: Strict mode, JSX transform, no emit
- ESLint extends `react-app` configuration

## Data Flow

### Initialization Flow
1. App mounts → `useEffect` in App.tsx
2. `initConnection(url)` creates Socket.IO connection to server
3. On 'connect' event:
   - `projectApi.getProjectMap()` sends 'mapProject' request with acknowledgment
   - Server responds via callback with `FileIncludeInfo[]`
   - `setProjectMap()` updates state
4. Subscribe to broadcast events:
   - `onProjectChange()` - Listen for file system changes
   - `onProjectMap()` - Listen for project map updates
   - `onFileMap()` - Listen for file map data
5. IncludesHierarchy renders with project structure

### File Navigation Flow
1. User clicks file in graph → Router navigates to `/f/{filename}`
2. `FileScreen` component mounts with `filename` prop
3. `useEffect` in FileScreen:
   - Checks if `filesMappings[filename]` exists in cache
   - If cached: Use cached data
   - If not cached: Call `projectApi.getFileMap(filename, true)`
4. `getFileMap()` sends 'mapFile' request with acknowledgment
5. Server responds via callback with `FileMapDetailed[]` (file + related files)
6. `setLocalFileData()` and `setRelatedFiles()` update local state
7. FilesMapping/LogicMap component renders with:
   - File content and analysis
   - Related files fetched (imported and importing files)
8. Component key changes when related files load → Forces re-render

### File Editing Flow
1. User edits code in CodeMirror/Monaco
2. Clicks save button
3. Component calls `onSave(filename, content, pos?, end?)`
4. `projectApi.saveFile(filename, content, pos, end)` sends 'saveFile' request
5. Server writes file to disk
6. Server file watcher detects change
7. Server broadcasts 'projectContentChange' event to all clients
8. Client receives event via `onProjectChange()`:
   - Calls `projectApi.getProjectMap()` to reload
   - Increments `forceReloadToken` to trigger component refresh
9. UI updates with new data

### Change Detection Flow
1. File changes on disk (external edit or save)
2. Server chokidar watcher detects change
3. Server calls `broadcast('projectContentChange', event)`
4. All connected clients receive 'projectContentChange' event
5. Client's `onProjectChange()` handler triggered
6. Client reloads project map and increments `forceReloadToken`
7. Components with `useEffect` depending on token re-fetch data
8. UI updates automatically to reflect changes

## Communication Protocol

### Client → Server

**Request with Response** (acknowledgment-based):
```typescript
// Get project map
const map = await projectApi.getProjectMap();

// Get file analysis with related files
const files = await projectApi.getFileMap('src/App.tsx', true);

// Save file
await projectApi.saveFile('src/App.tsx', content, startPos, endPos);
```

**Under the hood**:
```javascript
socket.emit('mapProject', payload, (response) => {
  // response: { success: true, data: [...] }
})
```

### Server → Client

**Subscribe to Events** (broadcast):
```typescript
projectApi.onProjectChange(({ type, path }) => {
  // Handle file system change
  console.log(`File ${type}: ${path}`);
});

projectApi.onProjectMap((data) => {
  // Handle project map update
  setProjectMap(data);
});

projectApi.onFileMap((data) => {
  // Handle file map broadcast
  updateFilesMappings(data);
});
```

**Event Types**:
- `projectContentChange` - `{ type: 'add'|'change'|'remove', path: string }`
- `projectMap` - `FileIncludeInfo[]` - Full project hierarchy
- `fileMap` - `FileMapDetailed[]` - File analysis results

## Component Hierarchy

```
App (Router)
├── ProjectDataContext.Provider
│   ├── IncludesHierarchy (/ route)
│   │   └── ReactFlow (graph)
│   ├── FileScreen (/f/:filename)
│   │   ├── FilesMapping
│   │   │   ├── CodeMirrorProvider
│   │   │   ├── ReactFlow
│   │   │   └── StandoutBar + CloseButton
│   │   └── LogicMap (/fine/:filename)
│   │       ├── MonacoEditorProvider
│   │       ├── ReactFlow
│   │       └── StandoutBar + CloseButton
│   └── History (sidebar)
└── Menu (navigation)
```

## State Management Strategy

**Global State** (Context):
- Project map (file relationships)
- File mappings cache
- Force reload trigger

**Local State** (Component):
- UI state (expand/collapse, selections)
- Editor content
- Graph layout positions

**Cache Strategy**:
- File mappings accumulated, not replaced
- Single source of truth in App.tsx
- Context prevents prop drilling

**Reactivity**:
- Changes propagate via context updates
- Components re-render on dependency changes
- WebSocket events trigger state updates

## Styling

- **CSS Modules**: Component-specific stylesheets
- **Material-UI**: Theme and component library
- **Class Management**: clsx for conditional classes
- **Files**:
  - `App.css` - Global app styles
  - `index.css` - Root/reset styles
  - `CodeMirror.css` - Editor-specific styles
  - `FilesMapping.css` - Component styles
  - `LogicMap.css` - Component styles
  - `IncludesHierarchy.css` - Component styles

## Performance Considerations

- **Code Splitting**: React Router enables route-based splitting
- **Memoization**: `useMemo` for expensive computations
- **Debouncing**: `use-debounce` for input and scroll events
- **Caching**: File mappings cached to avoid re-requesting
- **Lazy Loading**: Monaco editor loaded on-demand
- **React Flow**: Virtualization for large graphs

## Known Limitations

- No offline support (service worker disabled)
- Single server connection only
- No authentication/authorization
- Large projects may cause performance issues
- Graph layout can be slow for 100+ files
- No undo/redo for code editing
- Monaco editor increases bundle size significantly

## Browser Support

- Modern browsers (Chrome, Firefox, Safari, Edge)
- ES6+ features required
- WebSocket support required
- No IE11 support

## Testing

- **Framework**: React Testing Library + Jest
- **Test Files**: `src/App.test.tsx`, `setupTests.ts`
- **Coverage**: Limited test coverage currently
- **Integration**: Can mock Socket.IO connections for testing

## Accessibility

- Material-UI provides ARIA attributes
- Keyboard navigation supported in editors
- Screen reader support through semantic HTML
- Focus management in modal views

## Security Considerations

- No input sanitization (trusted local server)
- No XSS protection (trusted content)
- WebSocket connects to localhost only
- No CSRF protection (not needed for local tool)
- Code execution happens server-side only

## Extension Points

**Adding New Visualization**:
1. Create component in `components/`
2. Add route in App.tsx router
3. Use ProjectDataContext for data access
4. Send commands via connection layer

**Adding New Editor**:
1. Create editor component with provider pattern
2. Implement `useFuncDecl` and `useFuncCall` hooks
3. Integrate with React Flow handles
4. Export provider and hooks

**Custom Graph Layouts**:
1. Modify `applyGraphLayout()` in utils.ts
2. Adjust Dagre configuration
3. Or implement custom layout algorithm
4. Return positioned nodes and edges

## Debugging

**History Component**:
- Shows all WebSocket messages received
- Timestamps for each event
- Useful for tracking data flow

**Console Logging**:
- Connection events logged
- Message received/sent logged
- Component mount/unmount logged

**React DevTools**:
- Inspect component tree
- View context values
- Profile performance

**Network Tab**:
- Monitor WebSocket frames
- Check connection status
- Debug reconnection issues
