import { test as base, type Page, type Route } from '@playwright/test';
export * from '@playwright/test';

/** Route.fulfill cannot leave a body open. Keep mocked snapshots on an explicitly controlled stream. */
export const test = base.extend<{ arenaStreamMocks: void }>({ arenaStreamMocks: [async ({ page }, use) => {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    const subscribers = new Set<(snapshot: unknown) => void>();
    (window as typeof window & { pushArenaSnapshot?: () => Promise<void> }).pushArenaSnapshot = async () => {
      const response = await original('/api/arena', { headers: { Accept: 'application/json' }, cache: 'no-store' });
      const snapshot: unknown = await response.json();
      for (const subscriber of subscribers) subscriber(snapshot);
    };
    window.fetch = async (input, init) => {
      const response = await original(input, init);
      if (response.headers.get('x-e2e-arena-stream') !== 'controlled') return response;
      const reader = response.body!.getReader();
      let stop = () => undefined as void;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          let closed = false;
          const send = (value: object) => { if (!closed) controller.enqueue(new TextEncoder().encode(`${JSON.stringify(value)}\n`)); };
          const publish = (snapshot: unknown) => send({ type: 'snapshot', snapshot });
          subscribers.add(publish);
          const timer = setInterval(() => send({ type: 'heartbeat' }), 5_000);
          const abort = () => {
            if (closed) return;
            stop();
            controller.error(new Error('Mock subscription aborted'));
          };
          stop = () => {
            closed = true; clearInterval(timer); subscribers.delete(publish);
            init?.signal?.removeEventListener('abort', abort);
            void reader.cancel().catch(() => undefined);
          };
          init?.signal?.addEventListener('abort', abort, { once: true });
          if (init?.signal?.aborted) { abort(); return; }
          void (async () => {
            try {
              for (;;) {
                const { done, value } = await reader.read();
                if (done || closed) return;
                controller.enqueue(value);
              }
            } catch (cause) { if (!closed) { stop(); controller.error(cause); } }
          })();
        },
        cancel() { stop(); },
      });
      return new Response(stream, { headers: response.headers, status: response.status });
    };
  });
  await use();
}, { auto: true }] });

export function fetchArenaSnapshot(route: Route) {
  return route.fetch({ headers: { ...route.request().headers(), accept: 'application/json' } });
}

export function fulfillArenaSnapshot(route: Route, options: Parameters<Route['fulfill']>[0]) {
  if (!route.request().headers().accept?.includes('application/x-ndjson') || (options?.status ?? 200) >= 400) return route.fulfill(options);
  const { json, ...rest } = options!;
  return route.fulfill({ ...rest, contentType: 'application/x-ndjson',
    headers: { ...rest.headers, 'content-type': 'application/x-ndjson', 'x-e2e-arena-stream': 'controlled' },
    body: `${JSON.stringify({ type: 'snapshot', snapshot: json })}\n`,
  });
}

/** Simulate one producer notification after changing the intercepted snapshot. */
export async function pushArenaSnapshot(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await (window as typeof window & { pushArenaSnapshot(): Promise<void> }).pushArenaSnapshot();
  });
}

export async function restartArenaSubscription(page: Page): Promise<void> {
  await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/api/arena'
      && Boolean(response.request().headers().accept?.includes('application/x-ndjson'))),
    page.evaluate(() => window.dispatchEvent(new Event('focus'))),
  ]);
}
