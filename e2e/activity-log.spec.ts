import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { getConfig } from '../src/server/config';
import { provisionGrant, revokeGrant } from '../src/server/integrations/mcp/grants';
import type { McpConnection, McpScope } from '../src/shared/mcp';
import type { CheckoutsResponse, PublicSession } from '../src/shared/types';

async function integration(request: APIRequestContext, origin: string, scopes: McpScope[] = []) {
  const config = { ...getConfig(), remoteAccess: 'local' as const,
    dataDir: process.env.CODEAI_E2E_DATA_DIR || path.resolve('test-results/server-data'),
    repositoriesRoot: path.resolve('test/fixtures/projects'), worktreesRoot: path.resolve('test-results/worktrees') };
  const previous = process.env.CODEAI_MCP_ORIGIN;
  process.env.CODEAI_MCP_ORIGIN = origin;
  const grant = await provisionGrant(config, 'Activity test integration', scopes).finally(() => {
    if (previous === undefined) delete process.env.CODEAI_MCP_ORIGIN;
    else process.env.CODEAI_MCP_ORIGIN = previous;
  });
  const connection = JSON.parse(await readFile(grant.connectionPath, 'utf8')) as McpConnection;
  return {
    call: (operation: string, input: unknown) => request.post('/api/integrations/mcp', { data: { operation, input }, headers: {
      Host: new URL(origin).host, Origin: origin, Authorization: `CodeAI-MCP ${connection.credential}`,
      'x-codeai-grant-id': connection.grantId, 'x-codeai-machine-id': connection.machineId,
    } }),
    close: () => revokeGrant(config, connection.grantId),
  };
}

async function checkoutId(request: APIRequestContext) {
  const { checkouts } = await (await request.get('/api/checkouts')).json() as CheckoutsResponse;
  return checkouts.find(checkout => checkout.relativePath === 'alpha')!.id;
}

for (const theme of ['light', 'dark']) for (const phone of [false, true]) {
  test(`opens and filters real activity in ${theme} on ${phone ? 'phone' : 'desktop'}`, async ({ page, request, baseURL }, testInfo) => {
    const created = await request.post('/api/sessions', { data: { provider: 'claude', checkoutId: await checkoutId(request) } });
    expect(created.status()).toBe(201);
    const { session } = await created.json() as { session: PublicSession };
    const prompt = `Private prompt ${randomUUID()}`;
    const submitted = await request.post('/api/agent/message', { data: {
      sessionId: session.id, participantId: session.primaryAgentId, text: prompt, mode: 'ask', messageId: randomUUID(), diagramAttachments: [],
    } });
    expect(submitted.ok()).toBe(true);
    const mcp = await integration(request, baseURL!);
    try {
      expect((await mcp.call('read_session', { sessionId: session.id })).status()).toBe(200);
      expect((await mcp.call('archive_session', { sessionId: session.id, expectedRevision: session.revision })).status()).toBe(403);
      await page.setViewportSize({ width: phone ? 390 : 1280, height: phone ? 844 : 900 });
      await page.addInitScript(value => localStorage.setItem('code-ai:theme', value), theme);
      await page.goto('/arena');
      await page.getByRole('button', { name: 'More', exact: true }).click();
      await page.getByRole('button', { name: 'Activity log', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Activity log' });
      const entries = dialog.getByRole('list', { name: 'Activity entries' });
      await expect(entries).toContainText('User message accepted');
      await expect(entries).toContainText('Session created');
      await expect(entries).toContainText('Activity test integration');
      await expect(entries).not.toContainText(prompt);

      await dialog.getByRole('combobox', { name: 'Source' }).click();
      await page.getByRole('option', { name: 'MCP', exact: true }).click();
      await expect(entries).not.toContainText('User message accepted');
      const denied = entries.getByRole('listitem').filter({ hasText: 'Archive session' }).first();
      await expect(denied).toContainText('Denied');
      await denied.getByText('Details', { exact: true }).click();
      await expect(denied.getByText('403', { exact: true })).toBeVisible();
      await expect(denied.getByText(session.id, { exact: true })).toBeVisible();
      await expect(dialog.getByRole('combobox', { name: 'Source' })).toBeInViewport();
      await dialog.screenshot({ path: testInfo.outputPath(`activity-${theme}-${phone ? 'phone' : 'desktop'}.png`) });

      expect((await mcp.call('list_projects', {})).status()).toBe(200);
      await dialog.getByRole('button', { name: 'Refresh', exact: true }).click();
      await expect(entries).toContainText('List projects');
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(dialog).toBeHidden();
    } finally { await mcp.close(); }
  });
}

test('records the real MCP-created session and first accepted message once through replay', async ({ request, baseURL }) => {
  const checkout = await checkoutId(request);
  expect((await request.get('/api/sessions')).status()).toBe(200);
  const mcp = await integration(request, baseURL!, ['sessions:create']);
  try {
    const firstMessage = { messageId: randomUUID(), text: `Private MCP prompt ${randomUUID()}`, mode: 'ask' };
    const input = { creationRequestId: randomUUID(), checkoutId: checkout, provider: 'claude', execution: 'local',
      checkoutMode: 'current', launch: 'run', firstMessage };
    const created = await mcp.call('create_session', input);
    expect(created.status()).toBe(200);
    const { sessionId, runId, accepted } = await created.json();
    expect(accepted).toBe(true);
    expect(await (await mcp.call('create_session', input)).json()).toMatchObject({ sessionId, runId });
    const activity = await request.get('/api/activity?source=mcp');
    expect(activity.status()).toBe(200);
    const data = await activity.json() as { entries: Array<{ sessionId?: string; action: string }> };
    const entries = data.entries.filter(entry => entry.sessionId === sessionId);
    expect(entries.map(entry => entry.action)).toEqual(['mcp.call', 'mcp.call', 'message.accept', 'session.create']);
    expect(entries[2]).toMatchObject({ messageId: firstMessage.messageId, runId, actor: { source: 'mcp', label: 'Activity test integration' } });
    expect(JSON.stringify(data)).not.toContain(firstMessage.text);
  } finally { await mcp.close(); }
});

test('loads older activity under a stable scrollable list', async ({ page, request, baseURL }) => {
  const created = await request.post('/api/sessions', { data: { provider: 'claude' } });
  expect(created.status()).toBe(201);
  const { session } = await created.json() as { session: PublicSession };
  const mcp = await integration(request, baseURL!);
  try {
    for (let i = 0; i < 51; i++) expect((await mcp.call('read_session', { sessionId: session.id })).status()).toBe(200);
    await page.goto('/arena');
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('button', { name: 'Activity log', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Activity log' });
    await dialog.getByRole('combobox', { name: 'Source' }).click();
    await page.getByRole('option', { name: 'MCP', exact: true }).click();
    const rows = dialog.getByRole('list', { name: 'Activity entries' }).getByRole('listitem');
    await expect(rows).toHaveCount(50);
    await dialog.getByRole('button', { name: 'Load older activity' }).click();
    await expect(rows.nth(50)).toBeAttached();
    await expect(dialog.getByRole('combobox', { name: 'Source' })).toBeInViewport();
  } finally { await mcp.close(); }
});
