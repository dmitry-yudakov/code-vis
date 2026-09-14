import { mkdtemp, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getConfig } from '@/server/config';
import { SessionStore, publicSession, arenaSessionSummary } from '@/server/storage/sessionStore';
import { createSessionRequestSchema } from '@/shared/protocol';
import { containerSecurity, dockerOwner, participantVolume, validateDockerCheckout } from '@/server/execution/dockerProfile';
import { dockerEnvironment } from '@/server/execution/dockerCommand';
import { resolveAgentPolicy } from '@/server/agents/agentPolicy';
import { buildClaudeArgs } from '@/server/agents/claudeInvocation';
import { codexTurnSecurity, codexThreadPolicyIssue } from '@/server/agents/codexInvocation';
import { ClaudeProcessRunner } from '@/server/agents/claudeProcessRunner';
import { CodexProcessRunner } from '@/server/agents/codexProcessRunner';
import type { AgentProcessRun } from '@/shared/types';
// @ts-expect-error The standalone gateway intentionally runs as plain Node ESM in the image.
import { publicIpv4, registryPath, rewriteMetadata, clientHelloHost } from '../docker/gateway.mjs';

async function directory() { return realpath(await mkdtemp(path.join(os.tmpdir(), 'codeai-docker-test-'))); }

describe('Docker execution contract', () => {
  const names = ['CODEAI_DOCKER_ENABLED', 'CODEAI_WEB2_DOCKER_ENABLED'] as const;
  const original = names.map((name) => process.env[name]);
  beforeEach(async () => { vi.stubEnv('CODEAI_DATA_DIR', await directory()); });
  afterEach(() => vi.unstubAllEnvs());
  afterEach(() => names.forEach((name, index) => {
    if (original[index] === undefined) delete process.env[name]; else process.env[name] = original[index];
  }));

  it('is opt-in with strict booleans and the usual legacy alias', () => {
    names.forEach((name) => { delete process.env[name]; });
    expect(getConfig().dockerEnabled).toBe(false);
    process.env.CODEAI_WEB2_DOCKER_ENABLED = 'yes';
    expect(getConfig().dockerEnabled).toBe(true);
    process.env.CODEAI_DOCKER_ENABLED = 'false';
    expect(getConfig().dockerEnabled).toBe(false);
    process.env.CODEAI_DOCKER_ENABLED = 'sometimes';
    expect(() => getConfig()).toThrow('must be a boolean');
  });

  it('accepts only a supported execution name and a Docker checkout selection', () => {
    expect(createSessionRequestSchema.parse({ provider: 'claude' })).not.toHaveProperty('execution');
    expect(createSessionRequestSchema.parse({ provider: 'codex', execution: 'docker', checkoutId: 'repo' }).execution).toBe('docker');
    for (const extra of [{ execution: 'remote' }, { image: 'custom' }, { mounts: ['/'] }, { network: 'host' }, { sandbox: 'none' }, { checkoutId: 'repo' }]) {
      expect(createSessionRequestSchema.safeParse({ provider: 'claude', ...extra }).success).toBe(false);
    }
  });

  it('persists and projects execution, validating inherited repositories and preventing rebinding', async () => {
    const store = new SessionStore(await directory());
    try {
      const host = await store.host();
      await expect(store.createSession({ provider: 'claude', execution: 'docker' })).rejects.toThrow('exactly one');
      const project = await store.createProject('Many', ['first', 'second']);
      await expect(store.createSession({ provider: 'claude', execution: 'docker', projectId: project.id })).rejects.toThrow('exactly one');
      const session = await store.createSession({ provider: 'codex', execution: 'docker', checkoutId: 'first' });
      expect(session).toMatchObject({ version: 4, execution: 'docker', repositories: [{ checkoutId: 'first', hostId: host.id, role: 'primary' }] });
      expect(publicSession(session).execution).toBe('docker');
      expect(arenaSessionSummary(session).execution).toBe('docker');
      await expect(store.setSessionRepositories(session.id, [], session.revision)).rejects.toThrow('binding is fixed');
      await expect(store.setSessionRepositories(session.id, session.repositories, session.revision)).resolves.toMatchObject({ revision: session.revision });
      expect((await store.createSession({ provider: 'claude' })).execution).toBe('local');
    } finally { await store.close(); }
  });

  it('reads active and archived v3 records as Local without rewriting native histories', async () => {
    const root = await directory();
    const store = new SessionStore(root);
    const active = await store.createSession({ provider: 'claude' });
    const second = await store.createSession({ provider: 'codex' });
    const archived = await store.archiveSession(second.id, second.revision);
    await store.close();
    for (const [record, location] of [[active, 'sessions'], [archived, 'archived-sessions']] as const) {
      const { execution: _execution, ...old } = record;
      await writeFile(path.join(root, 'session-store-v2', location, `${record.id}.json`), JSON.stringify({ ...old, version: 3 }));
    }
    const reopened = new SessionStore(root);
    try {
      expect(await reopened.getSession(active.id)).toMatchObject({ id: active.id, version: 3, revision: active.revision });
      expect(await reopened.getArchivedSession(archived.id)).toMatchObject({ id: archived.id, version: 3, revision: archived.revision });
      const persisted = JSON.parse(await readFile(path.join(root, 'session-store-v2', 'archived-sessions', `${archived.id}.json`), 'utf8'));
      expect(persisted).toMatchObject({ version: 3, revision: archived.revision });
      expect(persisted).not.toHaveProperty('execution');
    } finally { await reopened.close(); }
  });

  it('rejects protected mounts, noncanonical roots and external Git metadata', async () => {
    const root = await directory();
    const config = { ...getConfig(), dataDir: path.join(root, 'data') };
    await expect(validateDockerCheckout(process.cwd(), config)).rejects.toThrow('installation');
    await mkdir(config.dataDir);
    await expect(validateDockerCheckout(root, config)).rejects.toThrow('installation');
    const checkout = path.join(root, 'repository');
    await mkdir(checkout);
    await expect(validateDockerCheckout(checkout, config)).resolves.toHaveProperty('uid');
    await writeFile(path.join(checkout, '.git'), 'gitdir: ../external\n');
    await expect(validateDockerCheckout(checkout, config)).rejects.toThrow('external Git');
    await symlink(checkout, path.join(root, 'alias'));
    await expect(validateDockerCheckout(path.join(root, 'alias'), config)).rejects.toThrow('canonical');
  });

  it('uses non-root bounded launch flags and no provider host environment', () => {
    const profile = containerSecurity(1001, 1002);
    expect(profile.join(' ')).toContain('--user 1001:1002');
    expect(profile.join(' ')).toContain('--cap-drop ALL');
    expect(profile.join(' ')).toContain('--memory 4g --memory-swap 4g --pids-limit 256');
    expect(profile).not.toContain('--privileged');
    expect(() => containerSecurity(0, 0)).toThrow('non-root');
    expect(Object.keys(dockerEnvironment()).sort()).toEqual(['HOME', 'LANG', 'NODE_ENV', 'PATH']);
    expect(participantVolume('owner', 'session', 'a', 'home')).not.toBe(participantVolume('owner', 'session', 'b', 'home'));
    expect(participantVolume('owner', 'session', 'a', 'home')).not.toBe(participantVolume('owner', 'other', 'a', 'home'));
  });

  it('keeps ownership stable through data-directory aliases and first-time directory creation', async () => {
    const root = await directory();
    const aliasRoot = await directory();
    const alias = path.join(aliasRoot, 'alias');
    await symlink(root, alias);
    const canonicalOwner = dockerOwner(path.join(root, 'data'));
    expect(dockerOwner(path.join(alias, 'data'))).toBe(canonicalOwner);
    await mkdir(path.join(root, 'data'));
    expect(dockerOwner(path.join(root, 'data'))).toBe(canonicalOwner);
    expect(dockerOwner(path.join(alias, 'data'))).toBe(canonicalOwner);
  });

  it('grants autonomy only through the Docker transport and retains the Local Codex policy', async () => {
    const config = getConfig();
    const policy = resolveAgentPolicy(config, 'agent', 'docker');
    expect(policy.interactivePermissions).toBe(false);
    expect(buildClaudeArgs({ session: { id: crypto.randomUUID(), action: 'start' }, attachmentDirectory: '/context', policy }).join(' ')).toContain('--permission-mode bypassPermissions');
    expect(codexTurnSecurity('agent', 'docker')).toMatchObject({ approvalPolicy: 'never', sandboxPolicy: { type: 'externalSandbox', networkAccess: 'restricted' } });
    expect(codexTurnSecurity('agent', 'local')).toMatchObject({ approvalPolicy: 'on-request', sandboxPolicy: { type: 'readOnly', networkAccess: false } });
    expect(codexThreadPolicyIssue({ cwd: '/workspace', approvalPolicy: 'never', sandbox: { type: 'dangerFullAccess' }, instructionSources: [] }, '/workspace', 'never', 'docker')).toBeUndefined();
    const input = { policy } as AgentProcessRun;
    for (const Runner of [ClaudeProcessRunner, CodexProcessRunner]) {
      await expect(new Runner({ binary: 'must-never-spawn', maxOutputBytes: 1024 }).run(input)).rejects.toThrow('verified container transport');
    }
  });
});

