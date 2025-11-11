# JavaScript/TypeScript Analyzer - Technical Documentation

## Overview

The `js.ts` analyzer is a core module that performs static code analysis on JavaScript and TypeScript files using the TypeScript Compiler API. It extracts file dependencies, function declarations, and function calls to build a comprehensive code structure map.

## Primary Functions

### 1. `extractFilesHierarchy(filenames: string[], getFileContent: (filename: string) => Promise<string>): Promise<FileIncludeInfo[]>`

**Purpose**: Analyzes multiple files to extract dependency relationships between them.

**Input**:
- `filenames`: Array of file paths to analyze
- `getFileContent`: Async function that retrieves file content by filename

**Output**: Array of `FileIncludeInfo` objects containing:
```typescript
{
  from: string,      // Source file path (dependency)
  to: string,        // Target file path (dependent)
  items: string[]    // List of imported/required identifiers
}
```

**Process Flow**:
1. Iterates through all provided filenames
2. Retrieves content for each file via `getFileContent` callback
3. Parses each file using TypeScript compiler
4. Extracts import/require statements
5. Resolves relative paths to absolute project paths
6. Auto-resolves incomplete module paths (missing extensions)
7. Returns flattened array of all dependencies

**Supported Import Patterns**:
- ES6 imports: `import`, `import *`, `import { ... }`, `import ... as`
- CommonJS: `require()` with const/let/var declarations
- Named exports, default exports, namespace imports
- Destructured imports/requires

**Filtering**:
- Only processes local/relative imports (starting with `.`)
- Ignores node_modules and external packages
- Ignores dynamic requires (non-string literals)
- Ignores side-effect-only imports (no imported identifiers)

---

### 2. `extractFileMapping(filename: string, content: string, projectFilenames: string[] = []): FileMapping`

**Purpose**: Performs comprehensive static analysis on a single file to extract its complete structure.

**Input**:
- `filename`: Path to the file being analyzed
- `content`: Source code content as string
- `projectFilenames`: Optional array of project files for path resolution

**Output**: `FileMapping` object containing:
```typescript
{
  includes: FileIncludeInfo[],              // Dependencies (imports/requires)
  functionDeclarations: FunctionDeclarationInfo[],  // Function definitions
  functionCalls: FunctionCallInfo[]         // Function invocations
}
```

**Data Structures**:

#### `FunctionDeclarationInfo`:
```typescript
{
  name: string,        // Function/method name
  filename: string,    // File path
  pos: number,         // Start position in source (excluding leading trivia)
  end: number,         // End position in source
  args: string[]       // Parameter names
}
```

#### `FunctionCallInfo`:
```typescript
{
  name: string,        // Called function name
  filename: string,    // File path
  pos: number,         // Start position in source
  end: number,         // End position in source
  args: string[]       // Arguments (literals or EXPR: placeholders)
}
```

**Extracted Function Types**:
1. **Regular functions**: `function name() {}`
2. **Arrow functions**: `const name = () => {}`
3. **Async functions**: `async function name() {}`
4. **Class methods**: `methodName() {}`
5. **Class property functions**: `propFunc = () => {}`
6. **Mixed declarations**: `const a = () => {}, b = () => {}`

**Special Handling**:
- Detects sole vs. multiple variable declarations for arrow functions
- Includes leading trivia (comments, whitespace) in position calculation
- Supports TypeScript syntax and JSX/TSX
- Handles async/await patterns
- Filters out callback functions passed as arguments

---

## Helper Functions

### `parseFile(filename: string, content: string): ts.SourceFile`
Creates TypeScript AST from source code. Uses `ts.ScriptKind.TSX` as the "worst case" to support all syntax variants (JS, TS, JSX, TSX).

### `extractIncludes(filename: string, content: string, sourceFile: ts.SourceFile): FileIncludeInfo[]`
Internal function that extracts both `import` and `require` statements from a parsed source file.

