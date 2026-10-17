import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// Exercise the real loopback listener in a child so a malformed-request crash is observable.
test('preview rejects malformed targets without crashing and serves only the allowlisted assets', () => {
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { request } from 'node:http';
    import { once } from 'node:events';
    import { preview } from './serve.mjs';
    const server = preview(0);
    await once(server, 'listening');
    assert.equal(server.address().address, '127.0.0.1');
    const send = (path, method = 'GET') => new Promise((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port: server.address().port, path, method }, res => {
        let body = ''; res.setEncoding('utf8'); res.on('data', value => body += value);
        res.on('end', () => resolve({ status: res.statusCode, body, type: res.headers['content-type'] }));
      });
      req.on('error', reject); req.end();
    });
    try {
      assert.equal((await send('http://[')).status, 400);
      const home = await send('/'); assert.equal(home.status, 200); assert.match(home.body, /CodeAI/);
      assert.equal((await send('/style.css')).status, 200);
      assert.equal((await send('/workflow.js')).status, 200);
      assert.equal((await send('/mark.svg')).status, 200);
      const head = await send('/', 'HEAD'); assert.equal(head.status, 200); assert.equal(head.body, '');
      assert.equal((await send('/README.md')).status, 404);
      assert.equal((await send('/../package.json')).status, 404);
      assert.equal((await send('/', 'POST')).status, 404);
    } finally { await new Promise(resolve => server.close(resolve)); }
  `], { cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 10000 });
  assert.equal(run.error, undefined, run.error?.message);
  assert.equal(run.status, 0, run.stderr || run.stdout);
});
