# JS/TS Analyzer

Located at `server/src/analyzers/js.ts`. Uses the TypeScript Compiler API to statically analyze JS/TS/JSX/TSX files.

All files are parsed as `ts.ScriptKind.TSX` to handle all syntax variants with a single code path.

## Public API

```typescript
export default {
  extractFilesHierarchy(
    filenames: string[],
    getFileContent: (filename: string) => Promise<string>
  ): Promise<FileIncludeInfo[]>,

  extractFileMapping(
    filename: string,
    content: string,
    projectFilenames?: string[]
  ): FileMapping,
}
```

## Data Types

```typescript
interface FileIncludeInfo {
  from: string;    // imported file (project-relative)
  to: string;      // file doing the import
  items: string[]; // imported symbols
}

interface FunctionDeclarationInfo {
  name: string; filename: string; pos: number; end: number; args: string[];
}

interface FunctionCallInfo {
  name: string;               // STABLE terminal callable name — never change semantics
  filename: string; pos: number; end: number; args: string[];
  calleeText?: string;        // printable callee, e.g. "console.log", "styled.button"
  callChain?: string[];       // e.g. ["console", "log"]
  callKind?: 'call' | 'constructor' | 'jsx-component' | 'tagged-template';
  receiverText?: string;
  receiverKind?: 'identifier' | 'property' | 'element-access' | 'call-result' | 'unknown';
  isOptional?: boolean;
  isBuiltin?: boolean;        // true for JS built-in constructors (Date, Map, etc.)
}

interface FileMapping {
  includes: FileIncludeInfo[];
  functionDeclarations: FunctionDeclarationInfo[];
  functionCalls: FunctionCallInfo[];
}
```

## Extracted Constructs

**Imports**: ES6 `import` (default, named, namespace, mixed) and CommonJS `require`. Local imports only (paths starting with `.`). Resolves relative paths; auto-completes missing extensions via `tryAutoResolveProjectModule`.

**Function declarations**: `function f()`, `const f = () =>`, class methods. Sole `const x = () => {}` declarations capture the full `VariableStatement` in `pos`/`end`. Sorted by position.

**Call-like nodes** — all four `SyntaxKind` types:
- `CallExpression` — regular and method calls (`callKind` omitted, defaults to `'call'`)
- `NewExpression` — constructor calls (`callKind: 'constructor'`, `isBuiltin` set for JS builtins)
- `JsxOpeningElement` / `JsxSelfClosingElement` — uppercase-initial tags only (`callKind: 'jsx-component'`); lowercase intrinsics (`div`, `span`) are excluded
- `TaggedTemplateExpression` — template tags (`callKind: 'tagged-template'`)
- `super()` calls are excluded

## Key Internal Functions

- `resolveCallee(expression, sourceFile)` → `ResolvedCalleeInfo` — determines `name`, `calleeText`, `callChain`, `receiverKind`, `isOptional`
- `extractSimplePropertyChain(expression)` → `string[] | null` — walks property access chains; returns `null` if chain contains a call result or element access
- `inferReceiverKind(expression)` → `ReceiverKind`
- `tryAutoResolveProjectModule(incomplete, projectFiles)` — appends common suffixes (`.js`, `.ts`, `.jsx`, `.tsx`, `.d.ts`, `/index.*`) to resolve extensionless imports
- `searchFor(tree, kind)` — recursive AST traversal via `ts.forEachChild`

## Compatibility Rule

`FunctionCallInfo.name` is always the terminal callable token (e.g. `log` for `console.log()`). All richer context is in optional fields. Existing consumers matching by `name` are unaffected by new fields.

## Known Limitations

- No dynamic imports (`require(dynamicPath)`, `import(...)`)
- No re-export tracking (`export { x } from './y'`)
- No decorator extraction
- `str.trim().toLowerCase()` — `toLowerCase` gets `receiverKind: 'call-result'`, no `calleeText`
- Intrinsic JSX tags intentionally excluded
