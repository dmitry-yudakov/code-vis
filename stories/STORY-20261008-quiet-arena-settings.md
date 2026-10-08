# Story 101 — Move machine settings out of the Arena overview

**Status:** Shipped · **Type:** Frontend-only · **Depends on:** Stories 67, 80, 82

## Motivation

The Arena permanently displays security, Docker updates, and global instructions above the
sessions. The user wants to dismiss the security notice, discover provider updates through a
badge on the settings gear, and choose global instructions in advanced new-session settings.
This supports the Arena overview in [the vision](../docs/vision.md#the-arena).

## Where the code is

- [SecurityLevelNotice.tsx](../src/features/arena/SecurityLevelNotice.tsx#L14) — dismisses and
  remembers the notice per home machine and level; Arena renders it above sessions.
- [MachineSettingsDialog.tsx](../src/features/arena/MachineSettingsDialog.tsx#L10) — the closeable
  home-machine controls and read-only security details.
- [DockerVersions.tsx](../src/features/arena/DockerVersions.tsx#L80) — owns version reads,
  update/rollback actions, and progress polling.
- [ActivityBar.tsx](../src/features/shell/ActivityBar.tsx#L68) — the More gear menu and update badge.
- [AppShell.tsx](../src/features/shell/AppShell.tsx#L480) — keeps home Docker settings separate
  from an open executor session; owns dialog visibility and the gear's count.
- [SessionPicker.tsx](../src/features/conversation/SessionPicker.tsx#L108) and
  [SessionSetupDialog.tsx](../src/features/session-launch/SessionSetupDialog.tsx#L119) — instructions
  in collapsed Advanced settings, retaining the existing choices and submission contracts.

## Desired behavior

1. Security has a Dismiss action remembered on this device per home machine and level. A different
   level appears again. The read-only level remains available in Machine settings.
2. More → Machine settings opens a closeable dialog for this home machine with security, Docker
   setup, provider versions, update/rollback actions, and global-instructions defaults/file views.
3. The gear carries the number of available Docker provider updates even with settings closed.
   Update progress continues while the dialog is closed, and successful switches refresh readiness.
4. Both desktop new-session forms place Default/Use/Isolate in closed Advanced settings. Remembered
   choices, local Codex isolation restrictions, and submission behavior are preserved.
5. Use existing server contracts, version owner, and global-instructions controls.
6. Machine settings always address the home machine. A save there preserves an executor session's
   capabilities, and that session's Docker hints refer to its own executing machine.

## Acceptance criteria

- [x] Security dismissal survives reload/navigation, is scoped by machine and level, and settings
  still exposes the level without an editable security control.
- [x] Docker and global-instructions panels leave the Arena overview and are reachable from the gear.
- [x] The gear reflects available updates; update, rollback, failed reads, and background progress work.
- [x] New-session instructions are under Advanced settings with defaults and restrictions preserved.
- [x] Settings supports keyboard dismissal, focus return, narrow screens, and both themes.
- [x] Focused offline/browser checks, TypeScript, and production build pass.

## Out of scope

Provider upgrades on the host, security policy changes, and VR settings redesign.

## How to verify

Run `npm run lint`, focused Vitest view tests, and the production browser suites for machine
settings, Docker versions/execution, global instructions, and Native security. Open Arena, dismiss
the notice, reload, and inspect More → Machine settings. Check both themes and a narrow viewport.
Open both new-session forms, expand Advanced settings, select Isolate, and confirm the remembered
choice and local Codex restriction. Docker actions use offline browser fixtures.

## Verification record — 2026-10-08

- The new dismissal browser check failed against the previous build before implementation.
- `npm run lint` and `CODEAI_DIST_DIR=.next-e2e npm run build` pass.
- 174 focused offline checks pass: Docker/global-instructions views and behavior, device choices,
  Codex process runner, and composer menus. The suite used `CODEAI_AGENT_TIMEOUT_MS=900000` to
  isolate the existing finite-timeout expectations from the running installation's unlimited setting.
- 47 focused production browser checks pass across machine settings, Docker versions/execution,
  global instructions, Native security, attached-machine settings, shared session setup, and the
  shell's tabs, toasts, composer menus, and activity bar.
- Light/dark screenshots at 360 px were reviewed; dismissal with another machine and level,
  background updates, failed reads/saves, rollback refusal, keyboard closing/focus return,
  remembered instructions, and executor capability isolation were checked.
- Final diff review found and repaired the home/executor capability mix introduced by making
  Docker settings reachable during executor conversations. No policy or provider execution changed.
- The running installation was not rebuilt or restarted; browser checks used an isolated fixture
  server. Host provider upgrades and physical Quest acceptance were not exercised.

## Pre-commit review — 2026-10-08

The bounded conversation forbids subagents, so this was a direct review of the complete diff.
No critical issues were found. The review checked home/executor routing, server-owned security
and instruction contracts, optional device storage, dialog focus and dismissal, update/rollback
failure paths, and polling while settings is closed. TypeScript, 70 focused offline tests, and
13 production browser tests were rerun and passed. The earlier production build and broader
174-offline/47-browser verification still cover the unchanged implementation.