### `extractFunctionDeclarations(filename: string, sourceFile: ts.SourceFile): FunctionDeclarationInfo[]`
Searches AST for function declarations, arrow functions, and class methods. Returns sorted array by position.

### `extractFunctionCalls(filename: string, sourceFile: ts.SourceFile): FunctionCallInfo[]`
Searches AST for call expressions, excluding special cases like `super()`.

### `resolveRelativeIncludePathInPlace(info: FileIncludeInfo): void`
Converts relative paths (`.`, `..`) to absolute project paths. Mutates the `info.from` property in-place.

**Algorithm**:
1. Split target path into tokens
2. Remove filename (keep directory path)
3. Process source path tokens:
   - `.` → no-op
   - `..` → pop from path stack
   - Other → push to path stack
4. Join tokens to create resolved path

### `tryAutoResolveProjectModule(incompleteFilename: string, projectFiles: string[]): string | null`
Attempts to resolve module paths without extensions by trying common suffixes.

**Supported Suffixes**:
- `.js`, `.ts`, `.jsx`, `.tsx`, `.d.ts`
- `/index.js`, `/index.ts`, `/index.jsx`, `/index.tsx`

**Example**: `'./utils'` → `'./utils.ts'` or `'./utils/index.ts'`

### `searchFor(tree: any, kind: SyntaxKind, result?: any[], path?: string[]): any[]`
Recursive AST traversal to find all nodes of a specific `SyntaxKind`. Includes infinite recursion protection (max depth: 100).

---

## TypeScript Compiler API Integration

The analyzer leverages the TypeScript Compiler API for robust parsing:

**Key SyntaxKind Values Used**:
- `ImportDeclaration` - ES6 import statements
- `CallExpression` - Function calls and require()
- `FunctionDeclaration` - Regular function definitions
- `ArrowFunction` - Arrow function expressions
- `MethodDeclaration` - Class methods
- `VariableDeclaration` - Variable bindings for arrow functions
- `StringLiteral` - String literals in require paths

**AST Node Properties**:
- `kind` - Node type identifier
- `pos` - Start position (includes trivia)
- `end` - End position
- `escapedText` - Identifier names
- `parent` - Parent node reference
- `getLeadingTriviaWidth()` - Width of whitespace/comments before node

---

## Test Coverage

The test suite (`js.test.ts`) validates:

### Import/Require Detection:
- ✅ Same directory imports
- ✅ Different subdirectory imports  
- ✅ Parent directory navigation
- ✅ Default exports
- ✅ Named exports `{ a, b }`
- ✅ Mixed exports `default, { a, b }`
- ✅ Multiple imports per file
- ✅ Multi-line imports
- ✅ Import aliases `as`
- ✅ Namespace imports `* as`
- ✅ CommonJS require with const/let/var
- ✅ Destructured requires
- ❌ Clauseless imports (ignored)
- ❌ Dynamic requires (ignored)
- ❌ node_modules (ignored)

### Function Mapping:
- ✅ Regular functions
- ✅ Arrow functions (single/multi-line)
- ✅ Arrow functions in complex statements
- ✅ Class methods and property functions
- ✅ Async/await functions
- ✅ Async class methods
- ✅ JSX/React components
- ✅ Nested function declarations
- ✅ Function position extraction
- ✅ Argument extraction

---

## Usage Patterns

### Pattern 1: Build Dependency Graph
```typescript
const files = ['src/index.ts', 'src/utils.ts', 'src/config.ts'];
const hierarchy = await jsAnalyzer.extractFilesHierarchy(
  files,
  async (filename) => fs.readFile(filename, 'utf-8')
);
// Result: Array of { from, to, items } showing file dependencies
```

### Pattern 2: Analyze Single File
```typescript
const content = await fs.readFile('src/app.ts', 'utf-8');
const mapping = jsAnalyzer.extractFileMapping(
  'src/app.ts',
  content,
  allProjectFiles
);
// Result: { includes, functionDeclarations, functionCalls }
```

