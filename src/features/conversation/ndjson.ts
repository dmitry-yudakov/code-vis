export async function* readNdjson<T>(response: Response, maxEventBytes = 2_000_000): AsyncGenerator<T> {
  if (!response.body) throw new Error('The response stream is unavailable.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    if (new TextEncoder().encode(buffer).byteLength > maxEventBytes * 2) {
      throw new Error('Agent stream event exceeded its limit.');
    }
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        if (line.length > maxEventBytes) throw new Error('Agent stream event exceeded its limit.');
        yield JSON.parse(line) as T;
      }
      newline = buffer.indexOf('\n');
    }
    if (done) break;
  }
  const finalLine = buffer.trim();
  if (finalLine) yield JSON.parse(finalLine) as T;
}
