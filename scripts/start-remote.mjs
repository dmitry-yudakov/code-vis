import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import os from 'node:os';
import path from 'node:path';
import next from 'next';
import nextEnv from '@next/env';

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

function setting(suffix) {
  return process.env[`CODEAI_${suffix}`] || process.env[`CODEAI_WEB2_${suffix}`] || undefined;
}

function expandHome(value) {
  if (value === '~') return os.homedir();
  return value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
}

function requireSetting(suffix) {
  const value = setting(suffix);
  if (!value) throw new Error(`CODEAI_${suffix} is required for start:remote`);
  return value;
}

async function main() {
  if (setting('REMOTE_ACCESS') !== 'paired') {
    throw new Error('CODEAI_REMOTE_ACCESS=paired is required for start:remote');
  }
  const publicOrigin = new URL(requireSetting('PUBLIC_ORIGIN'));
  if (
    publicOrigin.protocol !== 'https:'
    || publicOrigin.username
    || publicOrigin.password
    || publicOrigin.pathname !== '/'
    || publicOrigin.search
    || publicOrigin.hash
  ) {
    throw new Error('CODEAI_PUBLIC_ORIGIN must be an exact HTTPS origin');
  }
  const port = Number(setting('BIND_PORT') || publicOrigin.port || 443);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('CODEAI_BIND_PORT must be a valid TCP port');
  }
  if (port !== Number(publicOrigin.port || 443)) {
    throw new Error('CODEAI_BIND_PORT must match the port in CODEAI_PUBLIC_ORIGIN');
  }
  const bindHost = setting('BIND_HOST') || '0.0.0.0';
  const [cert, key] = await Promise.all([
    readFile(expandHome(requireSetting('TLS_CERT'))),
    readFile(expandHome(requireSetting('TLS_KEY'))),
  ]);

  // This process-only value distinguishes TLS-terminated requests from a paired-mode app started
  // accidentally with ordinary `next start`. It is overwritten onto every inbound request.
  const transportMarker = randomBytes(32).toString('base64url');
  globalThis.__codeaiInternalTlsMarker = transportMarker;
  const app = next({ dev: false, hostname: publicOrigin.hostname, port });
  const handle = app.getRequestHandler();
  await app.prepare();

  const server = createServer({ cert, key }, (request, response) => {
    if (request.headers.host !== publicOrigin.host) {
      response.writeHead(421, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('This host is not the configured CodeAI origin.');
      return;
    }
    request.headers['x-codeai-internal-transport'] = transportMarker;
    response.setHeader('Strict-Transport-Security', 'max-age=31536000');
    void handle(request, response);
  });
  server.on('error', (error) => {
    process.stderr.write(`CodeAI remote server failed: ${error.message}\n`);
    process.exitCode = 1;
  });
  server.listen(port, bindHost, () => {
    process.stdout.write(`CodeAI personal-device server listening at ${publicOrigin.origin}\n`);
  });
}

main().catch((error) => {
  process.stderr.write(`Could not start CodeAI remote access: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
