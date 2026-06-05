import { createOpenAiCompatibleClient } from './openaiCompatible';
import { getLlmClient } from './index';

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

describe('getLlmClient factory', () => {
  const SNAPSHOT = { ...process.env };
  const LLM_KEYS = [
    'CODEAI_LLM_PROVIDER',
    'CODEAI_LLM_BASE_URL',
    'CODEAI_LLM_MODEL',
    'CODEAI_LLM_API_KEY',
    'CODEAI_LLM_JSON_MODE',
    'CODEAI_LLM_TIMEOUT_MS',
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

  test('Stage 2 providers no-op (null) until cliAgent lands', () => {
    process.env.CODEAI_LLM_PROVIDER = 'claude-code';
    expect(getLlmClient()).toBeNull();
    process.env.CODEAI_LLM_PROVIDER = 'codex';
    expect(getLlmClient()).toBeNull();
  });
});
