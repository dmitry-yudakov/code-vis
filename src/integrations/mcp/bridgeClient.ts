import { lstat, readFile } from 'node:fs/promises';
import { mcpConnectionSchema, MCP_REQUEST_BYTES, MCP_RESPONSE_BYTES, type McpConnection } from '../../shared/mcp';
import { readWorkspaceStream } from '../../shared/workspaceStream';

export async function readMcpConnection(file: string): Promise<McpConnection> {
  try {
    const info = await lstat(file);
    if (!info.isFile() || (info.mode & 0o077) || (process.getuid && info.uid !== process.getuid()) || info.size > 4096) throw new Error();
    const connection = mcpConnectionSchema.parse(JSON.parse(await readFile(file, 'utf8')));
    const url = new URL(connection.origin);
    if (url.origin !== connection.origin || url.username || url.password || (url.protocol !== 'https:' &&
      (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error();
    return connection;
  } catch { throw new Error('MCP connection is missing, invalid or not private. Run npm run mcp:grant and use its connection path.'); }
}
export class BridgeClientError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
/** This client imports no server modules and never opens session storage or providers. */
export class McpBridgeClient {
  constructor(readonly connection: McpConnection) {}
  private async request(method: string, body?: string, signal?: AbortSignal) {
    let response: Response;
    try {
      response = await fetch(`${this.connection.origin}/api/integrations/mcp`, { method, body,
        headers: { Authorization: `CodeAI-MCP ${this.connection.credential}`, Origin: this.connection.origin,
          'x-codeai-machine-id': this.connection.machineId, 'x-codeai-grant-id': this.connection.grantId, 'Content-Type': 'application/json' },
        redirect: 'error', cache: 'no-store', signal });
    } catch { throw new BridgeClientError('Cannot reach CodeAI. Start the configured server and check its origin and certificate trust.', 503); }
    if (!response.ok) {
      const raw = await this.bounded(response);
      const error = JSON.parse(raw).error;
      throw new BridgeClientError(error?.message || 'CodeAI refused the integration request.', response.status);
    }
    return response;
  }
  private async bounded(response: Response) {
    if (!response.body) throw new Error('CodeAI returned no response.');
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) { const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > MCP_RESPONSE_BYTES) throw new Error('CodeAI response exceeds 64 KiB.'); chunks.push(value); }
      return Buffer.concat(chunks).toString('utf8');
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  }
  async call(operation: string, input: unknown = {}, timeoutMs = 120_000): Promise<Record<string, unknown>> {
    const body = JSON.stringify({ operation, input });
    if (Buffer.byteLength(body) > MCP_REQUEST_BYTES) throw new Error('MCP operation exceeds 16 KiB.');
    return JSON.parse(await this.bounded(await this.request('POST', body, AbortSignal.timeout(timeoutMs))));
  }
  async subscribe(receive: (header: Record<string, unknown>) => void, signal: AbortSignal) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) controller.abort();
    let watchdog = setTimeout(abort, 20_000);
    const alive = () => { clearTimeout(watchdog); watchdog = setTimeout(abort, 20_000); };
    try {
      const response = await this.request('GET', undefined, controller.signal);
      if (!response.headers.get('content-type')?.includes('application/x-ndjson')) throw new Error('CodeAI returned an invalid workspace stream.');
      await readWorkspaceStream<Record<string, unknown>>(response, { snapshot: value => {
        const machine = value.machine as { id?: string } | undefined;
        if (machine?.id !== this.connection.machineId) throw new BridgeClientError('CodeAI machine identity changed.', 409);
        alive(); receive(value);
      }, heartbeat: alive }, MCP_RESPONSE_BYTES);
    } finally { clearTimeout(watchdog); signal.removeEventListener('abort', abort); controller.abort(); }
  }
}
