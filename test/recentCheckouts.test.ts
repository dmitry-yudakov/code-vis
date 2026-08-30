import { describe, expect, it } from 'vitest';
import { recentCheckoutIds } from '@/server/repository/recentCheckouts';
import type { CheckoutSummary, DurableSession, RepositoryBinding } from '@/shared/types';

const hostId = '11111111-1111-4111-8111-111111111111';

function repository(checkoutId: string, role: RepositoryBinding['role'] = 'primary', boundHostId = hostId): RepositoryBinding {
  return { id: crypto.randomUUID(), hostId: boundHostId, checkoutId, role };
}

function activity(updatedAt: string, repositories: RepositoryBinding[]): Pick<DurableSession, 'repositories' | 'updatedAt'> {
  return { repositories, updatedAt };
}

function checkout(id: string): CheckoutSummary {
  return { id, name: id.toUpperCase(), relativePath: id };
}

describe('recent checkouts', () => {
  it('uses each current checkout’s newest local primary session and limits the result to five', () => {
    const checkouts = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(checkout);
    const sessions = [
      activity('2026-08-20T00:00:00.000Z', [repository('a')]),
      activity('2026-08-28T00:00:00.000Z', [repository('a')]),
      activity('2026-08-27T00:00:00.000Z', [repository('b')]),
      activity('2026-08-30T00:00:00.000Z', [repository('b', 'primary', '22222222-2222-4222-8222-222222222222')]),
      activity('2026-08-29T00:00:00.000Z', [repository('c', 'reference')]),
      activity('2026-08-26T00:00:00.000Z', [repository('d')]),
      activity('2026-08-25T00:00:00.000Z', [repository('e')]),
      activity('2026-08-24T00:00:00.000Z', [repository('f')]),
      activity('2026-08-23T00:00:00.000Z', [repository('g')]),
    ];
    expect(recentCheckoutIds(checkouts, sessions, hostId)).toEqual(['a', 'b', 'd', 'e', 'f']);
  });

  it('uses registry order as a deterministic tie breaker', () => {
    const checkouts = ['b', 'a'].map(checkout);
    const sessions = [
      activity('2026-08-28T00:00:00.000Z', [repository('a')]),
      activity('2026-08-28T00:00:00.000Z', [repository('b')]),
    ];
    expect(recentCheckoutIds(checkouts, sessions, hostId)).toEqual(['b', 'a']);
  });
});
