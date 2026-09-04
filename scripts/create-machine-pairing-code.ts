import { loadEnvConfig } from '@next/env';
import { getConfig } from '../src/server/config';
import { MachineAuthStore } from '../src/server/machines/machineAuthStore';

async function main() {
  loadEnvConfig(process.cwd());
  const config = getConfig();
  if (config.remoteAccess !== 'paired' || !config.publicOrigin) {
    throw new Error('Set CODEAI_REMOTE_ACCESS=paired and CODEAI_PUBLIC_ORIGIN before creating a machine pairing code.');
  }
  const challenge = await new MachineAuthStore(config.dataDir).issuePairingCode();
  process.stdout.write([
    `Attach this executor at ${config.publicOrigin}`,
    `Code: ${challenge.code}`,
    `Expires: ${challenge.expiresAt}`,
    'Run machine:attach from the home machine. Creating another code replaces this one.',
    '',
  ].join('\n'));
}

main().catch((error) => {
  process.stderr.write(`Could not create a machine pairing code: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
