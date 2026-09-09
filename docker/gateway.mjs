import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { lookup } from 'node:dns/promises';

// The gateway image, not worker configuration, owns destinations and HTTP methods.
export const PROVIDER_HOSTS = Object.freeze({
  claude: ['api.anthropic.com', 'claude.ai', 'console.anthropic.com', 'platform.claude.com'],
  codex: ['api.openai.com', 'auth.openai.com', 'chatgpt.com'],
});
const REGISTRY = 'registry.npmjs.org';
const REGISTRY_ORIGIN = `https://${REGISTRY}`;
const GATEWAY_ORIGIN = 'http://egress:8081';
const MAX_METADATA = 16 * 1024 * 1024;
const MAX_TARBALL = 64 * 1024 * 1024;

export function publicIpv4(address) {
  if (net.isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99)))
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    || (a === 203 && b === 0 && c === 113));
}

async function upstreamAddress(host) {
  const addresses = await lookup(host, { all: true, family: 4 });
  if (!addresses.length || addresses.some(({ address }) => !publicIpv4(address))) throw new Error('Blocked destination');
  return addresses[0].address;
}

/** Inspect the first TLS ClientHello before connecting a tunnel to a shared provider IP.
 * The CONNECT authority and TLS SNI must agree; direct-IP and alternate-SNI tunnels fail closed.
 */
export function clientHelloHost(buffer) {
  if (buffer.length < 5) return undefined;
  if (buffer[0] !== 22 || buffer[1] !== 3) throw new Error('TLS ClientHello required');
  const length = buffer.readUInt16BE(3);
  if (length > 16_384) throw new Error('ClientHello limit exceeded');
  if (buffer.length < length + 5) return undefined;
  const data = buffer.subarray(5, length + 5);
  if (data[0] !== 1 || data.length < 39) throw new Error('Invalid ClientHello');
  let offset = 38;
  offset += 1 + data[offset];
  offset += 2 + data.readUInt16BE(offset);
  offset += 1 + data[offset];
  const end = offset + 2 + data.readUInt16BE(offset);
  offset += 2;
  if (end > data.length) throw new Error('Invalid ClientHello extensions');
  let name;
  while (offset + 4 <= end) {
    const type = data.readUInt16BE(offset);
    const size = data.readUInt16BE(offset + 2);
    offset += 4;
    if (offset + size > end) throw new Error('Invalid TLS extension');
    if (type === 0xfe0d) throw new Error('Encrypted TLS authority is unsupported');
    if (type === 0) {
      if (name || size < 5 || data[offset + 2] !== 0) throw new Error('Invalid TLS server name');
      const bytes = data.readUInt16BE(offset + 3);
      if (bytes + 5 !== size) throw new Error('Ambiguous TLS server name');
      name = data.subarray(offset + 5, offset + 5 + bytes).toString('utf8');
      if (!/^[a-z0-9.-]+$/.test(name)) throw new Error('Invalid TLS server name');
    }
    offset += size;
  }
  if (!name) throw new Error('TLS server name required');
  return name;
}

export function registryPath(value) {
  if (!value?.startsWith('/') || value.startsWith('//') || /[\\\r\n\0]/.test(value)) throw new Error('Blocked registry path');
  const url = new URL(value, REGISTRY_ORIGIN);
  if (url.origin !== REGISTRY_ORIGIN || url.username || url.password || url.hash) throw new Error('Blocked registry origin');
  return url.pathname + url.search;
}

export function rewriteMetadata(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(rewriteMetadata);
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'tarball' && typeof item === 'string') {
      const url = new URL(item);
      if (![REGISTRY_ORIGIN, `http://${REGISTRY}`].includes(url.origin) || url.username || url.password) throw new Error('Blocked tarball origin');
      Object.defineProperty(result, key, { value: GATEWAY_ORIGIN + registryPath(url.pathname + url.search), enumerable: true });
    } else Object.defineProperty(result, key, { value: rewriteMetadata(item), enumerable: true });
  }
  return result;
}

function fail(response, code = 403) {
  if (!response.headersSent) response.writeHead(code, { 'content-type': 'text/plain', 'connection': 'close' });
  response.end('Blocked or unavailable in the CodeAI Docker network profile.\n');
}

