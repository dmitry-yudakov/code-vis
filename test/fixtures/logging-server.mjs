import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const mode = process.argv[2];
if (mode === 'broken-console') {
  const [stream, pidFile, stoppedFile] = process.argv.slice(3);
  writeFileSync(pidFile, String(process.pid));
  process.on('SIGTERM', () => {
    writeFileSync(stoppedFile, 'stopped');
    const tail = process.argv[6] === 'large' ? `shutdown tail ${'x'.repeat(2 * 1024 * 1024)}\n` : 'shutdown tail';
    process.stdout.write(tail, () => process.exit(0));
  });
  process[stream].write('ready\n');
  setInterval(() => process[stream].write('still running\n'), 100);
} else if (mode === 'signals') {
  process.on('SIGUSR2', () => process.stdout.write('rollback received\n'));
  process.on('SIGTERM', () => { process.stdout.write('shutdown tail'); process.exit(0); });
  process.stdout.write('ready\n');
  setInterval(() => {}, 1000);
} else if (mode === 'signal-exit') {
  process.kill(process.pid, 'SIGTERM');
} else {
  console.log(`server ${process.env.NODE_ENV} ${process.argv.slice(2).join('|')}`);
  console.error('server error');
  const child = spawn(process.execPath, ['-e', 'console.log("inherited child"); console.error("inherited child error")'], { stdio: 'inherit' });
  child.on('close', () => {
    process.stdout.write('trailing partial');
    process.exit(7);
  });
}
