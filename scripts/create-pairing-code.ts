import { getConfig } from '../src/server/config';
import { DeviceAuthStore } from '../src/server/devices/deviceAuthStore';
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());
  const config = getConfig();
  if (config.remoteAccess !== 'paired' || !config.publicOrigin) {
    throw new Error('Set CODEAI_REMOTE_ACCESS=paired and CODEAI_PUBLIC_ORIGIN before creating a pairing code.');
  }
  const challenge = await new DeviceAuthStore(config.dataDir).issuePairingCode();
  process.stdout.write([
    `Pair a personal device at ${config.publicOrigin}`,
    `Code: ${challenge.code}`,
    `Expires: ${challenge.expiresAt}`,
    'Creating another code replaces this one.',
    '',
  ].join('\n'));
}

main().catch((error) => {
  process.stderr.write(`Could not create a pairing code: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
