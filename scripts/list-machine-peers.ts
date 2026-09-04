import { loadEnvConfig } from '@next/env';
import { getConfig } from '../src/server/config';
import { MachineAuthStore } from '../src/server/machines/machineAuthStore';

async function main() {
  loadEnvConfig(process.cwd());
  const peers = await new MachineAuthStore(getConfig().dataDir).listPeers();
  if (!peers.length) {
    process.stdout.write('No home machines are authorized on this executor.\n');
    return;
  }
  for (const peer of peers) {
    process.stdout.write(`${peer.id}\t${peer.label}\tpaired ${peer.pairedAt}\texpires ${peer.expiresAt}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`Could not list machine peers: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
