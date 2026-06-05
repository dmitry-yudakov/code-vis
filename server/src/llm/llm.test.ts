import { EventEmitter } from 'events';
import { createOpenAiCompatibleClient } from './openaiCompatible';
import { createCliAgentClient } from './cliAgent';
import { getLlmClient } from './index';

// Spy on spawn rather than jest.mock(): ts-jest 26's jest.mock() hoist
// transformer calls ts.getMutableClone, which TS 5.x removed (the documented
// toolchain mismatch). jest.spyOn is a plain runtime call — no hoisting.
// We spy on the real require()'d module (writable props) — the same cached
// object cliAgent's `import { spawn }` resolves to — not an `import * as`
// namespace, whose __importStar copy has non-configurable getter props.
const childProcess = require('child_process') as typeof import('child_process');
const spawnSpy = jest.spyOn(childProcess, 'spawn');
afterAll(() => spawnSpy.mockRestore());

/** A fake ChildProcess: EventEmitter for the process + stdout/stderr streams,
 *  and a stdin stub recording what the adapter writes. */
function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { end: jest.Mock };
    kill: jest.Mock;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end: jest.fn() };
  child.kill = jest.fn();
  return child;
}

/** Create a fake child and wire it as the next spawn() return value. */
function mockSpawnOnce() {
  const child = fakeChild();
  spawnSpy.mockReturnValue(
    child as unknown as import('child_process').ChildProcess
  );
  return child;
}

/** Build a Response-like stub for the global fetch mock. */
function okJson(payload: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  jest.clearAllMocks();
});

