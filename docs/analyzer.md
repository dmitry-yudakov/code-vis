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
  callKind?: 'call' | 'constructor' | 'jsx-component' | 'tagged-template' | 'callback-reference';
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

**Imports**: ES6 `import` (default, named, namespace, mixed) and CommonJS `require`. Relative imports (paths starting with `.`) resolve against the importing file's directory. Bare ES `import` specifiers (e.g. `selectors/hints`) are treated as possible path aliases and kept **only when they suffix-match a real project file** via `resolveBareIncludePath`; otherwise they're dropped as external packages. Missing extensions are auto-completed via `tryAutoResolveProjectModule`. (CommonJS `require` still keeps relative specifiers only.)

**Function declarations**: `function f()`, `const f = () =>`, class methods. Sole `const x = () => {}` declarations capture the full `VariableStatement` in `pos`/`end`. Sorted by position.

**Call-like nodes** — all four `SyntaxKind` types:
- `CallExpression` — regular and method calls (`callKind` omitted, defaults to `'call'`)
- `NewExpression` — constructor calls (`callKind: 'constructor'`, `isBuiltin` set for JS builtins)
- `JsxOpeningElement` / `JsxSelfClosingElement` — uppercase-initial tags only (`callKind: 'jsx-component'`); lowercase intrinsics (`div`, `span`) are excluded
- `TaggedTemplateExpression` — template tags (`callKind: 'tagged-template'`)
- Bare callback references in known higher-order call positions — e.g. `items.find(hasValue)`, `promise.then(handleDone)`, `setTimeout(tick)` (`callKind: 'callback-reference'`)
- `super()` calls are excluded

## Key Internal Functions

- `resolveCallee(expression, sourceFile)` → `ResolvedCalleeInfo` — determines `name`, `calleeText`, `callChain`, `receiverKind`, `isOptional`
- `extractSimplePropertyChain(expression)` → `string[] | null` — walks property access chains; returns `null` if chain contains a call result or element access
- `inferReceiverKind(expression)` → `ReceiverKind`
- `tryAutoResolveProjectModule(incomplete, projectFiles)` — appends common suffixes (`.js`, `.ts`, `.jsx`, `.tsx`, `.d.ts`, `/index.*`) to resolve extensionless imports
- `resolveBareIncludePath(specifier, projectFiles)` — resolves a non-relative specifier to a project file by path-suffix match (heuristic stand-in for tsconfig `baseUrl`/`paths`); returns `null` for external packages
- `searchFor(tree, kind)` — recursive AST traversal via `ts.forEachChild`

## Compatibility Rule

`FunctionCallInfo.name` is always the terminal callable token (e.g. `log` for `console.log()`). All richer context is in optional fields. Existing consumers matching by `name` are unaffected by new fields.

## Known Limitations

- No dynamic imports (`require(dynamicPath)`, `import(...)`)
- No re-export tracking (`export { x } from './y'`)
- No decorator extraction
- `str.trim().toLowerCase()` — `toLowerCase` gets `receiverKind: 'call-result'`, no `calleeText`
- Intrinsic JSX tags intentionally excluded
- Callback-reference extraction is heuristic and limited to common array/promise/timer APIs; arbitrary higher-order functions are not inferred
- No real `baseUrl`/`paths` resolution. Path-aliased imports are matched heuristically by path suffix (`resolveBareIncludePath`), so a package subpath that coincidentally matches a project file (e.g. `lodash/fp` vs a local `lodash/fp.ts`) can be mis-linked. **Future:** read the analyzed project's `tsconfig.json`/`jsconfig.json` `baseUrl` + `paths` for exact alias resolution.
- Unresolved imports are dropped silently (only a `console.log` server-side); the map gives no signal that an edge is missing. **Future:** surface unresolved / external imports (e.g. an "unresolved" marker or external-package node) so the graph can flag them instead of hiding them.
