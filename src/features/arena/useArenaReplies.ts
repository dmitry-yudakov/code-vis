'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentMode, ArenaMachineSnapshot, ArenaSessionSummary, ModelSelection, PublicSession } from '@/shared/types';
import { machineApiPath } from '@/features/machines/routes';
import { LaunchFailure, launchSession, type LaunchAttempt } from '@/features/session-launch/sessionLaunch';
import { createUuid } from '@/shared/uuid';
import { reconcileMessageAcceptance } from '@/features/conversation/draftLifecycle';
import { MAX_IMAGES_PER_MESSAGE } from '@/shared/limits';
import { prepareImage } from '@/features/conversation/imageAttachments';
import { ARENA_REPLY_STORAGE_KEY, createArenaReplyStore, parseArenaReplies, serializeArenaReplies, type ArenaReplyState } from './arenaReplyDrafts';
import { chatCommand } from '@/features/conversation/chatCommands';

export interface ArenaReplyOptions {
  mode: AgentMode;
  modes: AgentMode[];
  modelSelection: ModelSelection;
  unavailableReason?: string;
}
const keyFor = (machineId: string, sessionId: string) => `${machineId}:${sessionId}`;

/** Shell ownership survives navigation; tab-local drafts and request identities survive reload. */
export function useArenaReplies(localMachineId: string | undefined, blockedReason: string | undefined, commands: {
  archive(machineId: string, session: ArenaSessionSummary): Promise<boolean>;
  newChat(machineId: string, session: PublicSession, options: ArenaReplyOptions): Promise<boolean>;
  saved(machineId: string, session: PublicSession): void;
}) {
  const [store] = useState(createArenaReplyStore);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const sending = useRef(new Set<string>());
  const preparing = useRef(new Map<string, number>());
  const flush = useCallback(() => {
    clearTimeout(saveTimer.current); saveTimer.current = undefined;
    try { sessionStorage.setItem(ARENA_REPLY_STORAGE_KEY, serializeArenaReplies(store.all())); } catch { /* optional storage */ }
  }, [store]);
  useEffect(() => {
    try { store.load(parseArenaReplies(sessionStorage.getItem(ARENA_REPLY_STORAGE_KEY))); } catch { /* optional storage */ }
    const save = () => { if (saveTimer.current !== undefined) flush(); };
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', save);
    return () => { save(); window.removeEventListener('pagehide', save); document.removeEventListener('visibilitychange', save); };
  }, [store, flush]);
  const patch = (key: string, update: Partial<ArenaReplyState>, coalesce = false) => {
    store.patch(key, update);
    if (!coalesce) flush();
    else if (saveTimer.current === undefined) saveTimer.current = setTimeout(flush, 150);
  };
  const get = (machineId: string, sessionId: string) => store.get(keyFor(machineId, sessionId));
  const subscribe = (machineId: string, sessionId: string, listener: () => void) => store.subscribe(keyFor(machineId, sessionId), listener);
  const edit = (machineId: string, sessionId: string, update: Pick<ArenaReplyState, 'text'>) => {
    const key = keyFor(machineId, sessionId);
    if (sending.current.has(key) || store.get(key).delivery) return;
    patch(key, { ...update, error: undefined, feedback: undefined, sent: false }, true);
  };
  const addImages = async (machineId: string, sessionId: string, files: File[]) => {
    const key = keyFor(machineId, sessionId);
    if (!files.length || sending.current.has(key) || store.get(key).delivery) return;
    preparing.current.set(key, (preparing.current.get(key) || 0) + 1);
    patch(key, { preparing: true, error: undefined, sent: false });
    const failures: string[] = [];
    const full = () => (store.get(key).images?.length || 0) >= MAX_IMAGES_PER_MESSAGE;
    try {
      for (const file of files) {
        if (full()) { failures.push(`A message carries at most ${MAX_IMAGES_PER_MESSAGE} images. Remove one to attach another.`); break; }
        try {
          const image = { id: createUuid(), ...await prepareImage(file) };
          if (full()) { failures.push(`A message carries at most ${MAX_IMAGES_PER_MESSAGE} images. Remove one to attach another.`); break; }
          patch(key, { images: [...(store.get(key).images || []), image] });
        } catch (error) { failures.push(error instanceof Error ? error.message : 'That image could not be read.'); }
      }
    } finally {
      const remaining = (preparing.current.get(key) || 1) - 1;
      if (remaining) preparing.current.set(key, remaining); else preparing.current.delete(key);
      patch(key, { preparing: remaining > 0, ...(failures.length ? { error: failures.join(' ') } : {}) });
    }
  };
  const removeImage = (machineId: string, sessionId: string, imageId: string) => {
    const key = keyFor(machineId, sessionId);
    if (sending.current.has(key) || store.get(key).delivery) return;
    patch(key, { images: store.get(key).images?.filter(image => image.id !== imageId), error: undefined });
  };
  const send = async (machine: ArenaMachineSnapshot, summary: ArenaSessionSummary, options: ArenaReplyOptions) => {
    const key = keyFor(machine.machine.id, summary.id);
    const draft = store.get(key);
    if (!localMachineId || (!draft.text.trim() && !draft.images?.length && !draft.delivery) || sending.current.has(key) || preparing.current.has(key)) return;
    const mode = draft.delivery?.mode ?? options.mode;
    // Frozen deliveries must retry their original payload, without executing commands again.
    const command = draft.delivery ? undefined : chatCommand(draft.text);
    const unavailable = blockedReason || options.unavailableReason
      || (machine.machine.state !== 'online' || machine.snapshotFresh === false ? 'Refresh the overview before replying. Your draft is kept.' : undefined)
      || (!options.modes.includes(mode) ? 'This mode is unavailable. Open the session to change it before replying.' : undefined)
      || (machine.runs.active.some(run => run.sessionId === summary.id) ? 'Wait for the current turn to finish.' : undefined);
    const commandBlocked = blockedReason
      || (machine.machine.state !== 'online' || machine.snapshotFresh === false ? 'Refresh the overview before running commands. Your draft is kept.' : undefined)
      || (command?.kind !== 'autoclose' && machine.runs.active.some(run => run.sessionId === summary.id) ? 'Wait for the current turn to finish.' : undefined);
    if (!draft.delivery && (command ? commandBlocked : unavailable)) { patch(key, { error: command ? commandBlocked : unavailable }); return; }
    sending.current.add(key);
    patch(key, { busy: true, error: undefined, feedback: undefined, sent: false });
    try {
      if (command?.kind === 'invalid') throw new Error(command.usage);
      if (command?.kind === 'archive') {
        if (!await commands.archive(machine.machine.id, summary)) throw new Error('Could not archive the session. Try again.');
        patch(key, { text: '' }); return;
      }
      const sessionUrl = machineApiPath(`/api/sessions/${encodeURIComponent(summary.id)}`, machine.machine.id, localMachineId);
      let saved: PublicSession | undefined;
      if (draft.delivery) {
        const acceptance = await reconcileMessageAcceptance(sessionUrl, draft.delivery.messageId);
        if (acceptance.state === 'accepted') {
          patch(key, { text: '', images: undefined, delivery: undefined, sent: true }); return;
        }
        if (acceptance.state === 'unknown') throw new Error('Could not confirm delivery. Check again when this machine reconnects.');
        saved = acceptance.session;
        if ((draft.delivery.imageCount || 0) !== (draft.images?.length || 0)) throw new Error('The original images are no longer available after reload. Check delivery again or open the session.');
        if (unavailable) throw new Error(`Delivery is not yet confirmed. ${unavailable}`);
      }
      if (!saved) {
        const response = await fetch(sessionUrl, { cache: 'no-store' });
        const data = await response.json() as { session?: PublicSession; error?: string };
        if (!response.ok || !data.session) throw new Error(data.error || 'Could not load this session. Your draft is kept.');
        saved = data.session;
      }
      const session = saved;
      if (session.id !== summary.id || session.projectId !== summary.projectId || (!draft.delivery && session.primaryAgentId !== summary.primaryAgentId)) throw new Error('This session changed. Refresh the overview before replying.');
      let text = draft.text.trim();
      if (command?.kind === 'autoclose') {
        const response = await fetch(sessionUrl, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ allowAgentArchive: command.allowed, expectedAllowAgentArchive: Boolean(session.allowAgentArchive) }),
        });
        const data = await response.json() as { session?: PublicSession; error?: string };
        if (!response.ok || !data.session) throw new Error(data.error || 'Could not save archive permission. Try again.');
        commands.saved(machine.machine.id, data.session);
        text = command.remainingText || '';
        patch(key, { text, feedback: `Auto-close ${command.allowed ? 'enabled' : 'disabled'}.` });
        if (!text) return;
        if (unavailable) throw new Error(unavailable);
      }
      if (command?.kind === 'new') {
        if (!await commands.newChat(machine.machine.id, session, options)) throw new Error('Could not create the session. Try again.');
        patch(key, { text: '' }); return;
      }
      if (!session.repositories.some(repository => repository.role === 'primary')) throw new Error('Open this session and attach a primary repository before replying.');
      const recipientId = draft.delivery?.participantId ?? session.primaryAgentId;
      const agent = session.participants.find(participant => participant.kind === 'agent' && participant.id === recipientId);
      if (!agent || agent.kind !== 'agent') throw new Error('The original agent is unavailable. Open the session and copy this reply to an available agent.');
      const delivery = draft.delivery ?? { messageId: createUuid(), participantId: session.primaryAgentId, mode, modelSelection: options.modelSelection,
        ...(draft.images?.length ? { imageCount: draft.images.length } : {}) };
      const attempt: LaunchAttempt<AgentMode> = {
          session: { ...session, primaryAgentId: recipientId }, messageId: delivery.messageId, creationRequestId: delivery.messageId,
          settings: { machineId: machine.machine.id, projectId: session.projectId, execution: session.execution || 'local',
            checkoutMode: 'current', provider: agent.provider, mode: delivery.mode, modelSelection: delivery.modelSelection },
          content: { text, images: (draft.images || []).map(({ dataUrl }) => ({ dataUrl })), files: [], reportIds: [] },
      };
      patch(key, { delivery });
      // Existing background delivery owns acceptance reconciliation, stable UUID retries and stream detachment.
      await launchSession(attempt, localMachineId);
      patch(key, { text: '', images: undefined, delivery: undefined, sent: true });
    } catch (error) {
      const editable = error instanceof LaunchFailure && error.editable;
      patch(key, { ...(editable ? { delivery: undefined } : {}), error: error instanceof Error ? error.message : 'Could not send the reply. Your draft is kept.' });
    } finally {
      sending.current.delete(key);
      patch(key, { busy: false });
    }
  };
  return { get, subscribe, edit, addImages, removeImage, send, blockedReason };
}
