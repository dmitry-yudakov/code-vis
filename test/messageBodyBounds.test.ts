import { afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/agent/message/route';

afterEach(() => vi.unstubAllEnvs());

describe('whole message body admission', () => {
  for (const declaredLength of [undefined, '1']) it(`bounds streamed bytes with Content-Length ${declaredLength ?? 'absent'}`, async () => {
    vi.stubEnv('CODEAI_REMOTE_ACCESS', 'local');
    let chunks = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (chunks++ < 7) controller.enqueue(new Uint8Array(1_000_000).fill(32));
        else controller.close();
      },
    });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (declaredLength) headers['Content-Length'] = declaredLength;
    const request = new Request('http://localhost/api/agent/message', { method: 'POST', body, headers, duplex: 'half' } as RequestInit);
    const response = await POST(request);
    expect(response.status).toBe(413);
    expect((await response.json()).error).toContain('large');
  });
});
