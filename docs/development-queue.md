# CodeAI development queue

**Updated:** October 1, 2026

This is the near-term queue for agent sessions: recovery first, a focused acceptance pass, title-bar
tabs, then the first software-model producer. The order comes from the October 1 development
discussion. The linked epics own direction; story files own specifications, implementation status,
and verification evidence.

## Using the queue in an agent session

Address an item by its stable ID, such as `Q1`, or ask for the next ready item:

```text
Work on Q1 in docs/development-queue.md. Read its sources, write or extend the story first,
then implement and verify it. Update the queue with the result and remaining work.
```

```text
Take the next ready unfinished item from docs/development-queue.md. Complete that item,
update its queue status and evidence, and report what should come next.
```

Work on one item per session unless asked for more. Check the current tree and linked stories before
starting; this queue is a starting point, and earlier sessions may have completed part of an item.
Record `In progress` when starting, and finish with `Done` or `Blocked` plus the concrete remaining
requirement. A blocked item yields to the next ready item; missing headset or provider access does
not prevent independent coding work.

For a new implementation, write a `Draft` story from [the template](../stories/TEMPLATE.md), with
code anchors, acceptance checkboxes, and How to verify. Follow the repository's story lifecycle and
update the queue when the story's criteria pass. Verification items use their existing stories.
Keep IDs stable when changing priority, and retain completed rows with links to their evidence.

## Queue order

Queue status describes work on this item; the linked story remains authoritative for whether a
feature has shipped. The order is priority, not a new dependency chain.

| Priority | ID | Work | Queue status | Next action |
|---|---|---|---|---|
| 1 | Q1 | Story 83 turn checkpoints and undo | Queued | Write the story; the epic currently carries only its scope |
| 2 | Q2 | Verify already implemented features | Queued | Run available checks below; record exact access or device gaps |
| 3 | Q3 | Story 73 title-bar tabs | Queued | Write the story against the implemented Story 72 frame |
| 4 | Q4 | Story 6 first software-model producer | Queued | Write the story and test identity stability on repeated agent output |

## Q1 Turn checkpoints and undo

**Why next:** [Story 82](../stories/STORY-20261001-native-security-level.md) shipped Native writing
modes, while writing turns still edit the real checkout without backing up uncommitted work.
[The security epic](../stories/EPIC-20261001-security-levels.md#catching-mistakes-without-asking)
reserves Story 83 for a checkpoint before each writing turn and **Undo this turn**, at both levels.

Write the spec before choosing a snapshot mechanism. Resolve staged, unstaged, and untracked file
handling, ignored/private-file exclusions, Git changes made during a turn, and Local, Docker, and
executor behavior. Preserve the existing credential and Docker boundaries.

The story should establish these completion criteria:

- [ ] A checkpoint is captured before provider execution without changing the user's current work.
- [ ] Undo preserves pre-existing work and refuses to overwrite newer human edits or another
      session's changes. Capture and restore use the checkout scheduler's access rules.
- [ ] Failed and cancelled turns have defined recovery behavior; checkpoint failure, process
      restart, retention, and storage limits have explicit contracts.
- [ ] The UI shows when Undo is available and explains its scope: checkout recovery cannot undo
      external actions or writes elsewhere under Full access.
- [ ] Focused failure and concurrency checks, the story's How to verify, and review pass.

Start with [runRegistry.ts](../src/server/runs/runRegistry.ts#L90),
[the message route](../src/app/api/agent/message/route.ts#L215),
[gitRead.ts](../src/server/repository/gitRead.ts#L14), and the durable
[session store](../src/server/storage/sessionStore.ts#L270). These are starting anchors, not a
requirement to put all checkpoint logic in those files.

## Q2 Verify already implemented features

**Why now:** Several implemented features still need checks in the user's running app or on the
actual device. Keep this pass limited to the following work and record evidence in each source
story. Fix concrete defects found during the pass; give larger follow-ups their own story.

- [ ] **Desktop:** run the pending How to verify steps on real data for
      [Story 70 preferences](../stories/STORY-20260924-remember-turn-choices.md),
      [Story 71 composer](../stories/STORY-20260925-compact-composer.md),
      [Story 72 layout](../stories/STORY-20260925-layout-frame.md), and
      [Story 78 toasts](../stories/STORY-20260928-toast-notifications.md), including both themes
      where those stories require them.
- [ ] **Providers:** verify [Story 81](../stories/STORY-20260930-paste-image-into-chat.md) with an
      actual screenshot paste/drop and real Claude and Codex turns. Complete the pending signed-in
      Docker Codex instructions check in
      [Story 80](../stories/STORY-20260929-global-instructions.md#how-to-verify) when that worker is
      available.
- [ ] **Quest 3S:** run [Story 52's](../stories/STORY-20260905-vr-arena-inbox.md#how-to-verify)
      six-session, two-active-run, 30-minute Arena journey. Record results and metrics against its
      existing criteria. Story 51's already accepted journey does not close this separate gate.

If a check needs unavailable real-provider access or physical interaction, record which part
passed, the exact remaining check, and what is needed to run it. Mark Q2 `Blocked` while access or
device gaps remain, and report the next ready item for a later session. Mark it `Done` only after
the checks above pass. This bounded pass does not close every older VR or Docker release criterion.

## Q3 Title bar tabs

**Source:** Story 73 in the
[workbench shell epic](../stories/EPIC-20260925-workbench-shell.md#story-map); its Story 72 frame is
implemented, with running-app acceptance included in Q2.

- [ ] Write Story 73 from the template, checking the current Story 72 implementation first.
- [ ] Move session tabs into the title bar and provide All sessions for overflow; decide where the
      close control belongs without raising the visible-control count.
- [ ] Preserve tab navigation, Delete-to-close, neighbour focus, stored layouts, and both themes.
- [ ] Verify against [the design boards](design/workbench-shell/) and the epic's control budget;
      the story's checks and review pass.

Start with [WorkspaceTabs.tsx](../src/features/conversation/WorkspaceTabs.tsx#L13) and its title bar
and tab-strip placement in [AppShell.tsx](../src/features/shell/AppShell.tsx#L1902). Keep this item
focused on Story 73; subsequent shell work remains in its epic.

## Q4 First software model producer

**Why this follows:** CodeAI has sessions, machines, and several surfaces, but the running app still
lacks the persistent software understanding described by
[the model epic](../stories/EPIC-20260705-north-star-roadmap.md#phase-a--re-found-the-model-on-the-running-product-now).
Start its reserved Story 6 before scheduling every remaining shell refinement.

- [ ] Write Story 6 for agent-emitted typed entities and relations alongside Mermaid, following the
      model epic's identity and provenance contracts.
- [ ] Repeated passes over the same repository produce stable enough identities to merge; record
      the evidence and the decision before investing in the persistence story.
- [ ] Missing output leaves an ordinary turn working, and malformed output is rejected without a
      partial merge. Suggested facts retain their LLM provenance and confidence.
- [ ] The story's checks and review pass. Record the next useful slice: Story 7 persistence and
      Story 9's first lens, which emits Mermaid through the existing canvas.

Use the epic's agent-emitted path first. If identity stability fails, record that result and revisit
its stated alternative of bringing Story 8's static extractor forward. Port the needed contracts
into the running app; production code keeps the existing boundary around `legacy/`.

## Deferred work

**Story 84 Guarded Claude Auto** remains deferred until there is concrete demand and the missing
machine dependencies are available. The
[security epic](../stories/EPIC-20261001-security-levels.md#story-map) records `socat` and an AppArmor
profile for `bwrap` requiring `sudo` on this machine. Revisit it as its own story when those
conditions change.
