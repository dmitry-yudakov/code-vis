import { afterEach, describe, expect, test, vi } from 'vitest';
import { getDefaultSocketUrl } from './socketUrl';

const remoteDevLocation = {
  hostname: 'code-map.internal',
  origin: 'http://code-map.internal:3000',
  protocol: 'http:',
};
const localDevLocation = {
  hostname: 'localhost',
  origin: 'http://localhost:3000',
  protocol: 'http:',
};

describe('getDefaultSocketUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('uses VITE_SOCKET_URL when configured', () => {
    vi.stubEnv('VITE_SOCKET_URL', ' http://code-map.internal:3789 ');

    expect(getDefaultSocketUrl(remoteDevLocation)).toBe(
      'http://code-map.internal:3789'
    );
  });

  test('ignores a localhost socket override for a remote browser', () => {
    vi.stubEnv('VITE_SOCKET_URL', 'ws://localhost:3789');

    expect(getDefaultSocketUrl(remoteDevLocation)).toBe(
      'http://code-map.internal:3000'
    );
  });

  test('keeps a localhost socket override for a local browser', () => {
    vi.stubEnv('VITE_SOCKET_URL', 'ws://localhost:3789');

    expect(getDefaultSocketUrl(localDevLocation)).toBe('ws://localhost:3789');
  });

  test('uses the current Vite origin in development', () => {
    vi.stubEnv('VITE_SOCKET_URL', '');

    expect(getDefaultSocketUrl(remoteDevLocation)).toBe(
      'http://code-map.internal:3000'
    );
  });
});
