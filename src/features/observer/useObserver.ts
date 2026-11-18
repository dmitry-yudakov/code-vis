'use client';

import { useEffect, useRef, useState } from 'react';
import type { AgentProvider, ArenaMachineSnapshot, ModelSelection } from '@/shared/types';
import type { ObserverResult } from '@/shared/observer';
import { observerAnswerSchema } from '@/shared/observer';
import { createUuid } from '@/shared/uuid';
import { executeObserverAction, observerActionSpeech, observerActionVoiceAllowed, previewObserverAction,
  type ObserverActionPreview } from './observerActions';
import { observerCommand } from './observerModel';
import { LaunchFailure } from '@/features/session-launch/sessionLaunch';
import { checkObserverDelivery, observerDeliverySchema, previewObserverDelivery, sendObserverDelivery,
  type ObserverDelivery, type ReplyOptions } from './observerDelivery';

const STORAGE_KEY = 'code-ai:device:v1:observer';
export interface ObserverMessage { role: 'user' | 'assistant'; text: string; result?: ObserverResult }

export function useObserver(input: { open: boolean; machines: ArenaMachineSnapshot[]; localMachineId?: string; options: ReplyOptions; blockedReason?: string; onBuildRestart(): void }) {
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<ObserverMessage[]>([]);
  const [delivery, setDelivery] = useState<ObserverDelivery>();
  const [actionPreview, setActionPreview] = useState<ObserverActionPreview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [nextOffset, setNextOffset] = useState<number>();
  const current = useRef({ input, draft, messages, delivery, actionPreview, nextOffset });
  current.current = { input, draft, messages, delivery, actionPreview, nextOffset };
  const operation = useRef<AbortController | undefined>(undefined);
  const sending = useRef(false);
  const generation = useRef(0);
  const pageFocus = useRef('');
  const persist = (nextDraft: string, nextDelivery?: ObserverDelivery, required = false) => {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, draft: nextDraft, delivery: nextDelivery })); }
    catch { if (required) throw new Error('Could not save delivery recovery. Enable browser storage before sending.'); }
  };
  const edit = (text: string) => {
    current.current.draft = text; setDraft(text);
    persist(text, current.current.delivery);
  };
  const saveDelivery = (value?: ObserverDelivery, required = false) => {
    persist(current.current.draft, value, required);
    current.current.delivery = value; setDelivery(value);
  };
  const saveAction = (value?: ObserverActionPreview) => { current.current.actionPreview = value; setActionPreview(value); };
  const feedback = (text: string) => { setError(text); return text; };
  const editDelivery = (text: string) => {
    const value = current.current.delivery;
    if (!value || value.attempted || sending.current) return;
    saveDelivery({ ...value, text, messageId: createUuid() });
  };
  const append = (message: ObserverMessage) => {
    const next = [...current.current.messages, message].slice(-100);
    current.current.messages = next; setMessages(next);
  };
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw && raw.length < 40_000) {
        const saved = JSON.parse(raw);
        if (saved.version === 1) {
          if (typeof saved.draft === 'string' && saved.draft.length <= 8000) edit(saved.draft);
          const parsed = observerDeliverySchema.safeParse(saved.delivery);
          if (parsed.success) saveDelivery(parsed.data);
        }
      }
    } catch { /* Optional draft recovery. New sends require successful storage. */ }
    return () => { operation.current?.abort(); };
    // Restore once; the shell owns this controller across dialog navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!input.open) { generation.current++; operation.current?.abort(); operation.current = undefined; if (!sending.current) setBusy(false); }
  }, [input.open]);

  const cancel = () => {
    if (sending.current || current.current.delivery?.attempted) return feedback('Check delivery before discarding this message.');
    saveDelivery(); saveAction(); setError(undefined); return 'Preview discarded.';
  };
  const confirmAction = async (command?: string) => {
    const preview = current.current.actionPreview;
    const latest = current.current.input;
    if (!preview || !latest.localMachineId || sending.current) return feedback('There is no matching action ready to confirm.');
    const expected = preview.action.kind === 'permission' ? (preview.action.decision === 'allow' ? 'approve' : 'deny')
      : preview.action.kind === 'edit-queued' ? 'correct' : 'cancel-turn';
    if (command && command !== expected) return feedback('That confirmation does not match the current preview.');
    if (command && !observerActionVoiceAllowed(preview)) return feedback('Review the full preview and use its confirmation button.');
    if (latest.blockedReason) { setError(latest.blockedReason); return latest.blockedReason; }
    sending.current = true; setBusy(true); setError(undefined);
    try {
      const text = await executeObserverAction(preview, latest.machines, latest.localMachineId);
      saveAction(); append({ role: 'assistant', text }); return text;
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Action outcome is unknown. Open the session to check its state.';
      setError(text); return text;
    } finally { sending.current = false; setBusy(false); }
  };
  const check = async () => {
    const value = current.current.delivery;
    if (!value || !input.localMachineId || sending.current) return '';
    sending.current = true; setBusy(true); setError(undefined);
    try {
      const result = await checkObserverDelivery(value, input.localMachineId);
      if (result.state === 'accepted') { saveDelivery(); append({ role: 'assistant', text: 'Sent.' }); return 'Sent.'; }
      // Absence can precede the original POST's append. It cannot release the captured UUID.
      const text = result.state === 'unknown' ? 'Delivery is unknown. Check again after reconnecting.' : 'The message is not in saved history yet. Retry the same send or open the session. You can still ask for briefings.';
      setError(text); return text;
    } finally { sending.current = false; setBusy(false); }
  };
  const confirm = async () => {
    const value = current.current.delivery;
    const latest = current.current.input;
    if (!value || !latest.localMachineId || sending.current) return feedback('There is no message ready to send.');
    if (!value.text.trim()) return feedback('Enter a message before sending.');
    if (latest.blockedReason) { setError(latest.blockedReason); return latest.blockedReason; }
    sending.current = true; setBusy(true); setError(undefined);
    try {
      await sendObserverDelivery(value, latest.machines, latest.localMachineId, latest.options, () => saveDelivery({ ...value, attempted: true }, true));
      saveDelivery(); append({ role: 'assistant', text: 'Sent.' }); return 'Sent.';
    } catch (error) {
      if (!value.attempted && error instanceof LaunchFailure && error.editable) saveDelivery({ ...value, attempted: false });
      const message = error instanceof Error ? error.message : 'Could not send. The message is kept.';
      setError(message); return message;
    } finally { sending.current = false; setBusy(false); }
  };
  const ask = async (text: string, provider: AgentProvider, selection: ModelSelection = {}, offset = 0): Promise<string> => {
    text = text.trim();
    if (!text || text.length > 8000 || operation.current || sending.current) return '';
    const command = observerCommand(text);
    if (command === 'stop') return 'Stopped listening.';
    if (command === 'send') return confirm();
    if (command === 'approve' || command === 'deny' || command === 'correct' || command === 'cancel-turn') return confirmAction(command);
    if (command === 'cancel') return cancel();
    if (command === 'check') return check();
    if (command === 'more') offset = current.current.nextOffset ?? 0;
    else pageFocus.current = text;
    const controller = operation.current = new AbortController();
    const owner = ++generation.current;
    const history = current.current.messages.slice(-6).map(({ role, text }) => ({ role, text: text.slice(0, 4000) }));
    const pending = current.current.delivery && !current.current.delivery.attempted
      ? { machineId: current.current.delivery.machineId, sessionId: current.current.delivery.sessionId, text: current.current.delivery.text } : undefined;
    edit(text); setBusy(true); setError(undefined);
    try {
      const response = await fetch('/api/observer', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, provider, ...selection, offset, focus: pageFocus.current, history, pending: pending?.text.trim() ? pending : undefined }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(70_000)]) });
      const result = await response.json() as ObserverResult & { error?: string };
      if (!response.ok) throw new Error(result.error || 'Observer could not answer. Retry your question.');
      if (!observerAnswerSchema.safeParse({ answer: result.answer, mentions: result.mentions, proposal: result.proposal, action: result.action }).success) throw new Error('Observer returned an invalid answer.');
      if (controller.signal.aborted || owner !== generation.current) return '';
      let speech = result.answer;
      if ((result.proposal || result.action) && current.current.delivery?.attempted) throw new Error('Check delivery or open the previous session before sending another instruction. Briefings remain available.');
      if (result.proposal) {
        const latest = current.current.input;
        if (!latest.localMachineId) throw new Error('The home machine is unavailable.');
        const preview = await previewObserverDelivery(result.proposal, latest.machines, latest.localMachineId, latest.options);
        if (controller.signal.aborted || owner !== generation.current) return '';
        saveDelivery(preview);
        saveAction();
        speech += ` ${preview.title}. ${preview.mode} mode. ${preview.text} Say Send it to confirm, or Cancel.`;
      }
      if (result.action) {
        const latest = current.current.input;
        if (result.action.kind === 'build-and-restart') {
          latest.onBuildRestart();
          saveDelivery(); saveAction();
          speech = '';
        } else {
          if (!latest.localMachineId) throw new Error('The home machine is unavailable.');
          const preview = await previewObserverAction(result.action, latest.machines, latest.localMachineId);
          if (controller.signal.aborted || owner !== generation.current) return '';
          saveDelivery(); saveAction(preview);
          speech += ` ${observerActionSpeech(preview)}`;
        }
      }
      append({ role: 'user', text }); append({ role: 'assistant', text: result.answer, result });
      setNextOffset(result.nextOffset); current.current.nextOffset = result.nextOffset; edit('');
      return speech;
    } catch (error) {
      if (controller.signal.aborted || owner !== generation.current) return '';
      const message = error instanceof Error ? error.message : 'Observer could not answer. Retry your question.';
      setError(message); return message;
    } finally {
      if (operation.current === controller) { operation.current = undefined; setBusy(false); }
    }
  };
  return { draft, edit, messages, delivery, editDelivery, actionPreview, confirmAction, busy, error, nextOffset, ask, confirm, cancel, check };
}
