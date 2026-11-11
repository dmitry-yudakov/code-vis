import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ root: '', denied: undefined as Response | undefined }));
vi.mock('@/server/config', () => ({ getConfig: () => ({
  dataDir: `${state.root}/data`, hostLabel: 'Logo host', repositoriesRoot: state.root, repositoryDiscoveryDepth: 1,
}) }));
vi.mock('@/server/devices/deviceAuthorization', () => ({ authorizeDeviceRequest: async () => state.denied }));
vi.mock('@/server/repository/checkoutRegistry', () => ({ getCheckoutRegistry: () => ({
  resolve: async (id: string) => {
    if (id !== 'repo') throw new Error('Unknown checkout');
    return { realPath: `${state.root}/repo` };
  },
  resolveMany: async () => [],
}) }));

import { PATCH } from '@/app/api/projects/[projectId]/route';
import { GET } from '@/app/api/projects/[projectId]/logo/route';
import { getSessionStore, SessionStore } from '@/server/storage/sessionStore';
import { readRepositoryImage } from '@/server/repository/repositoryFiles';
import { machineOperationAllowed } from '@/server/machines/machineRoutePolicy';
import { runRegistry } from '@/server/runs/runRegistry';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10H0z"/></svg>';
const context = (projectId: string) => ({ params: Promise.resolve({ projectId }) });
const patch = (projectId: string, data: unknown) => PATCH(new Request('http://localhost/api/projects/' + projectId, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
}), context(projectId));
const image = (projectId: string) => GET(new Request(`http://localhost/api/projects/${projectId}/logo`), context(projectId));
const preview = (projectId: string, query: Record<string, string>) => GET(new Request(`http://localhost/api/projects/${projectId}/logo?${new URLSearchParams(query)}`), context(projectId));
async function fixture() {
  const store = getSessionStore(`${state.root}/data`, 'Logo host');
  const project = await store.createProject('With logo', ['repo']);
  return { store, project, logo: { repositoryId: project.repositories[0].id, path: 'logo.svg' } };
}
beforeEach(async () => {
  state.root = await mkdtemp(path.join(os.tmpdir(), 'codeai-logo-'));
  state.denied = undefined;
  await mkdir(`${state.root}/repo`);
  await writeFile(`${state.root}/repo/logo.svg`, svg);
});
afterEach(async () => { await rm(state.root, { recursive: true, force: true }); });

it('previews a bound repository image before saving, with the same isolation headers and no stored changes', async () => {
  const { project, store, logo } = await fixture();
  const response = await preview(project.id, logo);
  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Type')).toBe('image/svg+xml');
  expect(response.headers.get('Content-Security-Policy')).toContain('sandbox');
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(await response.text()).toBe(svg);
  expect(await store.getProject(project.id)).toEqual(project);
  expect((await image(project.id)).status).toBe(404);
});

it('validates preview paths and membership even when a project already has a saved logo', async () => {
  const { project, logo, store } = await fixture();
  await store.updateProject(project.id, { expectedRevision: 0, expectedLogo: null, logo });
  const invalidQueries: Record<string, string>[] = [
    { path: 'logo.svg' }, { repositoryId: logo.repositoryId },
    { ...logo, path: '../logo.svg' }, { ...logo, path: '.git/logo.svg' },
    { ...logo, repositoryId: crypto.randomUUID() },
  ];
  for (const query of invalidQueries) expect((await preview(project.id, query)).status).toBe(400);
  expect((await preview(project.id, { ...logo, path: 'missing.svg' })).status).toBe(404);
  state.denied = new Response(null, { status: 401 });
  expect((await preview(project.id, logo)).status).toBe(401);
});

