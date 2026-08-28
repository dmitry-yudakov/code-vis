# Story 28 — Surface recently worked-on projects in the selector

**Status:** Shipped · **Type:** Full-stack ·
**Depends on:** [Story 26](STORY-20260826-loosen-project-host-bindings.md) (host-owned conversations)

---

## Motivation

When the configured projects root contains many checkouts, the alphabetical selector makes a user
search repeatedly for the few projects they are actively using. The selector should put the last
five projects worked on in CodeAI within immediate reach while retaining search and access to every
discovered project.

## Current behavior (where the code is)

- Project discovery returns path-safe, alphabetically ordered summaries from
  [projectRegistry.ts](../src/server/projects/projectRegistry.ts#L78) (~line 78), without activity
  metadata.
- The projects route returns only those summaries and discovery depth in
  [route.ts](../src/app/api/projects/route.ts#L8) (~line 8).
- Durable conversations are already sorted by `updatedAt` and carry host-scoped project attachments
  in [conversationStore.ts](../src/server/storage/conversationStore.ts#L218) (~line 218).
- The browser loads the projects response in
  [AppShell.tsx](../src/features/shell/AppShell.tsx#L168) (~line 168).
- The project picker filters and renders one flat list in
  [ProjectPicker.tsx](../src/features/projects/ProjectPicker.tsx#L18) (~line 18).

## Desired behavior

The projects response derives activity from durable CodeAI conversation updates. A project's
activity time is the newest `updatedAt` among conversations whose primary attachment names that
project's checkout id. Only currently discovered projects qualify. The five newest distinct
projects are returned in descending activity order.

With no search query, the picker renders those projects once beneath a **Recent** heading, followed
by a visually separated **Other projects** group in the registry's existing alphabetical order.
When searching, the picker renders a single ungrouped list of matching projects so duplicates and
section boundaries do not obscure results.

### Concrete changes

1. Add a pure server-side derivation for recent project ids from discovered projects and durable
   conversations.
2. Return the ordered recent ids from `GET /api/projects` and consume them in the application shell.
3. Split the unfiltered project picker into accessible Recent and Other projects groups, without
   duplicating rows.
4. Add regression coverage for primary attachments, ordering, deduplication, stale checkout ids,
   the five-project limit, and the projects route response.

### Type contract

```ts
interface ProjectsResponse {
  projects: ProjectSummary[];
  recentProjectIds: string[]; // newest activity first, at most five
  discoveryDepth: number;
}
```

## Acceptance criteria

- [x] `GET /api/projects` returns at most five distinct, currently discovered project ids ordered
  by their newest primary-attached conversation `updatedAt`.
- [x] Conversations with only a reference attachment do not make a project recent.
- [x] With no query, the picker shows non-empty **Recent** and **Other projects** groups separated
  visually and renders each project at most once.
- [x] With a query, the picker shows one ungrouped set of matching projects and preserves the
  existing empty state.
- [x] A missing recent-project match does not affect project discovery, selection fallback, or
  access to the alphabetical project list.
- [x] Focus, selection, disabled-state, and project-switch behavior remain intact.
- [x] Targeted tests, the full Vitest suite, strict TypeScript check, production build, and browser
  suite pass.

## Out of scope

- Detecting work performed outside CodeAI through Git history or filesystem timestamps.
- Persisting a second browser-local recent-project list.
- Portable recent-project identity across hosts or checkouts.

## How to verify

1. Run `npm test`, `npm run lint`, `npm run build`, and `npm run test:e2e` from the repository root.
2. Start CodeAI with more than five discovered projects and conversations updated across at least
   two of them.
3. Open the project selector and confirm Recent appears newest-first, Other projects remains
   alphabetical without duplicates, and searching replaces both groups with one filtered list.

Verification completed on 2026-08-28: strict TypeScript, 143 Vitest tests, the production build,
and all four Playwright scenarios passed.
