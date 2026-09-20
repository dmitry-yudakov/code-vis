import { expect, test } from '@playwright/test';
import type { AgentMessageRequest, ArenaMachineSnapshot, PublicSession, UserMessage } from '../src/shared/types';

const MACHINE_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const AGENT_ID = '44444444-4444-4444-8444-444444444444';
const BINDING_ID = '55555555-5555-4555-8555-555555555555';
const RUN_ID = '66666666-6666-4666-8666-666666666666';
const ASSISTANT_ID = '77777777-7777-4777-8777-777777777777';
const NOW = '2026-09-04T12:00:00.000Z';

test('opens and streams a remote executor session, then preserves its cached offline card', async ({ page }) => {
  let online = true;
  let remoteMessagePath = '';
  const project = {
    version: 1 as const, revision: 0, id: PROJECT_ID, name: 'Remote project',
    repositories: [{ id: BINDING_ID, hostId: MACHINE_ID, checkoutId: 'remote-checkout', role: 'primary' as const }],
    createdAt: NOW, updatedAt: NOW,
  };
  let remoteSession: PublicSession = {
    version: 3, revision: 0, id: SESSION_ID, title: 'Work on the laptop', projectId: PROJECT_ID,
    repositories: project.repositories, createdAt: NOW, updatedAt: NOW,
    participants: [
      { id: `${SESSION_ID}:human`, kind: 'human', displayName: 'You' },
      { id: AGENT_ID, kind: 'agent', displayName: 'Claude', provider: 'claude', role: 'coder', defaultMode: 'plan' },
    ],
    primaryAgentId: AGENT_ID, messages: [], pinnedDiagramIds: [], annotations: {}, sketches: [],
  };

  const machineSnapshot = (): ArenaMachineSnapshot => ({
    machine: {
      id: MACHINE_ID, label: 'Laptop executor', kind: 'remote', state: online ? 'online' : 'offline',
      lastSeenAt: NOW,
    },
    projects: [project],
    checkouts: [{ id: 'remote-checkout', name: 'remote-repo', relativePath: 'remote-repo' }],
    recentCheckoutIds: ['remote-checkout'],
    providers: online ? {
      claude: { available: true, authenticated: true, supportedModes: ['ask', 'plan', 'agent'] },
      codex: { available: false, authenticated: 'unknown', supportedModes: [] },
    } : {
      claude: { available: false, authenticated: 'unknown', supportedModes: [] },
      codex: { available: false, authenticated: 'unknown', supportedModes: [] },
    },
    sessions: [{
      id: SESSION_ID, revision: remoteSession.revision, title: remoteSession.title, projectId: PROJECT_ID,
      repositoryCheckoutIds: ['remote-checkout'],
      agents: [{ id: AGENT_ID, displayName: 'Claude', provider: 'claude', role: 'coder' }],
      updatedAt: remoteSession.updatedAt,
      ...(remoteSession.messages.at(-1) ? {
        lastActivity: {
          messageId: remoteSession.messages.at(-1)!.id,
          createdAt: remoteSession.messages.at(-1)!.createdAt,
          status: remoteSession.messages.at(-1)!.status,
        },
      } : {}),
    }],
    archivedSessions: [], runs: { active: [], recent: [] },
  });

  await page.route('**/api/arena', async (route) => {
    const local = await route.fetch();
    const body = await local.json() as { machines: ArenaMachineSnapshot[] };
    await route.fulfill({ response: local, json: { machines: [...body.machines, machineSnapshot()] } });
  });
  await page.route(`**/api/machines/${MACHINE_ID}/**`, async (route) => {
    const url = new URL(route.request().url());
    const prefix = `/api/machines/${MACHINE_ID}`;
    const pathname = url.pathname.slice(prefix.length);
    if (route.request().method() === 'GET' && pathname === '/sessions') {
      await route.fulfill({ json: { sessions: [remoteSession] } });
      return;
    }
    if (route.request().method() === 'GET' && pathname === `/sessions/${SESSION_ID}`) {
      await route.fulfill({ json: { session: remoteSession } });
      return;
    }
    if (route.request().method() === 'GET' && pathname === '/agent/runs') {
      await route.fulfill({ json: { active: [], recent: [] } });
      return;
    }
    if (route.request().method() === 'GET' && pathname === '/repository/status') {
      await route.fulfill({ json: { tree: { isRepository: true, branch: 'main', files: [] } } });
      return;
    }
    if (route.request().method() === 'POST' && pathname === '/agent/message') {
      remoteMessagePath = url.pathname;
      const input = route.request().postDataJSON() as AgentMessageRequest;
      const user: UserMessage = {
        id: input.messageId, role: 'user', authorId: `${SESSION_ID}:human`,
        addressedParticipantId: AGENT_ID, text: input.text, createdAt: NOW, status: 'sent',
        diagramAttachments: [], mode: input.mode,
      };
      const assistant = {
        id: ASSISTANT_ID, role: 'assistant' as const, authorId: AGENT_ID, createdAt: NOW,
        status: 'complete' as const, rawMarkdown: 'Remote answer arrived.',
        blocks: [{ kind: 'markdown' as const, markdown: 'Remote answer arrived.' }], mode: input.mode,
      };
      remoteSession = { ...remoteSession, revision: 1, updatedAt: NOW, messages: [user, assistant] };
      const events = [
        { type: 'run-started', runId: RUN_ID, sessionId: SESSION_ID, messageId: input.messageId, participantId: AGENT_ID },
        { type: 'status', runId: RUN_ID, phase: 'responding', label: 'Writing the remote answer' },
        { type: 'assistant-message', runId: RUN_ID, message: assistant },
        { type: 'done', runId: RUN_ID, durationMs: 10, cancelled: false },
      ];
      await route.fulfill({
        contentType: 'application/x-ndjson',
        body: `${events.map((event) => JSON.stringify(event)).join('\n')}\n`,
      });
      return;
    }
    await route.fulfill({ status: 404, json: { error: `Unhandled remote route ${pathname}` } });
  });

  await page.goto('/arena');
  const arena = page.getByRole('main', { name: 'Arena' });
  const remoteMachine = arena.getByRole('region', { name: 'Laptop executor' });
  await expect(remoteMachine).toContainText('Online');
  await remoteMachine.getByRole('button', { name: 'Open Work on the laptop' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('.project-search-trigger')).toContainText('Remote project');
  const conversation = page.getByRole('complementary', { name: 'Conversation' });
  await expect(conversation).toBeVisible();
  await conversation.locator('textarea').fill('Answer on the laptop');
  await conversation.getByRole('button', { name: 'Send' }).click();
  await expect(conversation.getByText('Remote answer arrived.')).toBeVisible();
  expect(remoteMessagePath).toBe(`/api/machines/${MACHINE_ID}/agent/message`);

  online = false;
  await page.getByRole('link', { name: 'Arena', exact: true }).click();
  await arena.getByRole('button', { name: 'Refresh' }).click();
  await expect(remoteMachine).toContainText('Offline');
  await expect(remoteMachine.getByRole('button', { name: 'Open Work on the laptop' })).toBeDisabled();
});
