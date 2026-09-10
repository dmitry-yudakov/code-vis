# Story 53 — Read shared sessions across checkout versions

**Status:** Shipped · **Type:** Full-stack · **Depends on:** nothing

## Motivation

Opening CodeAI from `code-ai-next` after using `code-ai` hides all projects and sessions behind
an invalid session file error. Both checkouts use `~/.code-ai/web2`; the Docker-capable checkout
upgraded session records to version 4, but this checkout accepts only version 3. The history
remains on disk. This repairs the durable session foundation of the
[Arena vision](../docs/vision.md) without requiring a data rollback.

## Current behavior (where the code is)

- [Session schemas](../src/shared/sessionSchema.ts#L200) (`src/shared/sessionSchema.ts:200`)
  strictly accept version 3; version 4 adds an `execution` field.
- [Session types](../src/shared/types.ts#L102) (`src/shared/types.ts:102`) define durable and
  public records; public snapshots preserve the durable shape except private agent state.
- [Storage](../src/server/storage/sessionStore.ts#L821) (`src/server/storage/sessionStore.ts:821`)
  validates every active and archived record during initialization, blocking the catalog on failure.
- [Message route](../src/app/api/agent/message/route.ts#L39)
  (`src/app/api/agent/message/route.ts:39`) loads a session before reserving a local provider run.

## Desired behavior

Accept version 3 and version 4 records in the same store. Version 3 has no execution field;
version 4 requires `execution: 'local' | 'docker'`. Preserve the original version and execution
metadata through reads, mutations, archiving, public snapshots, and exports. New records retain
this checkout's version 3 format. Keep strict content validation.

Version 4 local sessions can continue normally. Docker session history remains readable, but
this checkout must reject agent turns before provider work because it lacks the Docker runtime.
Preserve Docker sessions' fixed single-primary-repository binding.

## Acceptance criteria

- [x] Projects and mixed version 3/4 active and archived sessions load without rewriting records.
- [x] Version 4 metadata, transcript, artifacts, and private provider state survive mutations and
  archive/restore; public snapshots and exports retain the format without exposing private state.
- [x] Invalid version/execution combinations and malformed content remain rejected.
- [x] Local version 4 turns work; Docker turns and repository rebinding are rejected before changes.
- [x] Existing user records validate read-only, with unchanged content hashes.
- [x] Typecheck and the offline test suite pass.

## Out of scope

Porting Docker execution, migrating or downgrading user data, changing the data directory, and VR
delivery (which remains tracked in the immersive workspace stories).

## How to verify

1. Run `npm run lint` and `npm test`. Storage and route regressions cover both versions, catalog
   discovery, preservation of history, and execution restrictions.
2. Validate existing session/project JSON with the shared schemas using a read-only script; do
   not open the live store through `SessionStore`, whose startup can recover interrupted writes.

Verified 2026-09-09: `npm run lint` and all 266 tests in 46 files pass. Read-only validation of
the affected store accepts 3 projects, 9 active sessions, and 1 archived session; all 13 content
hashes match the pre-change baseline. No browser or real-provider acceptance was run for this
compatibility repair; route tests exercise catalog discovery, public snapshots, canvas edits,
and queued version 4 local turns.

To pick up the fix in an existing installation, restart the dev server (or rebuild and restart
a production server), then refresh the browser and open an existing project. The store instance
is process-wide, so recompiling a route alone may retain the previous reader.
