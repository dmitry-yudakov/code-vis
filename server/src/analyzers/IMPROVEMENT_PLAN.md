# JS/TS Analyzer Improvement Plan

**Created:** November 11, 2025  
**Last Revised:** April 27, 2026  
**Status:** Implemented

## Overview

This document revises the original analyzer improvement plan to make it safe to ship without breaking current consumers.

The main constraint is that the current UI and downstream logic match calls by `FunctionCallInfo.name`. That field must remain backward-compatible while the analyzer learns richer call shapes.

## Goals

1. Detect more real call-like constructs in JS/TS and TSX.
2. Preserve the current meaning of `FunctionCallInfo.name` for existing consumers.
3. Add optional metadata for richer context instead of replacing existing fields.
4. Roll changes out in small phases with regression coverage in both server and web layers.

## Non-Goals

1. Do not change `FunctionCallInfo.name` from terminal callable name to full chain in the first rollout.
2. Do not treat lowercase JSX intrinsic tags like `div` and `span` as function calls.
3. Do not bundle export-graph work into the first call-detection rollout.
4. Do not require TypeScript type-checker integration for this phase.

---

## Current Gaps Summary

### Critical
1. **JSX component usage** - `<Button />` and `<Layout.Header />` are not detected.
2. **Constructor calls** - `new MyClass()` is not detected.

### Important
3. **Call context** - `obj.method()` is reduced to `method`, so receiver context is lost.
4. **Tagged templates** - `styled.button\`...\`` and `sql\`...\`` are not detected.

### Nice to Have
5. **Optional chaining calls** - `obj?.method?.()` lacks explicit metadata.
6. **Indirect/computed calls** - `(fn)()` and `arr[0]()` are not represented consistently.

---

## Compatibility Constraints

The current analyzer and UI rely on these assumptions:

1. `FunctionCallInfo.name` is the terminal callable identifier used for matching against imports and declarations.
2. `FileMapping` is mirrored in both server and web type definitions.
3. Existing snapshots and UI filters assume a stable payload shape.

That means the first implementation must extend the data model, not redefine it.

---

## Data Model Decision

### Existing field that stays stable

```typescript
interface FunctionCallInfo {
  name: string;      // KEEP: terminal callable name for compatibility
  filename: string;
  pos: number;
  end: number;
  args: string[];
}
```

### Revised non-breaking shape

```typescript
interface FunctionCallInfo {
  name: string;               // Stable terminal name: method, Button, Date, sql
  filename: string;
  pos: number;
  end: number;
  args: string[];
  calleeText?: string;        // Printable form: console.log, styled.button
  callChain?: string[];       // Structured path when representable
  callKind?: 'call' | 'constructor' | 'jsx-component' | 'tagged-template';
  receiverText?: string;      // console, app.services.db, or synthetic marker
  receiverKind?: 'identifier' | 'property' | 'element-access' | 'call-result' | 'unknown';
  isOptional?: boolean;
  isBuiltin?: boolean;
}
```

### Compatibility rules

1. `name` remains the terminal symbol currently used by consumers.
2. New fields are optional everywhere.
3. Existing filters should continue to work even if they ignore all new metadata.
4. Server and web copies of the shared interfaces must be updated together.

### Representation rules

1. `console.log()` -> `name: "log"`, `calleeText: "console.log"`, `callChain: ["console", "log"]`
2. `new Date()` -> `name: "Date"`, `callKind: "constructor"`, `isBuiltin: true`
3. `<Button />` -> `name: "Button"`, `callKind: "jsx-component"`
4. `<Layout.Header />` -> `name: "Header"`, `calleeText: "Layout.Header"`, `callChain: ["Layout", "Header"]`
5. `styled.button\`...\`` -> `name: "button"`, `calleeText: "styled.button"`, `callKind: "tagged-template"`
6. `str.trim().toLowerCase()` ->
   - `trim`: `name: "trim"`, `calleeText: "str.trim"`, `receiverKind: "identifier"`
   - `toLowerCase`: `name: "toLowerCase"`, `receiverKind: "call-result"`, `calleeText` omitted if a stable string is not available

