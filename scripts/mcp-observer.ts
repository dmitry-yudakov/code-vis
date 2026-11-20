import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ResourceUpdatedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { ObserverLoop } from '../src/integrations/mcp/observer';
import { MCP_WORKSPACE_URI } from '../src/shared/mcp';

async function main() {
  const [connection, agentCommand, ...agentArgs] = process.argv.slice(2);
  if (!connection || !agentCommand) throw new Error('Usage: npm run mcp:observer -- CONNECTION_FILE AGENT_COMMAND [ARGUMENTS...]. Agent reads a JSON briefing request on stdin and writes its reply to stdout.');
  let client: Client | undefined; let stopped = false; let delay = 1000; let timer: ReturnType<typeof setTimeout> | undefined;
  let connecting: { client: Client; transport: StdioClientTransport } | undefined;
  let inferenceChild: ChildProcess | undefined;
  let terminateInference: (() => void) | undefined;
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    if (!client) throw new Error('CodeAI unavailable. Last-observed facts may be stale.');
    const result = await client.callTool({ name, arguments: args });
    if (result.isError) throw new Error(JSON.stringify(result.content));
    return (result.structuredContent ?? JSON.parse((result.content as Array<{ text: string }>)[0].text)) as Record<string, unknown>;
  };
  const loop = new ObserverLoop({ workspace: () => call('get_workspace'),
    async sessions() {
      const rows: Array<Record<string, unknown>> = []; let cursor: unknown;
      do { const page = await call('list_sessions', cursor ? { cursor } : {}); rows.push(...page.rows as Array<Record<string, unknown>>); cursor = page.nextCursor; } while (cursor);
      return rows;
    }, detail: id => call('read_session', { sessionId: id }),
    infer: input => new Promise<string>((resolve, reject) => {
      const child = spawn(agentCommand, agentArgs, { stdio: ['pipe', 'pipe', 'inherit'], shell: false });
      inferenceChild = child;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const terminate = () => {
        if (child.exitCode !== null || child.signalCode !== null || killTimer) return;
        child.kill('SIGTERM'); killTimer = setTimeout(() => child.kill('SIGKILL'), 2000); killTimer.unref();
      };
      terminateInference = terminate;
      let output = ''; let failed: Error | undefined;
      const deadline = setTimeout(() => { failed = new Error('External agent timed out.'); terminate(); }, 120_000);
      child.stdout.on('data', chunk => {
        if (failed) return;
        if (Buffer.byteLength(output) + chunk.length > 64 * 1024) { failed = new Error('External agent output exceeded 64 KiB.'); output = ''; terminate(); return; }
        output += chunk.toString();
      });
      child.once('error', reject); child.stdin.once('error', reject); child.once('close', code => {
        clearTimeout(deadline); if (killTimer) clearTimeout(killTimer);
        if (inferenceChild === child) { inferenceChild = undefined; terminateInference = undefined; } if (failed) reject(failed); else if (code === 0) resolve(output.trim()); else reject(new Error('External agent failed. CodeAI work continues.')); });
      child.stdin.end(JSON.stringify(input));
    }),
    say: text => process.stdout.write(`${text}\n`),
    unavailable: () => process.stderr.write('CodeAI unavailable; showing last-observed state. Reconnect rereads saved progress; intermediate transitions may be missed.\n'),
  });
  const connect = async () => {
    if (stopped) return;
    const next = new Client({ name: 'codeai-external-observer-example', version: '1.0.0' });
    const transport = new StdioClientTransport({ command: process.execPath,
      args: ['--import', path.resolve('node_modules/tsx/dist/loader.mjs'), path.resolve('scripts/mcp.ts'), path.resolve(connection)], stderr: 'inherit' });
    connecting = { client: next, transport };
    try {
      await next.connect(transport);
      if (stopped) { await next.close(); return; }
      client = next; delay = 1000;
      next.setNotificationHandler(ResourceUpdatedNotificationSchema, () => loop.changed());
      const resources = next.getServerCapabilities()?.resources;
      if (resources?.subscribe) await next.subscribeResource({ uri: MCP_WORKSPACE_URI });
      if (stopped) { await next.close(); return; }
      loop.resynchronize();
      // Polling also detects stopped bridges when a host's notification channel stays open.
      timer = setInterval(() => loop.changed(), 5000);
      next.onclose = () => { if (client === next) client = undefined; if (timer) clearInterval(timer); timer = undefined; reconnect(); };
    } catch { await transport.close().catch(() => undefined); reconnect(); }
    finally { if (connecting?.client === next) connecting = undefined; }
  };
  const reconnect = () => {
    if (stopped || timer) return;
    process.stderr.write('CodeAI unavailable. Reconnecting; saved progress will be reread and intermediate transitions may have been missed.\n');
    timer = setTimeout(() => { timer = undefined; void connect(); }, delay); delay = Math.min(delay * 2, 30_000);
  };
  const input = createInterface({ input: process.stdin });
  input.on('line', line => {
    if (line.trim() === '/brief') loop.brief();
    // Typed commands are explicit user directions, never generated from session evidence.
    else if (line.startsWith('/tool ')) {
      try { const command = JSON.parse(line.slice(6)); void call(command.name, command.arguments).then(result => process.stdout.write(`${JSON.stringify(result)}\n`), error => process.stderr.write(`${error.message}\n`)); }
      catch { process.stderr.write('Use /tool {"name":"TOOL","arguments":{...}}.\n'); }
    }
  });
  const stop = async () => { stopped = true; loop.stop(); if (timer) clearTimeout(timer); input.close(); terminateInference?.(); await connecting?.transport.close().catch(() => undefined); await client?.close(); };
  process.once('SIGINT', () => void stop()); process.once('SIGTERM', () => void stop());
  process.stderr.write('External Observer: /brief requests a briefing; /tool JSON sends an explicit user-directed tool call. Ctrl+C stops only the observer.\n');
  await connect();
}
main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : 'Observer startup failed.'}\n`); process.exitCode = 1; });
