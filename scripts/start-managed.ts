import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ManagedServer } from './managedLifecycle';

/**
 * `npm run start:managed`: serve the paired HTTPS server through a parent that can build a new
 * release and swap to it on request. The installation is this script's own checkout, and the
 * command must be run from it; `CODEAI_INSTALLATION_ROOT` is ignored.
 */
async function main(): Promise<void> {
  const root = await realpath(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
  if (await realpath(process.cwd()) !== root) {
    throw new Error(`Run start:managed from the CodeAI installation it belongs to: ${root}`);
  }
  const managed = new ManagedServer({
    root,
    environment: process.env,
    serverArguments: [path.join(root, 'scripts', 'start-remote.mjs')],
    buildArguments: [path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'build'],
    failCandidateOnce: process.env.CODEAI_MANAGED_TEST_FAIL_CANDIDATE === '1',
    log: (line) => process.stdout.write(`[start:managed] ${line}\n`),
    exit: (code) => process.exit(code),
  });
  process.on('SIGUSR2', () => { void managed.previousRelease(); });
  process.on('SIGINT', () => { void managed.shutdown(130); });
  process.on('SIGTERM', () => { void managed.shutdown(143); });
  await managed.start();
}

main().catch((error: unknown) => {
  process.stderr.write(`Could not start managed CodeAI: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
