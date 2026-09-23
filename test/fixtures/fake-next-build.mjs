#!/usr/bin/env node
// Stands in for `next build` under the start:managed parent. Like the real build it rewrites
// next-env.d.ts and tsconfig.json for its build directory. <root>/build-behavior changes the run:
// fail, hang, no-id, id-then-fail; <root>/candidate-behavior is copied into the new release.
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const slot = process.env.CODEAI_DIST_DIR;
const directory = path.join(root, slot);
const read = (file) => { try { return readFileSync(file, 'utf8').trim(); } catch { return ''; } };
const behavior = read(path.join(root, 'build-behavior'));
appendFileSync(path.join(root, 'events.log'), `build ${slot} node_env=${process.env.NODE_ENV} root_override=${process.env.CODEAI_INSTALLATION_ROOT || '-'} marked=${process.env.CODEAI_MANAGED_SERVER || '-'} args=${process.argv.slice(2).join(',')}\n`);
writeFileSync(path.join(root, 'next-env.d.ts'), `import "./${slot}/types/routes.d.ts";\n`);
writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ include: [`${slot}/types/**/*.ts`] }));
mkdirSync(directory, { recursive: true });
if (behavior === 'hang') setInterval(() => undefined, 60_000);
else {
  const releaseId = `release-${Date.now()}-${Math.floor(Math.random() * 1_000)}`;
  if (behavior !== 'no-id' && behavior !== 'fail') writeFileSync(path.join(directory, 'BUILD_ID'), releaseId);
  if (existsSync(path.join(root, 'candidate-behavior'))) copyFileSync(path.join(root, 'candidate-behavior'), path.join(directory, 'behavior'));
  process.exit(behavior === 'fail' || behavior === 'id-then-fail' ? 1 : 0);
}
