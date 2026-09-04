import { loadEnvConfig } from '@next/env';
import { getConfig } from '../src/server/config';
import { machinePairResponseSchema } from '../src/shared/machineSchema';
import { boundedResponseText } from '../src/server/machines/machineClient';
import { MachineRegistry } from '../src/server/machines/machineRegistry';
import { getSessionStore, readStoredMachineIdentity } from '../src/server/storage/sessionStore';

function exactHttpsOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('The executor origin must be an exact HTTPS origin.'); }
  if (
    url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/'
    || url.search || url.hash
  ) {
    throw new Error('The executor origin must be an exact HTTPS origin.');
  }
  return url.origin;
}

async function main() {
  loadEnvConfig(process.cwd());
  const [rawOrigin, code, ...extra] = process.argv.slice(2);
  if (!rawOrigin || !code || extra.length) {
    throw new Error('Usage: npm run machine:attach -- <https-origin> <pairing-code>');
  }
  const origin = exactHttpsOrigin(rawOrigin);
  const config = getConfig();
  let localMachine = await readStoredMachineIdentity(config.dataDir);
  if (!localMachine) {
    const store = getSessionStore(config.dataDir, config.hostLabel);
    try { localMachine = await store.host(); } finally { await store.close(); }
  }
  const response = await fetch(`${origin}/api/machine/pair`, {
    method: 'POST',
    redirect: 'error',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ code, machine: localMachine }),
    signal: AbortSignal.timeout(10_000),
  });
  const raw = await boundedResponseText(response, 32_000);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { throw new Error(`Executor pairing returned ${response.status} with invalid JSON.`); }
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
      ? body.error : `Executor pairing returned ${response.status}.`;
    throw new Error(message);
  }
  const parsed = machinePairResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error('Executor pairing response does not match the machine contract.');
  const registry = new MachineRegistry(config.dataDir);
  try {
    if (parsed.data.machine.id === localMachine.id) throw new Error('A machine cannot attach to itself.');
    await registry.attach({
      machine: parsed.data.machine,
      origin,
      credential: parsed.data.credential,
      expiresAt: parsed.data.expiresAt,
    });
  } catch (error) {
    await fetch(`${origin}/api/machine/attachment`, {
      method: 'DELETE',
      redirect: 'error',
      headers: { Authorization: `Bearer ${parsed.data.credential}` },
      signal: AbortSignal.timeout(5_000),
    }).catch(() => undefined);
    throw error;
  }
  process.stdout.write(`Attached ${parsed.data.machine.label} (${parsed.data.machine.id}) at ${origin}.\n`);
}

main().catch((error) => {
  process.stderr.write(`Could not attach machine: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