it('sets, persists, serves, changes and removes a repository logo without changing the repository', async () => {
  const { project, store, logo } = await fixture();
  const response = await patch(project.id, { expectedRevision: 0, expectedLogo: null, logo });
  expect(response.status).toBe(200);
  expect((await response.json()).project).toMatchObject({ revision: 0, logo });
  // The previous release's strict project schema still accepts the untouched base record.
  expect(JSON.parse(await readFile(`${state.root}/data/session-store-v2/projects/${project.id}.json`, 'utf8'))).toEqual(project);
  await store.close();
  const reopened = new SessionStore(`${state.root}/data`, { hostLabel: 'Logo host' });
  expect((await reopened.getProject(project.id)).logo).toEqual(logo);
  await reopened.close();
  const served = await image(project.id);
  expect(served.status).toBe(200);
  expect(served.headers.get('Content-Type')).toBe('image/svg+xml');
  expect(served.headers.get('Cache-Control')).toBe('no-store');
  expect(served.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(served.headers.get('Content-Security-Policy')).toContain('sandbox');
  expect(await served.text()).toBe(svg);
  await writeFile(`${state.root}/repo/other.svg`, svg.replace('h10', 'h5'));
  const otherLogo = { ...logo, path: 'other.svg' };
  expect((await patch(project.id, { expectedRevision: 0, expectedLogo: logo, logo: otherLogo })).status).toBe(200);
  expect(await (await image(project.id)).text()).toContain('h5');
  expect((await patch(project.id, { expectedRevision: 0, expectedLogo: otherLogo, logo: null })).status).toBe(200);
  expect((await store.getProject(project.id)).logo).toBeUndefined();
  expect((await image(project.id)).status).toBe(404);
});

it('keeps the saved logo on invalid or stale updates and can remove a missing logo', async () => {
  const { project, store, logo } = await fixture();
  expect((await patch(project.id, { expectedRevision: 0, expectedLogo: null, logo })).status).toBe(200);
  expect((await patch(project.id, { expectedRevision: 0, expectedLogo: null, logo: null })).status).toBe(409);
  for (const requested of ['missing.svg', '../logo.svg', '/logo.svg', '.git/logo.svg', 'logo.txt', 'folder\\logo.svg']) {
    const response = await patch(project.id, { expectedRevision: 0, expectedLogo: logo, logo: { ...logo, path: requested } });
    expect([400, 404]).toContain(response.status);
    expect((await store.getProject(project.id)).logo).toEqual(logo);
  }
  expect((await patch(project.id, { expectedRevision: 0, expectedLogo: logo, logo: { ...logo, repositoryId: crypto.randomUUID() } })).status).toBe(400);
  await rm(`${state.root}/repo/logo.svg`);
  expect((await image(project.id)).status).toBe(404);
  expect((await patch(project.id, { expectedRevision: 0, name: 'Still usable' })).status).toBe(200);
  expect((await patch(project.id, { expectedRevision: 1, expectedLogo: logo, logo: null })).status).toBe(200);
});

it('clears the logo when its repository binding is removed and rejects foreign-host bindings', async () => {
  const { project, store, logo } = await fixture();
  await patch(project.id, { expectedRevision: 0, expectedLogo: null, logo });
  expect((await patch(project.id, { expectedRevision: 0, repositories: [] })).status).toBe(200);
  expect((await store.getProject(project.id)).logo).toBeUndefined();
  const foreign = { ...project.repositories[0], hostId: crypto.randomUUID() };
  await store.updateProject(project.id, { expectedRevision: 1, repositories: [foreign] });
  expect((await patch(project.id, { expectedRevision: 2, expectedLogo: null, logo })).status).toBe(400);
});

it('authorizes reads and writes before access; permits only image GET on the executor gateway', async () => {
  const { project, logo } = await fixture();
  state.denied = new Response(null, { status: 401 });
  expect((await image(project.id)).status).toBe(401);
  expect((await patch(project.id, { expectedRevision: 0, expectedLogo: null, logo })).status).toBe(401);
  expect(machineOperationAllowed('GET', ['projects', project.id, 'logo'])).toBe(true);
  for (const method of ['POST', 'PATCH', 'DELETE']) expect(machineOperationAllowed(method, ['projects', project.id, 'logo'])).toBe(false);
});

it('keeps existing project data and logo usable through a failed logo write and damaged decoration', async () => {
  const { project, store, logo } = await fixture();
  await store.updateProject(project.id, { expectedRevision: 0, expectedLogo: null, logo });
  await store.close();
  const failing = new SessionStore(`${state.root}/data`, { beforeRename: target => {
    if (target.includes('project-logos')) throw new Error('Disk write failed');
  } });
  try {
    await expect(failing.updateProject(project.id, {
      expectedRevision: 0, expectedLogo: logo, logo: { ...logo, path: 'new.svg' },
    })).rejects.toThrow('Disk write failed');
    expect((await failing.getProject(project.id)).logo).toEqual(logo);
    expect(JSON.parse(await readFile(`${state.root}/data/session-store-v2/projects/${project.id}.json`, 'utf8'))).toEqual(project);
  } finally { await failing.close(); }
  await writeFile(`${state.root}/data/session-store-v2/project-logos/${project.id}.json`, '{damaged');
  expect(await store.getProject(project.id)).toEqual(project);
  expect(await store.listProjects()).toEqual([project]);
  await writeFile(`${state.root}/data/session-store-v2/project-logos/${project.id}.json`, JSON.stringify({
    logo: { ...logo, repositoryId: crypto.randomUUID() }, repository: project.repositories[0],
  }));
  expect(await store.getProject(project.id)).toEqual(project);
  expect((await store.updateProject(project.id, { expectedRevision: 0, name: 'Still editable' })).name).toBe('Still editable');
});

it('accepts supported raster headers and a full logo at the size limit', async () => {
  const root = `${state.root}/repo`;
  const formats = [
    ['png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'image/png'],
    ['jpg', Buffer.from([255, 216, 255]), 'image/jpeg'],
    ['jpeg', Buffer.from([255, 216, 255]), 'image/jpeg'],
    ['gif', Buffer.from('GIF89a'), 'image/gif'],
    ['webp', Buffer.from('RIFF0000WEBP'), 'image/webp'],
    ['ico', Buffer.from([0, 0, 1, 0]), 'image/x-icon'],
  ] as const;
  for (const [extension, bytes, contentType] of formats) {
    await writeFile(`${root}/logo.${extension}`, bytes);
    expect(await readRepositoryImage(root, `logo.${extension}`)).toEqual({ bytes: new Uint8Array(bytes), contentType });
  }
  await writeFile(`${root}/limit.svg`, svg + ' '.repeat(2 * 1024 * 1024 - Buffer.byteLength(svg)));
  expect((await readRepositoryImage(root, 'limit.svg')).bytes.length).toBe(2 * 1024 * 1024);
});

it('bounds image reads, rejects non-images, directories, links and metadata, and releases checkout ownership', async () => {
  const root = `${state.root}/repo`;
  await writeFile(`${root}/large.svg`, svg + ' '.repeat(2 * 1024 * 1024));
  await writeFile(`${root}/fake.png`, '<html>Not an image</html>');
  await writeFile(`${state.root}/outside.svg`, svg);
  await symlink(`${state.root}/outside.svg`, `${root}/linked.svg`);
  await symlink(state.root, `${root}/linked-folder`);
  await mkdir(`${root}/.git`);
  await writeFile(`${root}/.git/logo.svg`, svg);
  for (const requested of ['large.svg', 'fake.png', '.', 'linked.svg', 'linked-folder/outside.svg', '.git/logo.svg', '../outside.svg']) {
    await expect(readRepositoryImage(root, requested)).rejects.toThrow();
  }
  const release = runRegistry.acquireCheckoutWrite(root)!;
  try { await expect(readRepositoryImage(root, 'logo.svg')).rejects.toMatchObject({ status: 409 }); }
  finally { release(); }
  expect((await readRepositoryImage(root, 'logo.svg')).contentType).toBe('image/svg+xml');
  const recover = runRegistry.acquireCheckoutWrite(root);
  expect(recover).toBeTypeOf('function');
  recover?.();
  await rename(root, `${root}-old`);
  await symlink(state.root, root);
  await expect(readRepositoryImage(root, 'outside.svg')).rejects.toThrow(/location changed/);
});