This avoids inventing unstable placeholders like `"?.toLowerCase"`.

---

## Implementation Plan

### Phase 1: JSX Component Detection

**Objective:** Detect React-style component usage without polluting results with intrinsic DOM tags.

**SyntaxKind types:**
- `JsxOpeningElement`
- `JsxSelfClosingElement`

**Scope decisions:**
1. Include component-like tags only.
2. Exclude lowercase intrinsic tags such as `div`, `span`, and `button`.
3. Exclude JSX fragments.
4. Support member-expression components such as `<Layout.Header />`.

**Detection rule:**
Treat a JSX tag as a component call only when the terminal segment is component-like, meaning it starts with an uppercase letter.

**Planned output examples:**
```typescript
<Button onClick={handler} />
// { name: 'Button', callKind: 'jsx-component', args: ['EXPR:onClick...'] }

<Layout.Header />
// {
//   name: 'Header',
//   calleeText: 'Layout.Header',
//   callChain: ['Layout', 'Header'],
//   callKind: 'jsx-component'
// }
```

**Tests:**
```typescript
test('JSX component', () => {
  const content = `<Button onClick={handler}>Click</Button>`;
  // Should detect Button
});

test('JSX member component', () => {
  const content = `<Layout.Header />`;
  // Should detect terminal name Header with callChain ['Layout', 'Header']
});

test('JSX intrinsic element ignored', () => {
  const content = `<div><span>Text</span></div>`;
  // Should not create FunctionCallInfo entries for div or span
});
```

**Estimated effort:** 3-5 hours

---

### Phase 2: Constructor Call Detection

**Objective:** Detect `new` expressions as call-like nodes.

**SyntaxKind types:**
- `NewExpression`

**Output rules:**
1. Keep `name` as the terminal constructor name.
2. Populate `calleeText` and `callChain` when the constructor is accessed through a property chain.
3. Set `callKind: 'constructor'`.
4. Add `isBuiltin` for standard built-ins.

**Examples:**
```typescript
new MyClass()
// { name: 'MyClass', callKind: 'constructor', isBuiltin: false }

new utils.Helper()
// {
//   name: 'Helper',
//   calleeText: 'utils.Helper',
//   callChain: ['utils', 'Helper'],
//   callKind: 'constructor'
// }
```

**Tests:**
```typescript
test('simple constructor call', () => {
  const content = `const obj = new MyClass();`;
  // Should detect MyClass as constructor call
});

test('builtin constructor', () => {
  const content = `const now = new Date(2025, 10, 11);`;
  // Should detect Date with isBuiltin true
});

test('namespaced constructor', () => {
  const content = `const obj = new utils.Helper();`;
  // Should detect Helper with calleeText utils.Helper
});
```

**Estimated effort:** 2-3 hours

---

### Phase 3: Call Context Metadata

**Objective:** Add receiver and chain metadata without changing existing call identity.

**Why this is separate:**
The original plan proposed replacing `name` with `obj.method`. That would break current matching behavior in the UI. This phase adds context while keeping old consumers working.

**Rules:**
1. `name` stays the terminal callable token.
2. `calleeText` is populated only when a stable textual path is available.
3. `callChain` is populated only for straightforward identifier/property chains.
4. Calls on returned values use `receiverKind: 'call-result'` instead of unstable synthetic names.

**Examples:**
```typescript
console.log('test');
// {
//   name: 'log',
//   calleeText: 'console.log',
//   receiverText: 'console',
//   receiverKind: 'identifier',
//   callChain: ['console', 'log']
// }

app.services.database.connect();
// {
//   name: 'connect',
//   calleeText: 'app.services.database.connect',
//   receiverText: 'app.services.database',
//   callChain: ['app', 'services', 'database', 'connect']
// }

str.trim().toLowerCase();
// trim -> name 'trim', calleeText 'str.trim'
// toLowerCase -> name 'toLowerCase', receiverKind 'call-result'
```

