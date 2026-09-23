import { randomBytes } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { createServer } from 'node:https';
import os from 'node:os';
import path from 'node:path';
import next from 'next';
import nextEnv from '@next/env';

const { loadEnvConfig } = nextEnv;

// Read before `.env*` loads, so only the start:managed parent can set it.
const managedMarker = process.env.CODEAI_MANAGED_SERVER === '1';
delete process.env.CODEAI_MANAGED_SERVER;
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

/**
 * `npm run start:managed` spawns this server with a private IPC channel and a marker, and sends the
 * installation, build directory and release first. Without both the server is unmanaged, whatever
 * else its environment says; browser input can set none of this.
 */
async function managedInit() {
  if (!managedMarker || typeof process.send !== 'function' || !process.connected) return undefined;
  const init = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the start:managed parent did not initialize this server')), 10_000);
    process.once('message', (message) => { clearTimeout(timer); resolve(message); });
  });
  if (init?.type !== 'lifecycle-init' || typeof init.slot !== 'string' || typeof init.releaseId !== 'string'
    || init.installationRoot !== await realpath(process.cwd())) {
    throw new Error('the start:managed parent sent an invalid initialization');
  }
  return init;
}

let server;
let stopping = false;
// Event streams never end by themselves: stop accepting, give requests a moment, then close the rest.
function stop() {
  if (stopping) return;
  stopping = true;
  if (!server?.listening) process.exit(0);
  server.close(() => process.exit(0));
  server.closeIdleConnections();
  setTimeout(() => server.closeAllConnections(), 2_000);
}
process.once('SIGTERM', stop);

async function main() {
  const init = await managedInit();
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
  if (init) {
    // A managed server never outlives its parent, whose lease and swap it depends on.
    process.once('disconnect', stop);
    // Read by the server's config and by the lifecycle the instrumentation hook binds during prepare.
    globalThis.__codeaiManagedLifecycle = {
      init,
      connected: () => process.connected,
      send: (message) => { if (process.connected) process.send(message); },
      listen: (listener) => { process.on('message', listener); },
    };
  }
  const app = next({ dev: false, hostname: publicOrigin.hostname, port });
  const handle = app.getRequestHandler();
  await app.prepare();
  const releaseId = init && (await readFile(path.join(process.cwd(), init.slot, 'BUILD_ID'), 'utf8')).trim();

  server = createServer({ cert, key }, (request, response) => {
    if (request.headers.host !== publicOrigin.host) {
      response.writeHead(421, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('This host is not the configured CodeAI origin.');
      return;
    }
    request.headers['x-codeai-internal-transport'] = transportMarker;
    response.setHeader('Strict-Transport-Security', 'max-age=31536000');
    response.setHeader('Permissions-Policy', 'xr-spatial-tracking=(self)');
    void handle(request, response);
  });
  server.on('error', (error) => {
    process.stderr.write(`CodeAI remote server failed: ${error.message}\n`);
    process.exit(1);
  });
  server.listen(port, bindHost, () => {
    process.stdout.write(`CodeAI personal-device server listening at ${publicOrigin.origin}\n`);
    // Readiness is this private message, sent only once Next is prepared and TLS is listening.
    if (init) globalThis.__codeaiManagedLifecycle.send({ type: 'lifecycle-ready', releaseId });
  });
}

main().catch((error) => {
  process.stderr.write(`Could not start CodeAI remote access: ${error instanceof Error ? error.message : String(error)}\n`);
  // An open IPC channel would otherwise keep a failed managed server alive until its readiness timeout.
  process.exit(1);
});
