import { loadEnvConfig } from '@next/env';
import { getConfig } from '../src/server/config';
import { MachineRegistry } from '../src/server/machines/machineRegistry';

async function main() {
  loadEnvConfig(process.cwd());
  const [machineId, ...extra] = process.argv.slice(2);
  if (!machineId || extra.length || !/^[0-9a-f-]{36}$/i.test(machineId)) {
    throw new Error('Usage: npm run machine:detach -- <machine-id>');
  }
  const registry = new MachineRegistry(getConfig().dataDir);
  const connection = await registry.get(machineId);
  let revoked = false;
  try {
    const response = await fetch(`${connection.origin}/api/machine/attachment`, {
      method: 'DELETE',
      redirect: 'error',
      headers: { Authorization: `Bearer ${connection.credential}` },
      signal: AbortSignal.timeout(5_000),
    });
    revoked = response.ok;
  } catch {
    // Local removal is still useful while a laptop sleeps. The executor-side credential expires
    // automatically and can be revoked from that machine when it returns.
  }
  await registry.remove(machineId);
  process.stdout.write(`Detached ${connection.machine.label}. Remote credential ${revoked ? 'revoked' : 'could not be reached; it will expire on the executor. Run machine:peers and machine:revoke there before reattaching'}.\n`);
}

main().catch((error) => {
  process.stderr.write(`Could not detach machine: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
