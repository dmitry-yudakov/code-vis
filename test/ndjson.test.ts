import { describe, expect, it } from 'vitest';
import { readNdjson } from '@/features/conversation/ndjson';

describe('readNdjson', () => {
  it('handles arbitrary chunks, blank lines, and a final line without newline', async () => {
    const chunks = ['{"a":', '1}\n\n{"b":2', '}'];
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    });
    const values = [];
    for await (const value of readNdjson(new Response(stream))) values.push(value);
    expect(values).toEqual([{ a: 1 }, { b: 2 }]);
  });
});