**Edge cases:**
1. `obj['method']()`
2. `obj.arr[0].method()`
3. `str.trim().toLowerCase()`
4. `(factory())()`

**Tests:**
```typescript
test('property access call metadata', () => {
  const content = `console.log('test');`;
  // name should stay 'log'
  // calleeText should be 'console.log'
});

test('deep property chain metadata', () => {
  const content = `app.services.database.connect();`;
  // name should stay 'connect'
  // callChain should capture the full path
});

test('call result receiver', () => {
  const content = `str.trim().toLowerCase();`;
  // toLowerCase should use receiverKind 'call-result'
});
```

**Estimated effort:** 3-5 hours

---

### Phase 4: Tagged Template Detection

**Objective:** Detect tagged template usage as call-like nodes.

**SyntaxKind types:**
- `TaggedTemplateExpression`

**Output rules:**
1. `name` remains the terminal tag segment.
2. `calleeText` and `callChain` are added when the tag is a property chain.
3. `callKind` is `tagged-template`.

**Examples:**
```typescript
styled.button`color: red;`
// {
//   name: 'button',
//   calleeText: 'styled.button',
//   callChain: ['styled', 'button'],
//   callKind: 'tagged-template'
// }

sql`SELECT * FROM users`
// { name: 'sql', callKind: 'tagged-template' }
```

**Tests:**
```typescript
test('styled component tag', () => {
  const content = "const Button = styled.button`color: red;`;";
  // Should detect button with calleeText styled.button
});

test('SQL template', () => {
  const content = "const query = sql`SELECT * FROM users`;";
  // Should detect sql
});
```

**Estimated effort:** 2-3 hours

---

### Phase 5: Optional Chaining and Advanced Forms

**Objective:** Add consistent metadata for modern call patterns.

**Scope:**
1. Optional chaining calls
2. Parenthesized calls
3. Element-access calls

**Representation rules:**
1. `user?.getName?.()` keeps `name: 'getName'` and sets `isOptional: true`.
2. `callbacks[0]()` may use `receiverKind: 'element-access'` and omit `callChain` if the expression is not a clean identifier chain.
3. `(getCallback())()` uses `receiverKind: 'call-result'`.

**Tests:**
```typescript
test('optional chaining call', () => {
  const content = `user?.getName?.();`;
  // Should detect getName with isOptional true
});

test('array element call', () => {
  const content = `callbacks[0]();`;
  // Should detect a call with receiverKind element-access
});

test('parenthesized call result', () => {
  const content = `(getCallback())();`;
  // Should detect a call with receiverKind call-result
});
```

**Estimated effort:** 2-4 hours

---

### Phase 6: Test and Consumer Validation

**Objective:** Prevent analyzer improvements from silently breaking the UI or payload contract.

**Required coverage:**
1. Positive analyzer tests for each new pattern.
2. Negative tests for excluded JSX intrinsic tags.
3. Snapshot updates only after targeted assertions exist.
4. Contract checks for both copies of shared types.
5. At least one consumer-level check for filtering logic that currently uses `fc.name`.

**Files that must be reviewed together:**
1. `server/src/types.d.ts`
2. `web/src/types.d.ts`
3. `server/src/analyzers/js.test.ts`
4. `web/src/components/LogicMap.tsx`
5. `web/src/components/FilesMapping.tsx`

**Documentation updates:**
1. Update `JS_ANALYZER_TECH_DOC.md` to document the revised shape.
2. Add migration notes that `name` remains stable and new fields are optional.
3. List excluded JSX intrinsic tags as an intentional limitation.

**Estimated effort:** 3-4 hours

---

## Delivery Order

### Sprint 1: Safe Call Coverage ✓
1. Phase 1: JSX component detection ✓
2. Phase 2: Constructor detection ✓
3. Phase 6a: Targeted tests for phases 1-2 ✓

### Sprint 2: Richer Metadata ✓
4. Phase 3: Call context metadata ✓
5. Phase 4: Tagged template detection ✓
6. Phase 6b: Consumer validation for `name` compatibility ✓

