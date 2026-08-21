import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUuid } from '@/shared/uuid';

describe('createUuid', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses crypto.randomUUID when the runtime provides it', () => {
    const uuid = '123e4567-e89b-42d3-a456-426614174000';
    const randomUUID = vi.fn(() => uuid);
    const getRandomValues = vi.fn();
    vi.stubGlobal('crypto', { randomUUID, getRandomValues });

    expect(createUuid()).toBe(uuid);
    expect(randomUUID).toHaveBeenCalledOnce();
    expect(getRandomValues).not.toHaveBeenCalled();
  });

  it('creates an RFC-compatible UUID v4 from random bytes when randomUUID is unavailable', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.set([0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
      return bytes;
    });
    vi.stubGlobal('crypto', { getRandomValues });

    expect(createUuid()).toBe('00112233-4455-4677-8899-aabbccddeeff');
    expect(getRandomValues).toHaveBeenCalledOnce();
  });
});
