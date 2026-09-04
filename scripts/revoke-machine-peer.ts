import { loadEnvConfig } from '@next/env';
import { getConfig } from '../src/server/config';
import { MachineAuthStore } from '../src/server/machines/machineAuthStore';

async function main() {
  loadEnvConfig(process.cwd());
  const [machineId, ...extra] = process.argv.slice(2);
  if (!machineId || extra.length || !/^[0-9a-f-]{36}$/i.test(machineId)) {
    throw new Error('Usage: npm run machine:revoke -- <home-machine-id>');
  }
  const removed = await new MachineAuthStore(getConfig().dataDir).revokeMachine(machineId);
  if (!removed) throw new Error('That home machine is not authorized on this executor.');
  process.stdout.write(`Revoked home machine ${machineId}.\n`);
}

main().catch((error) => {
  process.stderr.write(`Could not revoke machine peer: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