describe('openaiCompatible adapter', () => {
  test('success returns the assistant message text', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(
        okJson({ choices: [{ message: { content: '{"ok":true}' } }] })
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = createOpenAiCompatibleClient({
      baseUrl: 'http://localhost:11434/v1',
      model: 'qwen2.5-coder',
    });
    const text = await client.complete({ system: 's', user: 'u' });

    expect(text).toBe('{"ok":true}');
    expect(client.id).toBe('openai-compatible(qwen2.5-coder)');

    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe('http://localhost:11434/v1/chat/completions');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('qwen2.5-coder');
    expect(body.temperature).toBe(0);
    expect(body.messages).toEqual([
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
    ]);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  test('no Authorization header when no apiKey; present when set', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(okJson({ choices: [{ message: { content: 'x' } }] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await createOpenAiCompatibleClient({
      baseUrl: 'http://local/v1',
      model: 'm',
    }).complete({ system: 's', user: 'u' });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();

    await createOpenAiCompatibleClient({
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      apiKey: 'sk-test',
    }).complete({ system: 's', user: 'u' });
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe(
      'Bearer sk-test'
    );
  });

  test('jsonMode:false omits response_format', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(okJson({ choices: [{ message: { content: 'x' } }] }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await createOpenAiCompatibleClient({
      baseUrl: 'http://local/v1',
      model: 'm',
      jsonMode: false,
    }).complete({ system: 's', user: 'u' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.response_format).toBeUndefined();
  });

  test('throws on non-2xx', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      text: async () => 'kaboom',
      json: async () => ({}),
    }) as unknown as typeof fetch;

    const client = createOpenAiCompatibleClient({
      baseUrl: 'http://local/v1',
      model: 'm',
    });
    await expect(client.complete({ system: 's', user: 'u' })).rejects.toThrow(
      /500 Server Error/
    );
  });

  test('throws when choices[0].message.content is missing', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(okJson({ choices: [] })) as unknown as typeof fetch;

    const client = createOpenAiCompatibleClient({
      baseUrl: 'http://local/v1',
      model: 'm',
    });
    await expect(client.complete({ system: 's', user: 'u' })).rejects.toThrow(
      /missing choices\[0\]\.message\.content/
    );
  });

  test('throws a timeout error when the request is aborted', async () => {
    // fetch that never resolves until its signal aborts.
    global.fetch = jest.fn(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            const e = new Error('aborted');
            e.name = 'AbortError';
            reject(e);
          });
        })
    ) as unknown as typeof fetch;

    jest.useFakeTimers();
    try {
      const client = createOpenAiCompatibleClient({
        baseUrl: 'http://local/v1',
        model: 'm',
      });
      const pending = client.complete({ system: 's', user: 'u', timeoutMs: 50 });
      jest.advanceTimersByTime(60);
      await expect(pending).rejects.toThrow(/timed out after 50ms/);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('cliAgent adapter', () => {
  test('claude: stdout JSON envelope → parsed result text', async () => {
    const child = mockSpawnOnce();

    const client = createCliAgentClient({ provider: 'claude-code' });
    expect(client.id).toBe('cli(claude)');
    const pending = client.complete({ system: 's', user: 'u' });

    child.stdout.emit(
      'data',
      JSON.stringify({ type: 'result', is_error: false, result: '{"ok":true}' })
    );
    child.emit('close', 0);

    await expect(pending).resolves.toBe('{"ok":true}');

    const [cmd, args] = spawnSpy.mock.calls[0];
    expect(cmd).toBe('claude');
    expect(args).toEqual(
      expect.arrayContaining([
        '-p',
        '--output-format',
        'json',
        '--append-system-prompt',
        's',
        '--allowedTools',
        '',
      ])
    );
    // The user prompt is fed on stdin, then stdin is closed.
    expect(child.stdin.end).toHaveBeenCalledWith('u');
  });

  test('claude: --model passed through when set', async () => {
    const child = mockSpawnOnce();

    const pending = createCliAgentClient({
      provider: 'claude-code',
      model: 'opus',
    }).complete({ system: 's', user: 'u' });
    child.stdout.emit(
      'data',
      JSON.stringify({ is_error: false, result: 'x' })
    );
    child.emit('close', 0);
    await pending;

    const args = spawnSpy.mock.calls[0][1];
    expect(args).toEqual(expect.arrayContaining(['--model', 'opus']));
  });

  test('codex: parses the last agent_message from the JSONL stream', async () => {
    const child = mockSpawnOnce();

    const client = createCliAgentClient({ provider: 'codex' });
    expect(client.id).toBe('cli(codex)');
    const pending = client.complete({ system: 's', user: 'u' });

    const lines =
      [
        'Reading prompt from stdin...', // non-JSON preamble is ignored
        JSON.stringify({ type: 'thread.started' }),
        JSON.stringify({
          type: 'item.completed',
          item: { type: 'agent_message', text: '{"ok":true}' },
        }),
        JSON.stringify({ type: 'turn.completed' }),
      ].join('\n') + '\n';
    child.stdout.emit('data', lines);
    child.emit('close', 0);

    await expect(pending).resolves.toBe('{"ok":true}');

    const [cmd, args] = spawnSpy.mock.calls[0];
    expect(cmd).toBe('codex');
    expect(args).toEqual(expect.arrayContaining(['exec', '--json']));
    // Codex has no system-prompt flag → system is prepended to the prompt.
    expect(child.stdin.end).toHaveBeenCalledWith('s\n\nu');
  });

  test('bin override is honored', async () => {
    const child = mockSpawnOnce();
    const pending = createCliAgentClient({
      provider: 'claude-code',
      bin: '/opt/claude',
    }).complete({ system: 's', user: 'u' });
    child.stdout.emit('data', JSON.stringify({ is_error: false, result: 'x' }));
    child.emit('close', 0);
    await pending;
    expect(spawnSpy.mock.calls[0][0]).toBe('/opt/claude');
  });

  test('non-zero exit throws (with stderr detail)', async () => {
    const child = mockSpawnOnce();
    const pending = createCliAgentClient({ provider: 'claude-code' }).complete({
      system: 's',
      user: 'u',
    });
    child.stderr.emit('data', 'boom');
    child.emit('close', 1);
    await expect(pending).rejects.toThrow(/exited with code 1 — boom/);
  });

  test('spawn error (missing binary) fails fast with a clear message', async () => {
    const child = mockSpawnOnce();
    const pending = createCliAgentClient({
      provider: 'claude-code',
      bin: 'nope',
    }).complete({ system: 's', user: 'u' });
    child.emit('error', new Error('spawn nope ENOENT'));
    await expect(pending).rejects.toThrow(/failed to start: spawn nope ENOENT/);
  });

  test('claude: unparseable stdout throws', async () => {
    const child = mockSpawnOnce();
    const pending = createCliAgentClient({ provider: 'claude-code' }).complete({
      system: 's',
      user: 'u',
    });
    child.stdout.emit('data', 'not json at all');
    child.emit('close', 0);
    await expect(pending).rejects.toThrow(/unparseable JSON/);
  });

  test('claude: is_error envelope throws', async () => {
    const child = mockSpawnOnce();
    const pending = createCliAgentClient({ provider: 'claude-code' }).complete({
      system: 's',
      user: 'u',
    });
    child.stdout.emit(
      'data',
      JSON.stringify({ is_error: true, result: 'rate limited' })
    );
    child.emit('close', 0);
    await expect(pending).rejects.toThrow(/reported an error: rate limited/);
  });

  test('codex: no agent_message event throws', async () => {
    const child = mockSpawnOnce();
    const pending = createCliAgentClient({ provider: 'codex' }).complete({
      system: 's',
      user: 'u',
    });
    child.stdout.emit('data', JSON.stringify({ type: 'turn.completed' }) + '\n');
    child.emit('close', 0);
    await expect(pending).rejects.toThrow(/no agent_message event/);
  });

  test('timeout kills the child and throws', async () => {
    const child = mockSpawnOnce();
    jest.useFakeTimers();
    try {
      const pending = createCliAgentClient({ provider: 'claude-code' }).complete({
        system: 's',
        user: 'u',
        timeoutMs: 50,
      });
      jest.advanceTimersByTime(60);
      await expect(pending).rejects.toThrow(/timed out after 50ms/);
      expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('getLlmClient factory', () => {
  const SNAPSHOT = { ...process.env };
  const LLM_KEYS = [
    'CODEAI_LLM_PROVIDER',
    'CODEAI_LLM_BASE_URL',
    'CODEAI_LLM_MODEL',
    'CODEAI_LLM_API_KEY',
    'CODEAI_LLM_JSON_MODE',
    'CODEAI_LLM_TIMEOUT_MS',
    'CODEAI_LLM_CLI_BIN',
    'CODEAI_LLM_CLI_MODEL',
  ];
  beforeEach(() => {
    for (const k of LLM_KEYS) delete process.env[k];
  });
  afterAll(() => {
    process.env = SNAPSHOT;
  });

  test('null when nothing is configured', () => {
    expect(getLlmClient()).toBeNull();
  });

  test('openaiCompatible when BASE_URL + MODEL set (provider inferred)', () => {
    process.env.CODEAI_LLM_BASE_URL = 'https://api.openai.com/v1';
    process.env.CODEAI_LLM_MODEL = 'gpt-4o-mini';
    const client = getLlmClient();
    expect(client).not.toBeNull();
    expect(client!.id).toBe('openai-compatible(gpt-4o-mini)');
  });

  test('null when only BASE_URL set (incomplete config)', () => {
    process.env.CODEAI_LLM_BASE_URL = 'https://api.openai.com/v1';
    expect(getLlmClient()).toBeNull();
  });

  test('explicit openai-compatible provider but no config → null', () => {
    process.env.CODEAI_LLM_PROVIDER = 'openai-compatible';
    expect(getLlmClient()).toBeNull();
  });

  test('Stage 2 providers return a cliAgent client', () => {
    process.env.CODEAI_LLM_PROVIDER = 'claude-code';
    const claude = getLlmClient();
    expect(claude).not.toBeNull();
    expect(claude!.id).toBe('cli(claude)');

    process.env.CODEAI_LLM_PROVIDER = 'codex';
    const codex = getLlmClient();
    expect(codex).not.toBeNull();
    expect(codex!.id).toBe('cli(codex)');
  });

  test('cli path ignores the Stage-1 CODEAI_LLM_MODEL (no --model leak)', async () => {
    // Regression: a leftover Stage-1 id like `gpt-oss:20b` must NOT be forwarded
    // as the CLI's --model, or claude|codex exit 1 at startup.
    process.env.CODEAI_LLM_PROVIDER = 'claude-code';
    process.env.CODEAI_LLM_MODEL = 'gpt-oss:20b';
    const child = mockSpawnOnce();

    const pending = getLlmClient()!.complete({ system: 's', user: 'u' });
    child.stdout.emit('data', JSON.stringify({ is_error: false, result: 'x' }));
    child.emit('close', 0);
    await pending;

    expect(spawnSpy.mock.calls[0][1]).not.toContain('--model');
  });

  test('cli path forwards CODEAI_LLM_CLI_MODEL as --model', async () => {
    process.env.CODEAI_LLM_PROVIDER = 'claude-code';
    process.env.CODEAI_LLM_MODEL = 'gpt-oss:20b'; // leftover Stage-1; ignored
    process.env.CODEAI_LLM_CLI_MODEL = 'haiku';
    const child = mockSpawnOnce();

    const pending = getLlmClient()!.complete({ system: 's', user: 'u' });
    child.stdout.emit('data', JSON.stringify({ is_error: false, result: 'x' }));
    child.emit('close', 0);
    await pending;

    expect(spawnSpy.mock.calls[0][1]).toEqual(
      expect.arrayContaining(['--model', 'haiku'])
    );
  });
});
