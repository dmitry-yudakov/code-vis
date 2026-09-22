# Story 65 — Open the store when one session needs a newer CodeAI

**Status:** Shipped · **Type:** Full-stack · **Depends on:** [Story 60](STORY-20260909-session-format-compatibility.md)

**Vision slice:** the durable session foundation of the [Arena vision](../docs/vision.md), the same
ground Story 60 repaired. It adds no session content and changes no existing record.

---

## Motivation

Story 60 was an incident: one checkout wrote version 4 sessions into the shared `~/.code-ai/web2`, and
a second, older checkout then hid every project behind *"Restore the whole directory from backup"*.
Nothing was lost, but nothing could be opened.

That failure is about to become routine rather than accidental.
[Story 63](STORY-20260921-report-evidence-in-conversation.md) introduces session version 5, and
[Story 64](STORY-20260921-managed-self-rebuild.md) lets the user return to the previous build, which
then reads data the newer build wrote. One session in a newer format must cost that one session, not
the whole workspace.

This cannot protect a build that predates it. It therefore ships before anything writes version 5,
and the README says that every checkout sharing a data directory needs it first.

---

## Current behavior (where the code is)

- Any schema failure in a session file, including an unknown `version`, is reported as corruption of
  the whole store: [sessionStore.ts:843](../src/server/storage/sessionStore.ts#L843).
- Initialization reads every active and archived session while repairing interrupted archive
  transitions, so one such file stops the store from opening:
  [sessionStore.ts:1073](../src/server/storage/sessionStore.ts#L1073).
- Listing reads every file again through the same strict reader:
  [sessionStore.ts:891](../src/server/storage/sessionStore.ts#L891).
- The durable schema accepts exactly versions 3 and 4:
  [sessionSchema.ts:201](../src/shared/sessionSchema.ts#L201).
- Health reports storage readiness and nothing about formats:
  [health/route.ts:13](../src/app/api/health/route.ts#L13).

---

## Desired behavior

A session file is a **newer-format session** when it parses as JSON, its top-level `version` is an
integer greater than the highest version this build reads, and its `id` matches its file name. Nothing
else inside it is interpreted.

The store treats such a file as present but closed:

- It is never rewritten, renamed, moved between active and archived storage, archived, restored, or
  deleted. Initialization's transition repair skips it, and project deletion does not detach it.
  *(As shipped, project deletion is refused with `409` while any newer-format session exists: its
  project link cannot be read, so deleting the project could orphan it in the build that owns it.)*
- Session lists and the Arena omit it. A read or mutation by id fails with a distinct
  `unsupported-format` store error, which routes answer as `409` with
  `This session was written by a newer CodeAI. Open it with that version.`
- It still counts toward the store's file safety bound.
- Health reports `newerFormatSessions: number`. When it is above zero the flat shell shows one
  bounded notice, for example `2 sessions were written by a newer CodeAI and are hidden here.`
  *(As shipped, the notice shows only while this machine's own catalog is selected, and can be
  dismissed until the next page load.)*

Everything else stays as strict as today. Unreadable JSON, a supported version with invalid content,
a missing or non-integer `version`, and an `id` that does not match its file name remain corruption
with today's message.

### Concrete changes

1. Export one `MAX_READABLE_SESSION_VERSION` beside the durable schema in
   `src/shared/sessionSchema.ts`, so a later format bump changes one place.
2. In `src/server/storage/sessionStore.ts`, classify a parsed file before strict validation; add the
   `unsupported-format` error code; skip newer-format sessions in transition repair, lists, project
   deletion, and the Arena collection; keep a count.
3. Map `unsupported-format` to `409` in the session and agent routes that load a session by id.
4. Add `newerFormatSessions` to the health response and the one-line notice to the flat shell.
5. Add a README note: checkouts that share a data directory must all include this story before any
   of them writes a newer session format.
6. *(Added during implementation.)* `deleteProject` refuses with `unsupported-format` while any
   newer-format session exists, instead of deleting a project that such a session may still name.
7. *(Added during implementation.)* Docker recovery loads every session a crashed run left in
   `docker/interrupted.json`. Without handling there, one newer-format session in that list would
   fail recovery, and because the archive route and every turn wait on recovery, that one session
   would block them all. Recovery now skips such a session and keeps its id in `interrupted.json`,
   so the newer build can still fail that interrupted delivery:
   [dockerRecovery.ts](../src/server/execution/dockerRecovery.ts).

---

## Acceptance criteria

- [x] A store containing valid version 3/4 sessions plus one file with `version: 99` opens; projects
      and every readable session list and load normally.
- [x] The newer-format file's bytes and location are unchanged after initialization, listing, project
      deletion, and an attempted archive, restore, or message by id. Those attempts answer `409`
      with the newer-CodeAI message.
- [x] A newer-format file in active storage and one in archived storage are both skipped by the
      interrupted-transition repair.
- [x] Health reports the count and the flat shell shows the notice only when it is above zero.
- [x] Unreadable JSON, invalid content at a supported version, a missing or non-integer `version`,
      and an `id`/file-name mismatch still fail as corruption with today's message.
- [x] `npm run lint` and `npm test` pass; store and route tests cover each case above.

## Out of scope

- Reading, downgrading, or partially showing a newer-format session.
- Project files: their format is unchanged and stays strictly validated.
- Builds that predate this story. They cannot be repaired retroactively; the README note is the
  mitigation.
- A notice inside the immersive workspace. The headset shows fewer sessions and the flat shell
  explains why.

## How to verify

1. `npm run lint && npm test`.
2. Copy a data directory, edit one session file's `version` to `99`, and start CodeAI against the
   copy. Confirm every other session opens, the notice names one hidden session, and the edited
   file's hash is unchanged after archiving and restoring a different session.
3. Restore the original `version` and confirm the session opens again with its history intact.

Verified 2026-09-22:

- `npm run lint` passes. All 514 Vitest tests in 77 files pass, and all 78 Playwright tests pass.
- The new store, route, and health tests fail against the previous store. The e2e notice test fails
  against the first notice version, which read the count from `health`: opening another project's
  session from the Arena replaced `health` and dropped the notice.
- How to verify, steps 2–3, run on a copy of the real `session-store-v2` (3 projects, 12 active
  sessions, 1 archived session), served on port 3031 with fake providers:
  - With one version 4 session edited to `version: 99`, health reported `newerFormatSessions: 1`.
    The other 11 sessions opened (200), and the Arena listed 11 active and 1 archived session
    without the edited one.
  - Opening or archiving the edited session answered 409 with the newer-CodeAI message.
  - Another session was archived and restored, and the edited file's SHA-256 hash was unchanged.
  - With the original bytes restored, the session opened again at revision 178 with all 10
    messages, and the count returned to 0.
  - The only file that changed was the session that was archived and restored.
- The notice was checked in the e2e test with a routed health count, not on the copied store.
- A review subagent found no blocking defects. Its findings are fixed: the project-deletion
  refusal, the machine-scoped notice, a string `id` requirement, strictness pinned at store open,
  and writing new sessions at `MAX_READABLE_SESSION_VERSION`.
