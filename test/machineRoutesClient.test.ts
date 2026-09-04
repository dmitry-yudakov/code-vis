import { describe, expect, it } from 'vitest';
import { machineApiBase, machineApiPath } from '@/features/machines/routes';

const LOCAL = '11111111-1111-4111-8111-111111111111';
const REMOTE = '22222222-2222-4222-8222-222222222222';

describe('browser machine routes', () => {
  it('keeps local calls unchanged and qualifies every remote API path through the home gateway', () => {
    expect(machineApiPath('/api/sessions?loose=true', LOCAL, LOCAL)).toBe('/api/sessions?loose=true');
    expect(machineApiPath('/api/sessions?loose=true', REMOTE, LOCAL))
      .toBe(`/api/machines/${REMOTE}/sessions?loose=true`);
    expect(machineApiBase(REMOTE, LOCAL)).toBe(`/api/machines/${REMOTE}`);
    expect(() => machineApiPath('/auth/status', REMOTE, LOCAL)).toThrow('must begin with /api/');
  });
});
