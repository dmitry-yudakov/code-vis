# JS/TS Analyzer Improvement Plan

**Created:** November 11, 2025  
**Status:** Planning Phase

## Overview

This document outlines a comprehensive plan to improve function call detection in the JavaScript/TypeScript analyzer, addressing critical gaps in JSX/React support and modern JavaScript patterns.

---

## Current Gaps Summary

### Critical (High Priority)
1. **JSX Elements** - Not detected as function calls (React components)
2. **Constructor Calls** - `new MyClass()` not detected

### Important (Medium Priority)
3. **Property Access Chains** - Only captures method name, loses object context
4. **Tagged Template Literals** - styled-components, SQL templates not detected

### Nice to Have (Lower Priority)
5. **Optional Chaining Calls** - `obj?.method()` 
6. **Indirect/Computed Calls** - `(func)()`, `arr[0]()`

---

## Implementation Plan

### Phase 1: JSX Element Detection (CRITICAL)

**Objective:** Detect JSX elements as function calls for React codebases

**SyntaxKind Types to Add:**
- `JsxOpeningElement` - `<Component>`
- `JsxSelfClosingElement` - `<Component />`

**Implementation Steps:**

1. **Add JSX Element Extraction Function**
   ```typescript
   const extractJsxElementCalls = (
     filename: string,
     sourceFile: ts.SourceFile
   ): FunctionCallInfo[] => {
     // Search for opening elements: <Component>
     const openingElements = searchFor(sourceFile, SyntaxKind.JsxOpeningElement);
     
     // Search for self-closing elements: <Component />
     const selfClosingElements = searchFor(sourceFile, SyntaxKind.JsxSelfClosingElement);
     
     return [...openingElements, ...selfClosingElements]
       .map(node => ({
         name: node.tagName.escapedText || node.tagName.getText(),
         args: extractJsxAttributes(node), // Convert JSX props to args
         pos: node.pos + (node.getLeadingTriviaWidth?.() || 0),
         end: node.end,
         filename,
         isJsx: true // Flag to distinguish JSX calls
       }));
   };
   ```

2. **Handle JSX Attributes as Arguments**
   ```typescript
   const extractJsxAttributes = (node: JsxElement): string[] => {
     // Convert <Component prop1="value" prop2={expr} /> 
     // to argument list representation
     return node.attributes.properties.map(attr => {
       if (attr.initializer) {
         return attr.initializer.text || 'EXPR:...';
       }
       return 'true'; // Boolean props without value
     });
   };
   ```

3. **Integrate into `extractFunctionCalls`**
   ```typescript
   const extractFunctionCalls = (filename: string, sourceFile: ts.SourceFile): FunctionCallInfo[] => {
     const regularCalls = searchFor(sourceFile, SyntaxKind.CallExpression)...;
     const jsxCalls = extractJsxElementCalls(filename, sourceFile);
     
     return [...regularCalls, ...jsxCalls].sort((a, b) => a.pos - b.pos);
   };
   ```

**Edge Cases to Handle:**
- JSX fragments: `<>...</>`
- Namespaced components: `<Component.Subcomponent>`
- Member expressions: `<obj.Component>`
- Intrinsic elements: `<div>`, `<span>` (lowercase HTML tags)

**Test Cases:**
```typescript
test('JSX opening element', () => {
  const content = `<Button onClick={handler}>Click</Button>`;
  // Should detect Button as function call
});

test('JSX self-closing element', () => {
  const content = `<Input value={val} onChange={fn} />`;
  // Should detect Input as function call
});

test('JSX nested components', () => {
  const content = `<Container><Header /><Body /></Container>`;
  // Should detect Container, Header, Body
});

test('JSX with intrinsic elements', () => {
  const content = `<div><span>Text</span></div>`;
  // Should detect div and span
});
```

**Estimated Effort:** 4-6 hours

---

### Phase 2: Constructor Call Detection

**Objective:** Detect `new` expressions as function calls

**SyntaxKind to Add:**
- `NewExpression`

**Implementation Steps:**

1. **Add Constructor Call Extraction**
   ```typescript
   const extractConstructorCalls = (
     filename: string,
     sourceFile: ts.SourceFile
   ): FunctionCallInfo[] => {
     return searchFor(sourceFile, SyntaxKind.NewExpression)
       .map(node => {
         const name = node.expression.escapedText || 
                     node.expression.name?.escapedText ||
                     'AnonymousClass';
         
         const args = node.arguments?.map(arg => 
           arg.text || `EXPR:${arg.expression?.escapedText}...` || 'n/a'
         ) || [];
         
         return {
           name,
           args,
           pos: node.pos + (node.getLeadingTriviaWidth?.() || 0),
           end: node.end,
           filename,
           isConstructor: true // Flag for constructor calls
         };
       });
   };
   ```