### Pattern 3: Function Reference Map
```typescript
const mapping = jsAnalyzer.extractFileMapping(filename, content);
mapping.functionCalls.forEach(call => {
  const declaration = mapping.functionDeclarations.find(
    decl => decl.name === call.name
  );
  if (declaration) {
    console.log(`${call.name} defined at ${declaration.pos}-${declaration.end}`);
  }
});
```

---

## Performance Considerations

1. **AST Parsing**: Each file is parsed once via TypeScript compiler (O(n) per file)
2. **AST Traversal**: Recursive search with depth protection (max 100 levels)
3. **Path Resolution**: Token-based path manipulation (O(path depth))
4. **Auto-resolution**: Linear search through project files for incomplete paths
5. **Memory**: AST nodes contain `parent` references (circular) - stripped in debug output

**Optimization Notes**:
- Files are processed in parallel via `Promise.all`
- AST is traversed multiple times for different node types (imports, functions, calls)
- Consider caching parsed ASTs for repeated analysis

---

## Error Handling

**Logged Errors** (non-throwing):
- Missing import module specifiers
- Unresolved import/require items
- Unexpected AST node structures
- Failed auto-resolution of module paths
- Ignored non-local imports

**Thrown Errors**:
- AST traversal exceeding 100 depth levels
- Critical parsing failures in extractIncludes

**Debug Mode**:
Set `process.env.DEBUG=1` to enable detailed logging in tests.

---

## Known Limitations

1. **Dynamic Imports**: Not supported
   ```javascript
   const module = require(dynamicPath); // Ignored
   import(dynamicPath); // Not detected
   ```

2. **Side-effect Imports**: Ignored
   ```javascript
   import './styles.css'; // Not tracked
   ```

3. **Re-exports**: Not explicitly tracked
   ```javascript
   export { something } from './other'; // May not be captured
   ```

4. **Computed Property Names**: Limited support
   ```javascript
   class X { [computed]() {} } // May not extract correctly
   ```

5. **Generators/Iterators**: Function detection works, but not specifically marked

6. **Decorators**: Not extracted as separate entities

---

## Integration Points

### Input Sources:
- File system via `fs.readFile`
- In-memory content (testing)
- Virtual file systems
- Network sources (via async callback)

### Output Consumers:
- Dependency graph builders
- Code navigation tools
- Refactoring utilities
- Documentation generators
- Code complexity analyzers
- Import/export validators

---

## Future Enhancements

1. **Type Information**: Extract type annotations and interfaces
2. **Export Detection**: Track what each file exports
3. **Comment Extraction**: JSDoc and inline comments
4. **Scope Analysis**: Variable scope and closure tracking
5. **Control Flow**: Conditional imports/requires
6. **Module Resolution**: Full Node.js resolution algorithm
7. **Incremental Parsing**: Cache and update only changed files
8. **Source Maps**: Support for bundled/transpiled code

---

## API Summary

```typescript
interface JsAnalyzer {
  // Build cross-file dependency graph
  extractFilesHierarchy(
    filenames: string[],
    getFileContent: (filename: string) => Promise<string>
  ): Promise<FileIncludeInfo[]>;

  // Analyze single file structure
  extractFileMapping(
    filename: string,
    content: string,
    projectFilenames?: string[]
  ): FileMapping;
}

export default JsAnalyzer;
```

---

## Version & Compatibility

- **TypeScript Compiler API**: Uses latest ScriptTarget
- **Supported Languages**: JavaScript (ES5+), TypeScript, JSX, TSX
- **Node.js**: Requires Node.js for TypeScript compiler
- **Dependencies**: `typescript`, `path` (built-in)

---

## Debugging Tips

1. **Enable Debug Output**: Set `DEBUG=1` environment variable
2. **AST Inspection**: Use `pp()` helper to strip parent references
3. **Position Validation**: Extract code slices using `content.slice(pos, end)`
4. **Test Snapshot**: Run with `--updateSnapshot` to refresh test expectations
5. **AST Visualization**: Use TypeScript Playground or AST Explorer

---

*Last Updated: November 11, 2025*