### Sprint 3: Advanced Forms ✓
7. Phase 5: Optional chaining and advanced call forms ✓
8. Phase 6c: Snapshot refresh and documentation updates ✓

### Deferred Track: Export Graph Work
Export detection is valuable, but it expands `FileMapping` and affects more consumers. It should be implemented as a separate follow-up after the call-shape rollout is stable.

---

## Rollout Strategy

### Step 1: Analyzer-first, non-breaking payload
Ship new optional metadata while preserving existing fields and matching behavior.

### Step 2: Consumer review
Confirm the web UI continues to work when ignoring all new fields.

### Step 3: Consumer enhancement
Optionally teach the UI to display or use `calleeText`, `callChain`, and `callKind`.

### Step 4: Separate export-detection plan
Only after the above is stable, introduce `exports` into `FileMapping` in a separate change.

If feature flags are needed, gate only the new metadata population or UI usage. Do not gate the existing `name` semantics.

---

## Estimated Effort

- **Phase 1 (JSX components):** 3-5 hours
- **Phase 2 (constructors):** 2-3 hours
- **Phase 3 (call metadata):** 3-5 hours
- **Phase 4 (tagged templates):** 2-3 hours
- **Phase 5 (advanced forms):** 2-4 hours
- **Phase 6 (tests and consumer validation):** 3-4 hours

**Total:** 15-24 hours

This excludes the deferred export-detection track.

---

## Breaking Changes and Migration

### Planned breaking changes

None in the initial rollout.

### Additive changes

1. More calls will be detected.
2. New optional metadata fields will appear in `FunctionCallInfo`.
3. Constructors, JSX components, and tagged templates will be distinguishable through `callKind`.

### Migration notes

1. Existing consumers may continue using `name` exactly as today.
2. Consumers that want richer display can opt into `calleeText` and `callChain`.
3. Any future change to `FileMapping` shape beyond optional fields should be treated as a separate contract change.

---

## Success Metrics

1. Existing consumers continue to match calls by `name` with no logic change required.
2. `<Button />` and `<Layout.Header />` are detected.
3. Lowercase intrinsic JSX tags remain excluded.
4. `new MyClass()` and `new utils.Helper()` are detected.
5. `console.log()` and `styled.button\`...\`` expose richer metadata without changing `name`.
6. Performance regression stays below 10% on representative files.
7. Existing analyzer behavior outside the targeted cases does not regress.

---

## Risk Assessment

### Low Risk
1. Constructor detection
2. Tagged template detection

### Medium Risk
1. JSX component detection because TSX has several tag shapes
2. Optional chaining and computed calls because representation gets ambiguous quickly

### High Risk
1. Any change that alters the meaning of `FunctionCallInfo.name`
2. Any change that expands `FileMapping` in a way that server and web do not adopt together

### Mitigation
1. Keep `name` stable.
2. Add only optional metadata in the first rollout.
3. Update duplicated types in server and web together.
4. Add consumer-focused checks before relying on new fields.
5. Keep export detection in a separate follow-up plan.

---

## Deferred Follow-Up: Export Detection

Export detection still makes sense, but it should not be combined with the first call-detection rollout.

When revisited, it should answer these questions first:

1. Should `FileMapping` gain optional `exports`, or should exports live in a separate payload?
2. Which consumers actually need export data?
3. How will re-exports and CommonJS exports be represented?
4. Is this a contract extension or a new API surface?

Until those are decided, export detection stays out of scope for this document.

---

## Already Supported

These patterns are already covered and do not need special new work:

1. Import aliases such as `import { a as b } from './m'`
2. Namespace imports such as `import * as ns from './m'`

---

## Future Enhancements

1. Type-aware call resolution using the TypeScript type checker
2. Dynamic `import()` detection
3. Decorator invocation tracking
4. React hook-specific analysis
5. Full caller-to-callee graph resolution beyond local syntax extraction

---

*Plan created: November 11, 2025*
*Updated: Added built-in constructor handling, clarified already-supported features*
