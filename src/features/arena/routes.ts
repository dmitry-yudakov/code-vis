export type ArenaSection = 'sessions' | 'inbox' | 'archived';

export const ARENA_SECTION_PATHS: Record<ArenaSection, string> = {
  sessions: '/arena',
  inbox: '/arena/inbox',
  archived: '/arena/archived',
};

export function arenaSectionForPathname(pathname: string): ArenaSection | undefined {
  const entry = Object.entries(ARENA_SECTION_PATHS)
    .find(([, routePath]) => routePath === pathname);
  return entry?.[0] as ArenaSection | undefined;
}
