import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkObserverDelivery, previewObserverDelivery, sendObserverDelivery, type ObserverDelivery } from '@/features/observer/observerDelivery';
import type { ArenaMachineSnapshot, PublicSession } from '@/shared/types';
const machineId = '10000000-0000-4000-8000-000000000001';
const sessionId = '20000000-0000-4000-8000-000000000001';
const participantId = '30000000-0000-4000-8000-000000000001';
const session = { id: sessionId, revision: 3, title: 'Login', primaryAgentId: participantId, repositories: [{ role: 'primary' }],
  participants: [{ id: participantId, kind: 'agent', provider: 'claude' }], messages: [] } as unknown as PublicSession;
const machine = { machine: { id: machineId, kind: 'local', state: 'online', label: 'Home' }, projects: [],
  sessions: [{ id: sessionId, primaryAgentId: participantId, revision: 3, title: 'Login' }], runs: { active: [], recent: [] } } as unknown as ArenaMachineSnapshot;
const options = () => ({ mode: 'ask' as const, modes: ['ask' as const], modelSelection: {} });
const proposal = { machineId, sessionId, text: 'Use the existing library and continue.' };
afterEach(() => vi.unstubAllGlobals());
function setup() {
  let saved = structuredClone(session);
  const posts: unknown[] = [];
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const payload = JSON.parse(String(init.body)); posts.push(payload);
      saved.messages.push({ id: payload.messageId, role: 'user' } as never);
      return new Response('', { headers: { 'X-CodeAI-Run-Id': crypto.randomUUID() } });
    }
    return Response.json({ session: saved });
  });
  vi.stubGlobal('fetch', fetcher);
  return { fetcher, posts, saved };
}

describe('Observer follow-up delivery', () => {
  it('previews the canonical session and sends exactly the captured request without creating a session', async () => {
    const { posts } = setup();
    const preview = await previewObserverDelivery(proposal, [machine], machineId, options);
    const persist = vi.fn();
    await sendObserverDelivery(preview, [machine], machineId, options, persist);
    expect(persist).toHaveBeenCalledOnce();
    expect(posts).toEqual([expect.objectContaining({ sessionId, participantId, messageId: preview.messageId, mode: 'ask', text: proposal.text })]);
    expect((await checkObserverDelivery(preview, machineId)).state).toBe('accepted');
  });

  it('reconciles acceptance before checking offline availability and never duplicates a lost-response send', async () => {
    const { posts } = setup();
    const preview = await previewObserverDelivery(proposal, [machine], machineId, options);
    await sendObserverDelivery(preview, [machine], machineId, options, () => {});
    const offline = { ...machine, machine: { ...machine.machine, state: 'offline' as const } };
    await sendObserverDelivery({ ...preview, attempted: true }, [offline], machineId, options, () => { throw new Error('Must not post'); });
    expect(posts).toHaveLength(1);
  });

  it('preserves proposals for busy/offline targets, and refuses changed revisions or modes before sending', async () => {
    const { posts, saved } = setup();
    const offline = { ...machine, machine: { ...machine.machine, state: 'offline' as const } };
    const kept = await previewObserverDelivery(proposal, [offline], machineId, options);
    expect(kept.text).toBe(proposal.text);
    await expect(sendObserverDelivery(kept, [offline], machineId, options, () => {})).rejects.toThrow('Refresh');
    const preview = await previewObserverDelivery(proposal, [machine], machineId, options);
    saved.revision++;
    await expect(sendObserverDelivery(preview, [machine], machineId, options, () => {})).rejects.toThrow('changed');
    saved.revision--;
    await expect(sendObserverDelivery(preview, [machine], machineId, () => ({ ...options(), mode: 'agent', modes: ['agent'] }), () => {})).rejects.toThrow('changed');
    expect(posts).toHaveLength(0);
  });

  it('does not transmit if the recovery record cannot be saved or delivery cannot be reconciled', async () => {
    const { posts, fetcher } = setup();
    const preview = await previewObserverDelivery(proposal, [machine], machineId, options);
    await expect(sendObserverDelivery(preview, [machine], machineId, options, () => { throw new Error('Storage unavailable'); })).rejects.toThrow('Storage');
    expect(posts).toHaveLength(0);
    fetcher.mockRejectedValue(new Error('Disconnected'));
    await expect(sendObserverDelivery({ ...preview, attempted: true } as ObserverDelivery, [machine], machineId, options, () => {})).rejects.toThrow('unknown');
    expect(posts).toHaveLength(0);
  });
});
