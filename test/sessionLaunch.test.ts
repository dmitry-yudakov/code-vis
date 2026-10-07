import { describe, expect, it, vi } from 'vitest';
import { LaunchFailure, launchSession, launchText, type LaunchAttempt } from '@/features/session-launch/sessionLaunch';
import type { PublicSession } from '@/shared/types';
const session: PublicSession = { version: 12, revision: 0, id: crypto.randomUUID(), title: 'New session', primaryAgentId: crypto.randomUUID(),
  repositories: [{ id: crypto.randomUUID(), hostId: 'home', checkoutId: 'repo', role: 'primary' }],
  participants: [], messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), annotations: {}, sketches: [], pinnedDiagramIds: [] };
function attempt(): LaunchAttempt { return { settings: { machineId: 'remote', execution: 'local', provider: 'claude', mode: 'plan',
  checkoutMode: 'current', checkoutId: 'repo', modelSelection: { model: 'opus', effort: 'high' } },
  content: { text: 'Fix it', images: [], files: [{ name: 'report.txt', text: 'The error' }], reportIds: [] },
  creationRequestId: crypto.randomUUID(), messageId: crypto.randomUUID() }; }
const accepted = () => new Response('run data', { headers: { 'X-CodeAI-Run-Id': 'accepted-run' } });
const snapshot = (messageId?: string) => Response.json({ session: { ...session, messages: messageId ? [{ id: messageId, role: 'user' }] : [] } });

describe('captured background session launch', () => {
  it('keeps the remembered isolation choice while sending only supported Local Codex instructions', async () => {
    const setup = attempt(); setup.settings.provider = 'codex'; setup.settings.instructions = 'isolated';
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ session })).mockResolvedValueOnce(accepted());
    await launchSession(setup, 'home', request);
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).not.toHaveProperty('instructions');
    expect(setup.settings.instructions).toBe('isolated');
  });
  it('opens only the idle session for whitespace and does not post a turn', async () => {
    const setup = attempt(); setup.content = { text: '  \n', files: [], images: [], reportIds: [] };
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ session }));
    expect(await launchSession(setup, 'home', request)).toEqual({ session, started: false });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe('/api/machines/remote/sessions');
  });
  it('freezes target/choices and detaches its accepted stream without consuming provider output', async () => {
    const setup = attempt();
    const cancel = vi.fn();
    const stream = new ReadableStream({ cancel });
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ session }))
      .mockResolvedValueOnce(new Response(stream, { headers: { 'X-CodeAI-Run-Id': 'queued-run' } }));
    const result = await launchSession(setup, 'home', request);
    expect(result).toMatchObject({ started: true, runId: 'queued-run' }); expect(cancel).toHaveBeenCalledOnce();
    const [url, init] = request.mock.calls[1];
    expect(url).toBe('/api/machines/remote/agent/message');
    expect(JSON.parse(String(init?.body))).toMatchObject({ sessionId: session.id, participantId: session.primaryAgentId,
      messageId: setup.messageId, mode: 'plan', model: 'opus', effort: 'high', fileAttachments: setup.content.files });
  });
  it('replays a lost creation response under the same creation id', async () => {
    const setup = attempt(); const request = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('lost'))
      .mockResolvedValueOnce(Response.json({ session })).mockResolvedValueOnce(accepted());
    await expect(launchSession(setup, 'home', request)).rejects.toMatchObject({ editable: false, uncertain: true });
    await launchSession(setup, 'home', request);
    expect(JSON.parse(String(request.mock.calls[0][1]?.body)).creationRequestId).toBe(setup.creationRequestId);
    expect(request.mock.calls[1][1]?.body).toBe(request.mock.calls[0][1]?.body);
  });
  it('reconciles lost/duplicate acceptance with the canonical message and never sends a new UUID', async () => {
    const setup = attempt(); const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ session }))
      .mockRejectedValueOnce(new Error('lost message response')).mockResolvedValueOnce(snapshot(setup.messageId));
    expect(await launchSession(setup, 'home', request)).toMatchObject({ started: true });
    expect(request.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(2);
    const duplicate = attempt(); duplicate.session = session;
    const duplicateRequest = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ error: 'already accepted' }, { status: 409 }))
      .mockResolvedValueOnce(snapshot(duplicate.messageId));
    expect(await launchSession(duplicate, 'home', duplicateRequest)).toMatchObject({ started: true });
  });
  it('keeps a retained creation frozen, but permits editing a definitely rejected first message in its created session', async () => {
    const setup = attempt();
    await expect(launchSession(setup, 'home', vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: 'Retained', creationState: 'retained' }, { status: 409 }))))
      .rejects.toMatchObject({ editable: false });
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ session }))
      .mockResolvedValueOnce(Response.json({ error: 'Queue full' }, { status: 429 })).mockResolvedValueOnce(snapshot());
    await expect(launchSession(setup, 'home', request)).rejects.toEqual(new LaunchFailure('Queue full', true));
    expect(setup.session?.id).toBe(session.id);
  });
  it('uses the personal-device installation endpoint and fixed Local target; archived replay does not start a turn', async () => {
    const setup = attempt(); setup.settings.machineId = 'home';
    setup.settings.codeai = { projectId: crypto.randomUUID(), checkoutId: 'installation', bindingsFingerprint: 'a'.repeat(64) };
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ session: { ...session, archivedAt: new Date().toISOString() } }));
    await expect(launchSession(setup, 'home', request)).rejects.toMatchObject({ editable: true });
    expect(request.mock.calls[0][0]).toBe('/api/codeai-session');
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toMatchObject({ action: 'create', preparedContext: setup.settings.codeai });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('shows explicit file-only and mixed-evidence fallback instructions', () => {
    const content = attempt().content; content.text = '';
    expect(launchText(content)).toContain('text files');
    expect(launchText({ ...content, reportIds: ['report'] })).toContain('attached evidence');
  });
});


describe('compatibility and in-flight acceptance', () => {
  it('omits new evidence fields on plain messages and never waits for an older executor stream', async () => {
    const setup = attempt(); setup.content.files = [];
    const cancelled = vi.fn();
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ session }))
      .mockResolvedValueOnce(new Response(new ReadableStream({ cancel: cancelled }), { headers: { 'Content-Type': 'application/x-ndjson' } }))
      .mockResolvedValueOnce(snapshot(setup.messageId));
    expect(await launchSession(setup, 'home', request)).toMatchObject({ started: true });
    expect(JSON.parse(String(request.mock.calls[1][1]?.body))).not.toHaveProperty('fileAttachments');
    expect(cancelled).toHaveBeenCalledOnce();
  });
  it('keeps the same frozen message when a retry conflicts with a reservation before its durable append', async () => {
    const setup = attempt(); setup.session = session; setup.messageAttempted = true;
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(Response.json({ error: 'busy', activeRun: { runId: 'accepting' } }, { status: 409 }))
      .mockResolvedValueOnce(snapshot());
    await expect(launchSession(setup, 'home', request)).rejects.toMatchObject({ editable: false, uncertain: true });
    expect(JSON.parse(String(request.mock.calls[1][1]?.body)).messageId).toBe(setup.messageId);
  });
});
