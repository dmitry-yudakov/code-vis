import { describe, expect, it } from 'vitest';
import { ARENA_SECTION_PATHS, arenaSectionForPathname } from '@/features/arena/routes';

describe('Arena routes', () => {
  it('maps each canonical pathname to one Arena section', () => {
    expect(ARENA_SECTION_PATHS).toEqual({
      sessions: '/arena',
      inbox: '/arena/inbox',
      archived: '/arena/archived',
    });
    expect(arenaSectionForPathname('/arena')).toBe('sessions');
    expect(arenaSectionForPathname('/arena/inbox')).toBe('inbox');
    expect(arenaSectionForPathname('/arena/archived')).toBe('archived');
  });

  it('does not treat the workspace or unknown descendants as Arena destinations', () => {
    expect(arenaSectionForPathname('/')).toBeUndefined();
    expect(arenaSectionForPathname('/arena/not-a-view')).toBeUndefined();
  });
});
