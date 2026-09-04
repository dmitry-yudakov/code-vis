import { loadEnvConfig } from '@next/env';
import { getConfig } from '../src/server/config';
import { MachineRegistry } from '../src/server/machines/machineRegistry';

async function main() {
  loadEnvConfig(process.cwd());
  const machines = await new MachineRegistry(getConfig().dataDir).list();
  if (!machines.length) {
    process.stdout.write('No remote execution machines are attached.\n');
    return;
  }
  for (const connection of machines) {
    process.stdout.write(`${connection.machine.id}\t${connection.machine.label}\t${connection.origin}\tlast seen ${connection.lastSeenAt || 'never'}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`Could not list machines: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
