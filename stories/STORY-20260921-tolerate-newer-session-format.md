# Story 65 — Open the store when one session needs a newer CodeAI

**Status:** Draft · **Type:** Full-stack · **Depends on:** [Story 60](STORY-20260909-session-format-compatibility.md)

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
- Session lists and the Arena omit it. A read or mutation by id fails with a distinct
  `unsupported-format` store error, which routes answer as `409` with
  `This session was written by a newer CodeAI. Open it with that version.`
- It still counts toward the store's file safety bound.
- Health reports `newerFormatSessions: number`. When it is above zero the flat shell shows one
  bounded notice, for example `2 sessions were written by a newer CodeAI and are hidden here.`

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

---

## Acceptance criteria

- [ ] A store containing valid version 3/4 sessions plus one file with `version: 99` opens; projects
      and every readable session list and load normally.
- [ ] The newer-format file's bytes and location are unchanged after initialization, listing, project
      deletion, and an attempted archive, restore, or message by id. Those attempts answer `409`
      with the newer-CodeAI message.
- [ ] A newer-format file in active storage and one in archived storage are both skipped by the
      interrupted-transition repair.
- [ ] Health reports the count and the flat shell shows the notice only when it is above zero.
- [ ] Unreadable JSON, invalid content at a supported version, a missing or non-integer `version`,
      and an `id`/file-name mismatch still fail as corruption with today's message.
- [ ] `npm run lint` and `npm test` pass; store and route tests cover each case above.

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