2. **Integrate into `extractFunctionCalls`**

**Built-in Constructor Handling:**

Add a list of standard built-in constructors that should be flagged:
```typescript
const BUILTIN_CONSTRUCTORS = new Set([
  'Date', 'Array', 'Object', 'String', 'Number', 'Boolean', 'RegExp',
  'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Error', 'TypeError',
  'RangeError', 'SyntaxError', 'URIError', 'EvalError', 'ArrayBuffer',
  'DataView', 'Int8Array', 'Uint8Array', // ... etc
]);

// Add flag to FunctionCallInfo
return {
  name,
  args,
  isBuiltin: BUILTIN_CONSTRUCTORS.has(name),
  isConstructor: true,
  // ... rest
};
```

This allows consumers to filter out built-ins if desired, similar to how non-local imports are filtered.

**Test Cases:**
```typescript
test('simple constructor call', () => {
  const content = `const obj = new MyClass();`;
  // Should detect MyClass as constructor call, isBuiltin: false
});

test('builtin constructor', () => {
  const content = `const now = new Date(2025, 10, 11);`;
  // Should detect Date with 3 arguments, isBuiltin: true
});

test('namespaced constructor', () => {
  const content = `const obj = new utils.Helper();`;
  // Should detect utils.Helper, isBuiltin: false
});
```

**Estimated Effort:** 2-3 hours

---

### Phase 3: Property Access Chain Tracking

**Objective:** Capture full object.method() chains, not just method name

**Current Behavior:**
```typescript
obj.method() → name: "method" (loses "obj")
a.b.c.method() → name: "method" (loses "a.b.c")
```

**Desired Behavior:**
```typescript
obj.method() → name: "obj.method" or { object: "obj", method: "method" }
a.b.c.method() → name: "a.b.c.method" or chain: ["a", "b", "c", "method"]
```

**Implementation Steps:**

1. **Update Call Expression Handler**
   ```typescript
   const extractFullCallChain = (node: CallExpression): string => {
     if (node.expression.kind === SyntaxKind.PropertyAccessExpression) {
       const chain = [];
       let current = node.expression;
       
       // Walk up the property access chain
       while (current.kind === SyntaxKind.PropertyAccessExpression) {
         chain.unshift(current.name.escapedText);
         current = current.expression;
       }
       
       // Add the root identifier
       if (current.escapedText) {
         chain.unshift(current.escapedText);
       }
       
       return chain.join('.');
     }
     
     // Fallback to current behavior
     return node.expression.escapedText || 
            node.expression?.name?.escapedText;
   };
   ```

2. **Update FunctionCallInfo Type** (in types.d.ts)
   ```typescript
   interface FunctionCallInfo {
     name: string;           // Full chain: "obj.method"
     callChain?: string[];   // Optional: ["obj", "method"]
     filename: string;
     pos: number;
     end: number;
     args: string[];
   }
   ```

**Edge Cases:**
- Computed property access: `obj['method']()`
- Chained calls: `obj.method1().method2()`
- Mix of property and element access: `obj.arr[0].method()`

**Test Cases:**
```typescript
test('property access call', () => {
  const content = `console.log('test');`;
  // Should detect name: "console.log"
});

test('deep property chain', () => {
  const content = `app.services.database.connect();`;
  // Should detect name: "app.services.database.connect"
});

test('chained method calls', () => {
  const content = `str.trim().toLowerCase();`;
  // Should detect both "str.trim" and "?.toLowerCase" (from result)
});
```

**Estimated Effort:** 3-4 hours

---

### Phase 4: Tagged Template Literals

**Objective:** Detect tagged template function calls (styled-components, SQL builders)

**SyntaxKind to Add:**
- `TaggedTemplateExpression`

**Implementation Steps:**

