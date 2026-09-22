import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as LIST } from '@/app/api/immersive/reports/route';
import { GET as DETAIL } from '@/app/api/immersive/reports/[reportId]/route';
import { GET as IMAGE } from '@/app/api/immersive/reports/[reportId]/image/route';
import { getConfig } from '@/server/config';
import { getDeviceAuthStore } from '@/server/devices/deviceAuthStore';
import { storeImmersiveReport } from '@/server/diagnostics/immersiveReports';
import { getCheckoutRegistry } from '@/server/repository/checkoutRegistry';
import { resolveSelfProject } from '@/server/repository/selfProject';
import { getSessionStore } from '@/server/storage/sessionStore';
import {
  IMMERSIVE_REPORT_ID, MAX_IMMERSIVE_REPORT_SUMMARY_ERROR, immersiveReportReceivedAt, type ImmersiveReport,
} from '@/shared/immersiveReport';

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0xff, 0xd9]);
let dataDir: string;
let root: string;
let credential: string;

function report(overrides: Partial<ImmersiveReport> = {}): ImmersiveReport {
  return {
    version: 1, kind: 'capture', at: '2026-09-21T10:20:30.000Z', browser: 'Quest Browser',
    errors: [], diagnostics: { version: 1, browser: 'Quest Browser', events: [] }, ...overrides,
  };
}

async function repository(relative: string): Promise<string> {
  const directory = path.join(root, relative);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'package.json'), '{}');
  return directory;
}

/** A project bound to the checkout discovered at `relative`, as the flat shell creates one. */
async function project(name: string, relative: string, role: 'primary' | 'reference' = 'primary') {
  const checkouts = await getCheckoutRegistry(root, 2).list();
  const checkout = checkouts.find((item) => item.relativePath === relative)!;
  const store = getSessionStore(dataDir, 'Home');
  const created = await store.createProject(name, [checkout.id]);
  if (role === 'primary') return created;
  return store.updateProject(created.id, {
    expectedRevision: created.revision,
    repositories: created.repositories.map((binding) => ({ ...binding, role })),
  });
}

function get(url: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://codeai.test${url}`, {
    headers: { 'x-codeai-internal-transport': 'report-list-test', Cookie: `__Host-codeai-device=${credential}`, ...headers },
  });
}

const params = (reportId: string) => ({ params: Promise.resolve({ reportId }) });

