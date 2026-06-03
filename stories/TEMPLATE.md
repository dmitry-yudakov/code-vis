# Story N — <imperative title: what this change does>

**Status:** <Draft | In progress | Shipped | Superseded> · **Type:** <Frontend-only | Server-only | Full-stack | Docs> · **Depends on:** <nothing | [Story X](STORY-….md)>

---

## Motivation

Why this change is worth doing — the problem in concrete terms, ideally with the user's own
words. State the *why*, not the *how*.

---

## Current behavior (where the code is)

Anchor the spec to real code so it's executable, not just prose. List the relevant
files with `file:line` links and a one-line note on what each does today:

- Component / function: [path/to/file.ts](../path/to/file.ts#L123) (~line 123) — what it does now.
- Data type: [path/to/types.d.ts](../path/to/types.d.ts#L107) (~line 107).
- (Add the few touchpoints a reader needs — not an exhaustive map.)

---

## Desired behavior

What it should do instead. Be specific enough that someone else could implement it.

### Concrete changes

1. …
2. …

### Type contract (if types change)

```ts
// the new/changed shape, and which files must stay in sync
```

---

## Acceptance criteria

The definition of done. Each is a checkbox — tick `[x]` as it's satisfied. The story is not
done until every box is checked and **How to verify** passes.

- [ ] …
- [ ] `server` and/or `web` typecheck against any new/changed types.

## Out of scope

What this story deliberately does **not** do (and which story owns it, if any).

- …

## How to verify

The concrete steps to confirm it works — run the app, the lens/view to open, what to look for.
See [run](.) / the verify flow.