1. **Add Tagged Template Extraction**
   ```typescript
   const extractTaggedTemplateCalls = (
     filename: string,
     sourceFile: ts.SourceFile
   ): FunctionCallInfo[] => {
     return searchFor(sourceFile, SyntaxKind.TaggedTemplateExpression)
       .map(node => {
         const name = node.tag.escapedText || 
                     node.tag.name?.escapedText ||
                     extractFullCallChain(node.tag);
         
         // Template strings are tricky - just mark as TEMPLATE
         const templateContent = node.template.getText().substring(0, 50);
         
         return {
           name,
           args: [`TEMPLATE:\`${templateContent}...\``],
           pos: node.pos + (node.getLeadingTriviaWidth?.() || 0),
           end: node.end,
           filename,
           isTaggedTemplate: true
         };
       });
   };
   ```

**Test Cases:**
```typescript
test('styled component', () => {
  const content = `const Button = styled.button\`color: red;\`;`;
  // Should detect "styled.button"
});

test('SQL template', () => {
  const content = `const query = sql\`SELECT * FROM users\`;`;
  // Should detect "sql"
});

test('custom tag function', () => {
  const content = `const str = myTag\`Hello \${name}\`;`;
  // Should detect "myTag"
});
```

**Estimated Effort:** 2-3 hours

---

### Phase 5: Optional Chaining & Advanced Patterns

**Objective:** Support modern JavaScript call patterns

**Implementation Steps:**

1. **Optional Chaining**
   - Already handled by CallExpression if expression is PropertyAccessExpression
   - May need to check for QuestionDotToken
   - Extract with optional indicator: `obj?.method` vs `obj.method`

2. **Indirect Calls**
   ```typescript
   // ParenthesizedExpression: (func)()
   // ElementAccessExpression: arr[0](), obj['method']()
   
   const extractIndirectCalls = (node: CallExpression): string => {
     if (node.expression.kind === SyntaxKind.ParenthesizedExpression) {
       return extractFromParenthesized(node.expression);
     }
     if (node.expression.kind === SyntaxKind.ElementAccessExpression) {
       return extractFromElementAccess(node.expression);
     }
     // ... existing logic
   };
   ```

**Test Cases:**
```typescript
test('optional chaining call', () => {
  const content = `user?.getName?.();`;
  // Should detect getName with optional marker
});

test('array element call', () => {
  const content = `callbacks[0]();`;
  // Should detect as callbacks[0] or similar
});