async function fetchRegistry(method, requestPath, redirects = 0) {
  const address = await upstreamAddress(REGISTRY);
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: address, servername: REGISTRY, port: 443, method, path: registryPath(requestPath),
      // Pin a validated public address through connect; a second DNS lookup cannot rebind it.
      headers: { host: REGISTRY, accept: requestPath.includes('/-/') ? '*/*' : 'application/json', 'accept-encoding': 'identity' },
      timeout: 20_000,
    }, (upstream) => {
      const status = upstream.statusCode || 502;
      if (status >= 300 && status < 400) {
        upstream.resume();
        try {
          const target = new URL(upstream.headers.location || '', REGISTRY_ORIGIN + requestPath);
          if (redirects >= 3 || target.origin !== REGISTRY_ORIGIN || target.username || target.password) throw new Error('Blocked redirect');
          resolve(fetchRegistry(method, registryPath(target.pathname + target.search), redirects + 1));
        } catch (error) { reject(error); }
        return;
      }
      const chunks = [];
      let bytes = 0;
      const metadata = (upstream.headers['content-type'] || '').includes('json');
      upstream.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > (metadata ? MAX_METADATA : MAX_TARBALL)) {
          upstream.destroy(new Error('Registry response limit exceeded'));
        } else chunks.push(chunk);
      });
      upstream.on('error', reject);
      upstream.on('end', () => {
        try {
          const raw = Buffer.concat(chunks);
          const body = metadata && method !== 'HEAD' && status === 200
            ? Buffer.from(JSON.stringify(rewriteMetadata(JSON.parse(raw.toString('utf8'))))) : raw;
          resolve({ status, body, contentType: metadata ? 'application/json' : 'application/octet-stream' });
        } catch (error) { reject(error); }
      });
    });
    request.on('timeout', () => request.destroy(new Error('Registry timeout')));
    request.on('error', reject);
    request.end();
  });
}

export function startGateway(provider) {
  const allowed = PROVIDER_HOSTS[provider];
  if (!allowed) throw new Error('Unsupported gateway provider');
  const proxy = http.createServer((_request, response) => fail(response));
  let tunnels = 0;
  proxy.on('connect', async (request, socket, head) => {
    const target = request.url || '';
    const host = target.endsWith(':443') ? target.slice(0, -4) : '';
    if (!allowed.includes(host) || tunnels >= 64) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    tunnels += 1;
    let upstream;
    const close = () => { socket.destroy(); upstream?.destroy(); };
    socket.once('close', () => { tunnels -= 1; upstream?.destroy(); });
    socket.on('error', close);
    socket.setTimeout(120_000, close);
    try {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      let hello = head;
      let tlsHost = clientHelloHost(hello);
      while (tlsHost === undefined) {
        const chunk = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => { cleanup(); reject(new Error('ClientHello timeout')); }, 10_000);
          const onData = (value) => { cleanup(); resolve(value); };
          const onClose = () => { cleanup(); reject(new Error('Tunnel closed')); };
          const cleanup = () => { clearTimeout(timer); socket.off('data', onData); socket.off('close', onClose); };
          socket.once('data', onData); socket.once('close', onClose);
        });
        hello = Buffer.concat([hello, chunk]);
        if (hello.length > 65_536) throw new Error('ClientHello limit exceeded');
        tlsHost = clientHelloHost(hello);
      }
      if (tlsHost !== host) throw new Error('TLS authority mismatch');
      socket.pause();
      const address = await upstreamAddress(host);
      if (socket.destroyed) return;
      upstream = net.connect({ host: address, port: 443 });
      upstream.setTimeout(120_000, close);
      upstream.on('error', close);
      upstream.on('connect', () => {
        upstream.write(hello);
        socket.pipe(upstream).pipe(socket);
        socket.resume();
      });
    } catch { close(); }
  });
  let downloads = 0;
  const registry = http.createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method) || downloads >= 8) { fail(response); return; }
    downloads += 1;
    try {
      // No client header, cookie, authorization, body, or alternate upstream is forwarded.
      const result = await fetchRegistry(request.method, registryPath(request.url));
      response.writeHead(result.status, { 'content-type': result.contentType, 'content-length': result.body.length });
      response.end(result.body);
    } catch { fail(response); }
    finally { downloads -= 1; }
  });
  registry.on('connect', (_request, socket) => socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'));
  for (const server of [proxy, registry]) {
    server.requestTimeout = 30_000;
    server.headersTimeout = 10_000;
    server.maxConnections = 80;
    server.on('clientError', (_error, socket) => socket.destroy());
  }
  proxy.listen(8080, '0.0.0.0');
  registry.listen(8081, '0.0.0.0');
  return { proxy, registry };
}

if (process.argv[1]?.endsWith('/gateway.mjs')) startGateway(process.env.CODEAI_GATEWAY_PROVIDER);
