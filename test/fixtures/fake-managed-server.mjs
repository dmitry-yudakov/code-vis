#!/usr/bin/env node
// Stands in for scripts/start-remote.mjs under the start:managed parent. It speaks the private IPC
// contract and records what happened in <root>/events.log. A `behavior` file in the build directory
// it serves lists what to change for its launches: exit, hang, wrong-id, ignore-sigterm, refuse-lease,
// silent-lease, ignore-disconnect.
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const slot = process.env.CODEAI_DIST_DIR;
const log = (line) => appendFileSync(path.join(root, 'events.log'), `${line}\n`);
const read = (file) => { try { return readFileSync(file, 'utf8').trim(); } catch { return ''; } };
const behaviors = new Set(read(path.join(root, slot, 'behavior')).split(/\s+/));
const marked = process.env.CODEAI_MANAGED_SERVER === '1';

log(`start ${slot} pid=${process.pid} marked=${marked} node_env=${process.env.NODE_ENV} root_override=${process.env.CODEAI_INSTALLATION_ROOT || '-'} fail_flag=${process.env.CODEAI_MANAGED_TEST_FAIL_CANDIDATE || '-'}`);
process.on('SIGTERM', () => {
  log(`sigterm ${slot}`);
  if (!behaviors.has('ignore-sigterm')) process.exit(0);
});
// Ends on its own with a code of its choosing, as a crashed server would.
process.on('SIGHUP', () => { log(`crash ${slot}`); process.exit(7); });
// Like start-remote.mjs, never outlive the parent.
process.on('disconnect', () => { if (!behaviors.has('ignore-disconnect')) process.exit(0); });
process.on('SIGUSR1', () => {
  const operationId = read(path.join(root, 'request-id'));
  log(`request ${slot} ${operationId}`);
  process.send({ type: 'lifecycle-request', operationId, action: 'build-and-restart' });
});
process.on('message', (message) => {
  if (message.type === 'lifecycle-init') {
    log(`init ${slot} ${message.slot} ${message.releaseId} root=${message.installationRoot === root} last=${message.lastOperation?.outcome || '-'}`);
    if (behaviors.has('exit')) process.exit(3);
    if (behaviors.has('hang')) return;
    const releaseId = behaviors.has('wrong-id') ? 'not-this-release' : read(path.join(root, slot, 'BUILD_ID'));
    process.send({ type: 'lifecycle-ready', releaseId });
  } else if (message.type === 'lifecycle-state') {
    const { phase, releaseId, candidateReleaseId, lastOperation } = message.snapshot;
    log(`state ${slot} ${phase} ${releaseId} candidate=${candidateReleaseId || '-'} last=${lastOperation?.outcome || '-'}:${lastOperation?.operationId || '-'}`);
  } else if (message.type === 'lifecycle-lease') {
    log(`lease ${slot} ${message.request}`);
    if (message.request === 'acquire' && !behaviors.has('silent-lease')) {
      process.send({ type: 'lifecycle-lease', request: 'acquire', granted: !behaviors.has('refuse-lease') });
    }
  }
});
setInterval(() => undefined, 60_000);