test('parenthesized call', () => {
  const content = `(getCallback())();`;
  // Should detect the call
});
```

**Estimated Effort:** 2-3 hours

---

### Phase 6: Testing & Documentation

**Test Coverage Goals:**
- ✅ All new call patterns have positive tests
- ✅ Edge cases covered (nested, chained, mixed)
- ✅ Snapshot tests updated
- ✅ Performance tests (large files with many JSX elements)

**Documentation Updates:**

1. **Update JS_ANALYZER_TECH_DOC.md:**
   - Add section on JSX call detection
   - Document new FunctionCallInfo properties
   - List all supported call patterns
   - Add examples for each pattern

2. **Update Known Limitations:**
   - Remove fixed items
   - Add any new limitations discovered

3. **Add Migration Notes:**
   - Breaking changes (if any)
   - New data structure fields
   - Backward compatibility considerations

**Estimated Effort:** 3-4 hours

---

## Implementation Order (Recommended)

### Sprint 1 (High Priority - Core Call Detection)
1. **Phase 1: JSX Elements** - Most critical for React codebases
2. **Phase 2: Constructor Calls** - Common pattern, easy win, includes built-in flagging
3. **Phase 8a: Tests for Phase 1-2** - Ensure quality

### Sprint 2 (Medium Priority - Improve Context)
4. **Phase 3: Property Chains** - Improves context for method calls
5. **Phase 4: Tagged Templates** - Important for styled-components users
6. **Phase 8b: Tests for Phase 3-4** - Ensure quality

### Sprint 3 (Complete the Graph)
7. **Phase 7: Export Detection** - Completes import/export relationships
8. **Phase 5: Advanced Patterns** - Optional chaining, indirect calls
9. **Phase 8c: Tests for Phase 5-7** - Ensure quality

### Sprint 4 (Polish & Document)
10. **Phase 9: Final Documentation** - Update all docs with new features

---

## Total Estimated Effort

- **Phase 1 (JSX):** 4-6 hours
- **Phase 2 (Constructors):** 2-3 hours
- **Phase 3 (Property Chains):** 3-4 hours
- **Phase 4 (Tagged Templates):** 2-3 hours
- **Phase 5 (Advanced):** 2-3 hours
- **Phase 7 (Exports):** 4-6 hours
- **Phase 8 (Testing):** 4-5 hours
- **Phase 9 (Documentation):** 2-3 hours

**Total: 23-33 hours** (3-4 full work days)

---

## Breaking Changes & Migration

### Potential Breaking Changes:

1. **More function calls detected** - Consumers expecting only explicit calls may see JSX elements now
2. **Name format changes** - Property chains now include full path (`obj.method` vs `method`)
3. **New optional fields** - `isJsx`, `isConstructor`, `isTaggedTemplate`, `callChain`

### Migration Strategy:

- Add feature flags for backward compatibility
- Version the output format
- Provide data transformation helpers
- Update all consumers in the same release

---

## Success Metrics

- ✅ All test cases pass
- ✅ JSX test shows `<Button>`, `<div>` as function calls
- ✅ Constructor test shows `new MyClass()` detected
- ✅ Property chain test shows full `obj.method` names
- ✅ Performance: <10% degradation on large files
- ✅ Zero regressions in existing functionality

---

## Risk Assessment

### Low Risk:
- Constructor calls - straightforward addition
- Tagged templates - isolated feature

### Medium Risk:
- Property chains - Changes existing behavior, may affect consumers
- JSX elements - Complex, many edge cases

### High Risk:
- None identified

### Mitigation:
- Comprehensive test coverage before implementation
- Feature flags for gradual rollout
- Run against real-world codebases for validation

---

## Already Supported (No Work Needed) ✅

These patterns are **already working** in the current implementation:

1. **Import aliases:** `import { a as b } from './m'`
   - Extracts the alias name (`b`) which is correct for tracking usage
   
2. **Namespace imports:** `import * as ns from './m'`
   - Extracts the namespace identifier (`ns`)

Both are tested and working in `js.test.ts`.

---

## Phase 7: Export Detection (RECOMMENDED - Completes the Graph)

**Objective:** Track what each file exports to validate import/export relationships and detect dead code

**Why This Fits Here:**
Your tool builds a **complete project call graph**. Currently you track:
- ✅ What files import (dependencies)
- ✅ What functions are declared
- ✅ What functions are called
- ❌ What files export (missing piece!)

Without export tracking, you can't:
- Validate that imports match actual exports
- Detect exported functions never imported anywhere (dead code)
- Show complete "provider → consumer" relationships
- Distinguish between public API (exported) vs internal functions

**Architecture Fit:**
The `FileMapping` structure naturally extends to include exports:
```typescript
interface FileMapping {
  includes: FileIncludeInfo[];      // What this file imports
  exports: FileExportInfo[];        // NEW: What this file exports
  functionDeclarations: FunctionDeclarationInfo[];
  functionCalls: FunctionCallInfo[];
}
```

**SyntaxKind Types to Add:**
- `ExportAssignment` - `module.exports = ...`, `export = ...`
- `ExportDeclaration` - `export { a, b }`, `export * from './m'`
- `ExportSpecifier` - Individual items in export lists
- Check variable/function declarations with `ExportKeyword` modifier

**Implementation Steps:**

1. **Define Export Info Type** (in types.d.ts)
   ```typescript
   export interface FileExportInfo {
     from: string;           // File doing the export
     items: string[];        // What's being exported
     isDefault?: boolean;    // Default export?
     isReExport?: boolean;   // Re-export from another file?
     reExportFrom?: string;  // Source file if re-export
   }
   ```

2. **Add Export Extraction Function**
   ```typescript
   const extractExports = (
     filename: string,
     sourceFile: ts.SourceFile
   ): FileExportInfo[] => {
     const exports: FileExportInfo[] = [];
     
     // ES6 named exports: export { a, b }
     searchFor(sourceFile, SyntaxKind.ExportDeclaration).forEach(node => {
       if (node.exportClause?.elements) {
         const items = node.exportClause.elements.map(
           el => el.name.escapedText
         );
         const reExportFrom = node.moduleSpecifier?.text;
         
         exports.push({
           from: filename,
           items,
           isReExport: !!reExportFrom,
           reExportFrom
         });
       }
     });
     
     // ES6 default export: export default ...
     searchFor(sourceFile, SyntaxKind.ExportAssignment).forEach(node => {
       // Get name from expression if possible
       const name = node.expression?.name?.escapedText || 'default';
       exports.push({
         from: filename,
         items: [name],
         isDefault: true
       });
     });
     
     // Export declarations: export const x = ..., export function f() {}
     sourceFile.statements.forEach(statement => {
       if (statement.modifiers?.some(m => m.kind === SyntaxKind.ExportKeyword)) {
         const name = extractNameFromStatement(statement);
         if (name) {
           exports.push({
             from: filename,
             items: [name]
           });
         }
       }
     });
     
     // CommonJS: module.exports = ..., module.exports.x = ...
     // (More complex - need to find assignments to module.exports)
     const moduleExports = extractCommonJSExports(sourceFile, filename);
     exports.push(...moduleExports);
     
     return exports;
   };
   ```

3. **CommonJS Export Extraction**
   ```typescript
   const extractCommonJSExports = (
     sourceFile: ts.SourceFile,
     filename: string
   ): FileExportInfo[] => {
     const exports: FileExportInfo[] = [];
     
     // Find: module.exports = { a, b }
     // Find: module.exports.something = ...
     // This requires traversing BinaryExpression with left side matching
     // module.exports pattern
     
     searchFor(sourceFile, SyntaxKind.BinaryExpression)
       .filter(node => {
         // Check if left side is module.exports
         return node.left?.expression?.escapedText === 'module' &&
                node.left?.name?.escapedText === 'exports';
       })
       .forEach(node => {
         // Extract what's being assigned
         const items = extractItemsFromExportAssignment(node.right);
         if (items.length) {
           exports.push({ from: filename, items });
         }
       });
     
     return exports;
   };
   ```

4. **Integrate into FileMapping**
   ```typescript
   const extractFileMapping = (
     filename: string,
     content: string,
     projectFilenames: string[] = []
   ): FileMapping => {
     const sourceFile = parseFile(filename, content);
     
     const includes = extractIncludes(filename, content, sourceFile);
     const exports = extractExports(filename, sourceFile); // NEW
     const functionDeclarations = extractFunctionDeclarations(filename, sourceFile);
     const functionCalls = extractFunctionCalls(filename, sourceFile);
     
     return { includes, exports, functionDeclarations, functionCalls };
   };
   ```

5. **Update Project Hierarchy**
   - Consider adding a project-level export map similar to import hierarchy
   - Or keep exports in individual file mappings (simpler)

**Edge Cases to Handle:**
- Re-exports: `export { x } from './other'`
- Export all: `export * from './other'`
- Export with rename: `export { x as y }`
- Default + named exports in same file
- Destructured exports: `module.exports = { a: func1, b: func2 }`
- Conditional exports (probably ignore)

**Test Cases:**
```typescript
test('ES6 named export', () => {
  const content = `export const func = () => {};`;
  // Should detect export of 'func'
});

