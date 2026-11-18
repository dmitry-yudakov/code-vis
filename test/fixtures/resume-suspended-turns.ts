// A fresh process with no browser or managed parent, exercising manual-restart recovery.
import { resumeSuspendedTurns } from '../../src/server/lifecycle/resumeSuspendedTurns';
import { runRegistry } from '../../src/server/runs/runRegistry';
import { getSessionStore } from '../../src/server/storage/sessionStore';
import { getConfig } from '../../src/server/config';

async function main() {
  const serverLifetime = setInterval(() => undefined, 1_000);
  try {
    await resumeSuspendedTurns();
    await Promise.all(runRegistry.currentRuns.map(run => runRegistry.wait(run.runId)));
    await getSessionStore(getConfig().dataDir).close();
  } finally { clearInterval(serverLifetime); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
