# Story 40 — Give Arena views canonical URLs

**Status:** Shipped · **Type:** Client shell ·
**Depends on:** [Story 39](STORY-20260903-archive-sessions.md) (recoverable session archive,
shipped) and [Story 38](STORY-20260903-arena-and-inbox.md) (the local Arena, shipped)

**Vision context:** step 6, “The arena,” in [vision.md](../docs/vision.md#sequence). This closes a
navigation gap in the shipped local Arena without changing its host-wide data model.

---

## Motivation

Arena is a top-level product destination, but the browser always remains at `/`. Its open/closed
state and selected section are component state, so refresh cannot preserve the current view, browser
Back and Forward do not traverse workspace/Arena navigation, and a person cannot bookmark an Arena
or Inbox destination. The URL should describe top-level navigation while disposable workspace
details continue to live on the device.

---

## Shipped implementation (where the code is)

- Shared shell layout: [src/app/(shell)/layout.tsx](../src/app/%28shell%29/layout.tsx#L3) (~line 3)
  keeps one `AppShell` mounted around the four static route pages, each of which supplies its own
  document title.
- Route model: [src/features/arena/routes.ts](../src/features/arena/routes.ts#L1) (~line 1) is the
  canonical pathname-to-section mapping and rejects workspace or unknown paths.
- Shell navigation: [src/features/shell/AppShell.tsx](../src/features/shell/AppShell.tsx#L73)
  (~line 73) derives Arena state with `usePathname`; header links, session opening, and Arena
  creation use client routing.
- Arena tabs: [src/features/arena/Arena.tsx](../src/features/arena/Arena.tsx#L151) (~line 151) are
  canonical Next links for Active, Inbox, and Archived.
- Coverage: [test/arenaRoutes.test.ts](../test/arenaRoutes.test.ts#L1) (~line 1) checks the pure route
  contract, while [e2e/canvas.spec.ts](../e2e/canvas.spec.ts#L356) (~line 356) covers direct entry,
  refresh, titles, not-found behavior, Back/Forward, and persistent shell identity.

---

## Desired behavior

1. The workspace remains at `/`; Arena Active lives at `/arena`, Inbox at `/arena/inbox`, and the
   archive at `/arena/archived`.
2. Header controls and Arena tabs use client navigation and create meaningful browser-history
   entries. Back and Forward restore the exact top-level view.
3. Direct visits and refreshes render the destination named by the URL. Unknown Arena descendants
   remain normal Next.js not-found routes rather than silently falling back to a view.
4. The persistent AppShell is hosted in a shared route-group layout so client transitions among
   workspace and Arena routes retain in-memory drafts, open views, panels, and live-run recovery.
5. Opening or creating a session from Arena returns to `/` after selecting the correct project and
   session. Archive and restore operations keep the current Arena route.
6. Each public route supplies a useful document title while the URL remains free of disposable
   device state such as selected project, open tabs, panel dimensions, and drafts.

### Route contract

| URL | Shell destination |
|-----|-------------------|
| `/` | Focused workspace |
| `/arena` | Active sessions |
| `/arena/inbox` | Inbox |
| `/arena/archived` | Archived sessions |

---

## Acceptance criteria

- [x] The four route files exist and direct load or refresh renders the matching workspace/Arena
      destination with a distinct document title.
- [x] The AppShell lives in one shared layout and derives Arena visibility/section from the pathname
      rather than duplicating it in component state.
- [x] Header controls, Arena tabs, session opening, and Arena session creation perform client-side
      URL navigation without losing device-local workspace state.
- [x] Browser Back and Forward traverse `/`, `/arena`, `/arena/inbox`, and `/arena/archived` and
      restore the corresponding selected view.
- [x] Unknown `/arena/*` paths return the normal not-found response.
- [x] Focused route-model tests and Playwright coverage exercise pathname mapping, direct entry,
      refresh, browser history, and state preservation.
- [x] README and architecture documentation describe the canonical Arena URLs and the shared shell
      layout boundary.
- [x] `npm run lint`, `npm test`, and `npm run test:e2e` pass.

## Out of scope

- Canonical project/session URLs, encoding drafts or panel layout in the URL, multi-device routing,
  or changing Arena polling and durable session records.
- Redirecting legacy links; all previously shipped UI stayed at `/` and therefore has no obsolete
  Arena URL to migrate.

## How to verify

1. Visit `/arena`, `/arena/inbox`, and `/arena/archived` directly and refresh each page; confirm the
   matching tab and title remain selected.
2. Starting at `/`, open Arena, Inbox, and Archived, then use Back and Forward; confirm URL and view
   move together.
3. Enter a workspace draft or retain another device-local view, visit Arena through its header, and
   return by opening a card or browser Back; confirm the state remains intact.
4. Create a session from Arena and confirm the browser returns to `/` with the new session focused.
5. Request `/arena/not-a-view` and confirm it is not treated as a valid shell destination.
6. Run `npm run lint`, `npm test`, and `npm run test:e2e`.