test('ES6 default export', () => {
  const content = `export default function main() {}`;
  // Should detect default export of 'main'
});

test('Export list', () => {
  const content = `
    const a = 1;
    const b = 2;
    export { a, b };
  `;
  // Should detect exports of 'a' and 'b'
});

test('Re-export', () => {
  const content = `export { func } from './utils';`;
  // Should detect re-export from './utils'
});

test('CommonJS module.exports', () => {
  const content = `module.exports.helper = function() {};`;
  // Should detect export of 'helper'
});

test('CommonJS object export', () => {
  const content = `module.exports = { a: funcA, b: funcB };`;
  // Should detect exports of 'a' and 'b'
});
```

**Benefits for Your Call Graph:**
1. **Validation**: Verify imports match actual exports
2. **Dead Code Detection**: Find exported but never imported items
3. **Complete Graph**: Show full provider/consumer relationships
4. **API Surface**: Distinguish public (exported) vs internal functions
5. **Refactoring Safety**: Know what's part of public API before changing

**Integration with UI:**
```typescript
// In generateConnections():
const exportedItems = new Set(mapping.exports.flatMap(exp => exp.items));
const includedItems = new Set(mapping.includes.flatMap(incl => incl.items));

// Now you can:
// - Show if a function call is to an exported function (public API)
// - Warn if importing something that's not exported
// - Highlight dead exports (exported but never imported anywhere)
```

**Estimated Effort:** 4-6 hours

---

## Future Enhancements (Beyond This Plan)

### Nice to Have:

2. **Type-aware call detection** - Use TypeScript type checker
3. **React Hook detection** - Identify custom hooks
4. **Dynamic import()** calls
5. **Decorator invocations**
6. **Generator/async iterator calls**
7. **Call graph visualization** - Map caller → callee relationships

---

*Plan created: November 11, 2025*
*Updated: Added built-in constructor handling, clarified already-supported features*