describe.sequential('CodeAI reports on the home machine', () => {
  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'codeai-report-list-'));
    root = await mkdtemp(path.join(os.tmpdir(), 'codeai-report-repositories-'));
    const installation = await repository('installation');
    await repository('copies/code-ai');
    vi.stubEnv('CODEAI_DATA_DIR', dataDir);
    vi.stubEnv('CODEAI_REPOSITORIES_ROOT', root);
    vi.stubEnv('CODEAI_REPOSITORIES_DEPTH', '2');
    vi.stubEnv('CODEAI_HOST_LABEL', 'Home');
    vi.stubEnv('CODEAI_INSTALLATION_ROOT', installation);
    vi.stubEnv('CODEAI_REMOTE_ACCESS', 'paired');
    vi.stubEnv('CODEAI_PUBLIC_ORIGIN', 'https://codeai.test');
    (globalThis as typeof globalThis & { __codeaiInternalTlsMarker?: string }).__codeaiInternalTlsMarker = 'report-list-test';
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = getDeviceAuthStore(dataDir);
    credential = (await store.pair((await store.issuePairingCode()).code, 'Headset')).credential;
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it('recognizes a self project only by its local primary checkout resolving to the installation', async () => {
    const config = getConfig();
    const self = await project('Anything at all', 'installation');
    expect((await resolveSelfProject(self.id, config))?.id).toBe(self.id);
    // Renaming changes nothing; a same-named checkout elsewhere is not this installation.
    const store = getSessionStore(dataDir, 'Home');
    await store.updateProject(self.id, { expectedRevision: self.revision, name: 'code-ai' });
    expect(await resolveSelfProject(self.id, config)).toBeDefined();
    expect(await resolveSelfProject((await project('code-ai', 'copies/code-ai')).id, config)).toBeUndefined();
    expect(await resolveSelfProject((await project('Reference only', 'installation', 'reference')).id, config)).toBeUndefined();
    // A checkout id bound on another machine never names this machine's checkout.
    const foreign = await store.createProject('Remote', []);
    await store.updateProject(foreign.id, { expectedRevision: foreign.revision, repositories: [{
      ...self.repositories[0], id: crypto.randomUUID(), hostId: crypto.randomUUID(),
    }] });
    expect(await resolveSelfProject(foreign.id, config)).toBeUndefined();
    expect(await resolveSelfProject(crypto.randomUUID(), config)).toBeUndefined();
    expect(await resolveSelfProject(undefined, config)).toBeUndefined();
    // The installation root is compared by real path, so a link to it names the same checkout.
    const link = path.join(await mkdtemp(path.join(os.tmpdir(), 'codeai-link-')), 'installation');
    await symlink(path.join(root, 'installation'), link);
    expect(await resolveSelfProject(self.id, { ...config, installationRoot: link })).toBeDefined();
    expect(await resolveSelfProject(self.id, { ...config, installationRoot: path.join(root, 'missing') })).toBeUndefined();
  });

  it('lists retained reports newest first with bounded summaries and skips malformed files', async () => {
    const self = await project('CodeAI', 'installation');
    const context = { machineId: crypto.randomUUID(), projectId: crypto.randomUUID(), sessionId: crypto.randomUUID() };
    const first = await storeImmersiveReport(report({ note: 'Panel clipped', context }), jpeg, dataDir);
    const second = await storeImmersiveReport(report({ kind: 'error', errors: [
      { at: '2026-09-21T10:20:31.000Z', kind: 'window-error', message: 'first' },
      { at: '2026-09-21T10:20:32.000Z', kind: 'window-error', message: 'x'.repeat(1_000) },
    ] }), undefined, dataDir);
    const diagnostics = path.join(dataDir, 'diagnostics');
    await writeFile(path.join(diagnostics, '2026-09-21T10-20-30.000Z-capture.json'), '{');
    await writeFile(path.join(diagnostics, 'notes.json'), '{}');

    const response = await LIST(get(`/api/immersive/reports?projectId=${self.id}`));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain(dataDir);
    expect(body).toEqual({ available: true, skipped: 2, reports: [
      { id: second.name, receivedAt: immersiveReportReceivedAt(second.name), kind: 'error', errorCount: 2,
        latestError: 'x'.repeat(MAX_IMMERSIVE_REPORT_SUMMARY_ERROR), screenshot: false },
      { id: first.name, receivedAt: immersiveReportReceivedAt(first.name), kind: 'capture', context,
        note: 'Panel clipped', errorCount: 0, screenshot: true },
    ] });
    expect(body.reports[0].id > body.reports[1].id).toBe(true);
    expect(Date.parse(body.reports[1].receivedAt)).not.toBeNaN();

    const detail = await DETAIL(get(`/api/immersive/reports/${first.name}?projectId=${self.id}`), params(first.name));
    expect(detail.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await detail.json()).toMatchObject({ summary: { id: first.name, screenshot: true }, report: { note: 'Panel clipped', context } });
    const image = await IMAGE(get(`/api/immersive/reports/${first.name}/image?projectId=${self.id}`), params(first.name));
    expect(image.headers.get('Content-Type')).toBe('image/jpeg');
    expect(image.headers.get('Cache-Control')).toBe('private, no-store');
    expect(Buffer.from(await image.arrayBuffer())).toEqual(jpeg);
    expect((await IMAGE(get(`/api/immersive/reports/${second.name}/image?projectId=${self.id}`), params(second.name))).status).toBe(404);
  });

  it('answers unavailable for any other project and refuses malformed ids and unpaired devices', async () => {
    const self = await project('CodeAI', 'installation');
    const other = await project('code-ai', 'copies/code-ai');
    const stored = await storeImmersiveReport(report(), jpeg, dataDir);
    for (const projectId of [other.id, crypto.randomUUID(), '']) {
      const list = await LIST(get(`/api/immersive/reports?projectId=${projectId}`));
      expect([list.status, await list.json()]).toEqual([200, { available: false }]);
      const detail = await DETAIL(get(`/api/immersive/reports/${stored.name}?projectId=${projectId}`), params(stored.name));
      expect([detail.status, await detail.json()]).toEqual([404, { available: false }]);
      const image = await IMAGE(get(`/api/immersive/reports/${stored.name}/image?projectId=${projectId}`), params(stored.name));
      expect([image.status, await image.json()]).toEqual([404, { available: false }]);
    }
    // The id is checked before any path is built from it.
    for (const reportId of ['../session-store-v2/manifest', `${stored.name}.json`, 'notes', `x${stored.name}`]) {
      expect(IMMERSIVE_REPORT_ID.test(reportId)).toBe(false);
      expect((await DETAIL(get(`/api/immersive/reports/x?projectId=${self.id}`), params(reportId))).status).toBe(400);
      expect((await IMAGE(get(`/api/immersive/reports/x/image?projectId=${self.id}`), params(reportId))).status).toBe(400);
    }
    const unpaired = get(`/api/immersive/reports?projectId=${self.id}`, { Cookie: '' });
    expect((await LIST(unpaired)).status).toBe(401);
    expect((await DETAIL(get(`/api/immersive/reports/${stored.name}?projectId=${self.id}`, { Cookie: '' }), params(stored.name))).status).toBe(401);
  });
});