describe('fixed upstream npm and provider gateway', () => {
  it('rejects private, metadata, loopback, direct IPv6 and non-IP upstream addresses', () => {
    for (const address of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', '::ffff:127.0.0.1', 'example.com']) expect(publicIpv4(address)).toBe(false);
    expect(publicIpv4('104.16.24.34')).toBe(true);
  });
  it('rewrites only approved tarballs and rejects origin/path tricks', () => {
    expect(rewriteMetadata({ dist: { tarball: 'https://registry.npmjs.org/pkg/-/pkg-1.tgz' } })).toEqual({ dist: { tarball: 'http://egress:8081/pkg/-/pkg-1.tgz' } });
    for (const tarball of ['https://example.com/a.tgz', 'https://registry.npmjs.org.evil.test/a', 'https://user:secret@registry.npmjs.org/a']) expect(() => rewriteMetadata({ dist: { tarball } })).toThrow();
    for (const target of ['https://example.com/a', '//example.com/a', '/\\example.com/a', '/a\r\nb']) expect(() => registryPath(target)).toThrow();
    expect(registryPath('/@scope%2fpkg')).toBe('/@scope%2fpkg');
  });
  it('requires a bounded TLS ClientHello instead of tunnelling arbitrary bytes', () => {
    expect(clientHelloHost(Buffer.alloc(0))).toBeUndefined();
    expect(() => clientHelloHost(Buffer.from('GET / HTTP/1.1\r\n'))).toThrow();
    expect(() => clientHelloHost(Buffer.from([22, 3, 3, 255, 255]))).toThrow('limit');
  });
});
