import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { IncomingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { DeviceAuthStore } from '../src/server/devices/deviceAuthStore';

// Exercise the actual plain-Node launcher and Next.js request normalization, with verified TLS.
test.describe('paired HTTPS through multiple IPs', () => {
  let directory: string;
  let server: ChildProcess;
  let certificate: string;
  let origins: string[];
  let port: number;

  async function send(origin: string, pathname: string, options: {
    method?: string; headers?: Record<string, string>; body?: unknown; cookie?: string;
  } = {}): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    return new Promise((resolve, reject) => {
      const request = httpsRequest(new URL(pathname, origin), {
        ca: certificate, method: options.method || 'GET',
        headers: {
          ...(body ? { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)) } : {}),
          ...(options.cookie ? { Cookie: options.cookie } : {}),
          ...options.headers,
        },
      }, (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => { text += chunk; });
        response.on('error', reject);
        response.on('end', () => resolve({ status: response.statusCode!, headers: response.headers, body: text }));
      });
      request.on('error', reject);
      request.setTimeout(10_000, () => request.destroy(new Error('HTTPS request timed out')));
      request.end(body);
    });
  }

  test.beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'codeai-remote-origins-'));
    const listener = createServer();
    await new Promise<void>((resolve, reject) => {
      listener.once('error', reject);
      listener.listen(0, '127.0.0.1', resolve);
    });
    port = (listener.address() as { port: number }).port;
    await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
    origins = [`https://127.0.0.1:${port}`, `https://127.0.0.2:${port}`];
    const certFile = path.join(directory, 'cert.pem');
    const keyFile = path.join(directory, 'key.pem');
    execFileSync('openssl', [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=CodeAI test',
      '-addext', 'subjectAltName=IP:127.0.0.1,IP:127.0.0.2', '-keyout', keyFile, '-out', certFile,
    ], { stdio: 'ignore' });
    certificate = await readFile(certFile, 'utf8');
    server = spawn(process.execPath, ['scripts/start-remote.mjs'], {
      cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env, NODE_ENV: 'production', CODEAI_MANAGED_SERVER: '',
        CODEAI_DIST_DIR: process.env.CODEAI_DIST_DIR || '.next-e2e',
        CODEAI_REMOTE_ACCESS: 'paired', CODEAI_SECURITY_LEVEL: 'guarded',
        CODEAI_PUBLIC_ORIGIN: origins[0], CODEAI_ADDITIONAL_ORIGINS: origins[1],
        CODEAI_BIND_PORT: String(port), CODEAI_BIND_HOST: '0.0.0.0',
        CODEAI_TLS_CERT: certFile, CODEAI_TLS_KEY: keyFile,
        CODEAI_DATA_DIR: directory, CODEAI_REPOSITORIES_ROOT: path.resolve('test/fixtures/projects'),
        CODEAI_WORKTREES_ROOT: path.join(directory, 'worktrees'),
        CODEAI_CLAUDE_BIN: path.resolve('test/fixtures/fake-claude.mjs'),
        CODEAI_CODEX_BIN: path.resolve('test/fixtures/not-a-real-codex'),
      },
    });
    await new Promise<void>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error(`Remote server did not start: ${output}`)), 30_000);
      server.once('error', (error) => { clearTimeout(timer); reject(error); });
      server.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Remote server exited (${code}): ${output}`)); });
      server.stderr!.on('data', (chunk: Buffer) => { output = (output + chunk).slice(-8_000); });
      server.stdout!.on('data', (chunk: Buffer) => {
        output = (output + chunk).slice(-8_000);
        if (output.includes('CodeAI personal-device server listening at')) { clearTimeout(timer); resolve(); }
      });
    });
  });

  test.afterAll(async () => {
    if (server && server.exitCode === null && server.signalCode === null) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => server.kill('SIGKILL'), 5_000);
        server.once('exit', () => { clearTimeout(timer); resolve(); });
        server.kill('SIGTERM');
      });
    }
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  test('serves, pairs, authorizes and signs out through each IP while rejecting other origins', async () => {
    for (const origin of origins) {
      const otherOrigin = origins.find((candidate) => candidate !== origin)!;
      expect((await send(origin, '/')).status).toBe(200);
      expect((await send(origin, '/api/agent/runs')).status).toBe(401);
      const { code } = await new DeviceAuthStore(directory).issuePairingCode();
      const body = { label: new URL(origin).hostname, code };
      const foreignHeaders: Record<string, string>[] = [{}, { Origin: otherOrigin }, { Origin: 'https://attacker.test' }];
      for (const headers of foreignHeaders) {
        expect((await send(origin, '/api/auth/pair', { method: 'POST', headers, body })).status).toBe(403);
      }
      const paired = await send(origin, '/api/auth/pair', { method: 'POST', headers: { Origin: origin }, body });
      expect(paired.status).toBe(201);
      const cookie = paired.headers['set-cookie']![0].split(';')[0];
      const status = JSON.parse((await send(origin, '/api/auth/status', { cookie })).body);
      expect(status).toMatchObject({ authenticated: true, transportSecure: true });
      expect((await send(origin, '/api/agent/runs', { cookie })).status).toBe(200);
      expect((await send(origin, '/api/execution/docker', {
        method: 'PATCH', cookie, headers: { Origin: origin }, body: {},
      })).status).toBe(400); // Passed both authorization guards; invalid Docker settings.
      expect((await send(origin, '/api/execution/docker', {
        method: 'PATCH', cookie, headers: { Origin: otherOrigin }, body: {},
      })).status).toBe(403);
      const signedOut = await send(origin, '/api/auth/devices', {
        method: 'DELETE', cookie, headers: { Origin: origin }, body: { deviceId: status.device.id },
      });
      expect(signedOut.status).toBe(200);
      expect((await send(origin, '/api/agent/runs', { cookie })).status).toBe(401);
    }
    expect((await send(origins[0], '/api/auth/status', {
      headers: { Host: `127.0.0.3:${port}`, 'X-Forwarded-Host': new URL(origins[0]).host },
    })).status).toBe(421);
    expect((await send(origins[0], '/api/agent/runs', {
      headers: { 'x-codeai-internal-transport': 'forged' },
    })).status).toBe(401); // The listener replaces the forged marker, but pairing is still required.
  });
});
