import type { ProjectSummary } from '@/shared/types';

export function groupProjects(
  projects: readonly ProjectSummary[],
  recentProjectIds: readonly string[],
): { recent: ProjectSummary[]; other: ProjectSummary[] } {
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const seen = new Set<string>();
  const recent = recentProjectIds.flatMap((id) => {
    const project = projectById.get(id);
    if (!project || seen.has(id)) return [];
    seen.add(id);
    return [project];
  });
  return { recent, other: projects.filter((project) => !seen.has(project.id)) };
}
